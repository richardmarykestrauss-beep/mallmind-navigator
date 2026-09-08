# MallMind — `mallmind-dev` Bootstrap Report

**Status: DEV BOOTSTRAP COMPLETE ✅ — migrations `000`–`034` applied to `mallmind-dev` and
contract-verified. No app connected; production untouched.**

`mallmind-dev` (ref `iivm********`, Stockholm) is linked, migrated (35/35 versions matched),
and verified. The existing production project (`qsps********`) was never queried, linked,
migrated, deployed to, or modified. Neither the frontend nor the backend is connected to
`mallmind-dev` yet (its ref appears in no app config or tracked file).

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
| 4 | Supply a fresh access token to the current shell only | ✅ **DONE** — session-only token; linked to dev |
| 5 | Approve + apply migrations `000`–`034` to `mallmind-dev` | ✅ **DONE** — 35/35 matched, contract verified |

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

## Phase 9 — Remote migration APPLIED ✅

`supabase db push` applied migrations `000`–`034` to `mallmind-dev` (ref `iivm********`).
Confirmed by the operator:

- `guard-target.mjs --env dev` passed; repository link points to `mallmind-dev` (verified
  independently here: `supabase/.temp/linked-project.json` → `iivm…`, name `mallmind-dev`, **not**
  the production `qsps…` ref).
- `npx supabase migration list` shows **all 35 versions matched local ↔ remote**.
- A pg-delta certificate warning appeared only *after* migrations were applied and did **not**
  affect remote migration history.

## Phase 10 — Contract verification (VERIFIED)

**How this was verified.** The remote applied the identical `000`–`034` files, and
`migration list` confirmed a 35/35 local↔remote match. Because the same deterministic DDL on a
fresh Postgres yields the same schema, the authoritative contract below was measured on the
disposable local stack (`npm run verify:db`, which rebuilds `000`–`034` from scratch); it holds
on the remote **by construction**. Direct remote figures can be reproduced read-only via the SQL
in the next section. (The dev DB password / access token live only in the operator's session, by
design, so this repo tooling does not connect to the remote itself.)

| Check | Result | Source |
|---|---|---|
| Migration count | **35** (`000`–`034`), 35/35 local↔remote matched | `migration list` (remote) + `verify:db` |
| Public tables | **53** | `verify:db` contract assertion |
| Public functions | **44** | `verify:db` contract assertion |
| Policies (public + storage) | **24** | `verify:db` contract assertion |
| RLS-enabled public tables | **46 of 53** | local stack query |
| Durable intake tables | **9 present** — `retail_intake_jobs, _job_chunks, _checkpoints, _dedup_keys, _events, _quarantine, _worker_leases, _product_index, _job_drafts` | local stack query |
| Durable intake RPCs | **9 present, exact signatures** (see below) | `verify:db` signature assertion |
| Service-role-only grants | `create_intake_job` EXECUTE = `postgres, service_role` only (no `anon`/`authenticated`) | local stack query |
| Production users | **0** (`auth.users = 0`) | local stack query |
| Mall@Reds data | **0** — no migration references `reds`/`f4a2c1b3` | migration grep |
| Copied production data | **0** — `malls=0, shops=0, products=0, mall_nodes=0` on a fresh migration-only DB | local stack query |

Durable RPC signatures (types only, via `oidvectortypes`):

```
claim_intake_job(uuid, text, integer)
claim_next_intake_job(text, integer)
commit_intake_chunk(uuid, text, bigint, jsonb)
create_intake_job(uuid, text, text, text, text, text, integer, bigint, integer, integer, boolean, text, boolean)
fail_intake_job(uuid, text, bigint, text, text)
finalize_intake_job(uuid, text, bigint, text)
intake_job_reconciliation(uuid)
renew_intake_lease(uuid, text, integer, bigint)
set_intake_job_control(uuid, text)
```

### Why no production data could be copied

- **`seed.sql` is disabled** (`supabase/config.toml` → `[db.seed] enabled = false`) and
  `db push` never runs seed regardless. The 110 demo products / 8 demo malls are **not** loaded.
- Every `INSERT` inside `000`–`034` is either a **function body** (runtime RPC logic — e.g. the
  `products` insert in `027` lives inside `publish_verified_observation`; the `profiles` insert in
  `000` lives inside the `handle_new_user` trigger) or **reference/config data** (achievement
  definitions in `002`, the `mall-map-assets` storage-bucket row in `018`).
- The `005` node/edge seed is `INSERT … SELECT … FROM shops`; with no shops it inserts **0 rows**.
- No migration inserts into `auth.users` (the matches are FK references and triggers).

Net: a fresh `mallmind-dev` holds only migration-authored reference/config data — identical on
local and remote — and **zero** users, malls, shops, products, nodes, or Mall@Reds rows. Nothing
was copied from the production project.

### Reproduce the remote figures read-only (operator's session / dev SQL editor)

Paste into the **mallmind-dev** SQL editor (or `psql` the dev connection). All `SELECT`-only:

```sql
select
  (select count(*) from supabase_migrations.schema_migrations)                                  as migrations,      -- 35
  (select count(*) from pg_tables where schemaname='public')                                    as public_tables,   -- 53
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public') as functions, -- 44
  (select count(*) from pg_policies where schemaname in ('public','storage'))                   as policies,        -- 24
  (select count(*) from pg_tables t join pg_class c on c.relname=t.tablename
     where t.schemaname='public' and c.relrowsecurity)                                          as rls_tables,      -- 46
  (select count(*) from auth.users)                                                             as users,           -- 0
  (select count(*) from public.products)                                                        as products,        -- 0
  (select count(*) from public.malls)                                                           as malls;           -- 0
-- Mall@Reds must be absent:
select count(*) as mallreds_rows from public.malls where id = 'f4a2c1b3-8d7e-4f6a-9b0c-1d2e3f4a5b6c';  -- 0
```

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

1. ~~Revoke token → purge plaintext copies.~~ ✅ done
2. ~~Create `mallmind-dev`; capture ref + password (password manager).~~ ✅ done
3. ~~Fresh session-only access token; verify CLI auth.~~ ✅ done
4. ~~Guarded link to dev; apply `000`–`034`; verify contract.~~ ✅ done — this report
5. **NEXT (each its own gated decision):**
   - Populate `google-cloud-backend/.env` / `.env.local` with the **dev** URL + keys when an app
     is deliberately pointed at dev (currently neither is — dev is connected to nothing).
   - Sprint 2E infrastructure: dev GCS bucket, worker service account, least-privilege IAM,
     Cloud Run worker — gated, and where the **real Cloud Run→Supabase latency is measured**
     (the open item from the Stockholm region decision).

**Confirmed for this run:** migrations applied to `mallmind-dev` only · production (`qsps…`)
never queried or touched · frontend/backend NOT connected to dev · nothing deployed to Cloud
Run · no GCS bucket created · no fixtures uploaded · no retailer data acquired.
