# Migration History Audit — Sprint 2M-A

**Remote status: NOT PERFORMED — blocked at the linked-project identity gate.**
The local CLI is linked to `iivmrlgntspbkpfqoboi` (mallmind-dev), not the audit target
`qspsouemjtcdcfnivpnt`. `supabase migration list` was **not** run — doing so would have queried
the wrong project and still would not satisfy the gate. Relinking is prohibited. See
[hosted-project-identity-audit.md](hosted-project-identity-audit.md).

## Local (repository) migration inventory — verified

Contiguous, zero-padded, single-owner chain. 40 migration files, `000 … 039`, no gaps, no
duplicates in the `03x` tail:

```
… 035_mall_directory_truth_fields.sql
036_retail_truth_model.sql
037_products_price_condition_check.sql
038_products_price_scope.sql
039_retail_feed_staging_bridge.sql      ← the migration under review (repository-only)
```

- Highest local migration: **039**.
- Migration 039 is present only in the repository and has been **locally** verified on a
  disposable Postgres (Sprint 2L-B: `verify:db` green twice, full `000..039` chain). It has
  **not** been applied to any hosted project.

## What the remote audit must establish (operator to complete)

Run, from an environment linked to `qspsouemjtcdcfnivpnt`:

```bash
supabase migration list
```

and record / compare:

| Check | Expected for GO | If not met |
|-------|-----------------|------------|
| Highest remote migration | **038** | investigate |
| Local vs remote agree `000–038` | identical versions, same order | **NO-GO** (divergence) |
| Migration `039` remote state | **not applied / not present remotely** | see drift rule below |
| Duplicate versions | none | **NO-GO** |
| Out-of-order versions | none | **NO-GO** |
| Remote-only records | none unexplained | investigate |
| Local-only records | only `039` | investigate |

**Drift rule:** if the `039` objects (table `retail_external_location_mappings`, function
`stage_retail_feed_observation`, index `relm_one_approved_per_branch_uidx`, the six observation
columns) already exist remotely while `039` is **absent** from the remote migration history,
that is **material drift → NO-GO**. Do **not** use `supabase migration repair`.

## This-audit conclusion for history

- Local side: **aligned and contiguous through 039** (repo-verified).
- Remote side: **UNVERIFIED** (identity gate). Cannot confirm `000–038` agreement or that `039`
  is remotely unapplied from this environment.
- Because remote agreement through 038 could not be proven read-only here, the migration-history
  dimension is **not GO-qualified** and contributes to the overall `NO-GO` verdict until an
  operator linked to the target completes `supabase migration list` per the runbook.
