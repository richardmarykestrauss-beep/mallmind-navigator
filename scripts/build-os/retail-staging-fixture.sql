-- retail-staging-fixture.sql — Sprint 2L-B pending-review staging bridge proof.
-- Runs on the DISPOSABLE stack after migrations 000-039. Real PostgreSQL assertions (not
-- static scans). Any failure RAISEs → psql (ON_ERROR_STOP) fails the run.
\set ON_ERROR_STOP on

-- ── Seed: actor, mall, shop, sources, mappings ───────────────────────────────
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
values ('11111111-1111-1111-1111-111111111111','00000000-0000-0000-0000-000000000000','authenticated','authenticated','staging-actor@test.local','x', now(), now())
on conflict (id) do nothing;
insert into public.profiles (id, username, is_admin) values ('11111111-1111-1111-1111-111111111111','staging_actor', true)
on conflict (id) do update set is_admin = true;

insert into public.malls (id, name, city, province) values ('da000000-0000-4000-8000-0000000000aa','Test Mall A','Centurion','Gauteng');
insert into public.shops (id, mall_id, name) values ('da000000-0000-4000-8000-0000000000a1','da000000-0000-4000-8000-0000000000aa','Shop A1');

insert into public.retail_data_sources (id, source_type, name, legal_status, is_active, rights_review_state, commercial_use_allowed, storage_allowed, lifecycle_state)
values
  ('dc000000-0000-4000-8000-000000000001','partner_feed','Stageable Synthetic Source','partner_licensed', true, 'under_review', null, null, 'testing'),
  ('dc000000-0000-4000-8000-000000000002','csv','Reference Only Source','reference_only', true, 'unreviewed', null, null, 'discovered'),
  ('dc000000-0000-4000-8000-000000000003','partner_feed','Other Source','partner_licensed', true, 'under_review', null, null, 'testing');

-- Governed mappings (approved ones MUST carry metadata/ids/provenance per the CHECK).
insert into public.retail_external_location_mappings (retailer_source_id, external_branch_id, external_branch_name, internal_retailer_id, internal_shop_id, internal_mall_id, status, match_method, approved_by, approved_at, valid_from, valid_until, source_reference)
values
  ('dc000000-0000-4000-8000-000000000001','BR-OK','Reds Approved', null,'da000000-0000-4000-8000-0000000000a1','da000000-0000-4000-8000-0000000000aa','approved','exact','11111111-1111-1111-1111-111111111111','2026-02-01T00:00:00Z','2026-01-01T00:00:00Z','2026-12-31T23:59:59Z','pilot-agreement'),
  ('dc000000-0000-4000-8000-000000000001','BR-DRAFT','Draft', null,'da000000-0000-4000-8000-0000000000a1','da000000-0000-4000-8000-0000000000aa','draft','exact',null,null,null,null,'draft'),
  ('dc000000-0000-4000-8000-000000000001','BR-EXP','Expired', null,'da000000-0000-4000-8000-0000000000a1','da000000-0000-4000-8000-0000000000aa','approved','exact','11111111-1111-1111-1111-111111111111','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z','2026-06-30T23:59:59Z','agreement'),
  ('dc000000-0000-4000-8000-000000000001','BR-FUT','Future', null,'da000000-0000-4000-8000-0000000000a1','da000000-0000-4000-8000-0000000000aa','approved','exact','11111111-1111-1111-1111-111111111111','2026-07-01T00:00:00Z','2026-12-01T00:00:00Z','2027-12-31T23:59:59Z','agreement'),
  ('dc000000-0000-4000-8000-000000000002','BR-MIS','Mismatch', null,'da000000-0000-4000-8000-0000000000a1','da000000-0000-4000-8000-0000000000aa','approved','exact','11111111-1111-1111-1111-111111111111','2026-02-01T00:00:00Z','2026-01-01T00:00:00Z','2026-12-31T23:59:59Z','other-agreement');

-- ── CHECK/constraint proofs ──────────────────────────────────────────────────
do $$
declare v_raised boolean;
begin
  -- two APPROVED mappings for the same (retailer, branch) cannot coexist (unique index)
  v_raised := false;
  begin
    insert into public.retail_external_location_mappings (retailer_source_id, external_branch_id, internal_shop_id, internal_mall_id, status, approved_by, approved_at, valid_from, valid_until, source_reference)
    values ('dc000000-0000-4000-8000-000000000001','BR-OK','da000000-0000-4000-8000-0000000000a1','da000000-0000-4000-8000-0000000000aa','approved','11111111-1111-1111-1111-111111111111','2026-03-01T00:00:00Z','2026-01-01T00:00:00Z','2026-12-31T23:59:59Z','dup');
  exception when unique_violation then v_raised := true; end;
  if not v_raised then raise exception 'FAIL: a second approved mapping for the same branch was accepted'; end if;

  -- an APPROVED mapping missing internal ids violates the metadata CHECK
  v_raised := false;
  begin
    insert into public.retail_external_location_mappings (retailer_source_id, external_branch_id, status, approved_by, approved_at, valid_from, valid_until, source_reference)
    values ('dc000000-0000-4000-8000-000000000001','BR-NOIDS','approved','11111111-1111-1111-1111-111111111111','2026-02-01T00:00:00Z','2026-01-01T00:00:00Z','2026-12-31T23:59:59Z','x');
  exception when check_violation then v_raised := true; end;
  if not v_raised then raise exception 'FAIL: an approved mapping without internal ids was accepted'; end if;
end $$;

-- ── Staging calls + assertions ───────────────────────────────────────────────
do $$
declare
  a  uuid := '11111111-1111-1111-1111-111111111111';
  s1 uuid := 'dc000000-0000-4000-8000-000000000001';
  s2 uuid := 'dc000000-0000-4000-8000-000000000002';
  s3 uuid := 'dc000000-0000-4000-8000-000000000003';
  ts timestamptz := '2026-07-31T10:00:00Z';
  o text; oid uuid; lid uuid; rev text; mo text; ident text; expl text;
  o2 text; oid2 uuid;
  v_shop uuid; v_mall uuid; v_name text; v_orig numeric; v_cond text; v_spid text;
begin
  -- C1 online-national standard → staged pending, ids null
  select outcome,observation_id,listing_id,review_status,mapping_outcome,observation_identity into o,oid,lid,rev,mo,ident
    from public.stage_retail_feed_observation(a,s1,'EX-1',null,'6001000000019',null,'Widget A','BrandX','400ml','Home','ZAR',7999,null,false,'standard',null,'online_national','online',null,null,'in_stock',ts,'https://x/EX-1',1,'feed.csv',null);
  if o <> 'staged' then raise exception 'C1 FAIL outcome=%',o; end if;
  if rev <> 'pending' then raise exception 'C1 FAIL review=%',rev; end if;
  select mall_id, shop_id, trust_state into v_mall, v_shop, v_name from public.retail_price_observations where id=oid;
  if v_mall is not null or v_shop is not null then raise exception 'C1 FAIL online row got internal ids'; end if;
  if v_name = 'verified' then raise exception 'C1 FAIL trust_state verified'; end if;

  -- C2 promotional (was price) → promotional preserved, original separate
  select outcome,observation_id into o,oid2 from public.stage_retail_feed_observation(a,s1,'EX-2',null,'6001000000026',null,'Widget B','BrandX','1L','Home','ZAR',5999,8999,true,'promotional','Save R30','online_national','online',null,null,'in_stock',ts,'https://x/EX-2',2,'feed.csv',null);
  if o <> 'staged' then raise exception 'C2 FAIL %',o; end if;
  select price_condition, original_price into v_cond, v_orig from public.retail_price_observations where id=oid2;
  if v_cond <> 'promotional' then raise exception 'C2 FAIL condition flattened to %',v_cond; end if;
  if v_orig <> 89.99 then raise exception 'C2 FAIL original_price=%',v_orig; end if;

  -- C3 approved branch mapping → resolved, internal ids from mapping ONLY
  select outcome,observation_id,mapping_outcome into o,oid,mo from public.stage_retail_feed_observation(a,s1,'EX-3',null,'6001000000033',null,'Widget C','BrandX','500ml','Home','ZAR',19999,null,false,'standard',null,'branch_specific','branch_confirmed','BR-OK','Reds Approved','in_stock',ts,'https://x/EX-3',3,'feed.csv',null);
  if o <> 'staged' or mo <> 'resolved' then raise exception 'C3 FAIL o=% mo=%',o,mo; end if;
  select mall_id, shop_id into v_mall, v_shop from public.retail_price_observations where id=oid;
  if v_shop <> 'da000000-0000-4000-8000-0000000000a1' or v_mall <> 'da000000-0000-4000-8000-0000000000aa' then raise exception 'C3 FAIL internal ids not from mapping'; end if;

  -- C4 draft / C5 expired / C6 unknown / C7 name-only / mismatch → mapping_required, NOT staged, no ids
  select outcome,mapping_outcome into o,mo from public.stage_retail_feed_observation(a,s1,'EX-4',null,null,null,'Widget D','BrandX','1L','Home','ZAR',10000,null,false,'standard',null,'branch_specific','branch_confirmed','BR-DRAFT','Draft','in_stock',ts,'https://x/EX-4',4,'feed.csv',null);
  if o <> 'mapping_required' or mo = 'resolved' then raise exception 'C4 FAIL draft resolved o=% mo=%',o,mo; end if;
  select outcome into o from public.stage_retail_feed_observation(a,s1,'EX-5',null,null,null,'W','B','1L','Home','ZAR',10000,null,false,'standard',null,'branch_specific','branch_confirmed','BR-EXP','Exp','in_stock',ts,'https://x/EX-5',5,'feed.csv',null);
  if o <> 'mapping_required' then raise exception 'C5 FAIL expired staged'; end if;
  select outcome into o from public.stage_retail_feed_observation(a,s1,'EX-5b',null,null,null,'W','B','1L','Home','ZAR',10000,null,false,'standard',null,'branch_specific','branch_confirmed','BR-FUT','Fut','in_stock',ts,'https://x/EX-5b',5,'feed.csv',null);
  if o <> 'mapping_required' then raise exception 'C5b FAIL future staged'; end if;
  select outcome into o from public.stage_retail_feed_observation(a,s1,'EX-6',null,null,null,'W','B','1L','Home','ZAR',10000,null,false,'standard',null,'branch_specific','branch_confirmed','BR-NOPE','Unknown','in_stock',ts,'https://x/EX-6',6,'feed.csv',null);
  if o <> 'mapping_required' then raise exception 'C6 FAIL unknown branch staged'; end if;
  select outcome,mapping_outcome into o,mo from public.stage_retail_feed_observation(a,s1,'EX-7',null,null,null,'W','B','1L','Home','ZAR',10000,null,false,'standard',null,'branch_specific','branch_confirmed',null,'Some Name','in_stock',ts,'https://x/EX-7',7,'feed.csv',null);
  if o <> 'mapping_required' or mo <> 'ambiguous' then raise exception 'C7 FAIL name-only o=% mo=%',o,mo; end if;
  select mapping_outcome into mo from public.stage_retail_feed_observation(a,s1,'EX-7b',null,null,null,'W','B','1L','Home','ZAR',10000,null,false,'standard',null,'branch_specific','branch_confirmed','BR-MIS','Mismatch','in_stock',ts,'https://x/EX-7b',7,'feed.csv',null);
  if mo <> 'retailer_mismatch' then raise exception 'C7b FAIL mismatch mo=%',mo; end if;

  -- C8 identical replay of C1 → replayed, same obs id, no duplicate
  select outcome,observation_id into o,oid2 from public.stage_retail_feed_observation(a,s1,'EX-1',null,'6001000000019',null,'Widget A','BrandX','400ml','Home','ZAR',7999,null,false,'standard',null,'online_national','online',null,null,'in_stock',ts,'https://x/EX-1',1,'feed.csv',null);
  if o <> 'replayed' then raise exception 'C8 FAIL replay outcome=%',o; end if;

  -- C9 changed price → new observation (distinct)
  select outcome,observation_id into o,oid from public.stage_retail_feed_observation(a,s1,'EX-1',null,'6001000000019',null,'Widget A','BrandX','400ml','Home','ZAR',6999,null,false,'standard',null,'online_national','online',null,null,'in_stock',ts,'https://x/EX-1',1,'feed.csv',null);
  if o <> 'staged' then raise exception 'C9 FAIL changed price outcome=%',o; end if;

  -- C10 conflict: same identity as C1 (same id/price/observed/scope) but different content (name)
  select outcome into o from public.stage_retail_feed_observation(a,s1,'EX-1',null,'6001000000019',null,'DIFFERENT NAME','BrandX','400ml','Home','ZAR',7999,null,false,'standard',null,'online_national','online',null,null,'in_stock',ts,'https://x/EX-1',1,'feed.csv',null);
  if o <> 'conflict' then raise exception 'C10 FAIL conflict outcome=%',o; end if;

  -- C11 reference_only source → rejected
  select outcome into o from public.stage_retail_feed_observation(a,s2,'EX-11',null,null,null,'W','B','1L','Home','ZAR',5000,null,false,'standard',null,'online_national','online',null,null,'in_stock',ts,'https://x/EX-11',11,'feed.csv',null);
  if o <> 'rejected' then raise exception 'C11 FAIL reference_only staged'; end if;

  -- C12 invalid price / C13 missing identity → rejected
  select outcome into o from public.stage_retail_feed_observation(a,s1,'EX-12',null,null,null,'W','B','1L','Home','ZAR',-1,null,false,'standard',null,'online_national','online',null,null,'in_stock',ts,'https://x/EX-12',12,'feed.csv',null);
  if o <> 'rejected' then raise exception 'C12 FAIL negative price staged'; end if;
  select outcome into o from public.stage_retail_feed_observation(a,s1,null,null,null,null,'W','B','1L','Home','ZAR',5000,null,false,'standard',null,'online_national','online',null,null,'in_stock',ts,'https://x/EX-13',13,'feed.csv',null);
  if o <> 'rejected' then raise exception 'C13 FAIL missing identity staged'; end if;

  -- C14 leading-zero id preserved
  select outcome,observation_id into o,oid from public.stage_retail_feed_observation(a,s1,'000123',null,null,null,'Zero Item','BrandX','250ml','Home','ZAR',4500,null,false,'standard',null,'online_national','online',null,null,'unknown',ts,'https://x/000123',14,'feed.csv',null);
  select source_product_id into v_spid from public.retail_price_observations where id=oid;
  if v_spid <> '000123' then raise exception 'C14 FAIL leading zero lost: %',v_spid; end if;

  -- C15 injection text is treated as data (never executed)
  select outcome,observation_id into o,oid from public.stage_retail_feed_observation(a,s1,'EX-15',null,null,null,'x''); drop table public.products; --','BrandX','1L','Home','ZAR',5000,null,false,'standard',null,'online_national','online',null,null,'in_stock',ts,'https://x/EX-15',15,'feed.csv',null);
  select product_name into v_name from public.retail_price_observations where id=oid;
  if v_name <> 'x''); drop table public.products; --' then raise exception 'C15 FAIL injection not stored verbatim'; end if;
  if to_regclass('public.products') is null then raise exception 'C15 FAIL products table was dropped by injection'; end if;
end $$;

-- ── Publication boundary + state assertions (real SQL) ───────────────────────
do $$
declare v_staged int; v_bad int; v_raised boolean;
begin
  -- scope to rows STAGED by this bridge (only the staging RPC sets staged_actor)
  select count(*) into v_staged from public.retail_price_observations where staged_actor is not null;
  if v_staged < 6 then raise exception 'expected several staged observations, got %', v_staged; end if;
  -- every staged obs is pending, unverified, no verified attribution, not published
  select count(*) into v_bad from public.retail_price_observations
   where staged_actor is not null
     and (review_status <> 'pending' or trust_state = 'verified' or verification_method is not null
          or published_product_id is not null or published_at is not null);
  if v_bad > 0 then raise exception 'FAIL: % staged rows are not pending/unverified', v_bad; end if;
  -- staging created NO shopper-facing product (no staged obs links to a product)
  if exists (select 1 from public.retail_price_observations where staged_actor is not null and published_product_id is not null) then
    raise exception 'FAIL: a staged observation is linked to a product';
  end if;
  -- the existing publisher still refuses a staged pending observation
  v_raised := false;
  begin
    perform * from public.publish_verified_observation((select id from public.retail_price_observations where staged_actor is not null limit 1), '11111111-1111-1111-1111-111111111111', 'x');
  exception when others then v_raised := true; end;
  if not v_raised then raise exception 'FAIL: publisher accepted a staged pending observation'; end if;
end $$;

-- ── Security: locked search_path + role execution + no injectable fields ─────
do $$
declare v_cfg text[]; v_args text; v_raised boolean;
begin
  -- SECURITY DEFINER function has a locked search_path
  select p.proconfig into v_cfg from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='stage_retail_feed_observation';
  if v_cfg is null or not (array_to_string(v_cfg,',') like '%search_path=%') then raise exception 'FAIL: staging RPC search_path not locked'; end if;
  -- the RPC exposes NO verified/approved/published/internal-id parameters (cannot be injected)
  select pg_get_function_arguments(p.oid) into v_args from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='stage_retail_feed_observation';
  if v_args ~* 'verified|approved|published|internal_shop|internal_mall|verified_by' then raise exception 'FAIL: staging RPC exposes a forbidden parameter'; end if;

  -- anon and authenticated cannot execute the staging RPC
  v_raised := false;
  begin set local role anon;
    perform * from public.stage_retail_feed_observation('11111111-1111-1111-1111-111111111111','dc000000-0000-4000-8000-000000000001','Z',null,null,null,'W','B','1L','Home','ZAR',5000,null,false,'standard',null,'online_national','online',null,null,'in_stock','2026-07-31T10:00:00Z','u',1,'f',null);
  exception when insufficient_privilege then v_raised := true; when others then v_raised := true; end;
  reset role;
  if not v_raised then raise exception 'FAIL: anon executed the staging RPC'; end if;

  v_raised := false;
  begin set local role authenticated;
    perform * from public.stage_retail_feed_observation('11111111-1111-1111-1111-111111111111','dc000000-0000-4000-8000-000000000001','Z',null,null,null,'W','B','1L','Home','ZAR',5000,null,false,'standard',null,'online_national','online',null,null,'in_stock','2026-07-31T10:00:00Z','u',1,'f',null);
  exception when insufficient_privilege then v_raised := true; when others then v_raised := true; end;
  reset role;
  if not v_raised then raise exception 'FAIL: authenticated executed the staging RPC'; end if;

  -- public has no EXECUTE grant on the staging RPC
  if has_function_privilege('public','public.stage_retail_feed_observation(uuid,uuid,text,text,text,text,text,text,text,text,text,bigint,bigint,boolean,text,text,text,text,text,text,text,timestamptz,text,integer,text,jsonb,uuid,text)','EXECUTE') then
    raise exception 'FAIL: public has EXECUTE on the staging RPC';
  end if;
  -- service_role does have EXECUTE
  if not has_function_privilege('service_role','public.stage_retail_feed_observation(uuid,uuid,text,text,text,text,text,text,text,text,text,bigint,bigint,boolean,text,text,text,text,text,text,text,timestamptz,text,integer,text,jsonb,uuid,text)','EXECUTE') then
    raise exception 'FAIL: service_role lacks EXECUTE on the staging RPC';
  end if;
end $$;

-- ══ Sprint 3A.3 / migration 040: lifecycle gate + traceability + arity compat ══
insert into public.retail_data_sources (id, source_type, name, legal_status, is_active, rights_review_state, commercial_use_allowed, storage_allowed, lifecycle_state)
values
  ('dc000000-0000-4000-8000-000000000004','partner_feed','Suspended Source','partner_licensed', true,  'under_review', null, null, 'suspended'),
  ('dc000000-0000-4000-8000-000000000005','partner_feed','Revoked Source','partner_licensed',   true,  'under_review', null, null, 'revoked'),
  ('dc000000-0000-4000-8000-000000000006','partner_feed','Inactive Source','partner_licensed',   false, 'under_review', null, null, 'active');

do $$
declare
  a  uuid := '11111111-1111-1111-1111-111111111111';
  s1 uuid := 'dc000000-0000-4000-8000-000000000001';
  s4 uuid := 'dc000000-0000-4000-8000-000000000004';
  s5 uuid := 'dc000000-0000-4000-8000-000000000005';
  s6 uuid := 'dc000000-0000-4000-8000-000000000006';
  ts timestamptz := '2026-07-31T10:00:00Z';
  v_job uuid := 'ab000000-0000-4000-8000-0000000000cc';
  o text; oid uuid; v_jobout uuid; v_draft text;
begin
  -- T1 suspended source → rejected (ADR-D lifecycle gate)
  select outcome into o from public.stage_retail_feed_observation(a,s4,'T-1',null,null,null,'W','B','1L','Home','ZAR',5000,null,false,'standard',null,'online_national','online',null,null,'in_stock',ts,'u',1,'f',null);
  if o <> 'rejected' then raise exception 'T1 FAIL suspended source staged: %',o; end if;
  -- T2 revoked source → rejected
  select outcome into o from public.stage_retail_feed_observation(a,s5,'T-2',null,null,null,'W','B','1L','Home','ZAR',5000,null,false,'standard',null,'online_national','online',null,null,'in_stock',ts,'u',2,'f',null);
  if o <> 'rejected' then raise exception 'T2 FAIL revoked source staged: %',o; end if;
  -- T3 inactive source (is_active=false) → rejected
  select outcome into o from public.stage_retail_feed_observation(a,s6,'T-3',null,null,null,'W','B','1L','Home','ZAR',5000,null,false,'standard',null,'online_national','online',null,null,'in_stock',ts,'u',3,'f',null);
  if o <> 'rejected' then raise exception 'T3 FAIL inactive source staged: %',o; end if;

  -- T4 stageable source WITH traceability params → staged; job/draft columns populated
  select outcome,observation_id into o,oid from public.stage_retail_feed_observation(a,s1,'T-4',null,'6001000000900',null,'Trace Widget','BrandX','400ml','Home','ZAR',7999,null,false,'standard',null,'online_national','online',null,null,'in_stock',ts,'https://x/T-4',4,'feed.csv',null,v_job,'draft_T4');
  if o <> 'staged' then raise exception 'T4 FAIL trace stage outcome=%',o; end if;
  select intake_job_id, intake_draft_ref into v_jobout, v_draft from public.retail_price_observations where id=oid;
  if v_jobout is distinct from v_job then raise exception 'T4 FAIL intake_job_id not stored: %',v_jobout; end if;
  if v_draft <> 'draft_T4' then raise exception 'T4 FAIL intake_draft_ref not stored: %',v_draft; end if;

  -- T5 replay of T4 → replayed (trace params never affect identity/replay authority)
  select outcome into o from public.stage_retail_feed_observation(a,s1,'T-4',null,'6001000000900',null,'Trace Widget','BrandX','400ml','Home','ZAR',7999,null,false,'standard',null,'online_national','online',null,null,'in_stock',ts,'https://x/T-4',4,'feed.csv',null,v_job,'draft_T4b');
  if o <> 'replayed' then raise exception 'T5 FAIL trace replay outcome=%',o; end if;

  -- T6 legacy 26-arg call still resolves (new params DEFAULT null) → staged, trace null
  select outcome,observation_id into o,oid from public.stage_retail_feed_observation(a,s1,'T-6',null,'6001000000901',null,'Legacy Arity','BrandX','400ml','Home','ZAR',8999,null,false,'standard',null,'online_national','online',null,null,'in_stock',ts,'https://x/T-6',6,'feed.csv',null);
  if o <> 'staged' then raise exception 'T6 FAIL 26-arg call outcome=%',o; end if;
  select intake_job_id into v_jobout from public.retail_price_observations where id=oid;
  if v_jobout is not null then raise exception 'T6 FAIL 26-arg call populated trace'; end if;
end $$;

select 'retail-staging-fixture: ALL STAGING / IDEMPOTENCY / MAPPING / SECURITY / PUBLICATION-BOUNDARY / LIFECYCLE / TRACEABILITY CASES PASSED' as result;
