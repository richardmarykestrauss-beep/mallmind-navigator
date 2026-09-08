# Security & Grants Report — Sprint 2L-B

All statements below are **proven on real PostgreSQL** by
`scripts/build-os/retail-staging-fixture.sql` (run inside `npm run verify:db`), plus static
grant assertions in `scripts/build-os/verify-db.mjs`. Every check RAISEs on failure under
`psql -v ON_ERROR_STOP=1`, so a green run means every claim held.

## Staging RPC hardening (`stage_retail_feed_observation`)

| Control | Mechanism | Proof |
|---------|-----------|-------|
| Locked search_path | `set search_path = pg_catalog, public` | `pg_proc.proconfig` asserted to contain `search_path=` |
| No dynamic SQL | fully parameterised body, schema-qualified objects | injection string in C15 stored as data; `to_regclass('public.products')` still non-null |
| No privilege-escalating params | signature has no `verified`/`approved`/`published`/`internal_shop`/`internal_mall`/`verified_by` arg | `pg_get_function_arguments` matched against `verified|approved|published|internal_shop|internal_mall|verified_by` → none present |
| Least privilege | `REVOKE ALL` from `public`, `anon`, `authenticated`; `GRANT EXECUTE` to `service_role` only | `has_function_privilege` checks (below) + role-switch execution tests |
| Definer safety | `SECURITY DEFINER` with the locked path and qualified writes | rows land pending/needs_review only (publication block) |

## Role execution matrix (proven)

| Role | EXECUTE on staging RPC | Proof |
|------|------------------------|-------|
| `anon` | **denied** | `set local role anon` → call raises `insufficient_privilege` |
| `authenticated` | **denied** | `set local role authenticated` → call raises `insufficient_privilege` |
| `public` | **denied** | `has_function_privilege('public', …, 'EXECUTE')` = false |
| `service_role` | allowed | `has_function_privilege('service_role', …, 'EXECUTE')` = true |

`verify-db.mjs` also independently asserts `public`, `anon`, and `authenticated` lack EXECUTE
via `has_function_privilege` after the migration chain applies.

## Governed mapping table (`retail_external_location_mappings`)

- **RLS enabled, no anon/authenticated policy** — unreachable from client roles.
- **Unique approved mapping per branch** — `relm_one_approved_per_branch_uidx`; a second
  `approved` row for the same `(retailer_source_id, external_branch_id)` raises
  `unique_violation` (proven). Conflicting approved mappings cannot silently coexist.
- **Approved requires provenance** — `relm_approved_requires_metadata` CHECK; an `approved`
  row missing internal ids raises `check_violation` (proven). Internal MallMind ids can only
  ever originate from a fully-attributed, human-`approved` mapping.

## Publication boundary (proven, unchanged gate)

Scoped to rows this bridge created (`staged_actor is not null`):

- every staged observation is `review_status='pending'`, `trust_state <> 'verified'`,
  `verification_method is null`, `published_product_id is null`, `published_at is null`;
- no staged observation links to any shopper-facing `products` row;
- `publish_verified_observation(<a staged pending obs>, …)` **raises** — the existing
  publication gate refuses staged pending data. Staging is not a publication path.

## Hosted-execution safeguard

`src/lib/retail/feed/hostedGuard.mjs` + `scripts/retail/staging-guard.mjs` refuse any hosted
target before DB work runs. Covered by `hostedGuard.test.ts` (7/7): both known project refs
(`iivmrlgntspbkpfqoboi`, `qspsouemjtcdcfnivpnt`), `*.supabase.co/.in`, `pooler.supabase.com`,
and arbitrary non-local hosts are rejected; only local disposable hosts pass; a password in a
rejected URL is never echoed in the error. `MALLMIND_ALLOW_PROD` set → hard refusal.

## Explicit non-actions

No hosted connection, no credentials or service-role key used, no `supabase db push`, no
production/dev-cloud write, no Cloud Run / durable worker, no publication, no verification,
no scheduled ingestion. Local disposable Postgres only.
