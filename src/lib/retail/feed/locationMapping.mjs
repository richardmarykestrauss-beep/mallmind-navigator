/**
 * locationMapping.mjs — ExternalRetailLocationMappingV1 (Sprint 2L-A).
 *
 * A local, versioned, governed contract + deterministic resolver for turning an EXTERNAL
 * retailer branch reference into internal MallMind ids — but ONLY when a unique, approved,
 * currently-valid, unambiguous, provenance-bearing mapping for the SAME retailer exists.
 *
 * Truth boundary: an external branch code/name never yields an internal id on its own, and
 * a mapping proves identity alignment ONLY — never stock, price, product availability,
 * retailer permission, or shopper-publication eligibility. The resolver NEVER silently
 * picks the first of several candidates. Pure + deterministic (no I/O, no network, no DB).
 */

export const MAPPING_CONTRACT_VERSION = "1.0.0";

export const MAPPING_STATUSES = Object.freeze([
  "draft", "pending_review", "approved", "rejected", "expired", "superseded",
]);

export const RESOLUTION_CODES = Object.freeze({
  RESOLVED: "resolved",
  UNMAPPED: "unmapped",
  AMBIGUOUS: "ambiguous",
  MAPPING_UNAPPROVED: "mapping_unapproved",
  MAPPING_EXPIRED: "mapping_expired",
  MAPPING_NOT_YET_VALID: "mapping_not_yet_valid",
  MAPPING_REJECTED: "mapping_rejected",
  MAPPING_SUPERSEDED: "mapping_superseded",
  MAPPING_COLLISION: "mapping_collision",
  RETAILER_MISMATCH: "retailer_mismatch",
  INVALID_MAPPING: "invalid_mapping",
});

const MAPPING_FIELDS = Object.freeze([
  "mapping_id", "mapping_version", "retailer_source_id", "external_branch_id", "external_branch_name",
  "external_mall_id", "external_mall_name", "internal_retailer_id", "internal_shop_id", "internal_mall_id",
  "status", "match_method", "approved_by", "approved_at", "valid_from", "valid_until",
  "source_reference", "notes", "created_at", "updated_at",
]);
export { MAPPING_FIELDS };

const isBlank = (v) => v === null || v === undefined || String(v).trim() === "";
const norm = (v) => String(v ?? "").trim().toLowerCase();
const hasInternalIds = (m) => !isBlank(m.internal_shop_id) && !isBlank(m.internal_mall_id);
const hasProvenance = (m) => !isBlank(m.source_reference);
function withinValidity(m, at) {
  const t = Date.parse(at);
  if (Number.isNaN(t)) return false;
  if (!isBlank(m.valid_from) && t < Date.parse(m.valid_from)) return false;
  if (!isBlank(m.valid_until) && t > Date.parse(m.valid_until)) return false;
  return true;
}

/** Structural validity of a mapping record ([] = valid). */
export function validateMapping(m) {
  const problems = [];
  if (isBlank(m.mapping_id)) problems.push("mapping_id is required");
  if (isBlank(m.retailer_source_id)) problems.push("retailer_source_id is required");
  if (!MAPPING_STATUSES.includes(m.status)) problems.push(`invalid status '${m.status}'`);
  if (isBlank(m.external_branch_id) && isBlank(m.external_branch_name)) problems.push("external_branch_id or external_branch_name is required");
  if (!isBlank(m.valid_from) && Number.isNaN(Date.parse(m.valid_from))) problems.push("valid_from is not a valid timestamp");
  if (!isBlank(m.valid_until) && Number.isNaN(Date.parse(m.valid_until))) problems.push("valid_until is not a valid timestamp");
  return problems;
}

function reasonFor(m, at) {
  const C = RESOLUTION_CODES;
  if (m.status === "rejected") return C.MAPPING_REJECTED;
  if (m.status === "draft" || m.status === "pending_review") return C.MAPPING_UNAPPROVED;
  if (m.status === "superseded") return C.MAPPING_SUPERSEDED;
  if (m.status === "expired") return C.MAPPING_EXPIRED;
  if (m.status === "approved") {
    if (!isBlank(m.valid_from) && Date.parse(at) < Date.parse(m.valid_from)) return C.MAPPING_NOT_YET_VALID;
    if (!withinValidity(m, at)) return C.MAPPING_EXPIRED;
    if (!hasInternalIds(m) || !hasProvenance(m)) return C.INVALID_MAPPING;
  }
  return C.INVALID_MAPPING;
}

/**
 * @param {Array<object>} mappings
 * @param {{ now?: string }} [opts]
 */
export function createLocationResolver(mappings, opts = {}) {
  const all = Array.isArray(mappings) ? mappings : [];
  const now = opts.now ?? "2026-07-31T12:00:00Z";
  const C = RESOLUTION_CODES;

  /**
   * @param {{retailer_source_id?:string, external_branch_id?:string, external_branch_name?:string, at?:string}} q
   */
  function resolve(q) {
    const at = q.at ?? now;
    const rsid = q.retailer_source_id ?? null;

    // Deterministic identity match is by external_branch_id.
    if (!isBlank(q.external_branch_id)) {
      const byBranch = all.filter((m) => m.external_branch_id === q.external_branch_id);
      if (byBranch.length && !byBranch.some((m) => m.retailer_source_id === rsid)) {
        return { outcome: C.RETAILER_MISMATCH, code: C.RETAILER_MISMATCH, explanation: `branch '${q.external_branch_id}' is mapped for a different retailer_source_id` };
      }
      const candidates = byBranch.filter((m) => m.retailer_source_id === rsid);
      if (candidates.length === 0) return { outcome: C.UNMAPPED, code: C.UNMAPPED, explanation: `no mapping for branch '${q.external_branch_id}'` };

      const usable = candidates.filter((m) => m.status === "approved" && withinValidity(m, at) && hasInternalIds(m) && hasProvenance(m));
      if (usable.length > 1) return { outcome: C.MAPPING_COLLISION, code: C.MAPPING_COLLISION, explanation: `${usable.length} approved valid mappings collide for branch '${q.external_branch_id}'` };
      if (usable.length === 1) {
        const m = usable[0];
        return { outcome: C.RESOLVED, code: C.RESOLVED, mapping_id: m.mapping_id,
          internal_retailer_id: m.internal_retailer_id ?? null, internal_shop_id: m.internal_shop_id, internal_mall_id: m.internal_mall_id,
          explanation: `resolved via approved mapping ${m.mapping_id}` };
      }
      // usable === 0
      if (candidates.length > 1) return { outcome: C.MAPPING_COLLISION, code: C.MAPPING_COLLISION, explanation: `${candidates.length} non-usable mappings for branch '${q.external_branch_id}'` };
      const code = reasonFor(candidates[0], at);
      return { outcome: code, code, explanation: `mapping ${candidates[0].mapping_id} not usable (${code})` };
    }

    // Name-only lookups are never deterministic → never resolve; ambiguous if any match.
    if (!isBlank(q.external_branch_name)) {
      const byName = all.filter((m) => m.retailer_source_id === rsid && norm(m.external_branch_name) === norm(q.external_branch_name));
      if (byName.length === 0) return { outcome: C.UNMAPPED, code: C.UNMAPPED, explanation: `no mapping for branch name '${q.external_branch_name}'` };
      return { outcome: C.AMBIGUOUS, code: C.AMBIGUOUS, explanation: `name-only match for '${q.external_branch_name}' is not a deterministic identity (${byName.length} candidate(s))` };
    }

    return { outcome: C.UNMAPPED, code: C.UNMAPPED, explanation: "no external branch identity supplied" };
  }

  return { resolve, mappings: all };
}

/** Adapt a resolver into the importer's opts.resolveBranch(rec) hook. */
export function makeResolveBranch(resolver) {
  return (rec) => resolver.resolve({
    retailer_source_id: rec.retailer_source_id,
    external_branch_id: rec.branch_external_id ?? rec.shop_external_id ?? null,
    external_branch_name: rec.external_branch_name ?? null,
    at: rec.observed_at ?? null,
  });
}
