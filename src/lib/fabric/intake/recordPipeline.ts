/**
 * The ONE controlled per-record path: RawRecord → staged draft (+ evidence) OR
 * duplicate OR conflict OR rejected. A record never partially publishes.
 *
 * Stages: structural validation → taxonomy validation → normalization →
 * source-policy validation → identity candidate → evidence creation →
 * deduplication → conflict detection → draft creation → review-queue placement.
 */

import type { RawRecord, IntakeRecordResult, IntakeState, QuarantineErrorClass } from "./types";
import type { SourceAccessPolicy, ExtractionCandidate, ExtractedField, ConfidenceDimensions, EvidenceRecord } from "../types";
import type { AdapterMode } from "../types";
import { normalizeToDraft, NormalizationError } from "../draft";
import { createEvidence, makeConfidence } from "../evidence";
import { buildIdentityCandidate } from "../identity";
import { structuredHash } from "../hash";
import { sourceCategory } from "@/lib/ingestion/conflicts";
import { isValidSourceType, isValidTrustLabel } from "@/lib/ingestion/labels";
import { sanitizeField, withinFieldLimits } from "./security";

export interface RecordContext {
  job: IntakeState["job"];
  policy: SourceAccessPolicy | undefined;
  state: IntakeState;
  recordIndex: number;
  nowIso: string;
}

/** Map an intake record's source_type onto an access mode (drives scope + trust hint). */
function modeFor(sourceType: string): AdapterMode {
  if (/catalogue/.test(sourceType)) return "catalogue";
  if (/partner/.test(sourceType)) return "merchant_feed";
  if (/product_page|search|specials/.test(sourceType)) return "browser_observation";
  return "manual";
}

const pick = (r: RawRecord, ...keys: string[]): string => {
  for (const k of keys) { const v = r[k]; if (v != null && String(v).trim() !== "") return sanitizeField(v).value.trim(); }
  return "";
};

function toExtraction(r: RawRecord): ExtractionCandidate {
  const f: ExtractedField[] = [];
  const add = (field: string, value: string, confidence: number) => { if (value) f.push({ field, value, confidence }); };
  add("productTitle", pick(r, "product_title", "title", "name"), 0.9);
  add("brand", pick(r, "brand"), 0.85);
  add("model", pick(r, "model", "model_number", "mpn"), 0.85);
  add("sku", pick(r, "sku", "retailer_sku"), 0.8);
  add("gtin", pick(r, "gtin", "ean", "upc", "gtin13"), 0.95);
  add("category", pick(r, "category"), 0.7);
  add("price", pick(r, "price"), 0.85);
  add("currency", pick(r, "currency") || "ZAR", 0.9);
  add("availability", pick(r, "availability_status", "availability"), 0.6);
  add("originalPrice", pick(r, "original_price"), 0.7);
  add("validFrom", pick(r, "valid_from", "promo_start"), 0.7);
  add("validTo", pick(r, "expires_at", "valid_to", "promo_end"), 0.7);
  add("promoText", pick(r, "promo_text"), 0.6);
  return { id: `ext_${structuredHash(r)}`.slice(0, 40), snapshotId: "bulk", candidateType: "offer", fields: f, extractorId: "bulk_intake", extractorVersion: "1.0.0" };
}

function confidenceFor(r: RawRecord): ConfidenceDimensions {
  return makeConfidence({
    identityConfidence: pick(r, "gtin") ? 0.9 : pick(r, "model", "model_number") ? 0.8 : 0.5,
    priceConfidence: pick(r, "price") ? 0.75 : 0,
    availabilityConfidence: pick(r, "availability_status", "availability") ? 0.5 : 0,
    freshnessConfidence: 0.7,
    sourceAuthority: 0.5,
  });
}

const rejected = (errors: string[], warnings: string[], recordHash?: string): IntakeRecordResult => ({ status: "rejected", errors, warnings, recordHash });

/** Classify a normalization error code into a quarantine error class. */
export function classifyNormalizationError(code: string): QuarantineErrorClass {
  if (code === "missing_title") return "structural";
  if (code === "invalid_price" || code === "impossible_price" || code === "unsupported_currency") return "validation";
  return "identity";
}

/** Process one record through the full controlled pipeline. Pure w.r.t. the record. */
export function processIntakeRecord(record: RawRecord, ctx: RecordContext): IntakeRecordResult {
  const warnings: string[] = [];

  // 1. Structural
  if (record == null || typeof record !== "object" || Array.isArray(record)) return rejected(["structural: record is not an object"], warnings);
  if (!withinFieldLimits(record)) return rejected(["structural: too many/oversized fields"], warnings);

  // 2. Taxonomy (only when explicitly provided)
  const rawSourceType = pick(record, "source_type");
  if (rawSourceType && !isValidSourceType(rawSourceType)) return rejected([`validation: unknown source_type "${rawSourceType}"`], warnings);
  const rawTrust = pick(record, "trust_label");
  if (rawTrust && !isValidTrustLabel(rawTrust)) return rejected([`validation: unknown trust_label "${rawTrust}"`], warnings);

  // 3. Source policy — a blocked source can never intake.
  if (ctx.policy?.automationStatus === "blocked") return rejected([`policy: source ${ctx.job.sourceId} is blocked`], warnings);

  // 4. Identity + extraction
  const extraction = toExtraction(record);
  const observedAt = pick(record, "observed_at") || ctx.nowIso;
  const mode = modeFor(rawSourceType);

  // 5. Evidence (created before the draft so lineage is attached).
  const evidence: EvidenceRecord = createEvidence({
    sourceId: ctx.job.sourceId, sourceUrl: pick(record, "source_url") || null, sourceOwner: pick(record, "retailer") || null,
    adapterId: ctx.job.adapterId ?? "bulk_intake", adapterVersion: "1.0.0", lifecycleState: "validated",
    capturedAt: ctx.nowIso, observedAt, contentType: ctx.job.mode === "csv" ? "manual" : "json",
    contentHash: structuredHash(record), extractedText: pick(record, "product_title", "title").slice(0, 120),
    structuredData: { fields: extraction.fields }, extractorId: "bulk_intake", extractorVersion: "1.0.0", fieldConfidence: confidenceFor(record),
  }, ctx.nowIso);

  // 6. Normalize → draft (idempotent draftHash is our record identity).
  let draft;
  try {
    draft = normalizeToDraft(extraction, {
      sourceId: ctx.job.sourceId, adapterId: ctx.job.adapterId ?? "bulk_intake", adapterMode: mode, extractorId: "bulk_intake",
      retailerName: pick(record, "retailer") || null, evidenceIds: [evidence.id], confidence: confidenceFor(record),
      observedAt, nowIso: ctx.nowIso,
    });
  } catch (e) {
    if (e instanceof NormalizationError) return rejected([`${classifyNormalizationError(e.code)}: ${e.message}`], warnings);
    return rejected([`internal: ${(e as Error).message.slice(0, 120)}`], warnings);
  }
  const recordHash = draft.draftHash;

  // 7. Deduplication (identical record → duplicate, not a new draft/evidence).
  if (ctx.state.seen[recordHash]) return { status: "duplicate", recordHash, existingReference: ctx.state.seen[recordHash], warnings };

  // 8. Conflict detection (same product + source category, DIFFERENT price).
  const identityCandidate = buildIdentityCandidate({ gtin: draft.gtin, manufacturerModel: draft.manufacturerModel, retailerSku: draft.retailerSku, brand: draft.brand ?? "", productTitle: draft.productTitle, category: draft.category });
  const identityKey = draft.gtin || identityCandidate.normalizedTitle;
  const conflictKey = `${identityKey}::${sourceCategory((rawSourceType || "manual_admin") as never)}`;
  const prior = ctx.state.productIndex[conflictKey];

  ctx.state.evidence.push(evidence);
  ctx.state.seen[recordHash] = draft.id;

  if (prior && prior.price !== draft.price) {
    const conflictGroupId = `conf_${conflictKey}`;
    draft.conflictState = "conflict_detected";
    // Retroactively flag the first-seen draft too, so neither auto-resolves.
    const first = ctx.state.drafts.find((d) => d.id === prior.draftId);
    if (first) first.conflictState = "conflict_detected";
    ctx.state.drafts.push(draft);
    return { status: "conflict", recordHash, conflictGroupId, evidenceIds: [evidence.id], draftId: draft.id, warnings: [...warnings, ...draft.warnings] };
  }

  if (!prior) ctx.state.productIndex[conflictKey] = { price: draft.price, draftId: draft.id };
  ctx.state.drafts.push(draft);
  return { status: "staged", recordHash, evidenceIds: [evidence.id], draftId: draft.id, warnings: [...warnings, ...draft.warnings] };
}
