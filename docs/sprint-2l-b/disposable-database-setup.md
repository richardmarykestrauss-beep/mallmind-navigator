# Disposable Database Setup — Sprint 2L-B

The staging bridge is proven against a **throwaway local PostgreSQL** (the Supabase CLI
Docker stack), never a hosted project. Every run boots a clean database, applies the full
migration chain `000 … 039`, runs real SQL assertions, and is torn down. Nothing here
touches `mallmind-dev` (`iivmrlgntspbkpfqoboi`) or production (`qspsouemjtcdcfnivpnt`).

## Prerequisites

- Docker Desktop running (the Supabase local stack runs in containers).
- Node 22.x + npm (repo `engines`).
- `supabase` CLI is pinned as a devDependency (`supabase@2.108.0`) — invoked via `npx supabase`.

## Commands

```bash
npm run retail:staging:guard   # preflight: refuses any hosted DB target, prints the local host
npm run db:test:start          # guard + `supabase start` (boots the disposable stack)
npm run db:test:reset          # guard + `supabase db reset --local` (re-applies 000..039 clean)
npm run retail:staging:test    # guard + verify:db (migration chain + all 2L-B fixtures)
npm run db:test:stop           # `supabase stop --no-backup` (destroys the disposable stack)
```

`npm run verify:db` is the authoritative proof: it boots/uses the local stack, applies the
migrations, and pipes the assertion SQL (`scripts/build-os/retail-staging-fixture.sql`) into
`docker exec … psql -v ON_ERROR_STOP=1`. Any failed assertion aborts with a non-zero exit.

## Safety guard

`scripts/retail/staging-guard.mjs` (module `src/lib/retail/feed/hostedGuard.mjs`) runs before
`db:test:start`, `db:test:reset`, and `retail:staging:test`. It:

1. hard-refuses if `MALLMIND_ALLOW_PROD` is set;
2. refuses if any of `DATABASE_URL` / `SUPABASE_DB_URL` / `SUPABASE_DB_HOST` / `PGHOST` points
   at a hosted host (`*.supabase.co`, `*.supabase.in`, `pooler.supabase.com`) or either known
   MallMind project ref;
3. refuses any non-local host; accepts only `localhost` / `127.0.0.1` / `::1` /
   `supabase_db_*` / `*.local` / `host.docker.internal`;
4. defaults to the local loopback (`127.0.0.1`) when no DB env override is set;
5. prints only the **host** — never a connection string, password, key, or ref.

Exit `0` = safe local target; exit `3` = refused. See
[security-and-grants-report.md](security-and-grants-report.md).

## What this setup deliberately does NOT do

No hosted connection, no `supabase db push`, no linked-project migration, no production/dev
cloud write, no hosted credentials, no service-role key, no Cloud Run, no durable worker, no
scraping, no publication, no scheduled ingestion. All of that remains out of Sprint 2L-B.
