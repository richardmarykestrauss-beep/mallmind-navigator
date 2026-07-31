# Migration 039 Collision & Compatibility Review — Sprint 2M-A

This is a **static** review of `supabase/migrations/039_retail_feed_staging_bridge.sql` against
the repository's pre-039 expected schema (migrations `000–038`). It was performed by reading
source only — **no hosted execution, no dry-run against the target** (identity gate; see
[hosted-project-identity-audit.md](hosted-project-identity-audit.md)). Every remote-confirmation
column below is therefore **UNVERIFIED** and must be checked by an operator linked to the target.

## Idempotency posture of 039 (reduces, does not remove, collision risk)

039 uses `create table if not exists`, `create unique index if not exists`,
`add column if not exists`, and `create or replace function`. So on a partially-populated schema
it will **not hard-error**. This is a safety property for re-runs, but it also means a
*pre-existing unrecorded* object would be silently tolerated — which is exactly why the drift
audit must confirm none of the 039 objects exist before it is recorded as applied.

## Create/alter operations vs collision risk

| # | Operation | Collision surface | Static risk | Remote check (operator) |
|---|-----------|-------------------|-------------|-------------------------|
| 1 | `create table retail_external_location_mappings` | table name in `public` | low (`if not exists`) | table absent pre-039 |
| 2 | FKs → `retail_data_sources(id)`, `shops(id)`, `malls(id)` | referenced tables/PKs must exist | low | those tables + PKs exist |
| 3 | 4 check constraints (`relm_*`) | constraint names on the new table | none (new table) | n/a |
| 4 | `create unique index relm_one_approved_per_branch_uidx` | index name in `public` | low (`if not exists`) | index absent pre-039 |
| 5 | `alter table retail_price_observations add column … ×6` (all nullable, no default) | 6 column names | low (`if not exists`, nullable) | columns absent pre-039; **no table rewrite** (nullable, no volatile default) |
| 6 | `create or replace function stage_retail_feed_observation(26-arg signature)` | exact function signature | low | no pre-existing function with the identical 26-arg signature |
| 7 | `revoke … from public/anon/authenticated`, `grant execute … to service_role` | grants on the new function | none (narrowing) | `service_role` role exists |
| 8 | `enable row level security` on the new table | RLS on new table | none | n/a |

### Named-object collision checklist (operator verifies remotely)

- table-name collision — `retail_external_location_mappings` must not pre-exist;
- function-signature collision — no existing `stage_retail_feed_observation(...)` with the same
  26-arg signature; a *differently-signed* same-named function would coexist (overload) and
  should be flagged;
- column-name collision — the 6 new columns must not pre-exist with an **incompatible type**
  (they are `text/integer/jsonb/uuid`; a pre-existing same-named column of another type is a
  blocker — `add column if not exists` would keep the existing type and the RPC insert could
  fail);
- index/constraint-name collision — `relm_*` names are new-table-scoped, low risk;
- enum/check incompatibility — 039 introduces no enum; checks apply only to the new table;
- role absence — `service_role` must exist (Supabase-managed; expected present);
- unexpected existing grants — confirm no broader pre-existing grant on a same-named function.

## Dependency compatibility (expected object → expected shape)

| Dependency | Expected key columns / shape | Migration impact if missing/incompatible |
|------------|------------------------------|-------------------------------------------|
| `retail_data_sources` | `id uuid pk`, `legal_status`, `rights_review_state` | RPC rights gate + FK fail |
| `retail_source_listings` | `(source_id, source_product_id)` partial unique | RPC upsert `on conflict` fails |
| `retail_price_observations` | `observation_hash`, `review_status`, `trust_state`, `verification_method`, `price_scope`, `availability_scope`, `price_condition(_label)`, nullable `mall_id`/`shop_id` | RPC insert / idempotency fails |
| `publish_verified_observation` | unchanged gate | boundary relies on it staying strict |
| `malls`, `shops` | `id uuid pk` | FK creation fails |
| `admin_audit_log` | `admin_id, action, table_name, row_id, new_values(jsonb)` | audit insert fails |
| `gen_random_uuid()` | available | table default fails |

## Existing-data compatibility (read-only aggregates — operator to run)

039 adds **only nullable columns with no default** and creates constraints **only on the new
(empty) table**. It adds **no** new constraint to `retail_price_observations`. Therefore:

- No `ALTER TABLE` on `retail_price_observations` can fail on existing rows (nullable adds).
- The new unique index is on a brand-new empty table → no duplicate-key risk from legacy data.
- No legacy value can violate a new constraint (no new constraint on existing tables).

Suggested read-only confirmations (aggregate counts only, **no row content**):

```sql
-- new columns must not already exist with an incompatible type
select column_name, data_type from information_schema.columns
 where table_schema='public' and table_name='retail_price_observations'
   and column_name in ('branch_external_id','feed_content_hash','feed_source_row',
                       'feed_file_name','feed_parse_warnings','staged_actor');
-- the 039 objects must not already exist
select to_regclass('public.retail_external_location_mappings') as mapping_table,
       to_regclass('public.relm_one_approved_per_branch_uidx') as approved_idx;
select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname='stage_retail_feed_observation';
```

## Lock & operational-risk assessment (static)

| Operation | Lock behaviour | Risk |
|-----------|----------------|------|
| `create table` / `create index` on the **new empty** table | brief, on a table with no rows | **low** |
| `add column … ×6` nullable, no default | Postgres ≥11 metadata-only, **no table rewrite** | **low** |
| `create or replace function` | short `ACCESS EXCLUSIVE` on the function only | **low** |
| `enable rls` on the new table | new table only | **low** |

- No table rewrite; no long-held lock on `retail_price_observations`; no data backfill.
- Transaction duration expected short; exact runtime not claimed.
- **Overall estimated operational risk: LOW** — *conditional on the remote pre-039 schema
  matching the baseline*, which is currently UNVERIFIED.

## Rollback compatibility

The rollback drops exactly the 039 objects (function, 6 columns, mapping table) and nothing
older — reviewed in [rollback-readiness-review.md](rollback-readiness-review.md).

## Verdict contribution

Statically, migration 039 is **additive, non-rewriting, narrowing-in-privilege, and
low-lock-risk**, and would apply cleanly onto the expected pre-039 baseline. It cannot be cleared
for the hosted window because the remote pre-039 schema and history are **UNVERIFIED** from this
environment → contributes to overall `NO-GO` pending the operator checks above.
