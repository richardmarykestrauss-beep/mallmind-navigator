# MallMind — `mallmind-dev` Bootstrap Report

**Status: LOCAL VERIFICATION COMPLETE ✅ — REMOTE BOOTSTRAP NOT STARTED ⛔**

`mallmind-dev` does not exist yet. Nothing has been applied to any remote Supabase project.
The existing live project was not queried, linked, migrated, deployed to, or modified.

---

## Phase 8 — Local database verification (COMPLETE, all green)

Run entirely against a **disposable local Supabase stack in Docker**. No remote project was
contacted. Executed on `feat/retail-fabric-sprint-2e` (the only branch carrying `000`–`034`).

### `npm run verify:db`

```
✔ Start disposable local Supabase stack
✔ Rebuild database from migrations 000-034      (71.9s)
✔ Assert final database contract                 (0.5s)

database verification passed | migrations=35 | tables=53 | functions=44 | policies=24

✔ DATABASE VERIFICATION PASSED
```

Migrations `000`–`034` rebuild cleanly **from scratch**, and the asserted contract holds —
including the durable-intake tables and the exact RPC signatures for
`commit_intake_chunk`, `claim_next_intake_job`, `create_intake_job`, and
`intake_job_reconciliation`.

### `npm run verify:all` — 12/12 steps

| Step | Result |
|---|---|
| Repository whitespace check | ✔ |
| Frontend production build | ✔ |
| Frontend tests | ✔ **223 passed**, 1 skipped |
| Backend TypeScript build | ✔ |
| Retail core / publisher / CSV-intake harnesses | ✔ ✔ ✔ |
| Shopping assistant harness | ✔ |
| CORS allowlist harness | ✔ |
| **Durable intake worker typecheck** | ✔ |
| **Durable intake worker harness** | ✔ 28 assertions |
| **Durable intake worker bundle** | ✔ |

`ALL CHECKS PASSED in 63.3s`. Nothing was weakened, skipped, or altered to force a pass.

**Conclusion:** the migration set is provably sound and ready to be applied to a real dev
project the moment one exists.

## Blocking gates (all require Richard)

| # | Gate | Status |
|---|---|---|
| 1 | Revoke the exposed `sbp_` personal access token | ✅ **DONE** — all dashboard tokens revoked |
| 2 | Purge plaintext token copies | ✅ **DONE** — 0 operational copies remain |
| 3 | Create the `mallmind-dev` project in the dashboard | ✅ **DONE** — `iivm********`, Stockholm, empty |
| 4 | Supply a fresh access token to the current shell only | ⛔ **NEXT** — awaiting manual token creation |
| 5 | Approve the migration plan before it is applied | ⛔ pending |

## Phase 9 — Remote migration plan (PREPARED, NOT EXECUTED)

To run **only after** gates 1–5, and **only** against `mallmind-dev`.

**Pre-flight — every check must pass or stop:**
1. `SUPABASE_DEV_PROJECT_REF` set and **different** from `SUPABASE_PROD_PROJECT_REF`
   (enforced by `scripts/supabase/guard-target.mjs --env dev`).
2. Confirm the remote project's name is exactly `mallmind-dev`.
3. Confirm remote migration history is **empty** (a fresh project) or a valid bootstrap
   state. Anything unexpected ⇒ **stop**.
4. Confirm no production user data, no Mall@Reds data, no copied live data.

**Apply (explicit ref, never the implicit link):**
```bash
node scripts/supabase/guard-target.mjs --env dev     # fail-closed target check
npx supabase link --project-ref "$SUPABASE_DEV_PROJECT_REF"
npx supabase migration list --linked                 # expect empty
npx supabase db push --linked                        # applies 000-034
```

**Explicitly NOT part of this plan:** seeding production users · copying any data from the
existing project · deploying edge functions · creating GCS buckets · deploying Cloud Run ·
uploading fixtures.

## Phase 10 — Post-apply verification (PREPARED, NOT EXECUTED)

Against `mallmind-dev` only, expecting the locally-proven contract:

| Check | Expected |
|---|---|
| Migration count | **35** (`000`–`034`) |
| Public tables | **≥ 53** |
| Public functions | **≥ 44** |
| Policies (public + storage) | **≥ 24** |
| Durable intake tables | `retail_intake_jobs`, `_job_chunks`, `_checkpoints`, `_dedup_keys` present |
| Durable intake RPCs | 4 present with exact signatures |
| Service-role-only grants | RPC `EXECUTE` restricted to `service_role` |
| Production users | **none** |
| Mall@Reds data | **none** |
| Copied production data | **none** |

No secret values will be printed by these checks.

## Migration set — inherited from the base branch (reconciled)

**Corrected:** Sprint 2E was merged into `origin/claude-premium-nav-test` via **PR #32**
(merge commit `eb6e510`). An earlier draft here claimed `000`–`034` lived only on an unmerged
branch — that was **stale**. The base branch now carries the complete `000`–`034` set,
`scripts/build-os/verify-db.mjs`, and the `verify:db`/`verify:all` scripts.

This environment-separation branch is **rebased on top of that base**, so it **inherits** the
migrations and tooling — it neither adds nor replays them (verified: the PR diff vs
`origin/claude-premium-nav-test` contains only the 7 environment-safety files).

The 2F audit found `malls`, `shops`, and `products` had no `CREATE TABLE` anywhere in the repo
(they were created in the dashboard). `000_baseline_schema.sql` — now on the base — **does**
create them. So `mallmind-dev` can be bootstrapped directly from the base branch's committed
migration set. Applying `000`–`034` brings the retail-data and durable-intake schema into dev,
which is the intended dev baseline.

## Remaining steps before any worker deployment

1. Revoke token → purge plaintext copies.
2. Create `mallmind-dev`; capture its ref (non-secret) and password (password manager only).
3. Fresh access token in the current shell only; verify CLI auth.
4. Guarded link to dev; apply `000`–`034`; run Phase 10 verification.
5. Only then consider Sprint 2E infrastructure — dev GCS bucket, worker service account,
   least-privilege IAM, Cloud Run worker — each its own gated decision.

**Confirmed for this run:** nothing deployed to Cloud Run · no GCS bucket created · no
retailer data acquired · no live project touched.
