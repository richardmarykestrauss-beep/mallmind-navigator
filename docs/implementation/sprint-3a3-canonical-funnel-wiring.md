# Sprint 3A.3 — Canonical Funnel Runtime Wiring (implementation)

Mode: LOCAL / DISPOSABLE DATABASE ONLY. No hosted system was contacted; no shopper-facing
product was published. Branch `feat/sprint-3a3-canonical-funnel-wiring` from
`claude-premium-nav-test@7249b64`. Implements ADR-A/B/C/D from
[../architecture/sprint-3a-architecture-decisions.md](../architecture/sprint-3a-architecture-decisions.md).

## Files changed

**New:**
- `supabase/migrations/040_retail_feed_staging_traceability.sql` — additive traceability columns +
  lifecycle-gated staging RPC.
- `supabase/rollback/040_retail_feed_staging_traceability_rollback.sql` — reverse script.
- `google-cloud-backend/src/services/intake/canonicalStagingMapper.ts` — pure OfferDraft → RPC-args mapper.
- `google-cloud-backend/src/services/intake/retailStagingPromotion.ts` — scoped promotion service.
- `google-cloud-backend/src/services/__tests__/retailStagingMapperHarness.ts` — unit proof.

**Modified:**
- `google-cloud-backend/src/routes/internalIntake.ts` — optional post-run promotion of durable drafts.
- `google-cloud-backend/src/worker.ts` — constructs the staging gateway (opt-in via env).
- `scripts/build-os/verify-db.mjs` — migration count 40→41, latest→040, RPC signature 26→28 args,
  new 040 traceability-column assertion.
- `scripts/build-os/retail-staging-fixture.sql` — 6 new lifecycle/traceability/arity cases.

## Runtime path — before and after

**Before:** durable job → `runDurableJob` → drafts staged in `retail_intake_job_drafts` → **dead-end**
(`stage_retail_feed_observation` had zero runtime callers).

**After (opt-in):**
```
approved registered source
  → durable intake job (retail_intake_jobs)
  → fabric validation (processIntakeRecord) → OfferDraft
  → durable draft (retail_intake_job_drafts)
  → [3A.3] promoteDrafts → offerDraftToStageArgs → stage_retail_feed_observation()
  → retail_price_observations (review_status = 'pending')
  → human review → publish_verified_observation → products   (unchanged, downstream)
```
Promotion runs after `runDurableJob` + reconcile, **only when** `RETAIL_STAGING_ACTOR_ID` is set and a
staging gateway is wired (`internalIntake` deps). Unset → the worker stages durable drafts exactly as
before (inert default; nothing was activated for hosted/local runs).

## Schema changes (migration 040, additive, forward-only)

- `retail_price_observations.intake_job_id uuid` (nullable) + `intake_draft_ref text` (nullable) +
  partial index `rpo_intake_job_idx`.
- `stage_retail_feed_observation` re-defined (039's 26-arg dropped; new 28-arg created) with two new
  **trailing params defaulting null** (`p_intake_job_id`, `p_intake_draft_ref`) — so existing 26-arg
  callers still resolve — plus the ADR-D lifecycle gate; writes the two new columns; `service_role`-only
  EXECUTE; locked `search_path`; SECURITY DEFINER. Identity/replay logic is byte-for-byte 039.
- No `products` column added (per non-goals; `published_observation_id` is Sprint 3B).

## Field mapping (OfferDraft → RPC args)

`source_id←draft.sourceId`, `retailer_sku←draft.retailerSku`, `gtin←draft.gtin`,
`product_name←draft.productTitle`, `brand`, `category`, `current_price_cents←round(price·100)`,
`original_price_cents`, `currency`, `observed_at←normalize(observedAt)`, `price_condition_label←promoText`,
`promotion_indicator←promoText!=null`, `price_scope←geographicScope map`, `availability_scope`,
`stock_status←availabilityStatus map`, `intake_job_id←jobId`, `intake_draft_ref←draft.id`,
`actor←RETAIL_STAGING_ACTOR_ID`. Unknown optionals (`source_product_id`, `barcode`, `pack_size`,
`price_condition`, `source_url`, `branch_external_id`) stay **null — never guessed**.

Scope mapping is deliberately conservative: `branch→branch_specific` (expresses branch *intent*, so the
RPC demands an approved mapping), `national|online_only→online_national`, `province→online_regional`,
`mall|unknown→unknown`. `availability_scope` is `online` only for online scopes — **never
`branch_confirmed`**, so retailer presence is never turned into an in-store availability claim.

## Source lifecycle behaviour (ADR-D)

The RPC reads source state from the registry (`retail_data_sources`) by `source_id` and rejects staging
when `legal_status ∈ {reference_only, needs_legal_review}`, `rights_review_state ∈ {rejected, expired}`
(039, unchanged), **or** `is_active=false` **or** `lifecycle_state ∈ {suspended, revoked, retired}` (new).
Adapters never assign or upgrade rights; the candidate's rights fields are not read by the gate.

## Canonical identity tuple (ADR-C)

`source_id | (source_product_id ∨ retailer_sku ∨ gtin ∨ barcode) | observed_at(UTC sec) | price_scope |
branch_external_id | current_price_cents`. The **DB `md5(tuple)` + unique-pending index is the final
authority**; the mapper's `canonicalIdentityTuple` is advisory and normalizes `observed_at` to the same
`YYYY-MM-DDThh:mm:ssZ` form the RPC uses. No JavaScript-only dedup replaces the DB rule.

## Replay / conflict / partial-failure / retry

- Replay/conflict are the RPC's authority: identical replay → `replayed` (no duplicate); same identity +
  different content → `conflict` (both retained). Proven in the disposable fixture (incl. with trace
  params — trace never affects identity).
- `promoteDrafts` promotes one draft per RPC call; a per-row failure is captured (`ok:false`,
  `outcome:'error'`) and **never aborts the batch** — that draft stays retryable, and the RPC's
  idempotency makes a re-run non-duplicating. Aggregate counts (staged/replayed/conflict/mapping_required/
  rejected/errors) are returned and logged.

## Security boundary

`promoteDrafts`/`SupabaseStagingGateway` may call **only** `stage_retail_feed_observation`. No code path
here writes `products`, inserts `retail_price_observations` directly, or publishes. The fabricated-price
Edge Function/scrapers were not called, copied, or imported. RLS + service-role-only EXECUTE preserved.

## Tests & exact results

- `verify:db` (disposable Postgres, migrations 000→040 from zero): **PASS** — `migrations=41 | tables=55 |
  functions=45 | policies=24`; fixture: *"ALL STAGING / IDEMPOTENCY / MAPPING / SECURITY /
  PUBLICATION-BOUNDARY / LIFECYCLE / TRACEABILITY CASES PASSED"* (T1 suspended→rejected, T2
  revoked→rejected, T3 inactive→rejected, T4 trace columns populated, T5 trace replay→replayed, T6 26-arg
  arity compat→staged, trace null).
- Mapper/promotion harness: **PASS** — "ALL MAPPING + PROMOTION CASES PASSED" (observed_at normalization,
  cents, scope/stock maps, never-branch_confirmed, canonical tuple, promotion counts + error isolation).
- Backend main build + `typecheck:worker`: **PASS**. Feed + fabric-intake vitest: **143 passed, 1 skipped**.
- `npm run verify:all`: **ALL 14 CHECKS PASSED** (incl. worker typecheck, worker bundle, backend build).

## Known limitations (→ Sprint 3B / 3A.4)

- Promotion consumes the **in-memory** `OfferDraft[]` returned by the current run; drafts committed in a
  prior crashed run (durable drafts carry no candidate payload) are not re-promoted automatically. The
  RPC's idempotency makes re-promotion safe, but durable-payload-backed re-promotion is follow-up work.
- `RETAIL_STAGING_ACTOR_ID` must be a real `profiles` id (admin_audit_log FK); documented, not seeded for
  hosted use here.
- `products` projection lock-down + `published_observation_id` + `price_scope` shopper surfacing are
  **Sprint 3B** (unchanged here). CSV path (`stage_retail_csv_import`) remains the compatibility path (ADR-A).

## Rollback plan

Apply `supabase/rollback/040_retail_feed_staging_traceability_rollback.sql` (drops the 28-arg function,
the index, and the two columns), then re-apply migration 039 to restore the 26-arg RPC. Code: the worker
wiring is inert unless `RETAIL_STAGING_ACTOR_ID` is set; unsetting it disables promotion with no schema
change.

## Explicit confirmation

**No products publication path was introduced.** Nothing in this sprint writes `products`, verifies, or
publishes; staging is `review_status='pending'` only, and the existing `publish_verified_observation`
gate is untouched. No fabricated-price logic was called or copied. No hosted Supabase/GCP/GitHub system
was contacted or mutated.
