# MallMind Retail Data Readiness Audit

| | |
|---|---|
| **Audit baseline commit** | `7c475ae9514758a141efae3c87a6ac2d04bb218a` |
| **Stable demo tag** | `founder-demo-mall-at-reds-2026-06-12` |
| **Date** | 2026-06-12 |
| **Sprint** | 22A — Retail Data Expansion Readiness Audit |

Evidence basis: repository code, migrations, scripts and sprint reports at the
baseline commit. Everything below is marked **[code]** (confirmed in code/SQL)
or **[inferred]** (inferred from usage, not directly read).

## Executive summary

The retail spine is in genuinely good shape for expansion: every write path to
shopper-visible product data flows through an approval-gated, dry-run-first,
provenance-tracked pipeline with a shared pure decision core
(`google-cloud-backend/src/services/retail/`) and harness coverage (93
assertions). Trust translation to shoppers is centralised and leak-tested.

The biggest immediate risk is not architecture — it is **freshness**: the
founder demo's "Verified option" depends on `price_verified_at`, and the
trust calculator expires manual verification after **7 days**. The demo's
Hisense price was verified 2026-06-09, so without re-verification the tagged
demo will silently degrade to "Verification expired" around **2026-06-16**.
That should be the first post-audit sprint.

Second-tier risks: a legacy scraper directory predating the trust pipeline
(must not be revived as-is), single-candidate name matching when scaling to
malls with duplicate shop names, and the cost of manual CSV verification as
the only current evidence channel.

## Current retail data architecture

### Tables (all **[code]**, from `supabase/migrations/`)

**Shopper-visible core**
- `malls`, `shops`, `products` — predate migration 001 [inferred: created in
  the original schema; columns confirmed via usage]. `shops` has
  `opening_time`/`closing_time` (NOT `opening_hours` — a phantom field that
  still exists on the frontend `Shop` type and caused two fixed route bugs).
- `products` quality fields (008): `data_quality_status`
  (demo | manually_verified | live_feed | stale | user_submitted |
  needs_review), `price_verification_method` (9 allowed values),
  `data_source` (free text), `verified_by`, plus `price_verified_at` (007).

**Retail provenance spine (026, Sprint 19C)**
- `retail_data_sources` — source registry: `source_type` (manual/csv/
  affiliate_feed/flyer/retailer_submission/user_submission/partner_feed),
  `base_trust`, `legal_status` (7 values incl. needs_legal_review),
  `attribution_required`, `is_active`.
- `retail_source_snapshots` — evidence records (csv/manual_note/pdf/image/
  feed/retailer_upload/user_photo), `content_sha256`, unique per
  (source_id, content hash).
- `retail_import_batches` — batch lifecycle (pending → processing → staged →
  approved/rejected/failed), row counters.
- `retail_price_observations` — staged facts with `trust_state` (11 values),
  `verification_method` (10 values), `confidence`, `review_status`
  (pending/approved/rejected/needs_more_info/published), `product_id` link,
  `published_product_id`, `observation_hash` (unique while pending), RLS
  locked with **no anon/authenticated policies** — service role only.

**Trust/feedback adjacent**
- `price_correction_reports` (011) — shopper disputes; feeds the trust
  calculator's "disputed"/"needs_review" overrides.
- `import_jobs`, `admin_audit_log` (009) — admin actions audited (the retail
  review route writes audit rows).

**Mall Intelligence / map (separate lane, read for completeness)**
- `mall_research_batches`/`_items` (007), `mall_research_sources`,
  `mall_source_findings` (012), `mall_sources`, `mall_map_assets`,
  `mall_store_locations_staged`, `mall_route_nodes_staged`,
  `mall_route_edges_staged` (013), `mall_manual_map_anchors_staged` (017),
  `map_factory_*` (019, 8 tables), `mall_nodes`/`mall_edges` (005).
- Security: 024 hardened profiles/staging RLS; 025 added search trigram
  indexes.

### Code layers **[code]**

- **Pure retail decision core**: `google-cloud-backend/src/services/retail/`
  — name normalization, product_id-first → shop/name → insert_new →
  ambiguous matching, trust→quality mapping, verification-method mapping,
  publish planning, warnings. Shared by publisher script and admin preview.
  93-assertion harness incl. purity scan (`npm run test:retail-core`).
- **Trust calculators**: `services/priceTrust.ts` (product → shopper trust
  state with 7-day expiry + dispute overrides) and `services/dataTrustPolicy.ts`
  (Sprint 9G central policy engine: classifySourceTrust, classifyEvidence-
  Strength, classifyFreshness, classifyConflictRisk, getSafeBadgeForTrustState,
  evaluateDataTrust — used by the data-guardian/mall-research lane).
- **Assistant layer**: `services/assistant/` pure engine translates trust to
  shopper-safe labels with an `INTERNAL_STATUS_TOKENS` blocklist and scrub
  function (103-assertion harness).
- **Admin surface**: `routes/retailObservationsAdmin.ts` — admin-gated review
  queue, status changes (never on published rows), dry-run publish preview.
- **Frontend**: `RecommendationCard` resolves trust display from computed
  `trust_state` and suppresses machine-formatted `data_source` strings.

## Current trust and verification model

**Tier mapping (single source of truth: `retailTrustMapper.ts`)** [code]
- Observation `trust_state` verified/retailer_submitted/flyer_extracted/
  web_observed → product `manually_verified`.
- `manual_fact_entry` → `manually_verified` ONLY with an evidence-backed
  method (phone/website/flyer/receipt/store_visit/retailer_confirmation/
  scraper/retailer_api); with `csv_manual` or none → `needs_review`.
  **Weak manual CSV rows can never become Verified prices.**
- live_feed → live_feed; user_submitted → user_submitted; expired/stale/
  disputed/needs_review/unknown → needs_review.

**Shopper-facing translation** [code]
- `priceTrust.calculatePriceTrust`: manually_verified → "Verified price"
  (high) but **expires after 7 days** → "Verification expired" (medium, with
  in-store confirmation warning); live_feed → "Live price"; demo → "Sample
  data · price may vary"; pending dispute overrides everything → "Recently
  disputed".
- Assistant labels: "Verified option", "Live retailer feed", "Price may need
  confirmation", "Example/demo data", "Not confirmed yet" — backed by a
  token blocklist (manual_fact_entry, csv_manual, retail_observation,
  data_quality_status, review_status, pending, approved, published, …).

**Leak surfaces**
- Fixed: raw `data_source` pipe-strings on RecommendationCard (20A) and the
  Gemini-text dominance issue (20B). Smoke checklist now scans for tokens.
- Residual: the API JSON still ships raw `data_quality_status`/`data_source`
  /`verified_by` fields on products (visible in dev tools, translated before
  display). Acceptable for now; flagged in 19C.8B and unchanged by approval.
- Safe labels list lives in three places (assistant engine, doctrine doc,
  smoke doc) — keep synchronized when copy changes.

## Current ingestion/staging scripts

| Script | Writes | Gate | Service role |
|---|---|---|---|
| `scripts/retail/import-csv-staging.mjs` | sources/snapshots/batches/observations (staging only) | **dry-run default**, `--apply` | yes |
| `scripts/retail/link-observations-to-products.mjs` | only `retail_price_observations.product_id` | dry-run default, `APPROVE_LINK=1`/`--apply` | yes |
| `scripts/retail/publish-staged-observations.mjs` | products + observation publish status | dry-run default, `--apply`; **only `review_status='approved'`**; `--approve-pending` hard-blocked; ambiguous matches skipped | yes |
| `scripts/map-assets/*` (Sandton/NMS) | map assets (draft only) | dry-run default, `APPROVE_IMPORT=YES`, "dev-only"/draft markers | yes |
| `scripts/scraper/**` (legacy, Sprints ~1–2 era) | **wrote directly to products via its own db.ts** [inferred from structure; not executed in this audit] | none of the 19C gates | yes [inferred] |
| backend `sourceIngestionService.ts` | mall research findings (not prices) | admin routes; data-guardian policy engine | Cloud Run service role |

Safety markers in active use: `DRY RUN`, `--apply`, `APPROVE_LINK`,
`APPROVE_IMPORT=YES`, `draft`, "dev-only", approved-only publish gate,
review-status immutability for published rows, `admin_audit_log` writes.

**Key finding [code]:** the legacy `scripts/scraper/` directory predates the
provenance pipeline entirely, and `.github/workflows/` contains two
**scheduled** workflows: `scrape-prices.yml` (**nightly**, cron `0 0 * * *`)
and `scrape-malls.yml` (weekly). The price workflow writes a `.env` with
`secrets.SUPABASE_SERVICE_KEY` and runs the retailer scrapers — i.e. if that
repository secret is configured, a nightly job has service-role write access
**outside every 19C gate** and could overwrite or pollute `products`
(including the demo's verified rows). Whether the secret is actually set
cannot be confirmed from code — verify in GitHub repo settings/Actions run
history immediately, and disable the schedules until scraping is rebuilt on
observation staging.

## Current founder demo data

- **Mall@Reds** `f4a2c1b3-8d7e-4f6a-9b0c-1d2e3f4a5b6c`; Game shop
  `a1b2c3d4-0001-…001` (Floor G, Shop G01). [code: smoke script, CSV, live API]
- Staged via `scripts/retail/mallreds_seed_starter.csv` → CSV importer →
  admin review → approved-only publisher. 10 observations total; **2
  published verified** (Hisense 43" FHD LED TV R3 499 — trust_state
  `verified`, method `phone`, `valid_to` 2026-07-31; Woolworths Greek Yoghurt
  500g); 8 staged safe (pending/needs_more_info), all `manual_fact_entry` +
  `csv_manual` → would publish as needs_review, never Verified. [code: CSV +
  19C reports + live `--live` smoke probe]
- **Demo card facts**: Hisense at Game R3 499 "Verified option" =
  **manually verified by phone** (real verification, 2026-06-09); backup
  Samsung 32" R2 999 = `demo` quality → honestly labelled "Example/demo
  data". The LG/Samsung rows in `products` come from the original
  `supabase/seed.sql` demo seed (data_source `manual_seed`, quality `demo`).
- Note: `supabase/seed.sql` also seeds a *different* mall id
  (`d5ac0565-…`) with other demo products — legacy seed data, quality `demo`.

## Risks / blindspots

1. **Demo freshness (URGENT)** — 7-day verification expiry means the tagged
   demo's "Verified price" degrades to "Verification expired" around
   **2026-06-16** unless `price_verified_at` is refreshed via a real
   re-verification. **Update (22B):** an operator-gated re-verification
   helper now exists (`scripts/retail/reverify-demo-prices.mjs`, see
   `demo-price-reverification.md`) — a human still has to actually verify
   and run it weekly.
2. **Legacy scraper lane (CONFIRMED scheduled in-code)** — a nightly
   `scrape-prices.yml` workflow wired to `SUPABASE_SERVICE_KEY` exists. If
   the secret is set, it bypasses every 19C gate nightly. Check GitHub
   Actions history; disable schedules pending quarantine (Sprint 22C).
   **Update (22C): quarantined** — both workflows de-scheduled, renamed
   `[QUARANTINED]`, gated behind a typed acknowledgement on manual dispatch,
   and `scripts/scraper/README.md` now carries a do-not-run banner. The
   repository secret itself still requires a human check in GitHub settings.
3. **Stale `valid_to` unused** — observations carry `valid_to` but nothing
   appears to enforce/expire on it after publish [inferred; no code found
   reading valid_to post-publish].
4. **Duplicate products / ambiguity at scale** — matching is exact
   shop_id + normalized name; ambiguous matches are safely skipped, but
   cross-shop duplicates (same TV at Game and Hi-Fi Corp) are intentionally
   separate products — fine — while *intra-shop* near-duplicates ("Hisense
   43in" vs "Hisense 43\"") would create silent inserts, not matches.
5. **Store naming mismatch across malls** — shop matching by name fragment
   (Deals route lookup uses `ilike` on first two words) will mis-hit when
   many malls have a "Game". Expansion needs shop_id-first references.
6. **Category free-text** — `category` is unconstrained text in both
   observations and products; cross-source category drift is unguarded.
7. **Approval bypass risk: low** — publisher enforces approved-only in the
   query; `--approve-pending` blocked; review route refuses published rows.
   Residual risk is direct service-role SQL, which is procedural, not code.
8. **RLS/service-role exposure** — retail staging tables have no anon
   policies [code]; service-role keys exist only in Cloud Run env and local
   script env. Frontend uses anon key. `app_events` anon 401 noise shows RLS
   default-deny is doing its job, at the cost of log noise.
9. **Shopper trust language drift** — labels duplicated across engine,
   doctrine, and smoke docs; copy changes must be synchronized.
10. **One-mall assumptions** — smoke script, demo docs, and default mall ids
    are Mall@Reds-specific; fine for now, must be parameterized for mall #2.

## Recommended retail expansion roadmap

**22B — Demo Verification Freshness Loop** *(immediate)*
- Goal: keep the founder demo's verified prices inside the 7-day window via a
  small re-verification script (operator confirms by phone/website, script
  updates `price_verified_at`/`verified_by` for the named product ids only).
- Scope: `scripts/retail/reverify-demo-prices.mjs` + doc note. Forbidden:
  schema changes, auto-verification without human input, touching trust
  mappers. Accept: dry-run default; refuses rows that aren't already
  manually_verified; demo card still shows "Verified option" after run.
- Why: the tagged demo silently degrades ~2026-06-16 otherwise.

**22C — Legacy Scraper Quarantine**
- Goal: decide and document the fate of `scripts/scraper/` + its GitHub
  Actions; disable scheduled workflows; add a README warning that all price
  writes must go through observation staging.
- Scope: `.github/workflows/*`, `scripts/scraper/README.md`, docs. Forbidden:
  deleting scraper code (it's future raw material), pipeline changes.
- Accept: no scheduled job can write products; documented.

**22D — Mall@Reds Catalogue Batch 2**
- Goal: stage + review + publish ~20–30 new evidence-backed observations
  (phone/website verification) through the existing CSV → review → publish
  loop; first real exercise of the pipeline at small scale.
- Scope: new CSV + runs of existing scripts (apply gates as designed); no
  code changes expected. Accept: every published row manually_verified with
  evidence method; zero needs_review rows published as verified.

**22E — Freshness & Expiry Surfacing**
- Goal: make expiry visible and managed — admin view/script listing products
  whose `price_verified_at` is older than N days; verify the shopper-side
  "Verification expired" path renders correctly end-to-end.
- Scope: small admin/script + smoke checklist addition. Forbidden: changing
  the 7-day policy without explicit decision.

**22F — Name/Duplicate Hygiene Harness**
- Goal: a read-only audit script that scans the live catalogue per shop for
  near-duplicate normalized names and reports would-be ambiguous matches
  before they bite at scale.
- Scope: `scripts/retail/audit-name-collisions.mjs` (read-only). Accept:
  report lists collisions; zero writes.

**22G — Source Registry Expansion**
- Goal: register 2–3 named, legally-clear sources (e.g. retailer public
  website checks, flyer photos) in `retail_data_sources` with correct
  `legal_status`/`base_trust`, documenting the evidence standard per type.
- Scope: registry rows via existing staging tooling + doc. Forbidden: any
  source with `needs_legal_review` feeding published data.

**22H — Second Mall Pilot**
- Goal: clone the Mall@Reds loop for one new mall (shops verified, 5–10
  products, full staging → publish), parameterizing mall-specific assumptions
  in scripts/smoke docs.
- Scope: data + small script parameter work. Accept: demo journey works for
  mall #2 without code forks.

*(Optional 22I — frontend type cleanup: remove phantom `Shop.opening_hours`,
quiet the `app_events` anon 401 noise.)*

## Immediate next sprint recommendation

**Two urgent items, in this order:**

1. **Check/disable the scheduled scraper workflows (start of 22C)** — a
   5-minute check in GitHub Actions settings. If `SUPABASE_SERVICE_KEY` is
   configured, a nightly job is writing past every trust gate today.
2. **22B — Demo Verification Freshness Loop** — small, zero-risk, and
   protects the just-tagged founder demo from silently losing its "Verified
   option" badge around 2026-06-16 (7-day expiry from the 06-09 phone
   verification).

## Open questions

1. Scheduled scraper workflows ARE present in code (nightly + weekly) and
   wired to `secrets.SUPABASE_SERVICE_KEY`. Is that secret configured, and do
   the Actions runs show recent executions? (Only verifiable in GitHub repo
   settings/Actions tab — check immediately.)
2. Should the 7-day verification expiry differ for demo vs production data,
   or should the demo simply be re-verified weekly (recommended)?
3. Is `valid_to` on observations meant to drive post-publish expiry later, or
   is `price_verified_at` + priceTrust the only freshness mechanism by design?
4. Who is the named human verifier for re-verification calls (audit trail
   currently records script paths/emails in `verified_by`/`reviewed_by`)?
5. For mall #2: is there a target mall with an existing shop dataset (e.g.
   from the GeoDirectory enrichment lane) to avoid manual shop entry?
