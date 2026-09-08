# Migration Chain Report — Sprint 2L-B

Migration 039 is **additive and append-only** (next number after 038). It was proven to apply
from an empty database as part of the full chain `000 … 039` on a disposable local Postgres,
twice, for repeatability.

## How it is proven

`npm run verify:db` (`scripts/build-os/verify-db.mjs`):

1. boots / resets the disposable Supabase local stack and applies **every** migration in order
   (no linked project, no `db push`);
2. asserts a migration/table/function/policy contract count;
3. asserts the 039 schema (mapping table exists; RPC exists; the 6 added observation columns
   exist; `public`/`anon`/`authenticated` lack EXECUTE on the RPC);
4. pipes `retail-036-fixture.sql` then `retail-staging-fixture.sql` into
   `docker exec … psql -v ON_ERROR_STOP=1` — any failed assertion aborts the run non-zero.

## Result (both runs identical)

```
database verification passed | migrations=40 | tables=55 | functions=45 | policies=24
retail-staging-fixture: ALL STAGING / IDEMPOTENCY / MAPPING / SECURITY / PUBLICATION-BOUNDARY CASES PASSED
✔ DATABASE VERIFICATION PASSED
```

(`migrations=40` counts the 000-based chain through 039 inclusive.)

## What 039 changes vs. does not change

**Adds:** one governed table (`retail_external_location_mappings`), six nullable columns on
`retail_price_observations`, one `service_role`-only SECURITY DEFINER function
(`stage_retail_feed_observation`).

**Does not touch:** any existing column type, existing RLS policy, the
`publish_verified_observation` gate, or any real retailer data. No column is dropped or
retyped; `036`'s nullable `mall_id`/`shop_id` and scope/identity columns are reused as-is.

## Reversibility

`supabase/rollback/039_retail_feed_staging_bridge_rollback.sql` drops the function, the six
added columns, and the mapping table. Not auto-executed. Core observation/listing rows survive
a rollback (only the six additive feed columns are removed).

## Boundary

This report attests a **local disposable** apply only. Migration 039 has **not** been applied
to `mallmind-dev` (`iivmrlgntspbkpfqoboi`) or production (`qspsouemjtcdcfnivpnt`); no hosted
migration history was read or written. Hosted application, if ever pursued, is a separate,
operator-run, human-approved step outside Sprint 2L-B.
