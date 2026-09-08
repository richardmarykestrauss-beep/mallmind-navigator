-- retail-036-fixture.sql — Sprint 2I truth-model proof (runs on the DISPOSABLE stack,
-- after migrations 000-036, inside verify:db). Read-mutations against throwaway data only.
-- Proves the ten hard cases. Any failed assertion RAISEs → psql (ON_ERROR_STOP) fails verify:db.
\set ON_ERROR_STOP on

-- ── Seed: admin (auth user + profile), two malls, two shops, two sources ──────
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
values ('11111111-1111-1111-1111-111111111111','00000000-0000-0000-0000-000000000000','authenticated','authenticated','admin036@test.local','x', now(), now())
on conflict (id) do nothing;
insert into public.profiles (id, username, is_admin)
values ('11111111-1111-1111-1111-111111111111','admin036', true)
on conflict (id) do update set is_admin = true;

insert into public.malls (id, name, city, province) values
  ('aaaaaaaa-0000-0000-0000-000000000001','Test Mall A','Centurion','Gauteng'),
  ('bbbbbbbb-0000-0000-0000-000000000002','Test Mall B','Centurion','Gauteng');
insert into public.shops (id, mall_id, name) values
  ('a1a1a1a1-0000-0000-0000-0000000000a1','aaaaaaaa-0000-0000-0000-000000000001','Shop A'),
  ('b2b2b2b2-0000-0000-0000-0000000000b2','bbbbbbbb-0000-0000-0000-000000000002','Shop B');

insert into public.retail_data_sources
  (id, source_type, name, legal_status, is_active, rights_review_state, commercial_use_allowed, storage_allowed, lifecycle_state)
values
  ('cccccccc-0000-0000-0000-000000000001','partner_feed','Approved Source','partner_licensed', true, 'approved', true, true, 'active'),
  ('dddddddd-0000-0000-0000-000000000002','partner_feed','Unreviewed Source','partner_licensed', true, 'unreviewed', null, null, 'discovered');

-- ══ CASE 7: barcode preserves leading zeros (TEXT) ════════════════════════════
insert into public.retail_source_listings (source_id, source_product_id, barcode)
values ('cccccccc-0000-0000-0000-000000000001','SP-1','0001234500009');
do $$ begin
  if (select barcode from public.retail_source_listings where source_id='cccccccc-0000-0000-0000-000000000001' and source_product_id='SP-1') <> '0001234500009'
  then raise exception 'CASE7 FAIL: barcode leading zeros not preserved'; end if;
end $$;

-- ══ CASE 8: repeated source identifiers dedupe (unique per source) ════════════
do $$
declare v_raised boolean := false;
begin
  begin
    insert into public.retail_source_listings (source_id, source_product_id, barcode)
    values ('cccccccc-0000-0000-0000-000000000001','SP-1','9999');
  exception when unique_violation then v_raised := true;
  end;
  if not v_raised then raise exception 'CASE8 FAIL: duplicate (source, source_product_id) was not rejected'; end if;
  if (select count(*) from public.retail_source_listings where source_id='cccccccc-0000-0000-0000-000000000001' and source_product_id='SP-1') <> 1
  then raise exception 'CASE8 FAIL: expected exactly one listing after dedup'; end if;
end $$;

-- ══ Constraint cases: branch/condition integrity (no publish needed) ══════════
do $$
declare v_raised boolean;
begin
  -- branch_confirmed WITHOUT shop/mall must be rejected
  v_raised := false;
  begin
    insert into public.retail_price_observations (source_id, product_name, price, availability_scope)
    values ('cccccccc-0000-0000-0000-000000000001','C-branch',10,'branch_confirmed');
  exception when check_violation then v_raised := true; end;
  if not v_raised then raise exception 'FAIL: branch_confirmed without shop/mall accepted'; end if;

  -- bulk WITHOUT minimum_quantity must be rejected
  v_raised := false;
  begin
    insert into public.retail_price_observations (source_id, product_name, price, price_condition)
    values ('cccccccc-0000-0000-0000-000000000001','C-bulk',10,'bulk');
  exception when check_violation then v_raised := true; end;
  if not v_raised then raise exception 'FAIL: bulk without minimum_quantity accepted'; end if;

  -- loyalty WITHOUT program/label must be rejected
  v_raised := false;
  begin
    insert into public.retail_price_observations (source_id, product_name, price, price_condition)
    values ('cccccccc-0000-0000-0000-000000000001','C-loyalty',10,'loyalty');
  exception when check_violation then v_raised := true; end;
  if not v_raised then raise exception 'FAIL: loyalty without program/label accepted'; end if;

  -- standard WITH minimum_quantity must be rejected
  v_raised := false;
  begin
    insert into public.retail_price_observations (source_id, product_name, price, price_condition, minimum_quantity)
    values ('cccccccc-0000-0000-0000-000000000001','C-std',10,'standard',2);
  exception when check_violation then v_raised := true; end;
  if not v_raised then raise exception 'FAIL: standard with minimum_quantity accepted'; end if;

  -- minimum_quantity must be > 0
  v_raised := false;
  begin
    insert into public.retail_price_observations (source_id, product_name, price, price_condition, minimum_quantity)
    values ('cccccccc-0000-0000-0000-000000000001','C-zero',10,'bulk',0);
  exception when check_violation then v_raised := true; end;
  if not v_raised then raise exception 'FAIL: minimum_quantity = 0 accepted'; end if;
end $$;

-- ══ CASE 9: unknown category stored as NULL (never invented) ══════════════════
do $$ begin
  insert into public.products (shop_id, mall_id, name, category, price)
  values (null, null, 'NullCat Widget', null, 5);
  if (select count(*) from public.products where name='NullCat Widget' and category is null) <> 1
  then raise exception 'CASE9 FAIL: null category product not stored'; end if;
end $$;

-- ══ CASE 1 + 2 + 9b: online price, shop_id NULL, published truthfully scoped ═══
insert into public.retail_price_observations
  (id, source_id, product_name, category, price, trust_state, verification_method, confidence, review_status, valid_to, availability_scope, price_scope, price_condition)
values
  ('f0000000-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-000000000001','Online Widget', null, 100,'live_feed','partner_feed',0.9,'approved', now()+interval '30 days','online','online_national','standard');
select * from public.publish_verified_observation('f0000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','fixture');
do $$
declare v_pid uuid; v_shop uuid; v_scope text; v_cat text; v_pscope text;
begin
  select published_product_id into v_pid from public.retail_price_observations where id='f0000000-0000-0000-0000-000000000001';
  if v_pid is null then raise exception 'CASE1 FAIL: online observation was not published'; end if;
  select shop_id, availability_scope, category, price_scope into v_shop, v_scope, v_cat, v_pscope from public.products where id=v_pid;
  if v_shop is not null then raise exception 'CASE1 FAIL: online product carries a shop_id (implied branch)'; end if;
  if v_scope <> 'online' then raise exception 'CASE2 FAIL: product availability_scope is % not online', v_scope; end if;
  if v_scope = 'branch_confirmed' then raise exception 'CASE2 FAIL: online became a branch claim'; end if;
  if v_cat is not null then raise exception 'CASE9b FAIL: null category invented on publish'; end if;
  -- CASE 12 (migration 038): price_scope projected verbatim from the observation
  if v_pscope <> 'online_national' then raise exception 'CASE12 FAIL: price_scope not projected (got %)', v_pscope; end if;
end $$;

-- ══ CASE 3: shop_id present but availability unknown ⇒ NOT a branch claim ══════
insert into public.retail_price_observations
  (id, source_id, mall_id, shop_id, product_name, price, trust_state, verification_method, confidence, review_status, valid_to, availability_scope)
values
  ('f0000000-0000-0000-0000-000000000003','cccccccc-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','a1a1a1a1-0000-0000-0000-0000000000a1','Context Widget',50,'live_feed','partner_feed',0.9,'approved', now()+interval '30 days','unknown');
select * from public.publish_verified_observation('f0000000-0000-0000-0000-000000000003','11111111-1111-1111-1111-111111111111','fixture');
do $$
declare v_pid uuid; v_scope text;
begin
  select published_product_id into v_pid from public.retail_price_observations where id='f0000000-0000-0000-0000-000000000003';
  select availability_scope into v_scope from public.products where id=v_pid;
  if v_scope = 'branch_confirmed' then raise exception 'CASE3 FAIL: shop_id alone produced a branch_confirmed claim'; end if;
end $$;

-- ══ CASE 4: branch_confirmed but shop belongs to another mall ⇒ publish refused ═
insert into public.retail_price_observations
  (id, source_id, mall_id, shop_id, product_name, price, trust_state, verification_method, confidence, review_status, valid_to, availability_scope)
values
  ('f0000000-0000-0000-0000-000000000004','cccccccc-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','b2b2b2b2-0000-0000-0000-0000000000b2','Cross-Mall Widget',50,'live_feed','partner_feed',0.9,'approved', now()+interval '30 days','branch_confirmed');
do $$
declare v_raised boolean := false;
begin
  begin
    perform * from public.publish_verified_observation('f0000000-0000-0000-0000-000000000004','11111111-1111-1111-1111-111111111111','fixture');
  exception when others then v_raised := true; end;
  if not v_raised then raise exception 'CASE4 FAIL: cross-mall branch claim was published'; end if;
end $$;

-- ══ CASE 5: loyalty price renders its condition ═══════════════════════════════
insert into public.retail_price_observations
  (id, source_id, product_name, price, trust_state, verification_method, confidence, review_status, valid_to, availability_scope, price_condition, loyalty_program, price_condition_label)
values
  ('f0000000-0000-0000-0000-000000000005','cccccccc-0000-0000-0000-000000000001','Loyalty Widget',80,'live_feed','partner_feed',0.9,'approved', now()+interval '30 days','online','loyalty','ClubCard','ClubCard members only');
select * from public.publish_verified_observation('f0000000-0000-0000-0000-000000000005','11111111-1111-1111-1111-111111111111','fixture');
do $$
declare v_pid uuid; v_cond text; v_label text;
begin
  select published_product_id into v_pid from public.retail_price_observations where id='f0000000-0000-0000-0000-000000000005';
  select price_condition, price_condition_label into v_cond, v_label from public.products where id=v_pid;
  if v_cond <> 'loyalty' then raise exception 'CASE5 FAIL: product price_condition is % not loyalty', v_cond; end if;
  if v_label is null then raise exception 'CASE5 FAIL: loyalty condition label not projected'; end if;
end $$;

-- ══ CASE 6: bulk price renders its minimum quantity ═══════════════════════════
insert into public.retail_price_observations
  (id, source_id, product_name, price, trust_state, verification_method, confidence, review_status, valid_to, availability_scope, price_condition, minimum_quantity, price_condition_label)
values
  ('f0000000-0000-0000-0000-000000000006','cccccccc-0000-0000-0000-000000000001','Bulk Widget',100,'live_feed','partner_feed',0.9,'approved', now()+interval '30 days','online','bulk',3,'Buy 3 for R100');
select * from public.publish_verified_observation('f0000000-0000-0000-0000-000000000006','11111111-1111-1111-1111-111111111111','fixture');
do $$
declare v_pid uuid; v_cond text; v_label text;
begin
  select published_product_id into v_pid from public.retail_price_observations where id='f0000000-0000-0000-0000-000000000006';
  select price_condition, price_condition_label into v_cond, v_label from public.products where id=v_pid;
  if v_cond <> 'bulk' then raise exception 'CASE6 FAIL: product price_condition is % not bulk', v_cond; end if;
  if v_label is null then raise exception 'CASE6 FAIL: bulk minimum-quantity label not projected'; end if;
end $$;

-- ══ CASE 10: unresolved rights block publication ══════════════════════════════
insert into public.retail_price_observations
  (id, source_id, product_name, price, trust_state, verification_method, confidence, review_status, valid_to, availability_scope)
values
  ('f0000000-0000-0000-0000-000000000010','dddddddd-0000-0000-0000-000000000002','Rights Blocked Widget',60,'live_feed','partner_feed',0.9,'approved', now()+interval '30 days','online');
do $$
declare v_raised boolean := false;
begin
  begin
    perform * from public.publish_verified_observation('f0000000-0000-0000-0000-000000000010','11111111-1111-1111-1111-111111111111','fixture');
  exception when others then v_raised := true; end;
  if not v_raised then raise exception 'CASE10 FAIL: publication proceeded with unresolved rights'; end if;
  if (select review_status from public.retail_price_observations where id='f0000000-0000-0000-0000-000000000010') = 'published'
  then raise exception 'CASE10 FAIL: rights-blocked observation was marked published'; end if;
end $$;

-- ══ CASE 11 (migration 037): products.price_condition CHECK vocabulary ════════
do $$
declare v_raised boolean;
begin
  -- an invalid price_condition must be rejected
  v_raised := false;
  begin
    insert into public.products (name, category, price, price_condition)
    values ('BogusCond Widget', null, 5, 'not_a_real_condition');
  exception when check_violation then v_raised := true; end;
  if not v_raised then raise exception 'CASE11 FAIL: invalid products.price_condition was accepted'; end if;

  -- a valid value and NULL must both be accepted
  insert into public.products (name, category, price, price_condition) values ('ValidCond Widget', null, 5, 'loyalty');
  insert into public.products (name, category, price, price_condition) values ('NullCond Widget',  null, 5, null);
  if (select count(*) from public.products where name in ('ValidCond Widget','NullCond Widget')) <> 2
  then raise exception 'CASE11 FAIL: valid/NULL price_condition not accepted'; end if;
end $$;

-- ══ CASE 13 (migration 038): products.price_scope CHECK vocabulary ════════════
do $$
declare v_raised boolean := false;
begin
  begin
    insert into public.products (name, category, price, price_scope)
    values ('BogusScope Widget', null, 5, 'not_a_real_scope');
  exception when check_violation then v_raised := true; end;
  if not v_raised then raise exception 'CASE13 FAIL: invalid products.price_scope was accepted'; end if;
  insert into public.products (name, category, price, price_scope) values ('ValidScope Widget', null, 5, 'branch_specific');
  if (select price_scope from public.products where name='ValidScope Widget') <> 'branch_specific'
  then raise exception 'CASE13 FAIL: valid price_scope not stored'; end if;
end $$;

select 'retail truth-model fixture (036 + 037 + 038): ALL 13 CASES PASSED' as result;
