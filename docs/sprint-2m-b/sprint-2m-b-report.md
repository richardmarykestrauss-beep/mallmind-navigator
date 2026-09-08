# Sprint 2M-B — Target-Linked Readiness Completion & Manual Backup — Report

**Branch:** `audit/target-readiness-backup-2m-b` · **Base:** `claude-premium-nav-test` (@ merged 2M-A)
**Mode:** target-linked read-only audit + manual logical backup · **Date:** 2026-07-31
**Target:** `qspsouemjtcdcfnivpnt` (Mallmind, Free plan, Healthy)

## Verdict: **NO-GO — operator action required (credential boundary)**

Not a hosted defect. The target-linked remote steps and the manual backup **could not be executed
by the assistant** because every one of them requires authenticating to production and handling the
production database password / an access token — which the assistant is prohibited from entering.
Readiness therefore remains **uncertified** until Richard completes the operator runbook.

## Why the assistant could not proceed (evidence)

Checked read-only in this environment:

| Signal | Result |
|--------|--------|
| `SUPABASE_ACCESS_TOKEN` | unset |
| `SUPABASE_DB_PASSWORD` | unset |
| service-role key / `PGPASSWORD` | unset |
| `supabase projects list` | **Unauthorized** (no logged-in CLI session) |
| Existing dev link (`supabase/.temp/project-ref`) | `iivmrlgntspbkpfqoboi` — **left untouched** (not relinked) |

With no environment-supplied credential, the CLI cannot self-authenticate, and the assistant may
not run `supabase login` (token entry) or supply the prod DB password for `supabase link` /
`db dump`. So Steps 2–7 (auth, link, migration list, dry-run, schema checks, backup) are
**operator-run**. This mirrors the safe posture of Sprint 2M-A: hosted-credentialed work is done
by a human, not the agent.

## What the assistant completed (safe, local)

- Created the isolated branch `audit/target-readiness-backup-2m-b` from the merged 2M-A base.
- **Did not** relink or alter the dev working directory's Supabase link (still dev).
- Produced a turnkey operator package:
  - [operator-runbook.md](operator-runbook.md) — every credentialed step, copy-paste ready, with
    the full "never run" prohibition list.
  - [manual-backup-procedure.md](manual-backup-procedure.md) — Free-plan logical backup + verify
    without exposing data, stored outside the repo, never committed.
  - [readiness-results-template.md](readiness-results-template.md) — fill-in evidence capture +
    verdict selection.
- Confirmed, from repository state, that migration 039 is present and locally verified but **not**
  applied remotely, and carried forward the 2M-A static findings (039 is additive, non-rewriting,
  privilege-narrowing, low-lock-risk against the expected pre-039 baseline; publication gate
  preserved by design).
- Ran `npm run verify:all` (**green**) and `git diff --check` (clean); committed docs only.

## Standing conditions to reach GO-CANDIDATE (operator)

1. Run [operator-runbook.md](operator-runbook.md) from a fresh clone linked to
   `qspsouemjtcdcfnivpnt`; confirm identity = target.
2. `supabase migration list`: `000–038` agree local↔remote; `039` pending (not applied).
3. `supabase db push --dry-run`: only `039` pending; no seed; no repair.
4. Read-only schema checks: none of the 039 objects exist; 6 new columns absent/compatible; roles
   present; `anon/authenticated` lack direct observation INSERT; `publish_verified_observation`
   intact and strict; `public-diff.sql` shows no blocking drift.
5. Manual logical backup captured, stored outside the repo, and **verified** (sizes + checksums +
   schema table-match), per the backup procedure.
6. Record explicit human go/no-go approval in the results template.

When 1–6 are satisfied and captured, the verdict may be upgraded to **GO-CANDIDATE**; applying
migration 039 remains a **separate, explicitly-approved** action outside this sprint.

## Boundary honoured

No relink of the dev directory; no `db push` / reset / repair / migration up; no 039 application;
no RPC execution; no INSERT/UPDATE/DELETE; no RLS/grant/role change; no secret rotation; no plan
change; no PITR; no DB branch; no Cloud Run / durable worker; no backup-setting change; no
user/shopper data inspected; **branch not merged**; **no credential entered or handled**.
