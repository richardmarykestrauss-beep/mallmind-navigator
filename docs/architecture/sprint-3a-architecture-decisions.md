# Sprint 3A — Approved Architecture Decisions & Verification Gate

Status: **APPROVED ARCHITECTURE DIRECTIONS.** These record agreed *direction*; concrete
implementation (migrations, triggers, RLS, grants) remains subject to a later migration + security
review and to the external verification in
[sprint-3a-external-caller-verification-runbook.md](../operations/sprint-3a-external-caller-verification-runbook.md).
Grounding: [sprint-3a1-canonical-funnel-design-audit.md](sprint-3a1-canonical-funnel-design-audit.md),
[sprint-3a2-direct-writer-quarantine-audit.md](sprint-3a2-direct-writer-quarantine-audit.md),
[wired-vs-present-audit.md](wired-vs-present-audit.md),
[mallmind-whole-system-convergence-blueprint.md](mallmind-whole-system-convergence-blueprint.md).

These are recorded here (not in `docs/build-os/DECISIONS.md`); promotion to the formal ADR log is a
separate step once implementation review completes.

## ADR-A — Canonical staging authority

**Decision (approved):** `stage_retail_feed_observation()` becomes the **sole row-level staging
authority**. `stage_retail_csv_import` (029) may remain **temporarily** as a compatibility path, but
it must eventually translate into the **same** canonical validation, identity, provenance, and
pending-observation pipeline. **It must not remain a second independent authority.**

- **Compatibility period:** the CSV admin route (`retailObservationsAdmin.ts` → `stage_retail_csv_import`)
  keeps working until the CSV path is re-expressed as RetailerFeedContractV1 candidates flowing
  through `stage_retail_feed_observation`. The compatibility path is time-boxed to Sprint 3A.3–3A.4
  (no open-ended dual authority); a definite deprecation flag is set when parity is proven.
- **Parity evidence required before deprecation:** on the disposable database, an identical CSV
  batch staged via 029 and via the feed-contract→039 path must produce **equivalent
  `retail_price_observations`** — same identity (`observation_hash`), same `review_status='pending'`,
  same rights outcome, same branch-mapping outcome, and no `products` write. Parity captured as a
  repeatable fixture.
- **Batch/snapshot provenance preservation:** 039 does not itself create
  `retail_source_snapshots`/`retail_import_batches`. During compatibility, that provenance envelope
  is preserved by the durable job envelope (`retail_intake_jobs` + drafts + quarantine + events) plus
  `retail_source_snapshots` as the raw-evidence store. Whether `retail_import_batches` is retained as
  a compatibility view or superseded by `retail_intake_jobs` is an implementation detail decided in
  the 3A.3 migration review — **no batch/evidence lineage may be lost in the transition.**
- **Rollback boundary:** the canonical wiring is additive and feature-flagged; disabling the flag
  restores the 029 path exactly. Any additive migration ships with its rollback.
- **No direct `products` publication:** neither staging path publishes; publication remains solely
  `publish_verified_observation`.

## ADR-B — Keyed traceability chain

**Decision (approved):** MallMind requires a **keyed** trace: intake job → durable draft/candidate →
`retail_price_observation` → shopper-facing publication/projection.

- **Preferred additive fields (subject to repository schema verification in the 3A.3 migration):**
  `intake_job_id`, `intake_draft_id` (or a stable `draft_ref`), `published_observation_id` (on
  `products`), and `supersedes_observation_id` (on `retail_price_observations`, for corrections).
- **Foreign keys where stable identities exist:** `intake_job_id` → `retail_intake_jobs(id)`;
  `(job_id, draft_ref)` already keys `retail_intake_job_drafts` (034), so an observation should carry
  both `intake_job_id` and `draft_ref` to bind to that composite key; `published_observation_id` →
  `retail_price_observations(id)`; `supersedes_observation_id` → `retail_price_observations(id)`.
- **No publication-event table yet.** The observation already records the publication inline
  (`review_status='published'`, `published_product_id`, `published_at`). A separate
  `publication_event_id`/table is **deferred** unless 3A.3 implementation analysis proves it
  necessary (e.g. many-to-one republication history that inline columns cannot express).

## ADR-C — Identity & replay authority

**Decision (approved):** the **database RPC (`md5` of the canonical tuple) plus the unique
pending-hash constraint** on `retail_price_observations.observation_hash` is the **final
replay/conflict authority**. Upstream feed-contract and worker hashes are **advisory only**. All
layers must compute/describe the **same canonical tuple**.

**Exact existing canonical tuple (extracted verbatim, not invented):**

- **RPC — `stage_retail_feed_observation` (migration `039_retail_feed_staging_bridge.sql`):**
  ```
  v_identity_str := concat_ws('|',
    p_source_id::text,
    coalesce(p_source_product_id, p_retailer_sku, p_gtin, p_barcode),
    to_char(p_observed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    coalesce(p_price_scope,'unknown'),
    coalesce(p_branch_external_id,''),
    p_current_price_cents::text);
  v_identity := md5(v_identity_str);           -- stored as observation_hash (unique while pending)
  ```
  Conflict is detected separately by `feed_content_hash` (md5 of the full candidate content).
- **Feed contract — `feedImporter.observationIdentity` (`src/lib/retail/feed/feedImporter.mjs`):**
  ```
  identity = source_product_id ?? retailer_sku ?? gtin ?? barcode
  djb2([ retailer_source_id, identity, observed_at, price_scope ?? "unknown",
         branch_external_id, current_price_cents ].join("|"))
  ```

**Tuple fields (identical order, both layers):**
1. source id (`source_id` / `retailer_source_id`)
2. product identity = first of `source_product_id ∨ retailer_sku ∨ gtin ∨ barcode`
3. `observed_at`
4. `price_scope` (default `unknown`)
5. `branch_external_id` (default empty)
6. `current_price_cents`

**Layers currently use DIFFERENT representations — reconciliation required before 3A.3:**
1. **Hash function differs** (contract `djb2` vs RPC `md5`) — acceptable *because* the contract hash
   is advisory; the RPC hash is authoritative. Keep them distinct but derived from the same tuple.
2. **`observed_at` normalization differs** — the RPC normalizes to **UTC ISO-8601 second precision**
   (`YYYY-MM-DDThh:mm:ssZ`); the contract hashes the **raw `observed_at` string**. **Reconciliation:**
   the contract/worker must normalize `observed_at` to the identical UTC second-precision form
   *before* computing any advisory hash, so advisory pre-checks and the DB authority describe the
   same slot.
3. **Durable worker uses two other keys, not the canonical tuple:** `retail_intake_dedup_keys(scope,
   record_hash)` where `record_hash` is a **worker-computed content hash** passed in via
   `p_chunk->'dedupRefs'` (migration 034), and `retail_intake_product_index(scope, product_key)`
   ("first writer per (scope, product_key) wins"). **Neither is proven equal to the canonical tuple.**
   **Reconciliation:** before 3A.3, either (a) derive the durable `product_key` from the canonical
   identity fields and treat `record_hash` explicitly as *content* dedup (distinct from identity), or
   (b) persist the RPC-returned `observation_hash` into the durable draft so every layer references
   one identity while the database remains final authority. The exact input tuple of the worker's
   `record_hash`/`product_key` must be verified against the canonical tuple as a 3A.3 prerequisite.

## ADR-D — Source lifecycle gate

**Decision (approved).** Source state governs what is permitted:

| State | new intake | staging | remain pending | verify | publish | existing projections |
|-------|-----------|---------|----------------|--------|---------|----------------------|
| **active** | allowed | allowed | allowed | allowed | allowed | served normally |
| **suspended** | blocked | blocked | existing stay | blocked | blocked | remain **only until normal freshness expiry**, unless the suspension reason requires immediate hide |
| **revoked** | blocked | blocked | blocked | blocked | blocked | **hidden immediately** |
| **expired** | blocked | blocked | blocked | blocked | blocked | **hidden when rights/offer validity expires** |
| **unknown / unapproved** | — | **quarantined** | — | blocked | blocked | none |

- Implementation must support an **emergency immediate-hide action** for legal, security, or serious
  trust incidents (overrides normal freshness-expiry for suspended sources).
- This extends the existing gates: the staging RPC already blocks
  `legal_status ∈ {reference_only, needs_legal_review}` and `rights_review_state ∈ {rejected,
  expired}`; ADR-D adds a **`lifecycle_state`/`is_active` check at staging and at intake-job
  creation** (block `suspended`/`revoked`/`retired`), and an immediate-hide path. The publication
  gate (`rights_review_state='approved'` + `commercial_use_allowed` + `storage_allowed`) is unchanged.
- "Hide existing projections" is a publication-time / read-time filter, coordinated with ADR-B's
  provenance keys (so hidden rows are auditable, never silently deleted).

## Out-of-order & correction rule (approved direction)

- **`observed_at` (source-declared) controls evidence ordering, freshness, and correction
  precedence.** The newest approved `observed_at` per identity slot is the current projection truth.
- **Ingestion timestamps are audit metadata, not truth ordering.** A slow pipeline can never make a
  stale price look fresh.
- **Late historical observations may be stored** but must **not** replace a newer active projection.
- **Corrections are append-only observations** linked by `supersedes_observation_id`; the superseded
  row is retained and auditable — **history is never silently rewritten.**
- **Same `observed_at` + conflicting payload → a reviewable `conflict`** (the RPC's existing
  `feed_content_hash` conflict outcome); no automatic winner.

## Fabricated-price hard rule (non-negotiable)

**No script, Edge Function, AI model, or deterministic formula may generate a claimed branch,
in-store, shelf, or stock price from an online price by applying a premium, discount, estimate, or
random variation.** (This directly prohibits the `supabase/functions/scrape-prices` "store premium:
2–6% above online price" behaviour documented in the 3A.2 audit.)

- **Estimated prices may not enter `retail_price_observations` as factual observations.**
- Any future modelling/prediction feature must: be **clearly separated** from observed retail truth;
  use a **separate data model**; be **labelled an estimate**; **never** receive a verified-price
  badge; and **never** be presented as branch availability or an observed shelf price.
- Corollary for adapters (ADR-A/§3A.2): a Takealot adapter may emit **`online_national`** observations
  only; it must **never** assert a branch/competitor in-store price.

## Final gate — Sprint 3A.3 external-caller gate SATISFIED → FULL GO

The external-caller verification is **complete** and all six gate conditions are **satisfied** (full
evidence + founder confirmation + the completed Google Cloud inventory in
[../operations/sprint-3a-external-caller-verification-results.md](../operations/sprint-3a-external-caller-verification-results.md)):

1. Supabase Edge Function `scrape-prices` deployment/scheduling — **met** (not deployed; no cron; no `scrape_logs`).
2. GitHub `SUPABASE_SERVICE_KEY` secret + workflow references — **met** (secret absent; scrapers manual-only, quarantined, ack-gated; no reusable/dispatch path).
3. Google Cloud scheduler/service/trigger inventory — **met** (completed by authenticated operator; no scraper/scheduler/Eventarc/Pub-Sub/Run-Job in either project).
4. **ADR-A/B/C/D recorded** (this document ✓) — to be promoted after migration/security review.
5. No active process silently broken by quarantine — **met** (no active writer found anywhere).
6. Fabricated-price Edge Function disposition — **met: NOT DEPLOYED / NOT SCHEDULED / NOT ACTIVE.**

**Sprint 3A.3 is now FULL GO** for runtime funnel wiring under the approved ADR directions above,
subject to the standing migration + security review of the implementation itself. This gate closure
does **not** alter the substance of ADR-A/B/C/D. The fabricated-price function must never be deployed
or run (fabricated-price hard rule); its dormant code is to be **retired/converted** during the
direct-writer quarantine, never activated.
