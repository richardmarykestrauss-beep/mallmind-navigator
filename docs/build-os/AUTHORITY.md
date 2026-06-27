# MallMind Build OS Authority

Status: Authoritative
Version: 1.0

## Purpose

This document governs how MallMind is built, verified, changed, deployed and recovered.

## Source-of-truth order

1. docs/build-os/project-state.json
2. docs/build-os/AUTHORITY.md
3. docs/build-os/ARCHITECTURE.md
4. docs/build-os/DECISIONS.md
5. current migrations and source code
6. specialist documents under docs/
7. historical notes and generated reports

Production infrastructure remains the final truth for what is actually deployed.

## Build doctrine

- Build premium working prototypes, not deceptive mockups.
- No dead buttons or invisible failures.
- Protect the product wow spine early.
- Label features honestly as Prototype, Mock Data, Manual, Live, AI-Assisted or Future.
- AI must reduce cognitive load.
- Shopper-facing data must pass trust and approval gates.
- Security, rollback, testing and observability are part of the product.

## Runtime and package policy

- Node.js 22.x is authoritative.
- npm is authoritative.
- package-lock.json files are committed.
- Bun lockfiles are not used.
- Blind npm audit fix --force is prohibited.

## Verification

The authoritative verification command is npm run verify:all.

A change is not eligible for merge or release unless it passes locally and in GitHub Actions.

Static SQL checks do not replace real PostgreSQL migration and RPC tests.

## Branch strategy

- main: release-quality integration
- build-os-*: engineering governance
- feature/*: isolated product work
- fix/*: defect correction
- security/*: security remediation

Every meaningful change requires an objective, isolated branch, verification evidence and rollback point.

## Database migration protocol

- Migrations are append-only.
- Applied migrations are never rewritten.
- RLS, grants and SECURITY DEFINER boundaries must be reviewed.
- Migrations must eventually run from zero in a disposable database.
- Important RPCs must be tested against real PostgreSQL.
- Production migration execution requires explicit approval.

## Agent roles

- Orchestrator: plans, delegates and returns one evidence packet.
- Implementation agent: changes code within approved scope.
- Database and security agent: reviews migrations, RLS, grants and secrets.
- QA agent: runs deterministic and browser-based checks.
- Release agent: records commit, artifact, revision, health and rollback evidence.

No agent may silently bypass an approval gate.

## Human approval gates

Approval is required before production migrations, RLS or secret changes, Cloud Run deployment, scheduled ingestion, direct-write ingestion, breaking dependency upgrades or cloud billing changes.

## Legacy scraper quarantine

Legacy mall and price scraper workflows remain manual-only and must not regain scheduled or direct production writes without a staged ingestion redesign.

## Current gaps

- Disposable migration verification
- Real RPC integration tests
- Deployment and rollback automation
- Branch protection confirmation
- Dependency remediation
- Secrets inventory
- Formal observability standard
