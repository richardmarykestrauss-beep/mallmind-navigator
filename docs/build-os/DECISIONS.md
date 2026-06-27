# MallMind Decision Register

## ADR-001 — Node 22 and npm are authoritative

Status: Accepted
Date: 2026-06-27

MallMind standardizes active JavaScript packages on Node.js 22.x and npm.

Bun lockfiles were removed because no active source or workflow required Bun.

## ADR-002 — One authoritative verification command

Status: Accepted
Date: 2026-06-27

npm run verify:all is the authoritative local and CI verification entry point.

GitHub Actions calls the same command instead of maintaining a separate hidden test sequence.

## ADR-003 — Legacy scrapers remain quarantined

Status: Accepted
Date: 2026-06-27

Legacy direct-write scraper workflows remain manual-only and must not be scheduled.

Future scraper work must create staged observations and evidence rather than write directly to shopper-facing product rows.

## ADR-004 — Database tests must use real PostgreSQL

Status: Accepted
Date: 2026-06-27

Static SQL contract checks are valuable but insufficient.

Build OS completion requires applying all migrations from zero to a disposable database and testing important RPCs against that running database.

## ADR-005 — Build OS documents outrank specialist notes

Status: Accepted
Date: 2026-06-27

The Build OS authority layer is the primary source of engineering governance and project state.

Existing specialist documents remain evidence and implementation guidance.

## ADR-006 — Production-impacting actions require approval

Status: Accepted
Date: 2026-06-27

Production migrations, deployments, secrets, RLS, grants, scheduled ingestion and breaking upgrades require explicit human approval.
