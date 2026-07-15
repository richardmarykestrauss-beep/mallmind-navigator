# Future AI Intake Operator — Permission Contract

**Status: DEFINED, NOT IMPLEMENTED (Sprint 2C).** No specialized AI agent exists in
the codebase. This document fixes the permission boundary the future agent must run
within so it can never weaken the governed, human-gated fabric.

## The agent MAY

- Create research / source **candidates** (registry entries in `candidate` status).
- Submit **authorized** inputs to the intake input store (files it is permitted to use).
- **Start** intake jobs and **monitor** their progress (status, counters, metrics).
- Inspect **quarantine summaries** (counts, error classes, retryable flags) — sanitized.
- **Propose** corrections for quarantined/rejected records.
- **Propose** review decisions (as suggestions surfaced to a human reviewer).

## The agent MAY NOT

- Change a **source access policy** (automation status, allowed modes, legal risk).
- Approve **legal access** or clear a blocked/login-walled source.
- **Bypass quarantine** or silently discard bad records.
- **Override or resolve conflicts** (conflict resolution is an explicit human action).
- **Self-approve evidence** or mark its own submissions reviewed.
- **Publish offers** or flip `published` — publication remains a separate human-gated batch.
- Set a trust label to **`verified_live`** without eligible policy + evidence.
- Alter **immutable provenance** (evidence records, revisions, review decisions).

## Enforcement anchors (already in the fabric)

- **Source policy engine** — a `blocked` source rejects at intake; `manual_only`
  forbids automated modes (`src/lib/fabric/policy.ts`, enforced in `recordPipeline.ts`).
- **Human-gated review** — drafts are `needs_review`; approval requires evidence and
  passes `approvalBlockers` (`src/lib/fabric/review.ts`); bulk approval never bypasses it.
- **Publication policy** — a separate gate; blockers never downgrade to warnings
  (`src/lib/fabric/publication.ts`, `intake/publicationBatch.ts`).
- **Immutable evidence** — corrections create revisions; originals are never
  overwritten (`src/lib/fabric/evidence.ts`).
- **No adapter/import-to-publish path** — the only route to a published offer is an
  approved `ReviewDecision` (`src/lib/fabric/offerBridge.ts`).

Any future agent action must route through these same functions; the agent gets no
privileged path around them.
