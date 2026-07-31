# Security, Grant & Publication-Boundary Audit — Sprint 2M-A

**Remote posture: UNVERIFIED — blocked at the linked-project identity gate.** No hosted catalog
query was run against `qspsouemjtcdcfnivpnt`. The following is a **static** review of what
migration 039 asserts and requires, plus the exact read-only checks an operator linked to the
target must run. No function was called; no observation was staged; no product was published.

## Roles required by 039

| Role | Why 039 needs it | Expected remote state | Operator check |
|------|------------------|-----------------------|----------------|
| `service_role` | sole `EXECUTE` grantee of the staging RPC; bypasses RLS for retail writes | exists (Supabase-managed) | `select 1 from pg_roles where rolname='service_role'` |
| `anon` | must be **denied** EXECUTE on the RPC | exists | `has_function_privilege('anon', …,'EXECUTE')` = false |
| `authenticated` | must be **denied** EXECUTE on the RPC | exists | `has_function_privilege('authenticated', …,'EXECUTE')` = false |

## Grant posture 039 establishes (narrowing, never broadening)

From the migration source (verbatim intent):

```
revoke all on function public.stage_retail_feed_observation(…) from public;
revoke all on function public.stage_retail_feed_observation(…) from anon;
revoke all on function public.stage_retail_feed_observation(…) from authenticated;
grant execute on function public.stage_retail_feed_observation(…) to service_role;
```

- The only privilege *granted* is `EXECUTE` to `service_role`. Every other grant is a **revoke**.
- 039 therefore **narrows** access; it adds no broad grant and touches no existing object's grants.
- The new table has **RLS enabled** and **no** anon/authenticated policy → unreachable by client
  roles (same posture as the other `retail_*` tables).

Operator confirmation (read-only, target-linked):

```sql
-- RPC hardening
select proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname='stage_retail_feed_observation';           -- expect search_path locked
select has_function_privilege('public','public.stage_retail_feed_observation(uuid,uuid,text,text,text,text,text,text,text,text,text,bigint,bigint,boolean,text,text,text,text,text,text,text,timestamptz,text,integer,text,jsonb)','EXECUTE'),
       has_function_privilege('anon',  'public.stage_retail_feed_observation(…)','EXECUTE'),
       has_function_privilege('authenticated','public.stage_retail_feed_observation(…)','EXECUTE'),
       has_function_privilege('service_role','public.stage_retail_feed_observation(…)','EXECUTE');
-- RLS state of the new table
select relrowsecurity from pg_class where oid='public.retail_external_location_mappings'::regclass;  -- expect true
```

**NOTE:** the RPC/table do not exist remotely yet (039 is pre-apply). These checks apply
*after* a separately-approved apply, or now against dependency objects only.

## Direct-insert privilege on retail tables (pre-039)

Confirm ordinary roles cannot already write retail observations directly (the boundary must not
depend solely on 039):

```sql
select has_table_privilege('anon','public.retail_price_observations','INSERT'),
       has_table_privilege('authenticated','public.retail_price_observations','INSERT');   -- expect false / false
select relrowsecurity from pg_class where oid='public.retail_price_observations'::regclass; -- expect true
```

Also confirm **no similarly-named staging function already exists** (drift signal):

```sql
select p.proname, pg_get_function_identity_arguments(p.oid)
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname ~* 'stage|staging';
```

## Publication-boundary review (static — the gate 039 must not weaken)

039 **does not touch** `publish_verified_observation` and inserts observations only at
`review_status='pending'`, `trust_state='needs_review'`, `verification_method=null`,
`published_product_id=null`. The staging path is *not* a publication path. The existing gate
(migrations 027/036) still requires source rights approved + commercial/storage allowed +
`review_status='approved'` + shop∈mall before anything becomes shopper-visible.

Operator read-only confirmations (definitions only — **do not call** the functions):

```sql
-- publisher + verification function definitions unchanged / still strict
select pg_get_functiondef('public.publish_verified_observation'::regproc);
-- shopper-visible surface still gated on verified/published, never on 'pending'
select table_name from information_schema.views where table_schema='public' and table_name ilike '%product%';
```

Confirm the current hosted system still separates: staged/unverified observations → verification
→ publication → shopper-visible facts. Migration 039 is **designed to be compatible** with this
gate (it feeds the *pending* pool the gate already refuses).

## Conclusion

- Static: 039's security model is **least-privilege and boundary-preserving**; it narrows access
  and leaves the publication gate untouched.
- Remote: **UNVERIFIED** — roles, existing grants, RLS state, and the live publisher definition on
  the target could not be inspected from this environment → contributes to `NO-GO` until the
  operator completes the checks above.
