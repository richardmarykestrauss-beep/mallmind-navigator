# Sprint 2M-B — Readiness Results (fill-in template)

Fill this in as you run [operator-runbook.md](operator-runbook.md) from the target-linked
operator directory. Paste **no** secrets and **no** dump/data content — only results, counts,
checksums, and safe identifiers. When complete, this file (plus the manual backup checksums)
closes out the hosted readiness audit and supports the verdict.

Operator: _______________  Date (UTC): _______________  Operator dir: `~/mallmind-target-audit`

## Identity (Step 3)

| Check | Expected | Observed | Pass? |
|-------|----------|----------|-------|
| `supabase/.temp/project-ref` | `qspsouemjtcdcfnivpnt` | | ☐ |
| Single project identity | yes | | ☐ |

## Migration history (Step 4) — `supabase migration list`

| Check | Expected | Observed | Pass? |
|-------|----------|----------|-------|
| Highest remote migration | `038` | | ☐ |
| `000–038` local↔remote agree | yes | | ☐ |
| `039` present remotely | no (pending) | | ☐ |
| Duplicates / out-of-order | none | | ☐ |
| Remote-only / local-only rows | only `039` local-only | | ☐ |

Paste the sanitized `migration list` table (version numbers only):

```
(paste here)
```

## Dry-run (Step 5) — `supabase db push --dry-run`

| Check | Expected | Observed | Pass? |
|-------|----------|----------|-------|
| Pending migrations | only `039` | | ☐ |
| Seed included | no | | ☐ |
| Repair requested | no | | ☐ |
| Earlier migration pending | no | | ☐ |

## Schema / collision / boundary (Step 6)

| Check | Expected | Observed | Pass? |
|-------|----------|----------|-------|
| `retail_external_location_mappings` exists | no (`NULL`) | | ☐ |
| `relm_one_approved_per_branch_uidx` exists | no (`NULL`) | | ☐ |
| `stage_retail_feed_observation` count | `0` | | ☐ |
| 6 new observation columns present | 0 rows | | ☐ |
| Roles `anon/authenticated/service_role` | all present | | ☐ |
| `anon/authenticated` direct INSERT on observations | `f, f` | | ☐ |
| `publish_verified_observation` present & strict | yes | | ☐ |
| `public-diff.sql` drift classification | no blocking drift | | ☐ |

Drift summary (classify per the 2M-A rubric — platform/formatting/known-repo vs manual-drift/
security/blocking):

```
(paste classification notes here — no data)
```

## Manual backup (Step 7) — see manual-backup-procedure.md

| Item | Value |
|------|-------|
| Destination path | `~/mallmind-backups/prod-________` |
| UTC timestamp | |
| roles.sql size | |
| schema.sql size | |
| data.sql size | |
| schema table-match count | (expect ≥ 5) |
| data `COPY` block count | |
| sha256 roles.sql | |
| sha256 schema.sql | |
| sha256 data.sql | |
| Backup readable/verified | ☐ |

## Verdict (Step 8)

- ☐ **GO-CANDIDATE** — all Steps 4–6 pass, a verified fresh backup exists, approval recorded.
- ☐ **CONDITIONAL GO-CANDIDATE** — no hard blocker; conditions: ______________________________
- ☐ **NO-GO** — blocker: ______________________________

Explicit go/no-go approver + date: ______________________________

> Reminder: this sprint stops at the verdict. Applying migration 039 is a separate,
> explicitly-approved action — not part of 2M-B.
