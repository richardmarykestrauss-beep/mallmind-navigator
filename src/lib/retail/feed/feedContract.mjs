/**
 * feedContract.mjs — RetailerFeedContractV1 (Sprint 2K)
 *
 * A retailer-NEUTRAL, permission-ready canonical feed record. It is the single
 * intermediate shape every retailer adapter (CSV / spreadsheet-CSV / JSON / future
 * API) maps into, BEFORE MallMind's truth-model staging. It deliberately carries
 * only EXTERNAL identifiers + provenance + rights + honest scope — it never carries
 * or invents an internal MallMind mall_id / shop_id / branch_id, and importing a
 * record never makes it verified or shopper-visible.
 *
 * Pure ESM JS (JSDoc-typed) so the same module runs under vitest AND the node CLI.
 * No I/O, no network, no DB, no Clicks-specific assumptions.
 */

export const FEED_CONTRACT_VERSION = "1.0.0";

// ── Enums (accepted vocabularies) ─────────────────────────────────────────────
export const SOURCE_TYPES = Object.freeze([
  "manual", "csv", "spreadsheet_csv", "json", "affiliate_feed", "partner_feed", "retailer_submission",
]);
export const RIGHTS_REVIEW_STATES = Object.freeze([
  "unreviewed", "under_review", "approved", "restricted", "rejected", "expired",
]);
export const LEGAL_STATUSES = Object.freeze([
  "manual_fact_entry", "licensed_feed", "retailer_supplied", "user_supplied",
  "partner_licensed", "reference_only", "needs_legal_review",
]);
export const PRICE_SCOPES = Object.freeze([
  "online_national", "online_regional", "branch_specific", "catalogue_national", "unknown",
]);
export const AVAILABILITY_SCOPES = Object.freeze([
  "online", "delivery_area", "click_collect", "branch_confirmed", "unknown", "not_observed",
]);
export const PRICE_CONDITIONS = Object.freeze([
  "standard", "loyalty", "promotional", "bulk", "bundle", "online_only", "unknown",
]);
export const PROMOTION_TYPES = Object.freeze([
  "none", "discount", "multibuy", "bundle", "loyalty", "clearance", "deal", "unknown",
]);
export const STOCK_STATUSES = Object.freeze([
  "in_stock", "out_of_stock", "low_stock", "unknown", "not_observed",
]);
export const SUPPORTED_CURRENCIES = Object.freeze(["ZAR"]);

// ── Canonical field list (grouped; documented in retailer-feed-contract-v1.md) ─
export const CANONICAL_FIELDS = Object.freeze({
  feed_identity: ["feed_contract_version", "feed_id", "feed_generated_at", "retailer_name",
    "retailer_source_id", "source_type", "source_reference", "rights_review_state", "legal_status"],
  product_identity: ["source_product_id", "retailer_sku", "gtin", "barcode", "product_name",
    "brand", "variant", "pack_size", "category", "subcategory"],
  commercial: ["currency", "current_price", "original_price", "promotion_indicator", "promotion_type",
    "price_condition", "price_condition_label", "promotion_start_at", "promotion_end_at"],
  scope_availability: ["price_scope", "availability_scope", "mall_external_id", "shop_external_id",
    "branch_external_id", "stock_status", "stock_quantity", "stock_observed_at"],
  evidence: ["canonical_source_url", "observed_at", "source_updated_at", "source_row_number",
    "source_file_name", "source_content_hash", "raw_source_reference", "parse_warnings"],
});

/**
 * Per-record REQUIRED facts. Everything else is optional and stays NULL when the
 * retailer does not supply it (never fabricated).
 * Identity is satisfied by ANY ONE of source_product_id / retailer_sku / gtin / barcode.
 */
export const REQUIRED_FEED_FIELDS = Object.freeze([
  "retailer_source_id", "product_name", "current_price", "currency", "observed_at",
]);
export const REQUIRED_PROVENANCE_FIELDS = Object.freeze([
  "source_row_number", "source_content_hash",
]);
export const IDENTITY_FIELDS = Object.freeze([
  "source_product_id", "retailer_sku", "gtin", "barcode",
]);

// ── Stable machine-readable outcome + code vocabularies ───────────────────────
export const OUTCOMES = Object.freeze({
  ACCEPTED: "accepted",
  ACCEPTED_WITH_WARNINGS: "accepted_with_warnings",
  QUARANTINED: "quarantined",
  DUPLICATE: "duplicate",
});

/** Codes that DOWNGRADE a row to quarantined (row cannot be trusted as-is). */
export const REJECTION_CODES = Object.freeze({
  MISSING_REQUIRED_FIELD: "MISSING_REQUIRED_FIELD",
  MISSING_PRODUCT_IDENTITY: "MISSING_PRODUCT_IDENTITY",
  INVALID_PRICE: "INVALID_PRICE",
  INVALID_TIMESTAMP: "INVALID_TIMESTAMP",
  UNKNOWN_CURRENCY: "UNKNOWN_CURRENCY",
  UNSUPPORTED_SCOPE: "UNSUPPORTED_SCOPE",
  MISSING_PROVENANCE: "MISSING_PROVENANCE",
  ORIGINAL_PRICE_BELOW_CURRENT_PRICE: "ORIGINAL_PRICE_BELOW_CURRENT_PRICE",
});

/** Codes that WARN but keep the row usable (accepted_with_warnings). */
export const WARNING_CODES = Object.freeze({
  PROMOTION_CONFLICT: "PROMOTION_CONFLICT",
  UNKNOWN_BRANCH_MAPPING: "UNKNOWN_BRANCH_MAPPING",
  UNRECOGNISED_COLUMN: "UNRECOGNISED_COLUMN",
  DUPLICATE_OBSERVATION: "DUPLICATE_OBSERVATION",
  CONFLICTING_OBSERVATION: "CONFLICTING_OBSERVATION",
  AMBIGUOUS_PROMOTION_LABEL: "AMBIGUOUS_PROMOTION_LABEL",
  MISSING_OPTIONAL_IDENTIFIER: "MISSING_OPTIONAL_IDENTIFIER",
  ONLINE_ONLY_NO_BRANCH: "ONLINE_ONLY_NO_BRANCH",
});

/**
 * @typedef {Object} CanonicalFeedRecord
 * Feed identity + product identity + commercial + scope/availability + evidence.
 * All fields are string|number|boolean|null except parse_warnings (string[]) and
 * raw_source_reference (object of the original, unmapped columns). Prices are held
 * decimal-safe as integer minor units (…_cents) alongside their exact display string.
 */

/**
 * @typedef {Object} FeedRowResult
 * @property {number} source_row_number
 * @property {string|null} source_product_id
 * @property {"accepted"|"accepted_with_warnings"|"quarantined"|"duplicate"} outcome
 * @property {CanonicalFeedRecord|null} record   normalized record when outcome !== quarantined
 * @property {string[]} warning_codes
 * @property {string[]} rejection_codes
 * @property {string[]} explanations             human-readable
 * @property {string} provenance_reference       source_file_name#row + content hash
 * @property {string|null} observation_identity   deterministic identity (null when quarantined)
 */

export function isRejectionCode(c) { return Object.values(REJECTION_CODES).includes(c); }
export function isWarningCode(c) { return Object.values(WARNING_CODES).includes(c); }
