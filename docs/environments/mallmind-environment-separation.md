# MallMind — Environment Separation Design

**Purpose:** establish a genuinely isolated `mallmind-dev` Supabase project, and make it
structurally impossible for a routine command to hit the live project by accident.

**Status:** design + guardrails landed. `mallmind-dev` **not yet created** (requires
Richard). Nothing has been applied to any remote project.

---

## 1. The problem this fixes

The 2F-B audit established:

- Exactly **one** Supabase project is referenced anywhere in the repo. It is named
  **"Mallmind"** — not `mallmind-dev` — and is used as the live project.
- The local `SUPABASE_SERVICE_ROLE_KEY` is a 29-character placeholder, not a JWT.
- A Supabase personal access token was exposed in plaintext locally (see
  `mallmind-token-rotation-report.md`).

And most dangerously:

> **`supabase/.temp/linked-project.json` was tracked in git** and pinned the CLI to the live
> project. Any `supabase db push` or `supabase db reset` run in this repository would have
> targeted **production by default** — no `--project-ref` required, no warning given.

That single file made every migration command a loaded gun. It is now untracked and ignored.

## 2. Default-target risk inventory (Phase 4)

Files that could steer a command at the live project, and their disposition:

| File | Risk | Disposition |
|---|---|---|
| `supabase/.temp/linked-project.json` | **Critical** — committed CLI link pinning prod; implicit default for all `db` commands | **Untracked** + `supabase/.temp/` git-ignored |
| `scripts/scraper/README.md` | Documents `supabase link --project-ref <prod-ref>` and `supabase functions deploy` | Ref replaced with `YOUR_PROJECT_REF` |
| `scripts/scraper/.env.example` | Hardcoded prod `SUPABASE_URL` | Ref replaced with `YOUR_PROJECT_REF` |
| `google-dev-agent/.env.example` | Hardcoded prod `SUPABASE_URL` | Ref replaced with `YOUR_PROJECT_REF` |
| `supabase/functions/*/index.ts` (3 files) | Header comments document `supabase functions deploy <name>` with **no ref** — would use the linked project | Left as-is (comments only); neutralised by removing the committed link + the guard |
| `google-dev-agent/src/safetyGuard.ts:133` | Already lists `supabase db push` as a blocked command | Pre-existing control, retained |

Untracked/ignored files that legitimately hold the live ref (`.env.local`,
`google-cloud-backend/.env`) were **not modified** — they configure the real app.

## 3. Hard safety rule

> **Any migration, deploy, secrets or function command must name its target project
> explicitly, and must refuse to run when the target is ambiguous.**

Enforced by `scripts/supabase/guard-target.mjs`, which **fails closed**:

| Case | Result |
|---|---|
| No `--env` supplied | **exit 1** — refuses to infer from CLI link state |
| `--env dev` but `SUPABASE_DEV_PROJECT_REF` unset | **exit 1** |
| `--env prod` without `MALLMIND_ALLOW_PROD=1` | **exit 1** — production disabled by default |
| `SUPABASE_DEV_PROJECT_REF == SUPABASE_PROD_PROJECT_REF` | **exit 1** — ambiguous |
| `dev` target resolving to the prod ref | **exit 1** |
| `--env dev` with a distinct dev ref | exit 0 |
| `--env prod` **with** explicit opt-in | exit 0 |

All seven behaviours are verified by exit code. The guard prints only redacted refs
(`abcd********`) and never tokens, keys, passwords, or URLs.

## 4. Environment variable separation

Project targeting — **two distinct variables, never inferred from one another:**

| Variable | Meaning |
|---|---|
| `SUPABASE_DEV_PROJECT_REF` | the `mallmind-dev` project ref |
| `SUPABASE_PROD_PROJECT_REF` | the existing live project ref |
| `MALLMIND_ALLOW_PROD` | must equal `1` to permit any production-targeted command |
| `SUPABASE_ACCESS_TOKEN` | CLI auth — **current shell only**, never a file |

Frontend development (`.env.local`, git-ignored):
`VITE_SUPABASE_URL` · `VITE_SUPABASE_ANON_KEY` (publishable — RLS is the real control)

Backend development (`google-cloud-backend/.env`, git-ignored):
`SUPABASE_URL` · `SUPABASE_SERVICE_ROLE_KEY` · database connection string if required

Google Cloud development worker (from Sprint 2E, **not yet provisioned**):
worker service URL · dev GCS bucket · dev service account · dev secrets — all dev-scoped,
with the worker's own fail-closed config (`INTAKE_FIXTURE_ONLY_MODE`, bucket allowlist,
invoker allowlist).

**Rules:** no secret values committed · env files stay git-ignored · example files hold
placeholders only · dev and prod refs are separate variables · scripts never infer one from
the other · production commands fail closed unless deliberately enabled.

**The public frontend is NOT pointed at `mallmind-dev`** — that stays on the live project
until an explicit, separate decision.

## 5. `mallmind-dev` creation — decisions required from Richard

Before filling in the dashboard form:

| Field | Guidance |
|---|---|
| **Organization** | Same org as the existing project (keeps billing/access together), unless deliberate isolation is wanted. |
| **Project name** | `mallmind-dev` — exactly, so it is unmistakable in the dashboard. |
| **Database password** | Strong, unique, **not reused** from the live project. Store in a password manager. Never paste it into chat. |
| **Region** | Match the live project's region where possible, so latency/behaviour are comparable. |
| **Pricing tier** | A second project on the free tier is normally fine for dev; note free-tier projects **pause after inactivity** and have lower limits. If dev must stay always-on, it needs a paid tier — a billing decision. |
| **Connection pooling** | Supabase enables the pooler (Supavisor) by default. Session vs transaction mode matters for migrations: use the **direct connection** for `db push`, the pooler for app traffic. |

Afterwards, only three things are needed back — **and none of them is a secret**:
the new project **ref**, confirmation the name is `mallmind-dev`, and confirmation it is a
**separate** project. Do **not** send the service-role key, anon key, database password, or
access token.

## 6. Read-only audit role (Phase 11 — SQL prepared, NOT executed)

Intended for future read-only audits (like Sprint 2F-B) without a service-role key.
**Review before running. Run against `mallmind-dev` only.**

```sql
-- Create a least-privilege, read-only audit role.
-- Password is supplied externally; do NOT commit it.
create role mallmind_audit_ro with login password :'audit_password'
  nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls;

-- Schema visibility only.
grant usage on schema public to mallmind_audit_ro;

-- SELECT only, on existing and future tables.
grant select on all tables in schema public to mallmind_audit_ro;
alter default privileges in schema public
  grant select on tables to mallmind_audit_ro;

-- Explicitly deny everything else.
revoke insert, update, delete, truncate, references, trigger
  on all tables in schema public from mallmind_audit_ro;
revoke execute on all functions in schema public from mallmind_audit_ro;
alter default privileges in schema public
  revoke execute on functions from mallmind_audit_ro;
revoke all on schema auth, storage, vault from mallmind_audit_ro;
revoke create on schema public from mallmind_audit_ro;
```

**Does RLS still restrict this role?** **Yes — and that is the important subtlety.**
`NOBYPASSRLS` is set deliberately, so every RLS policy still applies. Because most MallMind
policies are written for `anon`/`authenticated`/`service_role`, a bare `mallmind_audit_ro`
will see **little or nothing** on RLS-enabled tables — `SELECT` privilege is necessary but
not sufficient.

There are two honest options:

1. **Grant `BYPASSRLS`** — the role sees everything. Simple, but it becomes a
   full-database reader and a high-value credential. Not recommended for routine use.
2. **A controlled reporting view (safer, recommended).** Create `security_invoker = off`
   views that expose exactly the audit columns needed (counts, non-personal fields), grant
   `SELECT` on just those views, and grant nothing on the base tables. The view author's
   privileges apply, so RLS on the base tables is bypassed *only through that narrow,
   reviewed surface* — no personal user data, no secrets, and revocable by dropping the view.

**Recommendation: option 2.** It gives a usable audit surface without minting a
read-everything credential, and it keeps personal data out of reach by construction.
Either way the role is revocable (`drop role`) without affecting the application.

## 7. Migration set — now inherited from the base branch

**Update (reconciled against the remote):** Sprint 2E was merged into
`origin/claude-premium-nav-test` via **PR #32** (merge commit `eb6e510`). An earlier draft of
this document stated the `000`–`034` migrations existed "only on an unmerged branch" — that
was **stale** and is corrected here.

| Source | Migrations | `000` baseline | `verify:db` |
|---|---|---|---|
| `origin/claude-premium-nav-test` (base, post-PR #32) | **35** (`000`–`034`) | ✅ present | ✅ present |

The full `000`–`034` migration set, `scripts/build-os/verify-db.mjs`, the `verify:db`/
`verify:all` scripts, and the Sprint 2E worker/fabric code are **already on the base branch**.
This environment-separation branch is rebased on top of that base and therefore **inherits**
them — it does not add or replay any of them.

`000_baseline_schema.sql` (on the base) creates `malls`, `shops`, and `products` — the core
tables the 2F audit found had no `CREATE TABLE` anywhere (they had been made by hand in the
dashboard). So a from-scratch `mallmind-dev` bootstrap is now possible directly from the base
branch's committed migration set; no separate/unmerged branch is required.
