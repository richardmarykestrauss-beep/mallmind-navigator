# Sprint 3A.5 — Clean-Staging Provisioning Runbook (operator)

Status: **Documentation only.** No Supabase project was created, linked, or contacted; no code or
migration changed. This runbook tells an operator how to create a **brand-new, isolated** Supabase
staging project and prove migrations `000–041` from zero, **without** risking either existing
project. Decisions/rationale: [../architecture/sprint-3a5-clean-staging-safety-decisions.md](../architecture/sprint-3a5-clean-staging-safety-decisions.md).
Verification sequence: [sprint-3a5-clean-staging-verification-plan.md](sprint-3a5-clean-staging-verification-plan.md).

> **Never paste into chat or commit:** database passwords, service-role keys, JWT secrets, access
> tokens, or connection strings. This runbook returns **identity + counts + redacted transcripts**.

## The two projects that must NEVER be touched

| Name | Ref | Rule |
|------|-----|------|
| `mallmind-dev` (development) | `iivmrlgntspbkpfqoboi` | do not relink/reset/migrate/use for the proof |
| `Mallmind` (legacy/frozen) | `qspsouemjtcdcfnivpnt` | frozen; do not use/repair/reset/migrate/link |

The new clean-staging project **does not exist yet** and has no ref until the operator creates it.

## PART 1 — Current linkage audit (repository facts)

| Item | State | Classification |
|------|-------|----------------|
| `supabase/config.toml` `project_id = "mallmind-navigator"` | CLI local project *name*, not a hosted ref | safe local-only |
| `supabase/.temp/` (incl. `project-ref` = `iivmrlgntspbkpfqoboi`) | **gitignored**, local link state only (not tracked) | hosted-link state — **do not copy into the staging run** |
| `.env.local` | gitignored; may hold hosted values | safe local-only (never commit/paste) |
| `.env.example`, `google-cloud-backend/.env.example` | templates, names only | safe read-only |
| Env vars that can point at hosted Supabase: `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`/service-role, `SUPABASE_DB_URL`, `SUPABASE_DB_PASSWORD`, `SUPABASE_ACCESS_TOKEN`, `PGHOST`/`DATABASE_URL`, `RETAIL_STAGING_ACTOR_ID` | consumed by CLI/worker | hosted mutation risk (guarded — see PART 5) |
| `npm run verify:db` → `npx supabase start` + `supabase db reset --local` | **local Docker stack only** | safe local-only |
| `db:test:start/reset` (gated by `scripts/retail/staging-guard.mjs`) | guard refuses hosted targets | safe local-only |
| `supabase db push` / `db reset --linked` / `migration repair` | act on the **linked** project | **forbidden for the operator run** (we never link the main repo) |
| `scripts/retail/staging-guard.mjs` + `src/lib/retail/feed/hostedGuard.mjs` | already hard-block `iivml`/`qspsou`; allow only local | safe local-only (basis for the PART 5 blocklist) |

**Commands that must NOT be run in the normal working directory:** any `supabase link`,
`supabase db push`, `supabase db reset --linked`, `supabase migration repair`, or anything that
writes `supabase/.temp/project-ref`. The repo supports **database-URL targeting** (psql / a URL-scoped
verifier) so migrations can be applied to staging **without `supabase link`** — this is the chosen
path (PART 6). Any CLI command whose default target is "the linked project" is forbidden here.

## PART 2 — Isolation strategy (selected: C — explicit DB-URL targeting from a separate directory)

**Selected: a separate throwaway clone/worktree (A) that applies migrations by explicit staging
database URL (C) — never `supabase link`.** Why this is safest:

- The **normal working directory keeps its exact link** (`supabase/.temp/project-ref = iivmrlgntspbkpfqoboi`)
  — untouched, because we never run `link`/`push`/`reset` there and never write `.temp`.
- No existing ref is overwritten; `.temp` state never leaks (the staging run is URL-scoped, stateless).
- The operator supplies the **staging DB URL explicitly** each time, so the target is visible before
  every mutation and there is no hidden "linked default."
- Commands **fail closed** if the staging URL/ref is absent or matches a blocked ref (PART 5).

Set-up (operator):

```bash
mkdir -p ~/mallmind-clean-staging && cd ~/mallmind-clean-staging
git clone https://github.com/richardmarykestrauss-beep/mallmind-navigator.git .
git checkout claude-premium-nav-test
git rev-parse HEAD           # must be in the 99eb9a2 lineage (Gate B)
# Do NOT run `supabase link` here. This directory only READS the migration tree.
```

## PART 3 — Project identity plan

- **Human name:** `mallmind-clean-staging` (contains "staging"; unambiguous vs `mallmind-dev` and the
  legacy `Mallmind`; never "prod"/"production").
- **Region:** choose the same region as the pilot for realism — **`af-south-1` (Johannesburg)** if
  available on the plan; otherwise document the chosen region explicitly in the evidence block.
- **Account/ownership:** the operator's Supabase org that owns `mallmind-dev` (documented in evidence),
  or a dedicated org — recorded, not assumed.
- **Free-plan note:** no managed backups / PITR (as with the legacy project). Acceptable — this is a
  disposable proof project; a failed proof is **abandoned and recreated**, not restored (PART 10).
- **Do not invent a project ref** — it exists only after creation.

**Identity verification block (operator completes before any migration):**

```
project_name:              mallmind-clean-staging
project_ref:               ____________________   (NOT iivmrlgntspbkpfqoboi / qspsouemjtcdcfnivpnt)
organization / account:    ____________________
region:                    ____________________
creation_timestamp (UTC):  ____________________
db_host_suffix:            ____________________   (e.g. .pooler.supabase.com — host only)
table_count (public):      ____  (expect empty/default-only)
migration_history_rows:    ____  (expect 0)
confirm_not_dev:           ref != iivmrlgntspbkpfqoboi   [ ]
confirm_not_legacy:        ref != qspsouemjtcdcfnivpnt   [ ]
```

## PART 4 — Operator safety gates (each must pass before the next)

**GATE A — New-project identity confirmed.** Operator pastes back only: project name, ref, region,
and a safe text/screenshot of the identity. **No password/service-role key/JWT/access token.**

**GATE B — Isolated execution environment confirmed.** Prove: `pwd` is `~/mallmind-clean-staging`
(not the normal repo); `git rev-parse HEAD` is in the `99eb9a2` lineage; no `supabase/.temp/project-ref`
was created here (`test ! -f supabase/.temp/project-ref`); the staging ref/URL is the only target supplied.

**GATE C — Pre-migration emptiness confirmed** (read-only SQL against the staging URL): no MallMind
app tables (`to_regclass('public.products') is null`, `to_regclass('public.retail_price_observations') is null`);
`supabase_migrations.schema_migrations` has 0 rows for `000–041`; no unexpected `public` functions;
no `products`/retailer-source data. Any non-empty result → **STOP** (PART 10).

**GATE D — Migration target echoed safely + typed acknowledgement.** Before mutation the script prints:
project name; **first+last 4 chars of the ref only**; region; DB host (sensitive parts masked);
`migration range: 000..041`; and `BLOCKED REFS: iivmrlgntspbkpfqoboi, qspsouemjtcdcfnivpnt`. Operator
must type exactly: **`APPLY-000-041-TO-CLEAN-STAGING`**. Any mismatch → exit non-zero.

**GATE E — Post-migration verification** (no deployment until all pass): migration history contiguous
`000–041`; schema object counts/list match the local proof; grants + RLS verified; privileged-RPC
EXECUTE limited to `service_role`; the staging RPC works on **synthetic** fixtures; **no `products`
publication**. Full sequence: the verification-plan doc.

## PART 5 — Hard blocklist (non-running pseudocode — do not execute here)

Extends the existing `staging-guard.mjs`/`hostedGuard.mjs` (which already block `iivml`/`qspsou` and
allow only local). A clean-staging guard must **allow exactly one approved staging target** while
still hard-blocking the two known refs. Every hosted-mutation step calls this first.

```text
# clean-staging-guard (pseudocode; documentation only)
BLOCKED = ["iivmrlgntspbkpfqoboi", "qspsouemjtcdcfnivpnt"]
target_ref  = env STAGING_PROJECT_REF        # required
target_url  = env STAGING_DB_URL             # required (never printed)
target_name = env STAGING_PROJECT_NAME       # required
ack         = env STAGING_ACK                # required

EXIT NONZERO IF target_ref is empty
EXIT NONZERO IF target_url is empty
EXIT NONZERO IF target_ref in BLOCKED
EXIT NONZERO IF host(target_url) contains any BLOCKED ref
EXIT NONZERO IF "staging" not in lower(target_name)
EXIT NONZERO IF ack != "APPLY-000-041-TO-CLEAN-STAGING"
EXIT NONZERO IF migration tree HEAD not in 99eb9a2 lineage
EXIT NONZERO IF cwd is the normal repository path (isolated execution required)
PRINT name, ref[0:4]+"…"+ref[-4:], region, masked host, "000..041"   # never the URL/secret
ELSE continue
```

Store this as pseudocode only in this sprint; implement + test it on the **local disposable stack**
before it ever runs against a hosted URL.

## PART 6 — Migration application strategy

- **Primary: `psql` against the staging DB URL**, applying `supabase/migrations/000..041` in order,
  each wrapped so `supabase_migrations.schema_migrations` records the version (mirroring how
  `verify-db.mjs` pipes SQL to the local stack). Rationale: **no `supabase link`** (zero project-link
  risk), the target URL is explicit + visible, migration order is deterministic and repeatable, and
  it works against Supabase-managed Postgres. Secrets: the URL is read from env, never printed.
- **Emergency fallback: Supabase CLI `db push` from the throwaway clone AFTER `supabase link` to the
  *staging* ref only** — used only if psql is unavailable, and only inside `~/mallmind-clean-staging`
  (never the main repo). Higher link-risk, so it is the fallback, not the default.
- **Prohibited:** `migration repair` as a normal step; squashing; editing old migrations; skipping
  migrations. Expected output: 42 recorded versions (`000–041`), contiguous, no repair prompts.

Preconditions: Gates A–D passed; guard green. Expected: each migration `NOTICE`/`INSERT` succeeds;
final `select count(*) from supabase_migrations.schema_migrations` = 42.

## PART 7 — Secret & environment plan (names only — create nothing now)

| Variable (name only) | Store where | Access | Needed at | Notes |
|----------------------|-------------|--------|-----------|-------|
| `STAGING_PROJECT_REF` | operator shell env | operator | migration/verify | not a secret; used by the guard |
| `STAGING_PROJECT_NAME` | operator shell env | operator | migration | guard checks "staging" substring |
| `SUPABASE_URL` (staging) | operator env; later Cloud Run for the worker | operator/deploy | verify/deploy | not secret (public URL) |
| anon/publishable key (staging) | operator env / frontend config later | operator | future deploy | low-sensitivity |
| **service-role key (staging)** | **Secret Manager / GitHub Actions secret only** | least-privilege | verify/deploy | **never commit/paste**; rotate on suspicion |
| `STAGING_DB_URL` / DB password | operator env (session only) | operator | migration/verify | **never printed/committed**; prefer `read -s` |
| `RETAIL_STAGING_ACTOR_ID` | operator env; later worker config | operator | verify/deploy | a `profiles.id` (PART 8); not secret but staging-scoped |

Prohibitions: no secret value in git, chat, logs, or evidence files. During **migration** only the DB
URL is needed; the service-role key is needed only for **verification/deploy** later.

## PART 8 — Staging-only service actor plan (design; do not create)

Schema facts: `profiles.id uuid PK references auth.users(id) on delete cascade`;
`admin_audit_log.admin_id references profiles(id)`. The staging RPC stamps `staged_actor = p_actor`
and audits with `admin_id = p_actor`, so `RETAIL_STAGING_ACTOR_ID` **must be a `profiles.id`**, which
**requires a matching `auth.users` row**.

- **Shape:** one `auth.users` row + one `profiles` row sharing a stable UUID the operator generates
  (`gen_random_uuid()`), recorded in the evidence block — **not fabricated here**.
- **Least privilege:** `profiles.is_admin` = **false/absent** — staging needs no admin, and
  `publish_verified_observation` requires admin, so the bot **cannot publish** (defence in depth).
- **auth.users linkage:** required by the `profiles→auth.users` FK; seed a non-human placeholder
  (e.g. email `retail-staging-bot@service.mallmind.invalid`), no password login.
- **Naming:** `profiles.username = 'retail_staging_service'` (auditable, clearly non-human).
- **Seed method:** an idempotent SQL seed run once on staging (like the fixture's actor seed), applied
  after migrations; recorded in evidence (id + username only).
- **Rotation/disable:** to disable, unset `RETAIL_STAGING_ACTOR_ID` (worker promotion goes inert) and/or
  delete the profiles row; to rotate, seed a new id and repoint the env var.
- **Invalid/missing tests:** already proven on disposable PG (3A.4): missing actor → inert; non-UUID →
  skipped; valid-UUID-without-profile → `admin_audit_log` FK fails closed. Re-assert on staging.

## PART 10 — Failure & abandonment plan (default: STOP — never repair in place)

If any of: migration fails halfway · history differs · unexpected pre-existing tables · RLS/grants
differ · function count differs · actor seed fails · replay differs · `products` changes unexpectedly
· target identity becomes uncertain →

1. **STOP immediately** — do not `migration repair`, do not edit migrations, do not patch the hosted schema.
2. **Capture evidence** (PART 11) of the failure state (redacted).
3. **Delete the clean-staging project** in the Dashboard and **abandon its ref**.
4. **Recreate from zero** (new project, new ref, back to Gate A) — clean staging is disposable by design.
5. If the failure implies a **repository migration defect** (not a hosted fluke), escalate for
   migration review before retrying; never fix it on the hosted project.

## PART 11 — Evidence package (no secret-bearing output)

Directory: `docs/evidence/sprint-3a5-clean-staging/` (created when the operator run happens; a
`.gitkeep` placeholder is added now). Capture: project-identity screenshot (secrets cropped); project
ref; region; creation time; pre-migration object inventory (Gate C); migration transcript **with the
DB URL/secret redacted**; migration history (`schema_migrations` versions); object counts;
RLS-policy inventory; grants; function signatures; controlled-fixture results; `products` row count
**before and after** (must be equal / zero shopper writes); audit-log rows with sensitive data
removed; final **GO/NO-GO**. **Never** commit terminal output containing a URL, password, key, or token.
