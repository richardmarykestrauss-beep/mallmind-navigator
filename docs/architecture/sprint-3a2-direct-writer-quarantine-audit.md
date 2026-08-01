# Sprint 3A.2 — Direct-Writer Quarantine Preparation & Caller Audit

Mode: **READ-ONLY** analysis, caller discovery, adapter-feasibility, and planning. No runtime code,
migrations, schema, Supabase, secret, config, or deployment change was made. Base branch
`claude-premium-nav-test` @ `2c66c07f9de87a337306686df081e6aaa6d26628`.
Governing authority: [wired-vs-present-audit.md](wired-vs-present-audit.md),
[mallmind-whole-system-convergence-blueprint.md](mallmind-whole-system-convergence-blueprint.md),
and the Sprint 3A.1 audit read from commit `78580c6648c0616556ce6ea6326c680db24b6c90`
(`docs/architecture/sprint-3a1-canonical-funnel-design-audit.md` — not merged; read via `git cat-file`).

## 1. Executive finding

The 3A.1 "UNKNOWN scheduled caller" risk is **largely resolved by repository evidence**, with **one
hard exception that must be verified by a Supabase operator before any disable**:

- **The GitHub-Actions scrapers are already quarantined and manual-only.** `scrape-prices.yml` and
  `scrape-malls.yml` had their `schedule:` triggers **removed in Sprint 22C**, are
  `workflow_dispatch`-only, are gated behind a typed `QUARANTINED` acknowledgement, and the
  `scripts/scraper/README.md` carries a "do not run against live Supabase" banner. **No repository
  evidence of a scheduled caller was found** for the Node scrapers.
- **The `publish-staged-observations` planner (`retailPublishPlanner.ts`) is not wired to any route,
  server, or worker** (grep of `routes/`, `server.ts`, `worker.ts` is empty). It is an operator path.
- **⚠ The Supabase Edge Function `supabase/functions/scrape-prices/index.ts` is a different story.**
  Its own header documents a **Dashboard-configured schedule** ("Schedule (in Supabase Dashboard →
  Edge Functions → scrape-prices → Schedules)"), it **updates `products.price` directly**, and it
  **fabricates an in-store price** ("Store premium: 2–6% above online price") from a Takealot online
  price. Whether it is **currently deployed and scheduled cannot be determined from the repository**
  — this is the one live trust-poisoning risk that requires **read-only Supabase operator
  verification before quarantine**.

**Verdict: CONDITIONAL-GO for Sprint 3A.3** — wiring may be *designed and prepared*, and the four
ADRs (§6) drafted for approval, but **no writer may be disabled and no wiring finalized** until the
external checklist (§3) — chiefly the edge-function schedule and the `SUPABASE_SERVICE_KEY` GitHub
secret — is verified read-only by the relevant operators.

## 2. Complete direct-writer inventory (per protected field)

| Protected target | Writers (file:line) |
|---|---|
| `products.price` | scraper `scripts/scraper/db.ts:90,107`; edge fn `supabase/functions/scrape-prices/index.ts:75`; `takealot.ts`/`pricecheck.ts` (via `db.ts`); planner `retailPublishPlanner.ts`/`publish-staged-observations.mjs`; **canonical** `publish_verified_observation` |
| `products.original_price` | `db.ts:91,108`; planner; publish RPC |
| `products.is_on_special` | `db.ts:92,109`; planner; publish RPC |
| `products.in_stock` | `db.ts:93,110`; publish RPC |
| `products.verified` | publish RPC (canonical); `reverify-demo-prices.mjs` (via verify fields) |
| `products.data_quality_status` | `routes/priceCorrections.ts:506-508` (status only); publish RPC |
| `products.price_verified_at` | `reverify-demo-prices.mjs:239-241`; publish RPC |
| `products.price_valid_until` | publish RPC |
| `products.price_scope` | publish RPC only (projected from observation) |
| `retail_price_observations` | `stage_retail_csv_import` (029, canonical batch); `stage_retail_feed_observation` (039, present-only); `import-csv-staging.mjs:195` (raw bypass) |
| `retail_intake_job_drafts` | `commit_intake_chunk` (034) — durable intermediate only |

## 3. Caller & scheduler evidence

Repository-wide sweep of: `.github/workflows/`, `package.json` scripts (root + backend), imports,
route callers, CLI entry points, and references to each writer path.

| Writer | Known runtime caller | Scheduler | Evidence of use | Context / role | Verdict on activity |
|--------|----------------------|-----------|-----------------|----------------|---------------------|
| Node scrapers (`scripts/scraper/*`, orchestrated by `index.ts`) | GH Actions `scrape-prices.yml`, `scrape-malls.yml` run `npx tsx index.ts` / `scrapers/<r>.ts` | **None** — `schedule:` removed (Sprint 22C); `workflow_dispatch` + `QUARANTINED` ack only | README banner "QUARANTINED — do not run against live Supabase" | Playwright/Node, `SUPABASE_SERVICE_KEY` in the workflow `.env` | **Manual-only, quarantined.** No repository evidence of a scheduled caller. |
| `supabase/functions/scrape-prices/index.ts` | Supabase Edge runtime | **Header documents a Dashboard schedule** — repo cannot confirm | header: "supabase functions deploy scrape-prices"; writes `scrape_logs` + `products.price` | Edge fn, service role | **UNKNOWN outside repo — REQUIRES Supabase operator verification.** Potential live scheduled writer. |
| `publish-staged-observations.mjs` / `retailPublishPlanner.ts` | **Not wired to any route** (grep empty) | None | report `reports/retail/19C.1-first-controlled-retail-publish.md` (a past *manual* controlled publish) | operator CLI / service key | **Manually operated; no scheduler.** |
| `import-csv-staging.mjs` | operator CLI (referenced from docs + `retailCsvIntake.ts`) | None | docs only | operator CLI / service key | **Manually operated; no scheduler.** |
| `reverify-demo-prices.mjs` | own CLI | None | `docs/retail/demo-price-reverification.md` | demo CLI | **Demo/manual; no scheduler.** |
| `routes/priceCorrections.ts` | wired backend route | Route (request-driven) | wired in `server.ts` | backend service role | **Active, request-driven (status-only writes).** |
| seed / `008` backfill | none | None | dev seed / one-time migration | dev / migration | **Inert (dev/one-time).** |

Other workflows: `agent-build.yml` (AF-1 build loop, `workflow_dispatch`), `verify.yml` (CI on
push/PR). Neither touches retail writers.

## 4. External dependency verification checklist (read-only; no secret values)

Repository evidence of external dependencies, grouped by verification track. **Secret values, tokens,
keys, and connection strings are NOT printed.**

**Supabase operator track (read-only Dashboard):**
- [ ] Edge Function `scrape-prices` — is it **deployed**? Does it have a **Schedule**? (Dashboard →
  Edge Functions → `scrape-prices` → Schedules). **Blocking for quarantine.**
- [ ] `scrape_logs` table — recent rows would indicate the edge function ran recently.
- [ ] Any other scheduled Edge Function or `pg_cron` job touching `products`/`retail_price_observations`.

**GitHub / CI track:**
- [ ] Repository secret `SUPABASE_SERVICE_KEY` — is it still configured? (Both scraper workflows say
  "HUMAN ACTION STILL REQUIRED: inspect/remove it (Settings → Secrets)"). Do **not** reveal its value.
- [ ] Confirm no workflow has a `schedule:` trigger re-added (currently none).

**Google Cloud / Gemini execution track:**
- [ ] Cloud Scheduler — any job invoking a scraper, the backend, or the intake worker on a schedule?
  (No repository evidence of one.)
- [ ] Cloud Run services `mallmind-backend-dev` and the intake worker — confirm no scheduled trigger
  performs retail writes.

**Founder / manual confirmation:**
- [ ] Confirm the "19C.1 first controlled retail publish" was a one-off manual operation and
  `publish-staged-observations` is not part of any runbook that will re-run automatically.

Env-var **names** referenced in-repo (values never printed): `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`,
`INTAKE_WORKER_URL`, `ANTHROPIC_API_KEY`, `NODE_OPTIONS`.

## 5. Scraper-to-adapter feasibility & field maps

Representative source: Takealot (`takealot.ts` + the edge fn share the same API shape). The scrapers'
**parsing** is small and retainable; their **write behaviour is not** — it fabricates competitor
in-store prices.

| Current parsed field | → RetailerFeedContractV1 | Transformation | Missing / risk |
|---|---|---|---|
| `core.title ?? title` | `product_name` | trim | brand often absent |
| `buy_box.price ?? product_views.listing_price` (cents) | `current_price` + `current_price_cents` | already cents | — |
| (implicit) | `currency` = `ZAR` | set constant | acceptable (SA sources) |
| (scrape time) | `observed_at` | generate at fetch | it is an **ingestion** time, not a source-declared observed_at |
| **(discarded)** Takealot product id | `source_product_id` / `gtin` | **must capture** (API returns it; code currently keeps only title+price) | **GAP — no stable identity today** |
| Takealot = the source | `retailer_source_id` | reference a **registered Takealot source_id** | source must be pre-approved |
| (none) | `price_scope` = `online_national` | honest for Takealot | **current code mislabels it as competitor branch price** |
| (none) | `canonical_source_url` / `source_content_hash` | store API URL + payload hash | evidence not persisted today |
| competitor `shopNames` mapping | — | **drop** | **GAP — fabricated branch identity; must not map an online price to a competitor's in-store row** |

**Feasibility assessment (per required checks):**
- Stable source item IDs — **NO today** (discarded; recoverable from the API). Must be captured.
- `observed_at` — only ingestion-time generated (acceptable, must be labelled as such).
- `price_scope` provable — **only `online_national` for the source retailer**; a branch/competitor
  scope is **not** provable and must not be asserted.
- Branch identity — **NO** (current competitor mapping is fabrication; drop it).
- Currency explicit — no, but safely constant `ZAR`.
- Evidence URL/snapshot — API URL available; snapshot not stored today (add).
- Title/brand reliable — title yes; brand frequently null.
- Corrections/replays representable — only once a **stable identity** exists.
- Invents/assumes fields — **YES**: the edge function invents a "store premium" branch price; the
  scrapers assume competitor shop mapping. **These fabrications must be removed, not ported.**

**Conclusion:** a governed adapter is feasible **only** as: registered-source Takealot →
`online_national` observations, keyed on a **captured** Takealot item id, evidence-stamped, rights
inherited from the source registry — and it must **never** emit branch/competitor prices. The
parsing is worth keeping; the write path and the competitor/store-premium logic must be discarded.
**No adapter assigns rights; every adapter references a pre-approved `source_id`.**

## 6. Direct-writer disposition matrix

| Writer | Disposition | Replacement path | Prereqs | Tests | Deprecation period? | Flag/kill-switch? | Rollback | Docs | Owner/approval |
|--------|-------------|------------------|---------|-------|---------------------|-------------------|----------|------|----------------|
| `publish_verified_observation` | **retain canonical** | — | — | existing | no | n/a | n/a | — | — |
| `retailPublishPlanner.ts` / `publish-staged-observations.mjs` | **retire → replace with publish RPC** | route the planner through `publish_verified_observation` | confirm 19C.1 was one-off | parity test vs RPC | short | n/a (not wired) | keep script in git history | update readiness docs | retail owner |
| Node scrapers `scripts/scraper/*` | **convert to governed adapter (parsing) + retire writes** | adapter emits `CanonicalFeedRecord` → funnel | capture source item id; registered Takealot source | adapter-emits-candidate test | n/a (already quarantined) | already ack-gated | revert workflow | update scraper README | retail owner |
| `supabase/functions/scrape-prices` | **quarantine pending external caller verification → then retire/convert** | governed adapter (online_national only) | **verify Dashboard schedule + deployment (§4)** | schedule audit + adapter test | **must confirm not scheduled first** | undeploy / remove schedule | redeploy from git | edge-fn README | Supabase operator + retail owner |
| `import-csv-staging.mjs` | **retire → replace with 039** | route rows through the feed contract → `stage_retail_feed_observation` | 039 wired (3A.3) | staging-parity test | short | n/a | keep in history | update CSV docs | retail owner |
| `reverify-demo-prices.mjs` | **retire (demo)** | — | confirm demo-only | none | n/a | n/a | keep in history | note in demo doc | retail owner |
| `routes/priceCorrections.ts` | **retain descriptive/status metadata only** | keep; ensure it never writes price/verify fields | confirm field set | status-write test | no | n/a | n/a | — | backend owner |
| seed / `008` backfill | **seed/migration-only** | — | — | none | n/a | n/a | n/a | — | — |

## 7. Draft ADR recommendations (PENDING approval — not added to DECISIONS.md)

The repository uses `docs/build-os/DECISIONS.md` as its ADR log (ADR-001…013); there is **no
standalone-ADR-file convention**. Therefore the following are **proposed drafts held in this audit,
marked PENDING**; none is written to `DECISIONS.md` and no standalone ADR files are created.

**ADR-A — Canonical staging authority & provenance envelope (PENDING).** Options: (1)
`stage_retail_feed_observation` as sole row-level authority with CSV intake adapted into the durable
job envelope; (2) both RPCs behind one shared canonical function; (3) deprecate the 029 CSV RPC after
a compatibility period. *Comparison:* 039 gives the richest governed identity + branch mapping;
the durable job envelope (033/034) gives better batch auditability/retry than the CSV
snapshot/batch envelope; replay is cleanest under one RPC + one index; operational complexity is
lowest if we avoid two live RPCs; migration risk favours additive wrapping over rewrite; backward
compatibility favours keeping 029 briefly. **Recommendation: Option 1 + a short Option 3 tail** —
make 039 the sole row-level authority, feed CSV rows through the feed contract → 039, and retain 029
only as a compatibility shim until the CSV route is migrated, then deprecate it. One provenance
envelope: the durable job (`retail_intake_jobs` + drafts + quarantine + events); reconcile
`retail_source_snapshots` as the raw-evidence store and treat `retail_import_batches` as superseded
by `retail_intake_jobs` (or a thin compatibility view).

**ADR-B — Traceability chain (PENDING).** Minimum keyed chain: intake job → draft → observation →
publication → products. *Recommended additive fields (smallest set):* `intake_job_id` and
`draft_ref` on `retail_price_observations`; `published_observation_id` on `products`;
`supersedes_observation_id` on `retail_price_observations` (for corrections). **Defer**
`publication_event_id` unless a separate publication-event table is introduced — the observation's
`published_at`/`published_product_id` already record the event inline. Recommendation: add the four
fields above; do not add a publication-event table yet.

**ADR-C — Identity & replay authority (PENDING).** Canonical identity tuple = `source_id |
(source_product_id ∨ retailer_sku ∨ gtin ∨ barcode) | observed_at(UTC) | price_scope |
branch_external_id | current_price_cents`. *Authoritative:* the RPC's `md5(tuple)` + the
unique-pending-hash index (final DB authority). *Advisory:* the feed-contract `djb2` (in-batch) and
the durable `record_hash` (cross-batch). **Recommendation:** define the tuple once in a shared spec;
have the contract and the worker compute their advisory hashes over the **same tuple**, and persist
the RPC-returned identity into the durable draft so all layers describe one tuple while the database
remains final authority.

**ADR-D — Source lifecycle gate (PENDING).** Matrix of what each state may do:

| Source state | submit | stage | remain pending | verify | publish | keep serving existing projections |
|---|---|---|---|---|---|---|
| active + rights approved | yes | yes | yes | yes | yes | yes |
| active + rights unreviewed/under_review | yes | yes | yes | no | no | yes |
| suspended | no | no | (existing stay) | no | no | yes (read-only) |
| revoked | no | no | no | no | no | **no — hide projections** |
| expired (rights) | no | no | (existing stay) | no | no | yes (until re-review) |
| unknown / unapproved | no | quarantine | — | no | no | n/a |

**Recommendation (smallest safe rule):** add a `lifecycle_state`/`is_active` check to **staging**
and **job creation** (block `suspended`/`revoked`/`retired`); keep the existing publication rights
gate (`approved` + commercial + storage); on **revocation**, hide existing shopper projections (a
publication-time / read-time filter, decided with ADR-B). Staging already blocks
`reference_only`/`needs_legal_review`/`rejected`/`expired` — extend it to lifecycle.

## 8. Out-of-order & correction rule recommendation (design only)

Timestamps and their single purposes:
- **`observed_at`** (source-declared or ingestion-generated) → **evidence ordering, freshness, and
  correction precedence.** The newest `observed_at` for an identity slot is the current truth.
- **`created_at`/ingest time** → **audit history only** (never used for precedence or freshness).
- **`published_at`** → publication event record.

Rules:
- **Newer arriving before older:** append-only; the projection selects the **max `observed_at`**
  approved observation per identity slot — order of *arrival* is irrelevant.
- **Late-arriving historical observation:** stored as evidence; it does **not** supersede a newer
  `observed_at` already published.
- **Explicit source correction:** a new observation with a later `observed_at` and
  `supersedes_observation_id` pointing at the corrected row; review approves; publication swaps the
  projection. History is preserved (never mutated).
- **Correction of a previously published bad price:** same as above; the superseded observation is
  marked, the projection updates, the old evidence remains auditable.
- **Same `observed_at`, conflicting payload:** the RPC's `conflict` outcome (same identity,
  different `feed_content_hash`) → both retained, flagged **reviewable**; no automatic winner.
- **Source vs ingestion timestamps:** publication eligibility and freshness use **`observed_at`
  only**; ingestion time is audit-only, preventing a slow pipeline from looking "fresh."

## 9. Quarantine test & safety plan

| Test | Type | Proves |
|------|------|--------|
| Direct writer cannot change a protected price field | negative security (disposable-DB) | quarantine holds |
| Scraper still parses source data | unit | parsing preserved |
| Scraper output validates against RetailerFeedContractV1 | unit | adapter shape correct |
| Candidate reaches pending observation via canonical path | integration | funnel wired |
| No path publishes directly to `products` | negative security | only publish RPC writes protected fields |
| Rights inherited from source registry (candidate rights ignored) | negative security | no self-assigned rights |
| Unknown / unapproved source | negative | quarantined, not staged |
| Identical replay | disposable-DB | harmless (`replayed`) |
| Conflict | disposable-DB | reviewable, not overwritten |
| Descriptive metadata update still possible where authorised | integration | catalogue maintenance survives |
| Temporary re-enable / rollback path | procedure | documented kill-switch + revert |

Evidence: caller/schedule inventory (this doc + §4 checklist results), `verify:db` transcripts,
adapter unit-test output, negative-security assertions.

## 10. Proposed exact scope for Sprint 3A.3

- **Files expected to change:** `google-cloud-backend/src/services/intake/*` (draft → candidate →
  `stage_retail_feed_observation` promotion), a `CanonicalFeedRecord → 039-params` mapper,
  `routes/internalIntake.ts` (finalize/promotion hook). Possibly `verify-db.mjs` + a new fixture.
- **Migrations:** at most **one additive** (next number 040) implementing ADR-B traceability fields
  and the ADR-D lifecycle staging check — **only after ADR approval**.
- **Non-goals:** disabling any writer (that follows external verification); publication changes;
  hosted contact; touching the legacy project.
- **Dependencies:** ADR-A/B/C/D approved; §4 external checklist completed (esp. the edge-fn schedule).
- **Acceptance:** `stage_retail_feed_observation` has ≥1 wired runtime caller; durable drafts promote
  to pending observations exactly once; one identity authority; disposable-DB proof green.
- **Rollback boundary:** additive migration + rollback; the promotion behind a feature flag.

## 11. Risks & unresolved questions

1. **Edge-function schedule (live risk).** `scrape-prices` may be deployed + scheduled in Supabase,
   invisibly writing fabricated in-store prices. **Must be verified read-only before quarantine.**
2. **`SUPABASE_SERVICE_KEY` GitHub secret** may still exist, enabling a manual scraper run against
   live data. Operator must inspect/remove.
3. **ADR-A/B/C/D** are unresolved architecture decisions gating 3A.3 wiring.
4. **Scraper identity gap:** adapters need a captured stable source item id (currently discarded).
5. **Revocation → hide projections** (ADR-D) interacts with ADR-B and the read path — needs care.
6. Whether `retail_import_batches` is superseded or kept as a compatibility view (ADR-A).

## 12. Verdict — GO / CONDITIONAL-GO / NO-GO for Sprint 3A.3

**CONDITIONAL-GO.** The caller landscape is now well-understood and low-risk in-repo (scrapers
quarantined + manual-only; planner unwired; no scheduled callers found), so 3A.3 wiring may be
**designed, and the four ADRs finalized for approval**. However, **beginning the disable/quarantine
of writers and finalizing runtime wiring is gated on**: (a) read-only operator verification of the
Supabase Edge Function `scrape-prices` deployment/schedule and the `SUPABASE_SERVICE_KEY` GitHub
secret (§4); and (b) approval of ADR-A/B/C/D (§6/§7). Until (a) and (b) are complete, this is not a
full GO. It is **not NO-GO** — nothing blocks *preparation and decision-making*; only the
irreversible steps wait on external confirmation.

No runtime wiring, writer disablement, migration, or hosted contact is authorized by this document.
