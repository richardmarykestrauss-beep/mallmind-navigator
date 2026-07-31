# RetailerFeedContractV1 — Permission-Ready Retail Feed Contract

**Version 1.0.0 · Sprint 2K · local, validated capability only (no hosted mutation, no publication).**

## Purpose
A retailer-**neutral** intermediate record that a *permissioned* retailer's product data maps into before it touches MallMind's truth-model staging. It exists so that legitimate feeds can be **validated, provenance-preserved, and honestly scoped** without ever becoming verified or shopper-visible automatically. It carries only **external** identifiers + rights + honest scope — never an internal MallMind `mall_id`/`shop_id`/`branch_id`, and never an invented fact.

It is the bridge that was missing: `CSV/JSON feed → RetailerFeedContractV1 → RawRetailCandidate (migration-036 truth model) → staged observation (review_status pending)`. The publication gate (`publish_verified_observation`) is unchanged and unreachable from import.

## Supported source formats
- CSV (UTF-8)
- Spreadsheet export saved as CSV
- Structured JSON (same canonical fields; adapter emits the same record)
- API / feed adapters added later (each is a thin adapter to the same canonical record)

A **retailer-specific adapter** maps that retailer's column/field names into this contract. The importer, validation, codes, identity and boundaries are shared and retailer-agnostic.

## Required vs optional fields
**Per-record required:** `retailer_source_id`, `product_name`, `current_price`, `currency`, `observed_at`, **at least one** product identity (`source_product_id` | `retailer_sku` | `gtin` | `barcode`), and provenance (`source_row_number`, `source_content_hash`).
**Everything else is optional** and stays `null` when the retailer does not supply it — never defaulted, never fabricated.

## Field definitions (grouped)
**Feed identity:** `feed_contract_version`, `feed_id`, `feed_generated_at`, `retailer_name`, `retailer_source_id`, `source_type`, `source_reference`, `rights_review_state`, `legal_status`.
**Product identity:** `source_product_id`, `retailer_sku`, `gtin`, `barcode`, `product_name`, `brand`, `variant`, `pack_size`, `category`, `subcategory`.
**Commercial:** `currency`, `current_price`, `original_price`, `promotion_indicator`, `promotion_type`, `price_condition`, `price_condition_label`, `promotion_start_at`, `promotion_end_at`.
**Scope & availability:** `price_scope`, `availability_scope`, `mall_external_id`, `shop_external_id`, `branch_external_id`, `stock_status`, `stock_quantity`, `stock_observed_at`.
**Evidence & provenance:** `canonical_source_url`, `observed_at`, `source_updated_at`, `source_row_number`, `source_file_name`, `source_content_hash`, `raw_source_reference`, `parse_warnings`.

Normalized records additionally carry decimal-safe `current_price_cents`/`original_price_cents` (+ display strings), `branch_mapping_status`, and the always-null `internal_mall_id`/`internal_shop_id`/`internal_branch_id`.

## Accepted enums
- `source_type`: manual | csv | spreadsheet_csv | json | affiliate_feed | partner_feed | retailer_submission
- `rights_review_state`: unreviewed | under_review | approved | restricted | rejected | expired
- `legal_status`: manual_fact_entry | licensed_feed | retailer_supplied | user_supplied | partner_licensed | reference_only | needs_legal_review
- `price_scope`: online_national | online_regional | branch_specific | catalogue_national | unknown
- `availability_scope`: online | delivery_area | click_collect | branch_confirmed | unknown | not_observed
- `price_condition`: standard | loyalty | promotional | bulk | bundle | online_only | unknown
- `promotion_type`: none | discount | multibuy | bundle | loyalty | clearance | deal | unknown
- `stock_status`: in_stock | out_of_stock | low_stock | unknown | not_observed
- `currency`: ZAR (feed-level default documented; others → `UNKNOWN_CURRENCY`)

These mirror the migration-036 truth-model vocabularies (asserted for parity in tests).

## Timestamp format
ISO-8601 (`YYYY-MM-DD` or `YYYY-MM-DDThh:mm[:ss][.sss][Z|±hh:mm]`). Any timestamp field that is present but unparseable → `INVALID_TIMESTAMP` (quarantine for `observed_at`; for optional timestamps too, since a malformed date is untrustworthy).

## Decimal & currency handling
Prices are parsed **decimal-safe to integer minor units (cents)** using string math — never a binary float (R79.99 → exactly `7999`). Currency symbols (`R`, `ZAR`) and thousands separators (space / `,`) are stripped deterministically; the decimal separator is resolved unambiguously. Currency must be explicit per row or via a documented feed-level default; unsupported currency is rejected. The exact display string is preserved alongside the cents.

## Identifier preservation
`source_product_id`, `retailer_sku`, `gtin`, `barcode` are preserved **verbatim as strings** — leading zeros survive (`0012345` stays `"0012345"`). Barcode/GTIN is text, never numeric.

## Null handling
Blank optional values become `null`. Unknown is represented as `null` (or the explicit `unknown` enum member where one exists), never as `0`, `""`, `"Other"`, or a fabricated default.

## Provenance requirements
Every record retains `source_row_number` (1-based data row), `source_file_name`, a deterministic `source_content_hash` (djb2 over the raw row), and the full original row in `raw_source_reference` (auditable, including unmapped columns). Missing provenance → `MISSING_PROVENANCE`.

## Promotion handling
A promotional price is **never flattened into a standard price**. `promotion_indicator`, `promotion_type`, `price_condition`, `price_condition_label`, and promo dates are preserved independently. Contradictions are detected: `promotion_indicator=true` with `price_condition='standard'`, or promo fields present with `promotion_indicator≠true`, raise `PROMOTION_CONFLICT` (warning). `original_price < current_price` raises `ORIGINAL_PRICE_BELOW_CURRENT_PRICE` (quarantine). A missing `original_price` does **not** imply "no promotion", and a discount % is never inferred unless both trustworthy prices exist. Promotion dates do **not** prove branch availability.

## Stock & branch truth boundaries
`stock_status`/`stock_quantity` are recorded as-supplied and scoped by `availability_scope`. **Online availability is never converted into branch stock.** A `branch_confirmed`/`branch_specific` row must carry an external branch identifier AND that identifier must have an **explicit approved mapping**; otherwise it is quarantined (`UNSUPPORTED_SCOPE`) — a branch claim cannot be substantiated. A non-branch row that merely references an unknown external branch gets a `UNKNOWN_BRANCH_MAPPING` warning, keeps the external id, and keeps internal ids null. **Internal `mall_id`/`shop_id`/`branch_id` are always null at this layer.**

## Rights & legal-status boundaries
`rights_review_state` and `legal_status` are carried as governed data. Import **never** approves rights or publishes; even a feed asserting `approved` cannot cross the publication gate from here. The downstream `publish_verified_observation` RPC remains the sole, fail-closed authority (requires `rights_review_state=approved` + `commercial_use_allowed` + `storage_allowed`, and a branch-confirmed shop∈mall).

## Row rejection vs warning rules
- **Quarantined (rejection codes):** `MISSING_REQUIRED_FIELD`, `MISSING_PRODUCT_IDENTITY`, `INVALID_PRICE`, `INVALID_TIMESTAMP`, `UNKNOWN_CURRENCY`, `UNSUPPORTED_SCOPE`, `MISSING_PROVENANCE`, `ORIGINAL_PRICE_BELOW_CURRENT_PRICE`. The row is not normalized (kept raw for audit).
- **Accepted with warnings (warning codes):** `PROMOTION_CONFLICT`, `UNKNOWN_BRANCH_MAPPING`, `CONFLICTING_OBSERVATION`, `AMBIGUOUS_PROMOTION_LABEL`, `MISSING_OPTIONAL_IDENTIFIER`, `ONLINE_ONLY_NO_BRANCH`. The row is usable but flagged. `UNRECOGNISED_COLUMN` and `DUPLICATE_OBSERVATION` are also warnings (the former feed-level).
- **Malformed/unknown fields are never silently discarded** — unmapped columns are retained in `raw_source_reference` and reported; bad values are coded.

## Duplicate handling & idempotency
A deterministic **observation identity** = `djb2(retailer_source_id | product-identity | observed_at | price_scope | branch_external_id | current_price_cents)`. Within a file: a second row with the same identity → `duplicate`. A row sharing the same *natural key* (identity minus price/content) but a different identity → `CONFLICTING_OBSERVATION` warning. This distinguishes an **identical replay** (same identity), a **newer observation** (different observed_at/price → different identity, a legitimate new observation), a **conflicting observation** (same slot, different price), and a **duplicated row**. The identity is suitable for later idempotent insertion (aligning with `retail_price_observations`' unique-pending-hash index); **no database write occurs in this sprint.**

## How future retailer adapters connect
Each retailer implements a small adapter exposing `mapRows(headers, rows, feedMeta) → CanonicalFeedRecord[]` (or the JSON equivalent). The adapter only renames/maps columns, preserves identifiers/rows, and reports unmapped columns. All validation, coding, identity, dedup, and boundaries live in the shared `importFeed()`. See `exampleRetailerAdapter.mjs`.

## How this differs from shopper-facing publication
This contract is **intake evidence**, not verification and not a shopper record. Imported rows are `review_status: not_ingested` here and would stage at `pending`; they only become a verified, shopper-visible `product` through human review + the `publish_verified_observation` gate — which import cannot reach. Nothing in this layer makes a price, a branch stock claim, or a product visible to shoppers.
