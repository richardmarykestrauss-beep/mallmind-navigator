/**
 * feedImporter.mjs — RetailerFeedContractV1 importer (Sprint 2K).
 *
 * Takes canonical records already mapped by a retailer adapter and validates them
 * into explicit, coded outcomes (accepted / accepted_with_warnings / quarantined /
 * duplicate). It NEVER writes to a database, calls a network, invokes the Cloud Run
 * worker, or publishes. It NEVER assigns an internal MallMind mall_id/shop_id/branch_id.
 * Deterministic + pure (no I/O). Prices are decimal-safe integer cents.
 */

import {
  FEED_CONTRACT_VERSION, OUTCOMES, REJECTION_CODES, WARNING_CODES,
  REQUIRED_FEED_FIELDS, REQUIRED_PROVENANCE_FIELDS, IDENTITY_FIELDS,
  PRICE_SCOPES, AVAILABILITY_SCOPES, PRICE_CONDITIONS, SUPPORTED_CURRENCIES,
} from "./feedContract.mjs";
import { parseRand, formatCents } from "./priceParse.mjs";

/** djb2 — identical to contentHash() in src/lib/retail/retailAdapter.ts (parity asserted in tests). */
export function djb2(input) {
  let h = 5381;
  const s = String(input);
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(8, "0");
}

const ISO_RE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/;
const isBlank = (v) => v === null || v === undefined || String(v).trim() === "";
function validTimestamp(v) { return typeof v === "string" && ISO_RE.test(v.trim()) && !Number.isNaN(Date.parse(v.trim())); }

/** The deterministic observation identity used for later idempotent insertion. */
export function observationIdentity(rec) {
  const identity = rec.source_product_id ?? rec.retailer_sku ?? rec.gtin ?? rec.barcode ?? "";
  const parts = [
    rec.retailer_source_id ?? "",
    identity,
    rec.observed_at ?? "",
    rec.price_scope ?? "unknown",
    rec.branch_external_id ?? "",
    rec.current_price_cents ?? "",
  ];
  return djb2(parts.join("|"));
}
/** Natural key = same observation "slot" ignoring price/content (to detect conflicts). */
function naturalKey(rec) {
  const identity = rec.source_product_id ?? rec.retailer_sku ?? rec.gtin ?? rec.barcode ?? "";
  return djb2([rec.retailer_source_id ?? "", identity, rec.observed_at ?? "", rec.price_scope ?? "unknown", rec.branch_external_id ?? ""].join("|"));
}

/**
 * @param {Array<Object>} records  canonical records from a retailer adapter
 * @param {{ branchMapping?: Record<string, object>, sourceFileName?: string }} [opts]
 */
export function importFeed(records, opts = {}) {
  const branchMapping = opts.branchMapping ?? {};
  const results = [];
  const seenIdentity = new Map();   // observation_identity → row_number of first occurrence
  const seenNatural = new Map();    // natural_key → observation_identity

  for (const rec of records) {
    const rejections = [];
    const warnings = [];
    const explanations = [];
    const rej = (code, msg) => { rejections.push(code); explanations.push(`${code}: ${msg}`); };
    const warn = (code, msg) => { warnings.push(code); explanations.push(`${code}: ${msg}`); };

    // Carry adapter parse warnings through (e.g. unrecognised columns).
    for (const w of rec.parse_warnings ?? []) {
      if (!warnings.includes(w.code)) warn(w.code, w.message);
    }

    // ── Provenance (required) ──
    for (const f of REQUIRED_PROVENANCE_FIELDS) {
      if (isBlank(rec[f])) rej(REJECTION_CODES.MISSING_PROVENANCE, `provenance field '${f}' is required`);
    }

    // ── Required feed fields ──
    for (const f of REQUIRED_FEED_FIELDS) {
      if (f === "current_price") continue; // priced below
      if (isBlank(rec[f])) rej(REJECTION_CODES.MISSING_REQUIRED_FIELD, `required field '${f}' is missing`);
    }

    // ── Product identity (at least one) ──
    if (IDENTITY_FIELDS.every((f) => isBlank(rec[f]))) {
      rej(REJECTION_CODES.MISSING_PRODUCT_IDENTITY, `at least one of ${IDENTITY_FIELDS.join("/")} is required`);
    }

    // ── Currency ──
    if (isBlank(rec.currency)) rej(REJECTION_CODES.MISSING_REQUIRED_FIELD, "currency is required");
    else if (!SUPPORTED_CURRENCIES.includes(String(rec.currency).toUpperCase()))
      rej(REJECTION_CODES.UNKNOWN_CURRENCY, `currency '${rec.currency}' is not supported (${SUPPORTED_CURRENCIES.join(",")})`);

    // ── Price (decimal-safe) ──
    let currentCents = null, originalCents = null;
    if (isBlank(rec.current_price)) rej(REJECTION_CODES.INVALID_PRICE, "current_price is required");
    else {
      const p = parseRand(rec.current_price);
      if (!p.ok) rej(REJECTION_CODES.INVALID_PRICE, `current_price '${rec.current_price}' is not a valid amount (${p.reason})`);
      else currentCents = p.cents;
    }
    if (!isBlank(rec.original_price)) {
      const o = parseRand(rec.original_price);
      if (!o.ok) rej(REJECTION_CODES.INVALID_PRICE, `original_price '${rec.original_price}' is not a valid amount (${o.reason})`);
      else {
        originalCents = o.cents;
        if (currentCents !== null && originalCents < currentCents)
          rej(REJECTION_CODES.ORIGINAL_PRICE_BELOW_CURRENT_PRICE, `original_price (${formatCents(originalCents)}) is below current_price (${formatCents(currentCents)})`);
      }
    }

    // ── Timestamps ──
    if (!isBlank(rec.observed_at) && !validTimestamp(rec.observed_at))
      rej(REJECTION_CODES.INVALID_TIMESTAMP, `observed_at '${rec.observed_at}' is not a valid ISO-8601 timestamp`);
    for (const f of ["source_updated_at", "promotion_start_at", "promotion_end_at", "stock_observed_at"]) {
      if (!isBlank(rec[f]) && !validTimestamp(rec[f]))
        rej(REJECTION_CODES.INVALID_TIMESTAMP, `${f} '${rec[f]}' is not a valid ISO-8601 timestamp`);
    }

    // ── Scope enums ──
    if (!isBlank(rec.price_scope) && !PRICE_SCOPES.includes(rec.price_scope))
      rej(REJECTION_CODES.UNSUPPORTED_SCOPE, `price_scope '${rec.price_scope}' is not a recognised scope`);
    if (!isBlank(rec.availability_scope) && !AVAILABILITY_SCOPES.includes(rec.availability_scope))
      rej(REJECTION_CODES.UNSUPPORTED_SCOPE, `availability_scope '${rec.availability_scope}' is not a recognised scope`);
    if (!isBlank(rec.price_condition) && !PRICE_CONDITIONS.includes(rec.price_condition))
      warn(WARNING_CODES.AMBIGUOUS_PROMOTION_LABEL, `price_condition '${rec.price_condition}' is not a recognised condition; treat as unknown`);

    // ── Promotion coherence (never flatten a promo into standard) ──
    const promoFlag = rec.promotion_indicator === true || rec.promotion_indicator === "true";
    const looksPromo = originalCents !== null || (rec.price_condition && rec.price_condition !== "standard" && rec.price_condition !== "unknown") || !isBlank(rec.promotion_start_at);
    if (promoFlag && rec.price_condition === "standard")
      warn(WARNING_CODES.PROMOTION_CONFLICT, "promotion_indicator is true but price_condition is 'standard'");
    if (!promoFlag && looksPromo && (rec.price_condition === "promotional" || originalCents !== null))
      warn(WARNING_CODES.PROMOTION_CONFLICT, "promotion fields present but promotion_indicator is not true");

    // ── Branch-mapping boundary ──
    // A feed's external branch code NEVER yields internal MallMind ids on its own.
    // Internal ids are set ONLY from a unique, approved, currently-valid mapping via the
    // governed resolver (opts.resolveBranch). Without one, ids stay null and the row is
    // warned (non-branch) or quarantined (branch claim). A mapping proves identity only —
    // never stock, price, permission, publication, or online→branch availability.
    const externalBranch = rec.branch_external_id ?? rec.shop_external_id ?? null;
    const intendsBranch = rec.availability_scope === "branch_confirmed" || rec.price_scope === "branch_specific";
    let branch_mapping_status = "not_applicable";
    let branch_mapping_code = null;
    let resolvedInternal = { internal_mall_id: null, internal_shop_id: null, internal_branch_id: null };
    if (externalBranch) {
      if (typeof opts.resolveBranch === "function") {
        const res = opts.resolveBranch(rec) ?? { outcome: "unmapped", code: "UNMAPPED" };
        branch_mapping_status = res.outcome;
        branch_mapping_code = res.code ?? null;
        if (res.outcome === "resolved") {
          resolvedInternal = {
            internal_mall_id: res.internal_mall_id ?? null,
            internal_shop_id: res.internal_shop_id ?? null,
            internal_branch_id: res.internal_shop_id ?? null,
          };
        } else if (intendsBranch) {
          rej(REJECTION_CODES.UNSUPPORTED_SCOPE, `branch claim not substantiated (${res.outcome}): ${res.explanation ?? externalBranch}`);
        } else {
          warn(WARNING_CODES.UNKNOWN_BRANCH_MAPPING, `external branch '${externalBranch}' not resolved (${res.outcome}); internal ids kept null`);
        }
      } else {
        // Legacy (Sprint 2K) plain-object branchMapping: recognised = key present.
        const recognised = Object.prototype.hasOwnProperty.call(branchMapping, externalBranch);
        branch_mapping_status = recognised ? "recognised" : "unrecognised";
        if (!recognised) {
          if (intendsBranch)
            rej(REJECTION_CODES.UNSUPPORTED_SCOPE, `branch_confirmed/branch_specific row references unmapped external branch '${externalBranch}' — cannot substantiate a branch claim`);
          else
            warn(WARNING_CODES.UNKNOWN_BRANCH_MAPPING, `external branch '${externalBranch}' has no recognised MallMind mapping; internal ids kept null`);
        }
      }
    } else if (intendsBranch) {
      rej(REJECTION_CODES.UNSUPPORTED_SCOPE, "branch_confirmed/branch_specific row carries no external branch identifier");
    }

    // ── Build the normalized record (internal ids ALWAYS null this sprint) ──
    const normalized = {
      feed_contract_version: rec.feed_contract_version ?? FEED_CONTRACT_VERSION,
      feed_id: rec.feed_id ?? null,
      retailer_name: rec.retailer_name ?? null,
      retailer_source_id: rec.retailer_source_id ?? null,
      source_type: rec.source_type ?? null,
      rights_review_state: rec.rights_review_state ?? null,
      legal_status: rec.legal_status ?? null,
      source_product_id: rec.source_product_id ?? null,
      retailer_sku: rec.retailer_sku ?? null,
      gtin: rec.gtin ?? null,
      barcode: rec.barcode ?? null,
      product_name: rec.product_name ?? null,
      brand: rec.brand ?? null,
      variant: rec.variant ?? null,
      pack_size: rec.pack_size ?? null,
      category: rec.category ?? null,
      subcategory: rec.subcategory ?? null,
      currency: isBlank(rec.currency) ? null : String(rec.currency).toUpperCase(),
      current_price_cents: currentCents,
      current_price_display: currentCents === null ? null : formatCents(currentCents),
      original_price_cents: originalCents,
      original_price_display: originalCents === null ? null : formatCents(originalCents),
      promotion_indicator: promoFlag,
      promotion_type: rec.promotion_type ?? null,
      price_condition: rec.price_condition ?? (promoFlag ? "promotional" : "unknown"),
      price_condition_label: rec.price_condition_label ?? null,
      promotion_start_at: rec.promotion_start_at ?? null,
      promotion_end_at: rec.promotion_end_at ?? null,
      price_scope: rec.price_scope ?? "unknown",
      availability_scope: rec.availability_scope ?? "unknown",
      mall_external_id: rec.mall_external_id ?? null,
      shop_external_id: rec.shop_external_id ?? null,
      branch_external_id: rec.branch_external_id ?? null,
      branch_mapping_status,
      branch_mapping_code,
      internal_mall_id: resolvedInternal.internal_mall_id,
      internal_shop_id: resolvedInternal.internal_shop_id,
      internal_branch_id: resolvedInternal.internal_branch_id,
      stock_status: rec.stock_status ?? null,
      stock_quantity: rec.stock_quantity ?? null,
      stock_observed_at: rec.stock_observed_at ?? null,
      canonical_source_url: rec.canonical_source_url ?? null,
      observed_at: rec.observed_at ?? null,
      source_updated_at: rec.source_updated_at ?? null,
      source_row_number: rec.source_row_number,
      source_file_name: rec.source_file_name ?? opts.sourceFileName ?? null,
      source_content_hash: rec.source_content_hash ?? null,
      raw_source_reference: rec.raw_source_reference ?? null,
      review_status: "not_ingested",   // never verified/published by import
    };

    const provenance_reference = `${normalized.source_file_name ?? "feed"}#row${normalized.source_row_number}:${normalized.source_content_hash ?? "nohash"}`;

    // ── Outcome ──
    let outcome, identity = null;
    if (rejections.length > 0) {
      outcome = OUTCOMES.QUARANTINED;
    } else {
      identity = observationIdentity(normalized);
      const nkey = naturalKey(normalized);
      if (seenIdentity.has(identity)) {
        outcome = OUTCOMES.DUPLICATE;
        warn(WARNING_CODES.DUPLICATE_OBSERVATION, `identical observation already seen at row ${seenIdentity.get(identity)}`);
      } else {
        if (seenNatural.has(nkey) && seenNatural.get(nkey) !== identity)
          warn(WARNING_CODES.CONFLICTING_OBSERVATION, `same product/observed_at/scope as an earlier row but different price/content`);
        seenIdentity.set(identity, normalized.source_row_number);
        seenNatural.set(nkey, identity);
        outcome = warnings.length > 0 ? OUTCOMES.ACCEPTED_WITH_WARNINGS : OUTCOMES.ACCEPTED;
      }
    }

    results.push({
      source_row_number: normalized.source_row_number,
      source_product_id: normalized.source_product_id,
      outcome,
      record: outcome === OUTCOMES.QUARANTINED ? null : normalized,
      raw_source_reference: normalized.raw_source_reference,
      warning_codes: warnings,
      rejection_codes: rejections,
      explanations,
      provenance_reference,
      observation_identity: outcome === OUTCOMES.QUARANTINED ? null : identity,
    });
  }

  // ── Feed-level warnings (not per-row) e.g. unrecognised columns ──
  const feed_warnings = [];
  const unrecognised = opts.unrecognisedColumns ?? [];
  if (unrecognised.length > 0) {
    feed_warnings.push({
      code: WARNING_CODES.UNRECOGNISED_COLUMN,
      message: `unmapped column(s) retained in raw_source_reference only: ${unrecognised.join(", ")}`,
    });
  }

  // ── Summary ──
  const by = (o) => results.filter((r) => r.outcome === o).length;
  const codeTally = (key) => {
    const t = {};
    for (const r of results) for (const c of r[key]) t[c] = (t[c] ?? 0) + 1;
    return t;
  };
  const warning_counts = codeTally("warning_codes");
  for (const fw of feed_warnings) warning_counts[fw.code] = (warning_counts[fw.code] ?? 0) + 1;
  const summary = {
    contract_version: FEED_CONTRACT_VERSION,
    total_rows: results.length,
    accepted: by(OUTCOMES.ACCEPTED),
    accepted_with_warnings: by(OUTCOMES.ACCEPTED_WITH_WARNINGS),
    quarantined: by(OUTCOMES.QUARANTINED),
    duplicates: by(OUTCOMES.DUPLICATE),
    warning_counts,
    rejection_counts: codeTally("rejection_codes"),
    feed_warnings,
    publication_occurred: false,
    database_write_occurred: false,
    network_call_occurred: false,
  };

  return { summary, results };
}
