# MallMind — Wired-vs-Present Integration Audit

Status: **Accepted as the repository-grounded source of truth** (three-model convergence, 2026-08).
Method: read-only call-chain tracing across frontend, backend, and SQL. Every claim is cited with
file paths and line numbers. This document describes **what the repository actually executes**, not
what it intends or documents.

## Status legend

| Tag | Meaning |
|-----|---------|
| **WIRED** | Reachable from a real runtime entry point (HTTP route / worker / frontend action) and completes end-to-end. |
| **WIRED BUT DEAD-ENDS** | Reachable at runtime, but terminates in a staging artefact that nothing downstream consumes. |
| **PRESENT-ONLY** | Code/tests exist and pass, but no runtime caller invokes them. |
| **DIVERGENT / BYPASS** | A path that writes shopper-relevant state outside the sanctioned pipeline / gate. |
| **SYNTHETIC OR PROTOTYPE DATA** | Wired code operating on AI-generated / simulated / hardcoded data rather than surveyed or verified real-world data. |

---

## 0. Headline finding — the last several sprints are orphaned

**`RetailerFeedContractV1` (Sprints 2K / 2L-A) and the migration-039 `stage_retail_feed_observation`
staging bridge (Sprint 2L-B) are both `PRESENT-ONLY` islands with zero runtime callers.** They are
high-quality and well-tested, but nothing in the backend, worker, or any route invokes them.

- `stage_retail_feed_observation` occurs only in: its definition (`supabase/migrations/039_retail_feed_staging_bridge.sql:91`),
  its rollback SQL, the disposable fixture (`scripts/build-os/retail-staging-fixture.sql:66+`, ~20 calls),
  an existence/permission check (`scripts/build-os/verify-db.mjs:261-276`), and docs. **No backend
  service, route, or worker calls it.**
- The `src/lib/retail/feed/*.mjs` modules are imported only by their own vitest tests and the dry-run
  CLIs (`scripts/retail/feed-dry-run.mjs:16-18`, `feed-json-dry-run.mjs:13-16`, `mapping-validate.mjs:12`),
  none of which write to a database. **There is no import of any `src/lib/retail/feed/*.mjs` module
  anywhere under `google-cloud-backend/src`.**

Consequence: the near-term job is to **wire what exists**, not to build more.

---

## 1. `products` vs the retail truth model — DIVERGENT / BYPASS (two editable truths)

### Intended (documented) model — a one-way projection
- `026_retail_data_v1.sql:5-9,179-180` — approved observations are "later" written to `public.products`;
  observations "do not affect shopper search until published".
- `027_evidence_backed_verification.sql:8-10` — "the product row stays the current shopper-facing
  projection; the retail_price_observation stays the historical source of truth."
- `036_retail_truth_model.sql:5-7` — pipeline `retail_data_sources → snapshots → retail_price_observations
  → publish_verified_observation → products`.

### Actually enforced — nothing prevents independent writes
`products` (`000_baseline_schema.sql:49-67`) is an ordinary table: **no trigger, no column-level
lockdown, no enforced provenance**, and only a one-way nullable link exists on the *observation*
(`retail_price_observations.published_product_id … on delete set null`, `026...:173`). `products` has
**no back-reference** to the observation that published it.

The sanctioned writer `publish_verified_observation` is genuinely clean — `SECURITY DEFINER`,
`service_role`-only (`027...:346-349`, `038_products_price_scope.sql:284-287`), rights/branch/evidence
gated (`036...:263-274,279-287`), writes `products` (`036...:380` UPDATE / `:399` INSERT) then stamps
the observation `review_status='published'`, `published_product_id`, `published_at` (`036...:416-421`).
Migration 039 only stages at `pending` and **cannot** reach `products` (`039...:271,288-292`) — that
part is correct.

But it is only one of several writers, and the DB enforces nothing.

## 2. Every known independent writer of `products`

| # | Writer (file:line) | Kind | Sanctioned pipeline? |
|---|---|---|---|
| 1 | `publish_verified_observation` RPC — `027...:268/287`, `036...:380/399`, `038...:217/237` | UPDATE + INSERT | **YES** — the projection path |
| 2 | `scripts/retail/publish-staged-observations.mjs:158-188` | UPDATE + INSERT, then marks obs published | **NO** — parallel JS publisher, **bypasses** the RPC's rights/branch/confidence gates |
| 3 | `scripts/scraper/db.ts:88-96,:100` | direct UPDATE + INSERT | **NO** — legacy scraper |
| 4 | `scripts/scraper/pricecheck.ts:148-156` | direct UPDATE + INSERT | **NO** — legacy scraper |
| 5 | `scripts/scraper/takealot.ts:115-117` | direct UPDATE `price` | **NO** — legacy scraper |
| 6 | `supabase/functions/scrape-prices/index.ts:75` | edge-function UPDATE `price` | **NO** — legacy |
| 7 | `scripts/retail/reverify-demo-prices.mjs:239-241` | UPDATE `price_verified_at`, `verified_by` | **NO** — direct audit write |
| 8 | `google-cloud-backend/src/routes/priceCorrections.ts:506-508` | UPDATE `data_quality_status='needs_review'` | **NO** — status-only route write |
| 9 | `supabase/seed.sql:125` | INSERT | **NO** — dev seed |
| 10 | `supabase/migrations/008_data_quality_fields.sql:86` | UPDATE `data_source='manual_seed'` | **NO** — one-time backfill |

Correctly funnelled through the RPC (safe): `adminVerifyProduct.ts` (legacy `product_id+method` shape
explicitly rejected, `:67-76`), `retailObservationPublisher.ts`, and `retailCsvImportService.ts` (never
touches `products`, `:5-11`).

### The concrete harm
The RPC sets `verified=true`, `price`, `price_valid_until` (`036...:387-390`). The scrapers later
`UPDATE ... price` (`scrape-prices:75`, `takealot.ts:116`, `db.ts:89`, `pricecheck.ts:149`) **without**
touching `price_verified_at`/`price_valid_until`, leaving a row still flagged verified but carrying an
unverified, silently-mutated price. `productService.recommendProducts` reads exactly those fields to
render the "Verified price" trust signal (`productService.ts:88-97,143-150`) — so **a bypass write
poisons the shopper-facing trust badge.** There is no `published_observation_id` reconciliation key.

---

## 3. Ingestion-path matrix — the paths diverge; only one is wired

Two Express apps exist: the public API (`server.ts`, routes `:61-79`) and a separate private worker
(`worker.ts`, mounts only `internalIntake` at `:79`).

| # | Path / entry | Calls | Terminal DB effect | Status |
|---|---|---|---|---|
| 1 | CSV admin import — `server.ts:74` → `retailObservationsAdmin.ts:367` → `retailCsvImportService.ts:59` | `intakeRetailCsv` then RPC `stage_retail_csv_import` (`:153`) | `retail_price_observations` (pending) | **WIRED — the one live canonical funnel** |
| 2 | Durable intake worker — `worker.ts:79` → `internalIntake` → `PostgresDurableIntakeStore` | RPCs `create_intake_job`/`claim_next_intake_job`/`commit_intake_chunk`/`finalize_intake_job` (`supabaseGateway.ts:34-44`; migrations 033/034) | **`retail_intake_job_drafts`** (drafts only; `internalIntake.ts:10` "Nothing on this surface publishes") | **WIRED BUT DEAD-ENDS** |
| 2b | Proxy — `server.ts:75` → `adminIntakeProxy.ts` → `INTAKE_WORKER_URL` | HTTP hop to #2 | (same as #2) | WIRED, env-gated (`503 not_configured` when unset, `:69`) |
| 3 | RetailerFeedContractV1 — `src/lib/retail/feed/*.mjs` | only vitest + dry-run CLIs | **none** (no DB sink) | **PRESENT-ONLY** |
| 4 | Staging bridge RPC `stage_retail_feed_observation` (039) | — | would write `retail_price_observations` | **PRESENT-ONLY — zero runtime callers** |
| 5 | CLI `scripts/retail/import-csv-staging.mjs:195` | direct `.from("retail_price_observations").insert(...)` | `retail_price_observations` (pending) | **DIVERGENT / BYPASS** (raw insert, bypasses `stage_retail_csv_import`) |
| 6 | `sourceIngestionService` — `server.ts:71` → `mallResearchBatches.ts:39` | source/finding bots | `mall_research_batch_items` (mall-directory, not price) | WIRED — different funnel |

**Named divergences:** (a) durable-worker drafts (`retail_intake_job_drafts`) vs. CSV-route observations
(`retail_price_observations`) — two different staging tables with **no wired bridge**; (b) the
`stage_retail_feed_observation` bridge present but uncalled — it is exactly the bridge that would promote
drafts into canonical observations; (c) the `.mjs` feed contract with no DB sink; (d) the CLI raw-insert
path bypassing the RPC. Net: **one wired funnel, one wired-but-dead-ending pipeline, two present-only
islands, one bypass CLI.**

Downstream publish step (for funnel completeness, wired): `retailObservationPublisher.publishApprovedObservation`
→ RPC `publish_verified_observation`, via `adminVerifyProduct.ts:15` and `priceCorrections.ts:3`.

---

## 4. Shopper-query trace — WIRED end-to-end, with two honest gaps

### Call chain (real)
- Assistant: `AssistantPage.tsx:816` → `googleBackendClient.ts:679-683` `POST /assistant` →
  `routes/assistant.ts:48` → `geminiService.ts:624 runAssistant` → `productService.ts:119 recommendProducts`.
- Search: `SearchPage.tsx:77` → `googleBackendClient.ts:640-646` `POST /recommend-products` →
  `routes/recommendProducts.ts:35` → same `productService.ts:119`.
- Deals: **different path** — `Deals.tsx:39-49` queries the `best_deals` view directly via the anon client.

### What it reads
`productService.recommendProducts` reads `shops` (`:124-127`), **`products`** (`:141-154`:
`price, original_price, is_on_special, price_verified_at, data_quality_status, price_verification_method,
data_source, verified_by`, filtered `.in("shop_id",…).ilike("name","%term%")`), and `price_correction_reports`
(`:229-233`). **`retail_price_observations` is never read on the shopper path** — it appears only in
admin/ingestion/publisher code. The projection model holds on the *read* side.

### Deterministic-vs-Gemini split + degradation (solid)
`geminiService.ts:runAssistant` — regex intent classify (`:398,652`) → deterministic nav bypass
(`:668-717`, early return `:702`) → deterministic shopping bypass (`:731-746` → `deterministicShoppingIntent.ts:58`,
early return `:739`) → Gemini agentic loop (`:756-1001`, `gemini-2.5-flash`). Failure → `recoverFromGeminiFailure`
(`:350`) re-runs the deterministic resolver, else `ASSISTANT_DEGRADED_MESSAGE` (`:371`); raw error never
surfaced. `verified_only` with no match "holds the line" (`:329-340`). Trust/freshness applied via
`calculatePriceTrust` (`productService.ts:243-246` → `priceTrust.ts:58`).

## 5. The missing `price_scope` wiring — GAP

**`price_scope` (national-online vs branch-specific) is NOT applied anywhere on the shopper read.** The
column exists (migration 038) but `price_scope` does not appear anywhere in `google-cloud-backend/src`
(grep clean) and is absent from the `products` SELECT list (`productService.ts:141-154`). `products.price`
is returned as-is regardless of scope. This is a **wiring gap on a core MallMind promise**, not a build gap.

## 6. The Deals trust bypass — DIVERGENT / BYPASS

`Deals.tsx:39-49` reads the `best_deals` view directly via the client anon key, ordered by
`discount_percent`, and renders raw `price`/`discount_percent` **with no `priceTrust`/`trust_state`
labelling** — bypassing the trust pipeline every other shopper surface uses.

### Other shopper-path caveats
- **Trigram search is not used for ranking** — the query is plain substring `.ilike("name","%term%")`
  (`productService.ts:148`); migration 025's GIN `gin_trgm_ops` indexes may passively accelerate `ILIKE`
  but no `similarity()` ranking is wired (025 header: "Future backend search can move toward similarity()").
- `recommendProducts` `break`s on the first search term returning rows (`productService.ts:158-161`), so a
  broad early term can shadow a more specific one.
- No mock stubs / TODO branches were found in the core shopper query path itself.

---

## 7. Navigation trace — WIRED routing over SYNTHETIC data; positioning simulated

### Call chain (real)
- `AssistantPage.tsx:1115` → `googleBackendClient.ts:659-665` `POST /build-route` → `routes/buildRoute.ts:37`
  → `routingService.ts:280`. `routingService.ts:302-308` queries **`mall_nodes`/`mall_edges` from Supabase**
  by `mall_id`; `:12 dijkstra(...)` runs shortest-path; persists to `shopping_routes` (`:434`) and sets
  `shopping_sessions.active_route_id` (`:457`).
- Render: `NavigateScreen.tsx:151` → `getIndoorMapModel` → `googleBackendClient.ts:2906` `GET /indoor-map-model`
  → `routes/indoorMapModel.ts:108-127` queries `mall_nodes`, `mall_edges`, `map_factory_generated_floorplans`.

### Real DB graph — but SYNTHETIC OR PROTOTYPE DATA
Routing runs on **real `mall_nodes`/`mall_edges` DB rows** (`routingService.ts:151-153,306-308`); empty
tables → honest `fallback:true` with empty steps (`:162-171,318-327`), not a fake route. `demoFloorplan.ts`
(`MALL_REDS_GAME_FLOORPLAN`) is **PRESENT-ONLY** — drawn solely in the "No Route Yet" empty state
(`NavigateScreen.tsx:314-341`, labelled "Indoor map engine · demo").

The map-factory → graph → routing chain is **integrated at the data layer**:
`mapFactoryRouteGraphBuilderService.ts` writes the same tables routing reads (`mall_nodes` `:348-360`
`source:'map_factory'`; `mall_edges` `:111-118`), triggered from `MapFactoryTab.tsx:253`. **But the graph
is prototype-grade:** node coordinates are **synthetic percentages** with fabricated entrance/shop anchors
and a synthesized corridor "spine" (`:246-273,420-465`); edge distances are `coordinate-distance × 5`
(`:115`), not measured; the code self-labels "an AI-Assisted Prototype graph, not a verified digital twin"
(`:219`). The floor image is a **generated SVG** (`map_factory_generated_floorplans.svg_output`,
`floorplanModel.ts:182-187`) or a schematic — **no surveyed floorplan asset pipeline** feeds it.

## 8. Positioning — SIMULATED (honestly labelled)
No real positioning exists. `routeWalk.ts:39 computeRouteWalk` is deterministic time-based interpolation
along node coords (`:84-90`; header "performs NO live positioning", `:6-8`); progress also advances via
manual "Done" taps (`NavigateScreen.tsx:260-269`). No BLE/PDR/QR/GPS code exists (grep found none). UI is
honest: "Simulating" / "Prototype preview" / disclaimer (`NavigateScreen.tsx:405-411,470-473`;
`floorplanModel.ts:10-13`). `detectActiveMall` uses real device lat/lng Haversine for **coarse mall
selection only** (`routes/detectActiveMall.ts`), not indoor positioning.

---

## 9. Convergence backlog (four items)

Derived directly from the findings above. Small, and none requires touching production.

1. **Wire one ingestion funnel.** Connect the durable-worker drafts (and/or the feed contract) into
   `retail_price_observations` via the already-built `stage_retail_feed_observation`. Retires the orphaned
   islands (§0, §3) in one move.
2. **Lock `products` to a projection.** Make `publish_verified_observation` the only writer of the
   protected commercial/price/trust fields; quarantine the legacy scraper + parallel-JS direct writers
   (§2); add a `published_observation_id` back-reference — **while keeping descriptive catalogue metadata
   legitimately editable** (see the projection-integrity field taxonomy in the blueprint).
3. **Surface `price_scope`** in the shopper read so national-vs-branch is shown honestly (§5); bring
   `Deals.tsx` through the trust pipeline (§6).
4. **Get one real mall graph + floorplan** for Mall@Reds — the navigation gap is **data quality**, not
   code (§7, §8).

Everything beyond these four is future-scale horizon, not pilot work.
