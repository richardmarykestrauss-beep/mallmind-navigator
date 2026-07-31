# MallMind Decision Register

## ADR-001 — Node 22 and npm are authoritative

Status: Accepted
Date: 2026-06-27

MallMind standardizes active JavaScript packages on Node.js 22.x and npm.

Bun lockfiles were removed because no active source or workflow required Bun.

## ADR-002 — Authoritative application verification

Status: Accepted
Date: 2026-06-27

`npm run verify:all` is the authoritative application verification entry point.

GitHub Actions calls the same command instead of maintaining a separate hidden application-test sequence. Database reconstruction is governed independently by ADR-007.

## ADR-003 — Legacy scrapers remain quarantined

Status: Accepted
Date: 2026-06-27

Legacy direct-write scraper workflows remain manual-only and must not be scheduled.

Future scraper work must create staged observations and evidence rather than write directly to shopper-facing product rows.

## ADR-004 — Database tests must use real PostgreSQL

Status: Accepted
Date: 2026-06-27

Static SQL contract checks are valuable but insufficient.

All migrations must apply from zero to a disposable database. This is enforced locally and in CI by `npm run verify:db`.

The current database gate verifies migration execution and critical schema contracts. Representative behavioural RPC integration tests remain a separate follow-on requirement.

## ADR-005 — Build OS documents outrank specialist notes

Status: Accepted
Date: 2026-06-27

The Build OS authority layer is the primary source of engineering governance and project state.

Existing specialist documents remain evidence and implementation guidance.

## ADR-006 — Production-impacting actions require approval

Status: Accepted
Date: 2026-06-27

Production migrations, deployments, secrets, RLS, grants, scheduled ingestion and breaking upgrades require explicit human approval.

## ADR-007 — Database verification is an independent required gate

Status: Accepted
Date: 2026-06-27

`npm run verify:db` is the authoritative disposable-database verification command.

It uses the pinned Supabase CLI, rebuilds PostgreSQL from migrations `000–032`, and asserts the final migration history, critical tables, functions, columns, storage bucket and policies.

GitHub Actions runs database verification as a separate job so application verification remains fast and independently diagnosable.

The baseline migration `000_baseline_schema.sql` exists to reconstruct the repository locally from zero. It must not be pushed blindly to an existing linked Supabase project whose foundational schema predates the repository migration history.

## ADR-008 — AF-1 Safe Autonomous Build Loop

Status: Accepted
Date: 2026-06-28

MallMind adds a minimal autonomous build loop triggered by applying the `agent:approved` label to a structured build-task issue. The agent implements within an `agent/<issue>-<slug>` branch, runs the deterministic gates, and opens a **draft** pull request targeting `claude-premium-nav-test`. It cannot merge or deploy.

Safety is enforced by the repository boundary, not by agent cleverness: explicit minimal workflow permissions; no Supabase/Google Cloud/deployment secret in the job (only `ANTHROPIC_API_KEY`); branch protection rejecting pushes to protected branches; a deterministic scope guard (`scripts/build-os/scope-guard.mjs`) plus `npm run verify:all` as the authoritative pass/fail. Permitted task types are `docs`, `frontend`, `backend`, `test`; `db`/migration/deploy/infra/secrets/workflow tasks are rejected. Agent behaviour is governed by `docs/build-os/AGENT_CHARTER.md`, which treats issue text and other repository content as untrusted data. Browser QA, database automation, continuous scheduling, auto-merge and deployment are explicitly out of AF-1 scope.

## ADR-009 — RetailerFeedContractV1 (permission-ready feed intake)

Status: Accepted
Date: 2026-07-30

MallMind adds a retailer-neutral, permission-ready feed intake contract (`RetailerFeedContractV1`, `src/lib/retail/feed/*`) that maps external retailer product data (CSV now; JSON/API adapters later) into the migration-036 truth model with stable, machine-readable warning/rejection codes, decimal-safe pricing, deterministic observation identity, and an explicit external-branch → mapping boundary.

Recorded as a **local, validated capability only** (`npm run verify:all` green; `feedImporter.test.ts` 31/31; dry-run CLI `retail:feed:dry-run`). It performs no hosted database write, no migration, no Cloud Run worker invocation, and no publication; imported rows never become verified or shopper-visible (the `publish_verified_observation` gate is unchanged and unreachable from import). This ADR asserts NO retailer permission, NO production readiness, and NO hosted verification — only that the contract and its dry-run importer are locally proven. Wiring accepted candidates into staging (`retail_price_observations` at `review_status='pending'`) remains future work behind human review and the publication gate.

## ADR-010 — Feed format neutrality + governed external branch mapping

Status: Accepted
Date: 2026-07-31

MallMind extends the Sprint 2K feed contract with a deterministic JSON feed reader
(`src/lib/retail/feed/jsonFeedReader.mjs`), a second structurally-different synthetic
retailer adapter (`kingdomAdapter.mjs`), CSV↔JSON canonical parity, and a governed
external-location mapping contract + resolver (`locationMapping.mjs`,
ExternalRetailLocationMappingV1) with statuses (draft/pending_review/approved/rejected/
expired/superseded) and stable coded resolution outcomes.

Recorded as a **local, validated capability only** (`npm run verify:all` green;
`jsonFeed.test.ts` 29/29 covering the 53 required assertions; 2K/2J suites still pass;
CLIs `retail:feed:json:dry-run` and `retail:mapping:validate`). Truth boundary proven:
an external branch code/name never yields an internal MallMind id on its own — internal
ids are set ONLY from a unique, approved, currently-valid, unambiguous, provenance-bearing
mapping for the same retailer; a mapping proves identity alignment only (never stock,
price, permission, or publication), and a resolved mapping never converts online
availability into branch availability. This ADR asserts NO retailer permission, NO
production readiness, NO hosted mapping data, NO branch stock, NO hosted DB verification,
NO staging insertion, NO automated publication, and NO Cloud Run deployment. The
PostgreSQL staging bridge and a governed hosted mapping table remain Sprint 2L-B.

## ADR-011 — Disposable pending-review staging bridge (local-only)

Status: Accepted
Date: 2026-07-31

MallMind adds a fail-closed **pending-review staging bridge** that writes canonical
retailer-feed candidates into the existing truth-model tables
(`retail_source_listings` + `retail_price_observations`) at `review_status='pending'`, proven
against a **disposable local PostgreSQL** only. Migration 039 is additive: a governed
`retail_external_location_mappings` table (unique-approved-per-branch index +
approved-requires-provenance CHECK + RLS with no client policy), six nullable feed columns on
`retail_price_observations`, and a `service_role`-only SECURITY DEFINER RPC
(`stage_retail_feed_observation`) with a locked `search_path`, no dynamic SQL, and no
caller-supplied verified/approved/published/internal-id parameters. Internal MallMind ids can
originate only from a unique, human-`approved`, currently-valid, same-retailer mapping; a
branch-scoped candidate without one fails closed to `mapping_required` and is not staged.

Recorded as a **local, validated capability only**: `npm run verify:db` (full `000..039` chain
on the throwaway Supabase Docker stack) green **twice** for repeatability —
`migrations=40 | tables=55 | functions=45 | policies=24` — with the real-Postgres fixture
`retail-staging-fixture.sql` asserting 20 feed cases + constraint, publication-boundary, and
security proofs (anon/authenticated/public cannot execute the RPC; `service_role` can; the
existing `publish_verified_observation` gate still refuses staged pending rows). A hosted-guard
(`hostedGuard.mjs` + `staging-guard.mjs`, 7/7 tests) refuses any hosted ref/host before DB
work. This ADR asserts NO retailer permission, NO production readiness, NO hosted connection,
NO `supabase db push`, NO production/dev-cloud migration, NO hosted credentials or service-role
key, NO Cloud Run/durable worker, NO scraping, NO shopper-facing publication, NO automatic
verification/approval, NO scheduled ingestion, and the branch is NOT merged. Hosted application
of 039 and wiring an authorised feed into the RPC remain future, operator-run, human-approved
work behind the unchanged publication gate.
