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
