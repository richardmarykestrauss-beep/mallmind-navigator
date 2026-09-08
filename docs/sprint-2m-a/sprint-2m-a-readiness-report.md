# Sprint 2M-A — Hosted Supabase Readiness & Schema-Drift Audit — Readiness Report

**Branch:** `audit/hosted-supabase-readiness-2m-a` · **Base:** `claude-premium-nav-test`
**Mode:** STRICTLY READ-ONLY HOSTED AUDIT · **Date:** 2026-07-31
**Audit target:** `qspsouemjtcdcfnivpnt` (production)

## Verdict: **NO-GO** *(audit blocked at the linked-project identity gate — readiness could not be certified)*

This is a **"cannot certify"** NO-GO, not a "found production drift" NO-GO. No hosted defect was
observed because **no hosted inspection was possible** from this environment. Migration 039 must
not be applied until the hosted audit is completed by an operator linked to the target and the
conditions below are cleared.

### Why NO-GO

The Supabase CLI on this machine is linked to **`iivmrlgntspbkpfqoboi` (mallmind-dev)**, not the
audit target **`qspsouemjtcdcfnivpnt`**. Reaching the target read-only would require relinking —
an **absolute prohibition** of this sprint ("project linking to a different Supabase project" /
"do not relink automatically"). There are also no target credentials present
(`SUPABASE_ACCESS_TOKEN` unset, `SUPABASE_DB_PASSWORD` unset), and handling such secrets is
itself prohibited. Per the sprint's stop conditions ("linked project reference is not
`qspsouemjtcdcfnivpnt`" → NO-GO), remote inspection was aborted. **This is the safe state:** the
environment is deliberately not wired to production.

## Dimension summary

| # | Dimension | Result |
|---|-----------|--------|
| 1 | Linked-project identity | **FAIL** — linked to dev (`iivmrlgntspbkpfqoboi`), not target |
| 2 | Local↔remote history agree through 038 | **UNVERIFIED** (remote not queried) |
| 3 | Migration 039 unapplied remotely | **UNVERIFIED** (repo-only + locally verified) |
| 4 | Hosted schema matches pre-039 baseline | **UNVERIFIED** |
| 5 | Manual hosted drift | **UNVERIFIED** |
| 6 | 039 objects already exist remotely | **UNVERIFIED** |
| 7 | 039 collision risk (static) | **LOW** — additive, `if not exists`, no rewrite |
| 8 | Hosted roles for 039 exist | **UNVERIFIED** (expected present; Supabase-managed) |
| 9 | Publication boundary intact | **UNVERIFIED remotely** / **preserved by 039 design** (static) |
| 10 | Backups visible & recent | **HUMAN VERIFICATION REQUIRED** |
| 11 | 039 dry-run preview | **NOT PERFORMED** (would target wrong project) |
| 12 | Human go/no-go gate prepared | **YES** (this report + checklist below) |

## Static findings (repository-side, fully performed)

- **Migration chain:** contiguous `000–039` (40 files), no gaps/dupes; highest local **039**;
  039 present only in repo and **locally** verified on disposable Postgres (2L-B `verify:db`
  green twice). See [migration-history-audit.md](migration-history-audit.md).
- **Collision/compatibility:** 039 is additive — one new table, six **nullable** columns (no
  rewrite), one SECURITY DEFINER RPC; written with `if not exists` / `create or replace`.
  Estimated operational risk **LOW**, *conditional on the remote pre-039 baseline matching the
  repo*. See [migration-039-collision-review.md](migration-039-collision-review.md).
- **Existing-data compatibility:** 039 adds **no** constraint to existing tables and only nullable
  columns → no `ALTER TABLE` can fail on legacy rows; the new unique index is on a new empty
  table. (Aggregate remote confirmations listed for the operator.)
- **Security/grants:** 039 **narrows** access (revokes from public/anon/authenticated; grants
  EXECUTE to `service_role` only) and enables RLS on the new table with no client policy. See
  [security-and-publication-boundary-audit.md](security-and-publication-boundary-audit.md).
- **Publication boundary:** 039 does not touch `publish_verified_observation`; it stages only
  `pending`/`needs_review`/unverified/unpublished rows → boundary preserved by design.
- **Rollback:** removes only 039 objects, preserves older migrations and data; **READY WITH
  CONDITIONS**. See [rollback-readiness-review.md](rollback-readiness-review.md).

## Hosted mutation proof — none occurred

- No `supabase db push` / `--include-seed`, no `db reset --linked`, no `migration up`/`repair`,
  no remote seed, no rollback, no RPC call, no `stage_retail_feed_observation` /
  `publish_verified_observation` invocation, no Cloud Run / durable worker, no grant/role/RLS
  change, no relink, no backup change.
- **No remote command of any kind was run** — inspection was aborted at the identity gate before
  any target contact. Only local files (`supabase/.temp/*`) and repository sources were read;
  no password/token/JWT/service-role value was read or printed.
- `git`-visible tree touched only new audit docs under `docs/sprint-2m-a/` (+ this Build OS note).

## Conditions attached to the verdict (all must clear before a GO)

1. **C1 — Identity:** operator CLI authenticated and linked to `qspsouemjtcdcfnivpnt` (verify
   `supabase/.temp/project-ref` = target).
2. **C2 — History:** `supabase migration list` shows `000–038` aligned local↔remote, no dup/out-of-
   order, and `039` **not** applied remotely.
3. **C3 — No drift/collision:** none of the 039 objects exist remotely pre-039; the six new column
   names are absent or type-compatible; no rogue same-named staging function.
4. **C4 — Dry-run:** `supabase db push --dry-run` (from a target-linked env) lists **only** 039 as
   pending, no seed, no repair, no earlier pending migration.
5. **C5 — Roles/boundary:** `service_role`/`anon`/`authenticated` exist; anon/authenticated lack
   direct retail-insert; `publish_verified_observation` unchanged and strict.
6. **C6 — Backups:** [backup-readiness-checklist.md](backup-readiness-checklist.md) items 2–5, 9
   confirmed + a fresh pre-migration dump captured.
7. **C7 — Approval:** explicit human go/no-go sign-off recorded for the migration window.

When C1–C7 are all satisfied and documented, the verdict may be upgraded to **GO-CANDIDATE**.

## Operator runbook — completing the hosted read-only audit (target-linked, still read-only)

> Run these in an environment authenticated to Supabase and linked to `qspsouemjtcdcfnivpnt`.
> All are read-only or explicitly non-mutating. Do **not** run any push/reset/repair/up.

```bash
# 0. Prove identity (must print the TARGET ref)
cat supabase/.temp/project-ref            # expect: qspsouemjtcdcfnivpnt

# 1. Migration history
supabase migration list                   # compare 000..038 local vs remote; confirm 039 NOT applied

# 2. Non-mutating preview (only if the CLI clearly states no SQL is applied)
supabase db push --dry-run                # expect: only 039 pending; no seed; no repair

# 3. Output-only schema diff into a GITIGNORED path (never save into supabase/migrations)
mkdir -p artifacts/sprint-2m-a
supabase db diff --schema public > artifacts/sprint-2m-a/public-diff.sql   # classify per drift rubric
```

Then run the read-only catalog checks in
[migration-039-collision-review.md](migration-039-collision-review.md) and
[security-and-publication-boundary-audit.md](security-and-publication-boundary-audit.md), and
record results back into those docs before requesting the go/no-go sign-off.

## Human Dashboard checklist (Richard — read-only, change nothing)

| Area | Link | Confirm |
|------|------|---------|
| Project overview | `https://supabase.com/dashboard/project/qspsouemjtcdcfnivpnt` | name is MallMind (prod); status healthy; no maintenance/paused state |
| Backups | `https://supabase.com/dashboard/project/qspsouemjtcdcfnivpnt/database/backups` | latest backup date/time; status healthy; retention window; PITR state; restore options visible |
| Database health | `https://supabase.com/dashboard/project/qspsouemjtcdcfnivpnt/database` | healthy; no storage/connection warning; no restart/upgrade pending |
| Postgres logs | `https://supabase.com/dashboard/project/qspsouemjtcdcfnivpnt/logs/postgres-logs` | no recurring DB errors; no repeated failed migrations; no role/permission errors |

Do not change anything during this audit.

## Recommended migration-window plan (only if the audit later reaches GO-CANDIDATE)

1. Announce a short maintenance window (039 is low-lock, but plan conservatively).
2. Capture a fresh logical dump of the target (`supabase db dump --linked`), stored off-repo.
3. Re-run `supabase migration list` + `db push --dry-run` immediately before to confirm only 039
   pending.
4. Apply 039 **only** under separate explicit approval (a future sprint — **not** this one).
5. Post-apply: verify the 039 objects, RLS, and grants read-only; confirm the publication gate
   still refuses a staged pending observation; keep the rollback script ready.

*This report does not authorize step 4; deployment remains a separate, human-approved action.*
