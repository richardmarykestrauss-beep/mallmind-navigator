# Rollback-Readiness Review — Sprint 2M-A

Static review of `supabase/rollback/039_retail_feed_staging_bridge_rollback.sql` against the
repository's pre-039 expected schema. **Not executed** anywhere. No hosted contact.

## Rollback contents (verbatim intent)

```sql
drop function if exists public.stage_retail_feed_observation(uuid,uuid,text,text,text,text,text,
  text,text,text,text,bigint,bigint,boolean,text,text,text,text,text,text,text,timestamptz,text,
  integer,text,jsonb);

alter table public.retail_price_observations
  drop column if exists branch_external_id,
  drop column if exists feed_content_hash,
  drop column if exists feed_source_row,
  drop column if exists feed_file_name,
  drop column if exists feed_parse_warnings,
  drop column if exists staged_actor;

drop table if exists public.retail_external_location_mappings;
```

## Assessment

| Requirement | Result | Notes |
|-------------|--------|-------|
| Removes only 039 objects | **yes** | function + 6 columns + mapping table; exact 26-arg signature targeted |
| Preserves pre-existing retail tables | **yes** | `retail_price_observations` / `retail_source_listings` themselves are untouched |
| Preserves previous migrations' objects | **yes** | no drop of any ≤038 object |
| Avoids deleting shopper/product data | **yes** | drops no data table; `products` untouched |
| Avoids removing older functions | **yes** | only the 039 RPC is dropped |
| Handles partial-apply state | **yes** | every statement is `if exists` / `drop column if exists` → tolerant of partial application |
| Signature-exact function drop | **yes** | avoids dropping an unrelated overload |

## Data-loss note (expected and documented)

Dropping the six additive columns discards feed provenance (`feed_content_hash`,
`branch_external_id`, `staged_actor`, etc.) for any rows staged before the rollback. The **core**
observation/listing rows survive (only the added columns are removed). If any pending staged rows
exist at rollback time, export them first. On a clean pre-039 remote (the expected state) there
are no staged rows, so this is moot.

## Ordering / dependency safety

Drop order is correct: the function first (it references the columns/table), then the columns,
then the mapping table last. No FK from older tables points **into** the mapping table, so its
drop cannot cascade into pre-existing data. The mapping table's own FKs use
`on delete cascade`/`set null` *inbound* only from itself.

## Classification

**Rollback readiness: READY WITH CONDITIONS.**

Conditions:
1. Confirm (read-only, target-linked) that no other object depends on the six columns before drop.
2. If any staged pending rows exist at rollback time, export them first (feed-provenance columns
   are dropped).
3. Rollback presupposes the remote pre-039 baseline matches the repository — currently
   **UNVERIFIED** from this environment.
