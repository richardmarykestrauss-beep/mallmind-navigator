# Feed Format Neutrality (Sprint 2L-A)

**Local, validated capability only. No hosted mutation, no staging bridge, no publication.**

## Goal
Prove that `RetailerFeedContractV1` (Sprint 2K) is genuinely independent of CSV **and** of a single retailer adapter: the same canonical record + the same `importFeed` validation, identity, and outcomes serve CSV, JSON, and future formats — with no second candidate model and no second validation pipeline.

## What was added
- **JSON feed reader** — `src/lib/retail/feed/jsonFeedReader.mjs`. Deterministic: `readJsonFeed(textOrObject)` parses JSON, rejects invalid JSON (`INVALID_JSON`) and invalid shape (`INVALID_FEED_SHAPE`) deterministically, extracts the `products` array, and retains **array position** as `source_row_number` (1-based). `validateFeedEnvelope()` checks feed-level metadata (contract version, `retailer_source_id`). Pure — no network, no I/O beyond the caller passing text.
- **Second retailer adapter** — `src/lib/retail/feed/kingdomAdapter.mjs` ("Kingdom Home & Tech Pilot"), structurally **different** from the 2K CSV adapter: nested `pricing` (with nested `promo`), a nested `availability` object (channel/scope/branchCode/branchName/mallCode/stock), different identifiers (`itemRef`), feed-level currency, and JSON numeric prices. It maps all of that into the same canonical record and hands it to the same `importFeed`.

## The one pipeline
```
CSV  → parseCsv     → exampleRetailerAdapter.mapRows       ┐
JSON → readJsonFeed → kingdomAdapter.mapKingdomFeed        ┴→ importFeed → coded outcomes
```
`importFeed` (unchanged validation core) applies the **same** decimal-safe price parsing, ISO-8601 timestamp rules, deterministic content hash, observation identity, dedup, promotion coherence, and the governed branch boundary — regardless of transport. A JSON reader does not re-implement any of it.

## Price handling across formats
Prices are parsed decimal-safe to integer cents. **JSON numeric values and string values are both handled intentionally:** the adapter stringifies a JSON number and the importer's parser validates it — a value with more than two decimals (e.g. `12.999`) is **rejected** (`INVALID_PRICE`), so floating-point ambiguity never silently rounds. Original and current prices remain independent; promotions are never flattened.

## Availability across formats
Online availability never becomes branch stock. A branch-scoped observation requires branch-scoped source evidence (channel/scope in the feed). Crucially, **a valid branch mapping does not convert online availability into branch availability** — mapping resolves *identity* only; `availability_scope` is copied from the feed and never upgraded (proved by JSON feed row 10: online + an approved branch mapping → resolved identity, availability stays `online`). Unknown stock stays unknown.

## CSV ↔ JSON parity
`parity-subset.csv` (2K format) and `parity-subset.json` (Kingdom format) carry the **same** three products under the same `retailer_source_id`. After adapter mapping + import, the canonical meaning is **equal** across formats for: `source_product_id`, `retailer_source_id`, `product_name`, `brand`, `pack_size`, `currency`, `current_price_cents`, `original_price_cents`, `promotion_indicator`, `price_condition`, `price_scope`, `availability_scope`, `branch_external_id`, `observed_at` — and the **observation identity is identical** across formats. Transport-specific provenance (`source_file_name`, `source_content_hash` inputs, `source_row_number`) may differ; product and commercial meaning do not.

## Local commands
```
npm run retail:feed:json:dry-run -- --file docs/sprint-2l-a/example-retailer-json-feed.json [--mappings docs/sprint-2l-a/example-location-mappings.json]
npm run retail:mapping:validate -- --file docs/sprint-2l-a/example-location-mappings.json
```
No network, no DB, no credentials; reports write only to gitignored `artifacts/`. Non-zero exit only for feed-/mapping-file-level structural failure; individual quarantined rows do not fail the run.

## Boundaries kept
No hosted migration, no linked-DB write, no worker, no Cloud Run, no publication, no service-role, no scraping, no network in tests. Imported rows are `review_status: not_ingested`; the publication gate is unchanged and unreachable from import.
