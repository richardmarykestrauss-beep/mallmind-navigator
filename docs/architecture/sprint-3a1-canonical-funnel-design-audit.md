# Sprint 3A.1 — Canonical Funnel Design & Safety Audit

Mode: **READ-ONLY design + safety audit.** No code, migrations, schema, Supabase, or deployment
changes were made. Base branch `claude-premium-nav-test` @ `2c66c07f9de87a337306686df081e6aaa6d26628`.
Governing authority: [wired-vs-present-audit.md](wired-vs-present-audit.md) and
[mallmind-whole-system-convergence-blueprint.md](mallmind-whole-system-convergence-blueprint.md).

## 1. Executive finding

The canonical funnel can be assembled **entirely from components that already exist** — no new
parallel path is required. The convergence work is *wiring and reconciliation*, not building.

Three facts dominate the design:

1. **Two staging RPCs already write `retail_price_observations` at `pending`.**
   `stage_retail_csv_import` (029) is the **wired** batch path; `stage_retail_feed_observation`
   (039) is the **present-only** per-row bridge with governed branch mapping. They carry
   **different provenance envelopes** — 029 creates `retail_source_snapshots` + `retail_import_batches`;
   the durable worker (033/034) creates `retail_intake_jobs` + `…_chunks`/`…_quarantine`/`…_events`
   /`…_drafts`. **Which staging RPC and which provenance envelope is canonical is the single
   biggest decision this sprint must record** (§4, §11).
2. **The durable worker dead-ends at `retail_intake_job_drafts`.** Nothing promotes a draft into
   `retail_price_observations`. `stage_retail_feed_observation` is precisely the missing promotion
   step (audit §3). Wiring drafts → RPC converges the durable path, the feed contract, and the
   bridge in one move.
3. **Three identity/dedup computations exist over the same logical tuple** but with different hash
   functions and scopes (contract `djb2`, durable `record_hash`, RPC `md5` + unique index).
   Exactly one must be the authority; the others must be advisory and aligned to the same tuple
   (§6). This is the highest-risk area for "multiple layers inventing different replay rules."

**Verdict: GO for Sprint 3A.2 (direct-writer quarantine *preparation*)** — a read-only + test
sub-sprint. Runtime wiring (3A.3) is **conditional-GO**, gated on the decisions in §11/§12.

## 2. Current ingestion-path inventory (files · routes · workers · scripts · RPCs · tables)

**Durable intake** — worker `google-cloud-backend/src/worker.ts`; route
`routes/internalIntake.ts`; services `services/intake/*` (`supabaseGateway.ts` allowlist,
`PostgresDurableIntakeStore`); migrations 033/034. Tables: `retail_intake_jobs`,
`retail_intake_worker_leases`, `retail_intake_job_chunks`, `retail_intake_checkpoints`,
`retail_intake_quarantine`, `retail_intake_events`, `retail_intake_dedup_keys`,
`retail_intake_job_drafts`. RPCs: `create_intake_job`, `claim_next_intake_job`,
`commit_intake_chunk`, `finalize_intake_job` (+ lease/checkpoint helpers).

**RetailerFeedContractV1** — `src/lib/retail/feed/`: `feedContract.mjs` (canonical shape + enums +
outcome codes), `feedImporter.mjs` (`observationIdentity`, `importFeed` in-batch dedupe),
`jsonFeedReader.mjs`, `kingdomAdapter.mjs`, `csvParse.mjs`, `exampleRetailerAdapter.mjs`,
`locationMapping.mjs`, `hostedGuard.mjs`. CLIs: `scripts/retail/feed-dry-run.mjs`,
`feed-json-dry-run.mjs`, `mapping-validate.mjs`.

**CSV intake** — route `routes/retailObservationsAdmin.ts` (`POST /import-csv`); service
`services/retailCsvImportService.ts`; RPC `stage_retail_csv_import` (029, patched 030–032). Tables:
`retail_data_sources`, `retail_source_snapshots`, `retail_import_batches`,
`retail_price_observations`.

**JSON intake** — `jsonFeedReader.mjs` + `kingdomAdapter.mjs` feed into the contract; **no distinct
DB sink** (shares the feed-contract island).

**`retail_intake_job_drafts`** — migration 034 (job_id, chunk_index, draft_ref, record_hash,
conflict_state; RLS forced, service_role-only); written by `commit_intake_chunk` (034:106).

**`stage_retail_feed_observation()`** — migration 039 (26 scalar params + governed branch mapping +
md5 identity/content hashes; service_role-only SECURITY DEFINER). Present-only.

**`retail_price_observations`** — 026/036/039; the pending staging table; `observation_hash`
unique-pending index; 039 added `feed_content_hash`, `feed_source_row`, `feed_file_name`,
`feed_parse_warnings`, `branch_external_id`, `staged_actor`.

**Verification** — `routes/adminVerifyProduct.ts`, `services/retailObservationPublisher.ts`,
`priceTrust.ts`, `dataTrustPolicy.ts`; review surface `routes/retailObservationsAdmin.ts`.

**Publication** — RPC `publish_verified_observation` (027/036/038, service_role-only); caller
`retailObservationPublisher.ts`; writes the `products` projection.

## 3. File-level runtime traces + classification

| # | Path | source → entry → validation → transformation → persistence → terminal | Class |
|---|------|------------------------------------------------------------------------|-------|
| 1 | Admin CSV | CSV → `POST /import-csv` (`retailObservationsAdmin.ts`) → `retailCsvImportService.ts` (pure `intakeRetailCsv`) → maps to source/snapshot/batch/observation JSONB → `stage_retail_csv_import` (029; review_status **forced** pending; dedupe by `observation_hash`; advisory lock) → `retail_price_observations` (pending) | **canonical (today) — but a second staging RPC** |
| 2 | Durable worker | payload → `worker.ts`/`internalIntake` → `create/claim/commit/finalize` RPCs → `commit_intake_chunk` dedups via `retail_intake_dedup_keys` → **`retail_intake_job_drafts`** | **durable intermediate → dead-end** |
| 3 | Feed contract / JSON | feed → `feedImporter.importFeed` (validate, normalize, in-batch dedupe) → CanonicalFeedRecord[] → dry-run CLIs print | **present-only / test-only** (no DB sink) |
| 4 | `stage_retail_feed_observation` | (would) candidate → RPC → `retail_price_observations` (pending) | **present-only** (zero runtime callers) |
| 5 | `import-csv-staging.mjs` | CSV → raw `.from('retail_price_observations').insert` | **divergent bypass** (bypasses the RPC) |
| 6 | Legacy scrapers | web → `scripts/scraper/{db,pricecheck,takealot}.ts` → direct `products` INSERT/UPDATE | **legacy / divergent bypass** |
| 7 | Edge / scheduled / route writers | `supabase/functions/scrape-prices` (direct `products.price` UPDATE); `routes/priceCorrections.ts` (`products.data_quality_status`); `mallResearchBatches.ts` (→ `mall_research_batch_items`, a different funnel) | scrape-prices **legacy/divergent**; priceCorrections **adapter candidate (metadata-only)**; mall-research **separate funnel** |
| 8 | Direct `retail_price_observations` inserts | governed: 029 RPC, 039 RPC. Ungoverned: `import-csv-staging.mjs:195` | governed = canonical; CLI = **divergent bypass** |
| 9 | Direct `products` writes | `publish_verified_observation` (canonical); `publish-staged-observations.mjs` (parallel JS publisher); scrapers + `scrape-prices` (legacy); `reverify-demo-prices.mjs` (demo); `priceCorrections.ts` (status); `seed.sql`/`008` (seed/backfill) | see §8 matrix |

## 4. Canonical funnel decision (one runtime sequence)

```
approved source registration          (retail_data_sources: rights approved + evidenced)
  → durable intake job                (retail_intake_jobs — transport/orchestration; input_hash)
  → RetailerFeedContractV1 validation (feedImporter.importFeed → CanonicalFeedRecord[])
  → durable candidate/draft           (retail_intake_job_drafts: draft_ref, record_hash, conflict_state)
  → stage_retail_feed_observation()   (per candidate; rights gate + governed branch mapping + md5 identity)
  → retail_price_observations (pending)
  → exception-based review → publish_verified_observation() → products (projection)
```

**Recommendation:** make `stage_retail_feed_observation` (039) the **single row-level staging
authority**. The durable worker is the transport; `retail_intake_job_drafts` is the durable
intermediate; the feed contract is the validator. `stage_retail_csv_import` (029) is retained
**short-term** as the wired CSV batch path but is **reconciled** onto the same identity/rights
authority and, in a later step, either (a) becomes a thin batch wrapper that internally calls the
same per-row logic, or (b) is retired once the CSV admin route maps rows through the feed contract
→ 039. **Do not run 029 and 039 as two independent definitions of a valid observation.**

### Resolved design questions

1. **Object worker → RPC:** one **validated `CanonicalFeedRecord`** per row (not a raw draft),
   mapped to the 26 RPC params, plus `p_actor` = the worker's **service-role identity** (never from
   the feed). The durable draft stores the candidate + `record_hash` for retry/audit.
2. **Does the contract already carry every RPC field?** **Almost fully — yes.** The contract's
   `commercial` / `product_identity` / `scope_availability` / `evidence` groups map 1:1 to the RPC
   params, and prices are already decimal-safe integer cents (`…_cents`). **Gaps:** (a) `p_actor`
   (must come from the worker's service-role context, *by design not from the feed*); (b)
   `p_external_branch_name` (the contract has `branch_external_id`/`shop_external_id` but no branch
   *display name* — pass `null`, or add an optional `external_branch_name` field).
3. **Field origins:** `source_id` ← approved source registration (`retail_data_sources.id`, echoed
   as `retailer_source_id`); **branch mapping** ← resolved **inside the RPC** from
   `retail_external_location_mappings` (approved-only); `observed_at`, `price_scope`, `currency`,
   evidence (`source_content_hash`, `source_url`, `source_row_number`, `source_file_name`,
   `parse_warnings`) ← adapter/feed; **replay identity** ← computed **by the RPC** (`md5` over the
   canonical tuple) + the unique-pending-hash index.
4. **Transformation ownership:** adapters = retailer columns → canonical fields **only** (no rights,
   no internal ids); feed contract = validation/normalization/decimal-safe cents/scope+currency+
   timestamp checks/in-batch dedupe (advisory)/warning+rejection codes; worker = transport
   (chunking, leasing, retry, durable drafts, cross-batch dedup keys (advisory), per-row RPC calls,
   row/batch outcome recording); RPC = rights gate (from registry) + governed branch mapping
   (approved-only) + **DB-authoritative idempotency** + pending insert + listing upsert + audit.
   **Nowhere (would duplicate authority):** rights approval (source registry only), internal-id
   assignment (approved mapping in the RPC only), replay authority (RPC + unique index only),
   publication (publish RPC only).
5. **`retail_intake_job_drafts` role:** **durable candidate + retry/conflict state** (durable raw
   audit + retry buffer), **not** a source of retail truth and **not** the review surface (review
   is on `retail_price_observations`). Retain; do not let it become a competing truth.
6. **Partial successes:** per-row rejects → `retail_intake_quarantine`; per-row events →
   `retail_intake_events`; staged count → `retail_intake_jobs.staged_drafts`; a job can finalize
   with some rows staged and some quarantined.
7. **Failed-row retry without duplication:** `retail_intake_dedup_keys` (scope, record_hash)
   suppresses re-staging already-successful rows; the RPC's unique-pending-hash index is the DB
   backstop (identical replay → `replayed`, no duplicate); checkpoints allow resume.
8. **Batch + row outcomes recorded:** batch = `retail_intake_jobs` (status/staged_drafts/failure);
   row = `retail_intake_quarantine` + `retail_intake_events` + the RPC's returned coded outcome
   (`staged`/`replayed`/`conflict`/`mapping_required`/`rejected`).
9. **Correction feeds:** a later `observed_at` with a changed price is a **new append-only
   observation** (RPC → `staged`), never an overwrite; a source *retraction/correction* is handled
   at **review/publication (supersession)** + the source registry, never by mutating past rows.
10. **End-to-end traceability:** `retail_intake_jobs.id` (+ `input_hash`) → `retail_intake_job_drafts`
    (`draft_ref`, `record_hash`) → RPC → `retail_price_observations` (`observation_hash`,
    `feed_content_hash`, `feed_source_row`, `feed_file_name`, `staged_actor`) → `publish_verified_observation`
    → `products`. **GAP:** `retail_price_observations` has no `intake_job_id`/`draft_ref` column, and
    `products` has no `published_observation_id` (3B). Without these the chain is inferential, not
    keyed — recommend adding both (see §11).

## 5. Field & authority ownership matrix

| Concern | Owning layer (authority) | Advisory / echo (non-authoritative) |
|---------|--------------------------|-------------------------------------|
| Retailer-column → canonical mapping | Adapter | — |
| Field validity / normalization / cents | Feed contract | — |
| In-batch duplicate detection | Feed contract (`djb2`) | must align to the RPC tuple |
| Cross-batch dedupe | Durable worker (`retail_intake_dedup_keys`) | advisory; RPC index is backstop |
| Transport / retry / chunk / draft | Durable worker | — |
| **Rights gate** | **Source registry**, enforced in RPCs | candidate `rights_review_state`/`legal_status` = echo only, **ignored** by gates |
| **Internal shop/mall id** | **Approved `retail_external_location_mappings`**, resolved in RPC | candidate branch codes never yield ids |
| **Replay / conflict identity** | **RPC `md5` + unique-pending-hash index** | contract `djb2`, durable `record_hash` advisory |
| Review status transitions | Review surface + observations table | — |
| **Publication → `products`** | **`publish_verified_observation` only** | all other writers = to be quarantined (§8) |
| Actor identity | Worker service-role context | never from the feed |

## 6. Idempotency & conflict model (single authority; others advisory)

**Authority = the RPC's `md5(identity tuple)` + the unique-pending-hash index on
`retail_price_observations.observation_hash`.** The identity tuple = `source_id | (source_product_id
∨ retailer_sku ∨ gtin ∨ barcode) | observed_at(UTC) | price_scope | branch_external_id |
current_price_cents`. Conflict is detected by a separate `feed_content_hash`.

| Scenario | Outcome | Owning layer |
|----------|---------|--------------|
| Identical replay | `replayed`, no duplicate | **RPC + index** |
| Duplicate within one batch | `duplicate` (skipped) | Feed contract (`seenIdentity`) → RPC backstop |
| Duplicate across batches | suppressed | Durable `dedup_keys` (advisory) → RPC backstop |
| Same item, changed price | new `staged` observation (price ∈ tuple) | **RPC** |
| Same item, changed branch | new `staged` observation (branch ∈ tuple); ids only from approved mapping | **RPC** |
| Same identity, conflicting payload | `conflict` (not overwritten; both retained) | **RPC** (`feed_content_hash`) |
| Source correction | new append-only observation + review supersession | Review/publication + registry |
| Late-arriving / out-of-order | append-only; latest resolved at projection time | Publication/projection **(GAP: ordering rule must be explicit)** |
| Malformed row | `quarantined`, never reaches RPC | Feed contract (`REJECTION_CODES`) |
| Unknown branch | non-branch → warning; branch-intending → `mapping_required` (not staged) | Contract (warn) / **RPC** (branch claim) |
| Missing rights approval | staging: `rejected` for reference_only/needs_legal_review/rejected/expired; publication: requires approved | **Source registry via RPC gates** |

**Convergence requirement:** the contract `djb2` and durable `record_hash` must be **derived from
the same tuple** the RPC hashes (or the RPC-returned identity must be persisted into the draft), so
no layer can silently disagree with the DB authority.

## 7. Rights-governance model

**Fields (`retail_data_sources`):** `legal_status` (026 check), `rights_review_state`
(unreviewed/under_review/approved/restricted/rejected/expired), `commercial_use_allowed`,
`storage_allowed`, `lifecycle_state` (discovered/testing/active/degraded/suspended/retired/revoked),
`is_active`.

- **Staging gate (039):** rejects `legal_status ∈ {reference_only, needs_legal_review}` **or**
  `rights_review_state ∈ {rejected, expired}`.
- **Publication gate (036):** `legal_status` must not block (raises otherwise, 036:257);
  `rights_review_state = 'approved'`; `commercial_use_allowed`; `storage_allowed`.
- **Authority = the source registry.** Both RPCs read rights **by `source_id`** and **ignore** any
  rights fields on the candidate. Therefore adapters/scrapers **cannot self-assign or upgrade
  rights**; the contract's `rights_review_state`/`legal_status` are descriptive echoes only.

**Gaps to close:**
1. The **staging gate does not check `lifecycle_state`** — a `suspended`/`revoked` source can still
   *stage* (publication would block, but a suspended source should not stage). Recommend adding a
   `lifecycle_state`/`is_active` check to staging **and** at durable-job creation.
2. The candidate carries echoed rights fields that could mislead a future author — the funnel must
   explicitly document/enforce "source registry is sole authority; candidate rights are never read
   by a gate."
3. No enforced link ensuring a durable job references an **active, non-suspended** source at
   creation time — recommend a check in `create_intake_job` (design note; not implemented here).

## 8. Direct-writer quarantine matrix (dispositions — NOT implemented)

| Writer (file:line) | Context / credential | Fields written | Poisons verified trust? | Prod/scheduled caller? | Breaks if disabled | Safe replacement | Tests before quarantine | **Disposition** |
|---|---|---|---|---|---|---|---|---|
| `publish_verified_observation` (036) | service_role, SECURITY DEFINER | protected commercial projection | No (it *is* the gate) | verification/publisher | publication | — | — | **retain (canonical)** |
| `publish-staged-observations.mjs:158-188` | operator CLI, service key | `products` price/verify + obs published | **Yes** (bypasses gates) | operator (confirm no cron) | a manual publish path | route via publish RPC | parity test vs RPC | **retire / replace-with RPC** |
| `scripts/scraper/db.ts:88-100` | script, service key | `products` price/insert | **Yes** | **UNKNOWN — confirm** | a scraper write path | governed adapter → contract → 039 | adapter-emits-candidate test | **convert to adapter, else retire** |
| `scripts/scraper/pricecheck.ts:148-156` | script | `products` price/insert | **Yes** | **UNKNOWN** | scraper path | as above | as above | **convert / retire** |
| `scripts/scraper/takealot.ts:115-117` | script | `products.price` | **Yes** | **UNKNOWN** | scraper path | as above | as above | **convert / retire** |
| `supabase/functions/scrape-prices/index.ts:75` | Edge fn (could be scheduled) | `products.price` | **Yes** | **UNKNOWN — must confirm no schedule** | edge price refresh | governed adapter → funnel | schedule audit + adapter test | **retire / convert (confirm schedule first)** |
| `reverify-demo-prices.mjs:239-241` | demo CLI | `price_verified_at`, `verified_by` | Yes (demo) | demo only | demo reverify | remove | — | **retire (demo)** |
| `routes/priceCorrections.ts:506-508` | backend route, service | `products.data_quality_status` (status only) | No (not price) | wired route | dispute-status update | keep, or route via governed status path | status-write test | **retain (metadata/status only)** |
| `import-csv-staging.mjs:195` | operator CLI | raw `retail_price_observations` insert | indirectly (bypasses RPC invariants) | operator | a raw staging path | route via 039 | staging-parity test | **retire / replace-with 039** |
| `supabase/seed.sql:125`, `008` backfill | dev seed / migration | `products` | No (dev/one-time) | none (dev) | dev seed | — | — | **test-only / inert** |

**Blocking prerequisite for any disable (3A.2 must produce this):** a definitive answer to the
**UNKNOWN** cells — is any scraper or the `scrape-prices` edge function invoked by a **scheduled
job / cron / production trigger**? Nothing may be disabled until that is proven, per the blueprint.

## 9. Proposed Sprint 3A sub-sprints

**3A.2 — Direct-writer quarantine preparation** *(read-only + tests; safe now).*
Files: none disabled; add tests + an adapter design note only. Migrations: none. Tests: caller/
schedule audit for every §8 writer; adapter-shim design proving scraper parsing can emit
`CanonicalFeedRecord`s. Acceptance: every §8 UNKNOWN resolved; each writer has a confirmed
disposition + a "what breaks" statement + a replacement path + required tests listed. Rollback:
n/a (no runtime change). Non-goals: disabling any writer; wiring the funnel. Deps: none. Evidence:
caller/schedule inventory; disposition sign-off.

**3A.3 — Canonical funnel runtime wiring** *(conditional-GO — see §12).*
Files (expected): `google-cloud-backend/src/services/intake/*` (draft → candidate → RPC promotion),
a mapper from `CanonicalFeedRecord` → the 039 param list, `routes/internalIntake.ts` (finalize
hook). Migrations: **possibly one additive** — traceability columns (`intake_job_id`/`draft_ref` on
observations) and the §7 `lifecycle_state` staging check (additive; next number 040). Tests:
disposable-DB integration proving drafts promote to pending observations exactly once. Acceptance:
`stage_retail_feed_observation` has ≥1 wired runtime caller; drafts no longer dead-end; one
identity authority. Rollback: additive migration + its rollback; feature-flag the promotion.
Non-goals: publication changes; disabling writers (that's 3B/its own step). Deps: 3A.2 + the §11
decisions. Evidence: end-to-end drafts→pending trace.

**3A.4 — Local disposable-database proof.** Files: extend `scripts/build-os/verify-db.mjs` + a new
fixture. Migrations: none new (exercises 3A.3's). Tests: the full §10 test matrix on disposable
Postgres. Acceptance: `verify:db` green twice; the matrix passes. Rollback: n/a (test only).
Non-goals: hosted contact. Deps: 3A.3. Evidence: green verify:db runs.

**3A.5 — Clean staging provisioning.** Files: none in-repo (an operator-run controlled task per
blueprint §15). Migrations: apply 000–039(+040) to a **new** project. Tests: schema/grants/RLS/RPC
verification. Acceptance: staging built + verified; legacy `qspsou…` untouched. Rollback: destroy
the throwaway staging project. Non-goals: touching the legacy project; production. Deps: 3A.4.
Evidence: staging verification report.

**3A.6 — Hosted staging integration proof.** Files: integration test harness only. Migrations: none.
Tests: run 3A.4's matrix against clean staging. Acceptance: funnel proven on staging; **staging
proof = Sprint 3A exit gate**. Rollback: n/a. Non-goals: publication; production. Deps: 3A.5.
Evidence: staging integration evidence pack.

## 10. Test & evidence plan (minimum matrix)

| Case | Layer(s) | Type | Expected |
|------|----------|------|----------|
| Valid CSV candidate | contract + RPC | unit + disposable-DB | `staged` pending |
| Valid JSON/feed candidate | contract + RPC | unit + disposable-DB | `staged` pending |
| Durable-worker draft → observation | worker + RPC | integration | draft promotes once |
| Identical replay | RPC + index | disposable-DB | `replayed`, no dup |
| Conflicting replay | RPC | disposable-DB | `conflict`, both retained |
| Unknown branch | contract + RPC | unit + disposable-DB | warn / `mapping_required` |
| Missing source rights | registry + RPC | negative security | `rejected` (stage) / blocked (publish) |
| Malformed price | contract | unit | `quarantined` (INVALID_PRICE) |
| Unsupported currency | contract | unit | `quarantined` (UNKNOWN_CURRENCY) |
| Partial batch failure | worker | integration | some staged, some quarantined; job finalizes |
| Retry after worker failure | worker + dedup_keys + index | integration | no duplicate staged |
| Correction feed | RPC + review | integration | new append-only obs; supersession at publish |
| Successful pending observation | full funnel | integration | pending, unverified, unpublished |
| **No path publishes directly to `products`** | full funnel | **negative security** | only `publish_verified_observation` writes protected fields |

Evidence artifacts: `verify:db` transcripts (×2), the disposable fixture output, a caller/schedule
inventory (3A.2), and the staging integration pack (3A.6). Unit = vitest; integration/disposable =
Dockerized Postgres via `verify:db`; staging = 3A.6; negative-security = role/gate assertions.

## 11. Risks & unresolved questions (need architecture / founder decision)

1. **Two staging RPCs / two provenance envelopes.** Canonical = 039 per-row + durable job envelope
   (033/034), OR extend 029 as the batch authority? And do `retail_source_snapshots` /
   `retail_import_batches` (CSV envelope) reconcile with `retail_intake_jobs` (durable envelope), or
   does one supersede the other? **Blocks 3A.3.**
2. **Traceability columns.** Add `intake_job_id`/`draft_ref` to `retail_price_observations` and
   `published_observation_id` to `products` (additive)? Needed for keyed end-to-end lineage (§4 Q10).
3. **Identity-hash unification.** Align contract `djb2` + durable `record_hash` to the RPC tuple, or
   persist the RPC identity into the draft? (Prevents divergent replay rules — §6.)
4. **Lifecycle rights gap.** Add `lifecycle_state`/`is_active` checks to staging + job creation (§7)?
5. **Scheduled-caller unknowns.** Are any scrapers / `scrape-prices` edge function scheduled in
   production? **Must be answered before any disable** (§8).
6. **`p_external_branch_name`.** Add an optional contract field or always pass `null`?
7. **Out-of-order projection rule.** Explicit rule for which observation wins the current-state
   projection when observations arrive late/out-of-order (§6).

## 12. Verdict — GO / NO-GO for Sprint 3A.2

**GO for Sprint 3A.2 (direct-writer quarantine preparation).** It is read-only + tests + design:
resolve the §8 UNKNOWN callers, confirm dispositions, and prove scraper parsing can be re-expressed
as governed adapters — none of which changes runtime behaviour or touches hosted systems. The
canonical funnel contract is fully specified from existing components (§4–§7), so 3A.2 has a firm
foundation.

**Sprint 3A.3 (runtime wiring) is CONDITIONAL-GO**, gated on resolving unresolved questions
#1 (canonical staging RPC + provenance envelope), #2 (traceability columns), #3 (identity
unification), and #5 (scheduled-caller confirmation). Those are architecture decisions, not code, and
must be recorded (ADRs per blueprint §22) before wiring begins.

No runtime wiring, writer disablement, migration, or hosted contact is authorized by this document.
