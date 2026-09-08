# Sprint 3A.4 — Crash-Safe Canonical Funnel End-to-End Proof

Mode: LOCAL / DISPOSABLE POSTGRES ONLY. No hosted Supabase/GCP/GitHub system was contacted; no
shopper-facing product was published. Continues `feat/sprint-3a3-canonical-funnel-wiring` from
`4e5da9d`. Implements the durable recovery the 3A.3 doc flagged as follow-up.

## Exact crash window found (3A.3 limitation)

`retail_intake_job_drafts` (migration 034) persisted only `{job_id, chunk_index, draft_ref,
record_hash, conflict_state}` — **no candidate payload, no promotion state**. 3A.3 promotion
consumed the current run's **in-memory** `OfferDraft[]`. So a worker restart **after** a chunk
commit (draft durable) but **around** staging had (a) no persisted payload to rebuild the RPC call
and (b) no ledger to know whether the draft was already promoted → risk of a lost or duplicated
promotion.

## Selected durable recovery design (option A — persist the canonical candidate)

Persist the **normalized canonical candidate** (the exact `stage_retail_feed_observation`
arguments) + a `candidate_version` on the durable draft, plus a promotion **ledger**
(`promotion_state`/`outcome`/`observation_id`/`attempts`). Recovery re-promotes from the persisted
candidate. Rejected alternatives: (B) a separate candidate table — more schema for no gain; (C)
re-derive from the raw snapshot — couples recovery to re-streaming GCS + re-running the engine. The
DB RPC (`md5(observation_hash)` + unique-pending index) stays the final replay authority, so a
re-promotion of an already-staged row returns `replayed`, never a duplicate. No second staging path.

## Schema changes — migration 041 (additive, forward-only)

On `retail_intake_job_drafts`: `staging_candidate jsonb`, `candidate_version text`,
`promotion_state text default 'eligible'` (CHECK eligible/promoted/failed/skipped),
`promotion_outcome text`, `observation_id uuid`, `promotion_attempts int default 0`,
`promoted_at timestamptz`; partial retry index on `(job_id) where promotion_state in
('eligible','failed')`. Three `service_role`-only, locked-`search_path` SECURITY DEFINER RPCs:
`persist_draft_staging_candidate`, `record_draft_promotion`, `list_promotable_drafts`. Migration
040 unedited; rollback provided.

## Restart-safe flow (per draft)

```
1. persist_draft_staging_candidate(job, draft, args, version)   ← candidate durable BEFORE the RPC
2. stage_retail_feed_observation(args)                          ← the sole staging authority
3. record_draft_promotion(job, draft, state, obs_id, outcome)   ← ledger updated AFTER the RPC
On restart: list_promotable_drafts(job) → for each persisted candidate → stage → record.
```
Crash after (1) before (2): draft is `eligible`/`failed` with a candidate → resume stages it.
Crash after (2) before (3): draft still `eligible`/`failed` → resume re-stages → RPC returns
`replayed` (idempotent) → recorded `promoted`. **One observation, never a duplicate.** Partial
batches: each row is independent; a per-row failure is recorded `failed` and never aborts the batch;
only unresolved (`eligible`/`failed`) rows are re-selected. Wired at `internalIntake`
(`promoteRun` after a run; `POST /jobs/:jobId/promote-pending` for recovery).

## Actor validation (PART 5)

`RETAIL_STAGING_ACTOR_ID` is opt-in. Absent → promotion is inert (worker stages durable drafts
only, as before). Present-but-not-a-UUID → the route logs `invalid_actor` and **skips** promotion
(fail closed — better inert than a bad attribution). Present-and-UUID-but-not-a-profile → the RPC's
`admin_audit_log.admin_id → profiles(id)` FK raises, the promoter records `failed`, nothing stages
(proven: fixture case A1). No fallback actor is invented. Tests use a synthetic seeded profile, not
a production identity. **Clean staging will obtain a valid non-human service actor** by seeding a
dedicated `profiles` row (a service account) in that project and setting `RETAIL_STAGING_ACTOR_ID`
to its id — **not created in this sprint.**

## Source lifecycle reconciliation (PART 6)

- **DB `retail_data_sources.lifecycle_state`** (migration 036 CHECK): `discovered, testing, active,
  degraded, suspended, retired, revoked`. **There is no `expired` lifecycle_state and no `inactive`
  value** — "inactive" is the boolean `is_active`.
- **DB `rights_review_state`** (036 CHECK): `unreviewed, under_review, approved, restricted,
  rejected, expired`. **`expired` is a RIGHTS state, distinct from `retired` (a lifecycle state).**
- **TypeScript:** no type mirrors `retail_data_sources.lifecycle_state`; the RPC is the sole
  authority and reads it from the registry, so there is no TS/DB enum to keep in sync (the fabric's
  `AdapterLifecycleState` is a different, evidence-lifecycle concept). No mismatch to fix; no new
  lifecycle value invented.
- **Fail-closed staging matrix (as the schema represents it):** `reference_only` /
  `needs_legal_review` legal_status → rejected (039); `rejected` / `expired` rights → rejected
  (039); `suspended` / `revoked` / `retired` lifecycle → rejected (040); `is_active=false` →
  rejected (040); `unreviewed` / `under_review` rights → **staged pending = quarantine** (never
  published); `discovered`/`testing`/`active`/`degraded` lifecycle → allowed to stage. Proven:
  fixture T1–T3 + L1–L3.
- **Projection-hiding on revocation** (hiding already-published shopper rows) is **Sprint 3B** work
  (read/publication-time filter); staging-side fail-closed is complete here.

## Legacy 26-argument compatibility (PART 7)

Migration 040 gave the two trace params `DEFAULT null`, so a 26-arg call resolves to the 28-arg
function. This is proven **not** by relying on overload resolution alone but by a realistic legacy
call: the entire pre-existing fixture (C1–C15, all 26-arg) still passes unchanged, and case **T6**
asserts a 26-arg call → `staged` with `intake_job_id` **null** (no fabricated traceability), and its
replay behaviour is unchanged. No ambiguity (only one function name/arity family exists).

## Test results (exact)

- `verify:db` (disposable Postgres, migrations **000→041 from zero**): **PASS** — `migrations=42 |
  tables=55 | functions=48 | policies=24`; fixture: *"ALL STAGING / IDEMPOTENCY / MAPPING / SECURITY
  / PUBLICATION-BOUNDARY / LIFECYCLE / TRACEABILITY / CRASH-RECOVERY CASES PASSED"* — incl. L1
  retired→rejected, L2 rights-expired→rejected, L3 unreviewed→staged(quarantine), P1 ledger happy
  path, **P2 crash-after-RPC → re-stage → replayed, exactly one observation**, A1 invalid actor
  fails closed.
- `durableStagingPromoterHarness` (unit, fake ledger + idempotent RPC + crash hooks): **PASS** — S1
  crash-after-persist→restart stages (1 stage call total); S2 crash-after-stage→restart replays
  (2 calls, **1 observation**); S3 happy path; S4 error isolation.
- `retailStagingMapperHarness`: **PASS**. Backend build + `typecheck:worker`: **PASS**. Feed/fabric
  vitest: **143 passed, 1 skipped**. `npm run verify:all`: **ALL 14 CHECKS PASSED**.

## Evidence paths

`scripts/build-os/retail-staging-fixture.sql` (SQL proof), `scripts/build-os/verify-db.mjs` (runner),
`google-cloud-backend/src/services/__tests__/durableStagingPromoterHarness.ts` (crash-safety unit),
`.../retailStagingMapperHarness.ts` (mapping). No secrets or private payloads stored; the persisted
`staging_candidate` is the RPC-arg copy (external identifiers + provenance only; rights re-checked by
the RPC).

## Observability & outcome model (PART 9)

Per-draft ledger states: `eligible` (persisted, awaiting/failed promotion) · `promoted` (staged or
replayed) · `failed` (retryable: mapping_required or transient error) · `skipped` (terminal:
rejected/conflict — surfaced for review). Job-level totals returned + logged
(`intake.promotion_finished`: total/staged/replayed/conflict/mapping_required/rejected/errors);
recovery via `intake.promote_pending`. Logs carry identifiers + counts only — no payloads/secrets.

## Known limitations (→ later sprints)

- A crash **between** a fabric chunk commit and the promotion pass (so the candidate was never
  persisted) leaves the draft `eligible` with `staging_candidate=null`; `list_promotable_drafts`
  excludes null-candidate rows, so such a draft is recovered by **re-running the job** (the pure
  engine re-derives deterministically; the RPC idempotency prevents duplicates). Persisting the
  candidate inside the chunk-commit transaction would close this fully but couples the generic
  fabric engine to the MallMind RPC shape — deferred by design.
- `products` field lock-down, `published_observation_id`, projection-hiding on revocation, and
  shopper `price_scope` surfacing remain **Sprint 3B**.

## Rollback

Apply `supabase/rollback/041_retail_intake_promotion_ledger_rollback.sql` (drops the 3 ledger RPCs,
the retry index, the CHECK, and the 7 ledger columns). Migration 040 is unaffected. Code: unsetting
`RETAIL_STAGING_ACTOR_ID` disables promotion with no schema change.

## Explicit confirmations

**No products publication path was introduced** — staging is `pending` only; the publish gate is
untouched. **No fabricated-price logic** was called or copied. **No hosted system was contacted or
mutated** — all work ran on the disposable local stack; the frozen Supabase target and both GCP
projects were untouched.
