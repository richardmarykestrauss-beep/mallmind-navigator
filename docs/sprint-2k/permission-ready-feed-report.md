# Sprint 2K — Permission-Ready Retail Feed Contract (Report)

**Local implementation + testing only. No hosted DB write, no migration, no worker, no Cloud Run, no publication, no network during tests. Production untouched.**

- **Branch:** `feat/permission-ready-retail-feed-contract`
- **Commit:** recorded in the returned evidence packet (this branch's HEAD adding the files below).
- **Authoritative verification:** `npm run verify:all` — PASS.

## Files created
- `src/lib/retail/feed/feedContract.mjs` — RetailerFeedContractV1 (fields, enums, stable warning/rejection codes, outcomes, JSDoc types).
- `src/lib/retail/feed/priceParse.mjs` — decimal-safe ZAR → integer cents.
- `src/lib/retail/feed/csvParse.mjs` — dependency-free quote-aware CSV reader.
- `src/lib/retail/feed/feedImporter.mjs` — validation → coded outcomes, deterministic observation identity, dedup, branch-mapping boundary. Never writes/publishes.
- `src/lib/retail/feed/exampleRetailerAdapter.mjs` — one example retailer adapter (external columns → canonical).
- `src/lib/retail/feed/feedImporter.test.ts` — 30 required assertions + parity/reuse (31 tests).
- `scripts/retail/feed-dry-run.mjs` — local dry-run CLI (no net/db).
- `docs/sprint-2k/retailer-feed-contract-v1.md` — contract documentation.
- `docs/sprint-2k/retailer-feed-contract-v1.schema.json` — machine-readable schema (draft-07).
- `docs/sprint-2k/example-retailer-authorised-feed.csv` — synthetic 17-row authorised-feed fixture.
- `docs/sprint-2k/permission-ready-feed-report.md` — this report.

## Files modified
- `package.json` — `retail:feed:dry-run` script.
- `.gitignore` — ignore `/artifacts/` (local dry-run reports are not committed).

## Architecture reused (no duplication)
- The retailer-neutral candidate vocabulary + validator: `RawRetailCandidate`, `validateCandidate`, `dedupeCandidates`, `contentHash` from `src/lib/retail/retailAdapter.ts` (migration-036-aligned). Accepted feed records map to a `RawRetailCandidate` that the **real** `validateCandidate` accepts (test 30), and `djb2` ≡ `contentHash` (parity test).
- Shopper-honesty helpers: `canClaimBranchAvailability` from `retailTruth.ts`.
- The row-outcome + dry-run-summary + content-hash + in-file-dedup **patterns** established by the legacy `retailCsvIntake.ts`. The legacy intake itself was NOT extended: it is mall/shop-UUID-centric and pre-036 (no external identifiers, rights, scope, or coded outcomes) — so this is a new bridge, not a fork.
- **Net-new (the genuine delta):** stable machine-readable warning/rejection codes; the external-identifier → mapping-boundary; the CSV/JSON→truth-model feed bridge with rights + scope.

## Canonical contract summary
Feed identity + product identity + commercial + scope/availability + evidence. Required per record: `retailer_source_id`, `product_name`, `current_price`, `currency`, `observed_at`, one product identity, and provenance. Everything else nullable; unknowns are never fabricated. Prices are decimal-safe integer cents. Internal MallMind ids are never carried. Full detail: `retailer-feed-contract-v1.md`.

## Fixture summary
`example-retailer-authorised-feed.csv` — **synthetic**, clearly fake "Example Retailer Pilot" data, 17 rows covering: standard / promotional prices; original+current; promotion with dates; with/without GTIN; leading-zero id; online-national + branch-specific; in/out/unknown stock; missing optional fields; a duplicate; a malformed price; an unknown branch; a promotion-flag conflict; plus invalid timestamp, missing identity, unknown currency, original-below-current, and a thousands-separator price.

## Adapter behaviour
Maps external column names → canonical; preserves the original row number; preserves leading zeros (identifiers stay strings); leaves blank optionals `null`; retains the full raw row (incl. unmapped columns) in `raw_source_reference`; reports unmapped columns feed-level; never assigns internal mall/shop/branch ids; never resolves an external branch without an explicit mapping. Price/timestamp validity + coded quarantine is the importer's job.

## Validation outcomes — every fixture row (default dry-run, no branch mapping)
| Row | product | outcome | codes |
|---|---|---|---|
| 1 | EX1001 | accepted | — |
| 2 | EX1002 | accepted | — (promotional, was+dates) |
| 3 | 0012345 | accepted | — (leading-zero id preserved) |
| 4 | EX1004 | **quarantined** | UNSUPPORTED_SCOPE (branch_confirmed, unmapped branch) |
| 5 | EX1005 | accepted | — (out_of_stock) |
| 6 | EX1006 | accepted | — (minimal optional fields) |
| 7 | EX1001 | **duplicate** | DUPLICATE_OBSERVATION (of row 1) |
| 8 | EX1008 | **quarantined** | INVALID_PRICE |
| 9 | EX1009 | **quarantined** | INVALID_TIMESTAMP |
| 10 | (no id) | **quarantined** | MISSING_PRODUCT_IDENTITY |
| 11 | EX1011 | **quarantined** | UNKNOWN_CURRENCY |
| 12 | EX1012 | **quarantined** | ORIGINAL_PRICE_BELOW_CURRENT_PRICE |
| 13 | EX1013 | accepted_with_warnings | PROMOTION_CONFLICT |
| 14 | EX1014 | accepted_with_warnings | UNKNOWN_BRANCH_MAPPING |
| 15 | EX1015 | **quarantined** | UNSUPPORTED_SCOPE (unmapped branch claim) |
| 16 | EX1016 | accepted | — (promotional multibuy) |
| 17 | EX1017 | accepted | — (thousands-separator price 1 299.00 → 129900c) |

**Totals:** total 17 · accepted **7** · accepted_with_warnings **2** · quarantined **7** · duplicates **1**.
**Warning counts:** DUPLICATE_OBSERVATION 1 · PROMOTION_CONFLICT 1 · UNKNOWN_BRANCH_MAPPING 1 · UNRECOGNISED_COLUMN 1 (feed-level: `InternalNotes`).
**Rejection counts:** UNSUPPORTED_SCOPE 2 · INVALID_PRICE 1 · INVALID_TIMESTAMP 1 · MISSING_PRODUCT_IDENTITY 1 · UNKNOWN_CURRENCY 1 · ORIGINAL_PRICE_BELOW_CURRENT_PRICE 1.

## Duplicate & idempotency findings
Observation identity = `djb2(retailer_source_id | identity | observed_at | price_scope | branch_external_id | current_price_cents)`. Row 7 (identical replay of row 1) → same identity → `duplicate`. A changed price yields a different identity (test 19); an identical replay yields the same identity (test 18). Deterministic across re-runs (test 17). Suitable for later idempotent insertion; no DB write performed.

## Branch-mapping findings
With **no** mapping: `branch_confirmed`/`branch_specific` rows (4, 15) are quarantined — a branch claim cannot be substantiated; internal ids stay null. A non-branch row referencing an unknown external branch (14) is accepted-with-warning, keeps the external id, internal ids null. With an **explicit** mapping fixture (`BR-REDS-01 → …`), row 4 becomes accepted with `branch_mapping_status='recognised'` (test 14) — and internal ids still remain null in this local sprint. Branch stock is never inferred from online availability (test 16).

## Test results
`src/lib/retail/feed/feedImporter.test.ts` — **31/31 pass** (the 30 required assertions + a parity/reuse bonus): contract version; ≥15 rows; leading-zero strings; blank→null; exact decimal-safe prices; original separate; promotional preserved; promotion conflict; malformed price / invalid timestamp / missing identity / unknown currency quarantined; unknown branch → no internal id; recognised mapping only with fixture; internal ids null without mapping; branch stock never inferred; deterministic duplicates; identical-replay identity; changed-price identity; unrecognised columns reported; row numbers + file provenance retained; deterministic content hashes; no image data; no long description required; and negative static scans proving the feed modules reference **no** database client, Cloud Run worker, publication function, or network primitive.

## Full verification result
- `npm run verify:all` → PASS (incl. Frontend tests with the new feed suite, the Clicks Sprint 2J tests still passing, retail core/publisher/CSV-intake harnesses, backend build, durable-worker checks).
- `git diff --check` → clean.

## No network / DB / worker / publication activity
The feed modules are pure (no `@supabase`, `createClient`, `pg`, `fetch`, `node:http(s)`, `publish_verified_observation`, or worker reference — asserted by static scans). The CLI uses only local file I/O and writes a gitignored report. Every summary carries `publication_occurred=false`, `database_write_occurred=false`, `network_call_occurred=false`.

## Known limitations
- Only a CSV path + one example adapter are implemented; a JSON reader and additional retailer adapters are future work (the canonical record + importer are format-agnostic).
- `bulk`/`bundle` `minimum_quantity` structuring is a downstream truth-model concern (the feed carries `promotion_type` + `price_condition_label`; `minimum_quantity` is added at staging).
- No real external-branch → MallMind mapping table exists yet; the boundary is enforced but the mapping source is out of scope here.
- No hosted staging RPC was written/called; wiring the accepted candidates into `retail_price_observations` (review_status pending) with listing identity is Sprint 2L.

## Recommendation for Sprint 2L
1. Add a **JSON feed reader** emitting the same canonical record, plus a second retailer adapter, to prove format-neutrality beyond CSV.
2. Design the **external-branch → MallMind mapping** as governed data (an explicit, reviewable mapping table), so `branch_confirmed` feeds can be substantiated without inventing internal ids.
3. Write a **staging bridge**: accepted / accepted_with_warnings candidates → `retail_source_listings` (identity) + `retail_price_observations` at `review_status='pending'`, idempotent on the observation identity — still behind human review + the publication gate. Prove it on the disposable stack (`verify:db`), not hosted.
4. Only after a **real retailer grants permission** (rights_review_state → approved via review) does anything approach publication — the outreach remains the long pole.
