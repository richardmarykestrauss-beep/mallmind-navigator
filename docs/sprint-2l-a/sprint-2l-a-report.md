# Sprint 2L-A — Feed Format Neutrality & Governed External Branch Mapping (Report)

**Local implementation + testing only. No hosted DB write, no migration, no worker, no Cloud Run, no publication, no network in tests, no service-role. Production untouched.**

- **Branch:** `feat/feed-format-neutrality-branch-mapping`
- **Commit:** recorded in the returned evidence packet (this branch's HEAD).
- **Authoritative verification:** `npm run verify:all` — PASS.

## Architecture findings
Sprint 2K's `RetailerFeedContractV1` + `importFeed` (in `src/lib/retail/feed/`) already own the canonical record, validation, codes, decimal-safe pricing, identity, and dedup. **No JSON reader and no governed mapping model existed** (grep confirmed). So this sprint reuses the 2K pipeline verbatim and adds only: a JSON reader, a second adapter, a CSV/JSON parity test, and a governed mapping contract + resolver. **No second candidate model and no second validation pipeline** — the JSON path calls the same `importFeed`. No stop condition triggered.

## Files created
- `src/lib/retail/feed/jsonFeedReader.mjs` — deterministic JSON reader.
- `src/lib/retail/feed/kingdomAdapter.mjs` — second retailer adapter ("Kingdom Home & Tech Pilot").
- `src/lib/retail/feed/locationMapping.mjs` — ExternalRetailLocationMappingV1 contract + resolver + `validateMapping`.
- `src/lib/retail/feed/jsonFeed.test.ts` — 29 tests covering the 53 required assertions (grouped).
- `scripts/retail/feed-json-dry-run.mjs`, `scripts/retail/mapping-validate.mjs` — CLIs.
- `docs/sprint-2l-a/{feed-format-neutrality.md, external-location-mapping-v1.md, example-retailer-json-feed.json, example-location-mappings.json, parity-subset.csv, parity-subset.json, sprint-2l-a-report.md}`.

## Files modified
- `src/lib/retail/feed/feedImporter.mjs` — added a backward-compatible `opts.resolveBranch` hook: internal ids are set **only** from an approved mapping; the 2K plain-object path is unchanged (2K tests still pass).
- `package.json` — `retail:feed:json:dry-run`, `retail:mapping:validate` scripts.
- `docs/build-os/DECISIONS.md` — ADR-010 (local validated capability only).

## JSON reader design
`readJsonFeed(text|object)` → `{ ok, envelope, products:[{source_row_number, product}] }` or `{ ok:false, error }`. Deterministic: invalid JSON → `INVALID_JSON`; non-object / missing `products` array → `INVALID_FEED_SHAPE`. Array position → `source_row_number`. `validateFeedEnvelope` checks the feed-level contract version + `retailer_source_id`. Pure; no network. Products flow into the **same** `importFeed`.

## Second adapter design
Kingdom's JSON is structurally different from the 2K CSV: nested `pricing.promo`, nested `availability` (channel/scope/branchCode/branchName/mallCode/stock), `itemRef` identifiers, feed-level currency, JSON numeric prices. `mapKingdomFeed` flattens it into the canonical record (identifiers preserved as strings; numbers stringified for the decimal-safe parser; unknown props retained in `raw_source_reference`). No internal ids assigned.

## CSV/JSON parity results
Same 3 products in `parity-subset.csv` and `parity-subset.json` (retailer `parity-pilot`). After mapping + import, canonical meaning is **equal** across formats for source_product_id, retailer_source_id, product_name, brand, pack_size, currency, current_price_cents, original_price_cents, promotion_indicator, price_condition, price_scope, availability_scope, branch_external_id, observed_at — and **observation_identity is identical** across formats. Transport provenance differs as expected. (Tests 15–21 pass.)

## Mapping contract & resolution
See `external-location-mapping-v1.md`. Resolver outcomes are stable coded values; deterministic id-match only; name-only → `ambiguous`; never picks the first candidate. `mapping-validate` on the 16-row fixture: **structurally invalid = 0**; outcomes `{ resolved:3, mapping_unapproved:2, mapping_rejected:1, mapping_expired:2, mapping_superseded:1, mapping_collision:2, ambiguous:2, invalid_mapping:2, mapping_not_yet_valid:1 }`.

## Row-by-row JSON feed outcomes (`--mappings` supplied; now via observed_at 2026-07-31T10:00Z)
| row | itemRef | outcome | mapping | codes |
|---|---|---|---|---|
| 1 | KH-1001 | accepted | n/a | — |
| 2 | KH-1002 | accepted | n/a | — (promo was+dates) |
| 3 | 000123 | accepted | n/a | — (leading-zero id) |
| 4 | KH-1004 | accepted | **resolved** | — (branch_confirmed, KH-APPROVED) |
| 5 | KH-1005 | quarantined | mapping_unapproved | UNSUPPORTED_SCOPE |
| 6 | KH-1006 | quarantined | mapping_expired | UNSUPPORTED_SCOPE |
| 7 | KH-1007 | quarantined | unmapped | UNSUPPORTED_SCOPE |
| 8 | KH-1008 | quarantined | mapping_collision | UNSUPPORTED_SCOPE |
| 9 | KH-1009 | quarantined | ambiguous (name-only) | UNSUPPORTED_SCOPE |
| 10 | KH-1010 | accepted | **resolved** | — (online + branch mapping → availability stays online) |
| 11 | KH-1011 | accepted | **resolved** | — (branch OOS) |
| 12 | KH-1012 | accepted | n/a | — (unknown stock) |
| 13 | KH-1013 | accepted | n/a | — (minimal) |
| 14 | KH-1001 | duplicate | n/a | DUPLICATE_OBSERVATION |
| 15 | KH-1015 | quarantined | — | INVALID_PRICE (12.999 float) |
| 16 | KH-1016 | quarantined | — | INVALID_TIMESTAMP |
| 17 | KH-1017 | accepted_with_warnings | n/a | PROMOTION_CONFLICT |
| 18 | KH-1018 | quarantined | mapping_expired | UNSUPPORTED_SCOPE |
| 19 | KH-1019 | quarantined | mapping_not_yet_valid | UNSUPPORTED_SCOPE |
| 20 | KH-1020 | accepted | **resolved** | — (branch_confirmed, KH-VALID) |

## Row outcome totals
JSON feed (20 rows): **accepted 9, accepted_with_warnings 1, quarantined 9, duplicate 1**. Warnings `{DUPLICATE_OBSERVATION:1, PROMOTION_CONFLICT:1}`. Rejections `{UNSUPPORTED_SCOPE:7, INVALID_PRICE:1, INVALID_TIMESTAMP:1}`.

## Mapping resolution totals
resolved 3 · mapping_unapproved 2 · mapping_rejected 1 · mapping_expired 2 · mapping_superseded 1 · mapping_collision 2 · ambiguous 2 · invalid_mapping 2 · mapping_not_yet_valid 1. (retailer_mismatch is produced when the Kingdom feed references the other-retailer branch KH-MISMATCH — test 29.)

## Test totals
`jsonFeed.test.ts` — **29/29 pass**, covering the 53 required assertions (JSON reader 1–12, adapter neutrality + parity 13–21, mapping governance 22–42, safety static scans + runtime fetch spy 43–48). Regression: 2K `feedImporter.test.ts` + 2J `clicksSample.test.ts` still pass (46/46); existing retail core/publisher/CSV-intake harnesses pass under `verify:all` (49–53).

## verify:all result
PASS (frontend build + tests incl. the new suite and the 2K/2J suites; backend build; retail core/publisher/CSV-intake harnesses; durable-worker checks). `git diff --check` clean.

## Proof of no database / publication / worker / network activity
Feed + mapping modules are pure (static scans: no `@supabase`/`createClient`/`pg`, no `publish_verified_observation`, no `runDurableJob`/`K_REVISION`/`/internal/intake`, no `fetch`/`node:http(s)`); a runtime `fetch` spy is never called during an import; every summary carries `publication_occurred=false`, `database_write_occurred=false`, `network_call_occurred=false`. CLIs use only local file I/O and write gitignored reports. No hosted migration created or applied.

## Limitations
- Two formats (CSV, JSON) + two adapters; further formats/adapters remain future work (the pipeline is format-agnostic).
- The mapping resolver + fixtures are local synthetic data — no hosted mapping table exists.
- Name-only mappings are intentionally never auto-resolved (identity requires a deterministic branch id).
- No staging bridge: accepted candidates are not yet written to `retail_price_observations` (Sprint 2L-B).

## Recommendation for Sprint 2L-B
1. Design the **PostgreSQL staging bridge** (disposable-stack verified, not hosted): accepted / accepted_with_warnings candidates → `retail_source_listings` (identity) + `retail_price_observations` at `review_status='pending'`, idempotent on the observation identity, with resolved internal ids attached **only** from an approved mapping.
2. Model the external-location mapping as a **governed hosted table** (its own additive migration) with the same eligibility rules, so resolution is auditable — still behind human review + the publication gate.
3. Keep the boundary absolute: no branch-confirmed publication, no online→branch upgrade, no rights/permission implied by a mapping; publication only after a real retailer's rights are reviewed to `approved`.
