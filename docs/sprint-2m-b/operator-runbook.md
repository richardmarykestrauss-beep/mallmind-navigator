# Sprint 2M-B — Operator Runbook (target-linked readiness + manual backup)

**Why this is an operator runbook, not an agent transcript.** Every remote step below requires
authenticating to the **production** target `qspsouemjtcdcfnivpnt` — a Supabase access token
(`supabase login`) and the production **database password** (`supabase link` / `db dump`). The
assistant is prohibited from entering passwords, API keys, or access tokens into any field, and
no credential is present in this environment for a tool to consume on its own
(`SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, service-role key, `PGHOST/PGPASSWORD` all
unset; `supabase projects list` → Unauthorized). So **Richard runs the commands below**; the
assistant prepared them, the results template, and the verdict framework.

> Everything here is **read-only or a logical dump (a read)**. Nothing mutates the target.
> Do **not** run any command from the "Never run" list at the bottom.

## Preconditions (once)

- Supabase CLI installed (repo pins `supabase@2.108.0`; `npx supabase` works).
- You can `supabase login` (opens a browser / pastes a token **you** control).
- You have the production DB password for `qspsouemjtcdcfnivpnt` (from the Dashboard →
  Project Settings → Database, or your password manager). **Never paste it into a chat.**

## Step 1 — Separate operator directory (do NOT touch the dev working dir)

The existing MallMind working directory stays linked to dev (`iivmrlgntspbkpfqoboi`). Work in a
**fresh clone** so the dev link is never altered:

```bash
mkdir -p ~/mallmind-target-audit
cd ~/mallmind-target-audit
git clone https://github.com/richardmarykestrauss-beep/mallmind-navigator.git .
git checkout claude-premium-nav-test
git pull --ff-only origin claude-premium-nav-test
```

## Step 2 — Authenticate + link the SEPARATE directory to the target

```bash
supabase login                                   # browser/token you control
supabase link --project-ref qspsouemjtcdcfnivpnt # will prompt for the prod DB password
```

Prefer feeding the DB password via env so it is never echoed:

```bash
# read into an env var without printing (bash). Do NOT hardcode it in a file.
read -s -p "Prod DB password: " SUPABASE_DB_PASSWORD; export SUPABASE_DB_PASSWORD; echo
```

## Step 3 — Prove target identity (must equal the target ref)

```bash
cat supabase/.temp/project-ref        # EXPECT: qspsouemjtcdcfnivpnt   ← abort if different
```

Record the printed ref in the results template. If it is **not** `qspsouemjtcdcfnivpnt`, STOP.

## Step 4 — Remote migration history (read-only)

```bash
supabase migration list
```

Compare against the local chain `000 … 039`. Record:
- highest remote migration (**expected 038**);
- local↔remote agree `000–038`? (must be **yes** for GO);
- is `039` present remotely? (**expected: NO / pending**);
- any duplicate / out-of-order / remote-only / local-only rows.

**If `000–038` do not agree, or `039` objects exist remotely without `039` in the history →
`NO-GO`.** Do **not** run `supabase migration repair`.

## Step 5 — Non-mutating dry-run (only if the CLI confirms no SQL is applied)

```bash
supabase db push --dry-run
```

Expected: **only `039` pending**, no seed, no repair, no earlier pending migration. Record the
full pending list. Anything else → `NO-GO`. **Do not run a real `db push`.**

## Step 6 — Read-only schema / collision / boundary checks

Output-only schema diff into a gitignored operator path (never into `supabase/migrations`):

```bash
mkdir -p artifacts/sprint-2m-b
supabase db diff --schema public > artifacts/sprint-2m-b/public-diff.sql
```

Then run the read-only catalog queries from the 2M-A docs (copy/paste; all `SELECT`-only):
- 039 objects must **not** already exist:
  `select to_regclass('public.retail_external_location_mappings');`
  `select to_regclass('public.relm_one_approved_per_branch_uidx');`
  `select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='stage_retail_feed_observation';`  (**expect 0**)
- the 6 new observation columns must be absent or type-compatible:
  `select column_name, data_type from information_schema.columns where table_schema='public' and table_name='retail_price_observations' and column_name in ('branch_external_id','feed_content_hash','feed_source_row','feed_file_name','feed_parse_warnings','staged_actor');`  (**expect 0 rows**)
- roles exist: `select rolname from pg_roles where rolname in ('anon','authenticated','service_role');`
- publisher intact & strict (definition only — **do not call it**):
  `select pg_get_functiondef('public.publish_verified_observation'::regproc);`
- ordinary roles cannot insert observations directly:
  `select has_table_privilege('anon','public.retail_price_observations','INSERT'), has_table_privilege('authenticated','public.retail_price_observations','INSERT');` (**expect f,f**)

Run SQL read-only via the Dashboard SQL Editor (SELECT only) or a psql session opened with the
connection string from Project Settings. **Never** run INSERT/UPDATE/DELETE/DDL, and never query
shopper/user/auth tables.

## Step 7 — Manual logical backup (Free plan has no managed backups)

See [manual-backup-procedure.md](manual-backup-procedure.md). Store the dump **outside the repo**
(e.g. `~/mallmind-backups/`), never commit it, and verify integrity without printing row data.

## Step 8 — Record results + verdict

Fill in [readiness-results-template.md](readiness-results-template.md) and assign:
- `GO-CANDIDATE` — history aligned, 039 pending only, no drift/collision, roles/boundary intact,
  a verified fresh backup exists, and you record explicit go/no-go approval;
- `CONDITIONAL GO-CANDIDATE` — no hard blocker but listed conditions remain;
- `NO-GO` — any blocker in Steps 4–6.

**This sprint stops here. Do not apply migration 039.**

## Never run (absolute prohibitions this sprint)

`supabase db push` (non-dry-run) · `supabase db reset --linked` · `supabase migration repair` ·
`supabase migration up` (hosted) · remote seed · applying 039 in the SQL Editor ·
`stage_retail_feed_observation` · `publish_verified_observation` · any INSERT/UPDATE/DELETE/DDL ·
RLS/grant/role changes · secret rotation · plan change · enabling PITR · creating a DB branch ·
Cloud Run / durable worker · changing backup settings · relinking the dev working directory.
