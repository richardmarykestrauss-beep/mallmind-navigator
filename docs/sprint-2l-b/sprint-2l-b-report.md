# Sprint 2L-B Report — Disposable Pending-Review Staging Bridge

**Branch:** `feat/disposable-retail-staging-bridge` (base: `claude-premium-nav-test`)
**Mode:** LOCAL DISPOSABLE DATABASE IMPLEMENTATION AND VERIFICATION ONLY.
**Status:** local capability proven; **not merged, not deployed, not applied to any hosted DB.**

## What was built

A fail-closed bridge that stages canonical retailer-feed candidates into the existing retail
truth-model tables at `review_status='pending'`, on a throwaway local Postgres, preserving the
trust boundary: authorised feed → RetailerFeedContractV1 → canonical candidate → approved
location mapping (branch only) → **pending DB staging** → human review → existing publication
gate.

### Deliverables

- **Migration 039** (`supabase/migrations/039_retail_feed_staging_bridge.sql`, additive):
  governed `retail_external_location_mappings` table (unique-approved-per-branch index +
  approved-requires-provenance CHECK + RLS, no client policy); six additive nullable columns on
  `retail_price_observations`; `stage_retail_feed_observation` SECURITY DEFINER RPC
  (locked search_path, no injectable verified/approved/published/internal-id params,
  `service_role`-only). Rollback at `supabase/rollback/039_…_rollback.sql`.
- **Hosted-execution guard:** `src/lib/retail/feed/hostedGuard.mjs` +
  `scripts/retail/staging-guard.mjs` CLI; refuses hosted refs/hosts, accepts only local
  disposable targets, prints host only. Test `hostedGuard.test.ts` (7/7).
- **Real-Postgres proof:** `scripts/build-os/retail-staging-fixture.sql` — 20 feed-case
  scenarios (C1–C15 incl. C5b/C7b) + 2 constraint proofs + publication-boundary block +
  security block; wired into `verify-db.mjs`.
- **Local commands:** `db:test:start`, `db:test:reset`, `db:test:stop`, `retail:staging:test`,
  `retail:staging:guard` (no hosted credentials; guard-gated).
- **Docs:** this folder (`disposable-database-setup`, `retail-staging-bridge`,
  `security-and-grants-report`, `migration-chain-report`, this report).
- **Build OS:** ADR-011 in `docs/build-os/DECISIONS.md`.

## Verification (disposable local Postgres)

`npm run verify:db` — run **twice** (repeatability), identical both times:

```
database verification passed | migrations=40 | tables=55 | functions=45 | policies=24
retail-staging-fixture: ALL STAGING / IDEMPOTENCY / MAPPING / SECURITY / PUBLICATION-BOUNDARY CASES PASSED
✔ DATABASE VERIFICATION PASSED
```

- `npm run test` (vitest) — feed + guard suites green, incl. `hostedGuard.test.ts` 7/7.
- `npm run verify:all` — green.
- `git diff --check` — clean.

Proven behaviours: staging writes only pending/needs_review/unverified rows; internal ids come
**only** from an approved mapping; branch intent without an approved mapping fails closed
(`mapping_required`); idempotent replay / conflict detection; rights gate rejects
`reference_only`; leading zeros preserved; injection stored as data; the publisher still
refuses staged pending observations; anon/authenticated/public cannot execute the RPC.

## Explicit boundary — what did NOT happen

No hosted Supabase connection; no `supabase db push`; no linked-project or production/dev-cloud
migration; no hosted credentials or production service-role key; no Cloud Run invocation/deploy;
no durable retail worker; no retailer scraping; no shopper-facing publication; no automatic
approval/verification; no scheduled ingestion; no real retailer data altered; no claim of
retailer permission; **branch not merged.**

## Next (future sprints, not now)

Operator-run, human-approved hosted application of 039 to `mallmind-dev`; wiring an authorised
feed + `service_role` caller into the RPC; the human review UI over pending observations. All
remain behind the unchanged publication gate.
