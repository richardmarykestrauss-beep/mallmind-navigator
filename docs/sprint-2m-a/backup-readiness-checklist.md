# Backup-Readiness Checklist — Sprint 2M-A

**Status: HUMAN VERIFICATION REQUIRED.** Claude could not inspect the Supabase Dashboard or any
project backup metadata for `qspsouemjtcdcfnivpnt` from this environment (identity gate; no
target credentials; Dashboard is not programmatically reachable here). Backup readiness **must
not be inferred** — it is unproven until Richard completes the checks below.

> Do not initiate a restore. Do not change backup settings. Do not enable/purchase PITR. Do not
> download confidential data. This is a read-only verification.

## Checklist (Richard to complete in the Dashboard)

Backups: `https://supabase.com/dashboard/project/qspsouemjtcdcfnivpnt/database/backups`

| # | Item | What to record | Pass condition for a migration window |
|---|------|----------------|----------------------------------------|
| 1 | Project plan | plan name (Free/Pro/Team/Enterprise) | plan supports the backup type you rely on |
| 2 | Daily backups available | yes/no | **yes** |
| 3 | Latest backup timestamp | exact date+time (UTC) | recent (ideally < 24h before the window) |
| 4 | Backup status | healthy/failed | **healthy** |
| 5 | Retention window | days shown | ≥ your rollback horizon |
| 6 | Point-in-Time Recovery (PITR) | enabled/disabled | note state (not required, but preferred) |
| 7 | Downloadable logical backup | available? | note availability |
| 8 | Restore-to-new-project | available? | note availability |
| 9 | Backup warnings | any shown? | **none** |

## Recommended pre-migration action (operator, not Claude)

Immediately before any separately-approved 039 apply, capture a **fresh** logical snapshot of the
`public` schema of the target from a target-linked, credentialed environment, e.g.:

```bash
# operator-run, target-linked, READ-ONLY dump (schema + retail data as desired)
supabase db dump --linked -f pre-039-backup.sql
```

Store it outside the repository (do not commit dumps). Verify the file is non-empty and contains
the retail tables before proceeding.

## Verdict input

Backup readiness = **HUMAN VERIFICATION REQUIRED**. Until items 2–5 and 9 are confirmed, the
migration window must not open. This is a standing condition on the overall verdict.
