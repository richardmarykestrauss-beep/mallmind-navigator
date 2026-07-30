-- Sprint 2I (follow-on) — migration 038: products.price_scope + shopper-safe projection.
--
-- Forward-only. Migration 036 projected availability_scope / price_condition /
-- price_condition_label onto products, but NOT price_scope — so once published, the
-- shopper layer could not tell a "national online price" from "this branch's price".
-- This migration:
--   1. adds public.products.price_scope (nullable) + a CHECK matching the observation
--      vocabulary, and
--   2. rebuilds publish_verified_observation so it projects obs.price_scope onto the
--      product VERBATIM (no invented default — an unknown scope stays 'unknown'/NULL).
--
-- Safety: additive column + constraint; publisher change is projection-only (adds one
-- mapped column, no new gate, no behaviour change to the rights/branch gates). NULL
-- preserved; no data INSERT/UPDATE of existing rows; no RLS policy change; grants
-- re-applied identically (service_role only). 036/037 are NOT edited or reapplied.
-- NOT auto-applied to any hosted project — see the rollback file.

-- ══ 1. products.price_scope + CHECK ═══════════════════════════════════════════
alter table public.products
  add column if not exists price_scope text;

do $$ begin
  alter table public.products add constraint products_price_scope_check
    check (price_scope is null or price_scope in
      ('online_national','online_regional','branch_specific','catalogue_national','unknown'));
exception when duplicate_object then null; end $$;

comment on column public.products.price_scope is
  'Projected from the published observation. Scope of the PRICE (national online vs a '
  'specific branch): online_national|online_regional|branch_specific|catalogue_national|unknown. '
  'NULL = not projected. The assistant must not present a national/online price as a branch price.';

-- ══ 2. publish_verified_observation — also project price_scope (verbatim) ══════
-- Identical to the migration-036 definition, with obs.price_scope added to the product
-- projection (UPDATE, INSERT, audit). No other change.
create or replace function public.publish_verified_observation(
  p_observation_id uuid,
  p_admin_id       uuid,
  p_verified_by    text default null
)
returns table (published_product_id uuid, action text)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  obs             public.retail_price_observations%rowtype;
  src             public.retail_data_sources%rowtype;
  snap_count      integer;
  v_method        text;
  v_quality       text;
  v_mapped_method text;
  v_min_conf      numeric;
  v_valid_until   timestamptz;
  v_now           timestamptz := now();
  v_product_id    uuid;
  v_match_count   integer;
  v_data_source   text;
  v_verified_by   text;
  v_old           jsonb;
  v_action        text;
  evidence_methods text[] := array['phone','website','flyer','receipt','store_visit','retailer_confirmation'];
  snapshot_methods text[] := array['phone','website','flyer','receipt','store_visit','retailer_confirmation'];
  verify_capable_methods text[] := array['phone','website','flyer','receipt','store_visit','retailer_confirmation','affiliate_feed','partner_feed'];
begin
  if p_admin_id is null then
    raise exception 'admin_id is required' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from public.profiles where id = p_admin_id and is_admin is true) then
    raise exception 'admin_id is not a current admin' using errcode = 'insufficient_privilege';
  end if;
  v_verified_by := nullif(btrim(coalesce(p_verified_by, '')), '');

  select * into obs from public.retail_price_observations where id = p_observation_id for update;
  if not found then
    raise exception 'Observation % not found', p_observation_id using errcode = 'no_data_found';
  end if;

  if obs.review_status = 'published' or obs.published_product_id is not null or obs.published_at is not null then
    raise exception 'Observation % is already published', p_observation_id using errcode = 'unique_violation';
  end if;
  if obs.review_status <> 'approved' then
    raise exception 'Observation % is not approved (status=%)', p_observation_id, obs.review_status using errcode = 'check_violation';
  end if;
  if obs.price is null or obs.price <= 0 then
    raise exception 'Observation % has a non-positive price', p_observation_id using errcode = 'check_violation';
  end if;
  if obs.observed_at is null then
    raise exception 'Observation % has no observed_at', p_observation_id using errcode = 'check_violation';
  end if;

  v_method := coalesce(obs.verification_method, '');

  select * into src from public.retail_data_sources where id = obs.source_id;
  if not found then
    raise exception 'Observation % has no linked data source', p_observation_id using errcode = 'check_violation';
  end if;
  if src.is_active is false then
    raise exception 'Source % is inactive', src.id using errcode = 'check_violation';
  end if;
  if src.legal_status in ('needs_legal_review','reference_only') then
    raise exception 'Source legal_status % blocks publication', src.legal_status using errcode = 'check_violation';
  end if;

  if src.rights_review_state is distinct from 'approved' then
    raise exception 'Source rights_review_state (%) is not approved', coalesce(src.rights_review_state, 'null')
      using errcode = 'check_violation';
  end if;
  if src.commercial_use_allowed is distinct from true then
    raise exception 'Source commercial_use_allowed is not TRUE (rights undetermined or prohibited)'
      using errcode = 'check_violation';
  end if;
  if src.storage_allowed is distinct from true then
    raise exception 'Source storage_allowed is not TRUE (rights undetermined or prohibited)'
      using errcode = 'check_violation';
  end if;

  if obs.availability_scope = 'branch_confirmed' then
    if obs.shop_id is null or obs.mall_id is null then
      raise exception 'branch_confirmed observation % lacks shop_id/mall_id', p_observation_id using errcode = 'check_violation';
    end if;
    perform 1 from public.shops where id = obs.shop_id and mall_id = obs.mall_id;
    if not found then
      raise exception 'Observation % shop does not belong to its mall — branch claim refused', p_observation_id using errcode = 'check_violation';
    end if;
  end if;

  if v_method = any(snapshot_methods) then
    select count(*) into snap_count from public.retail_source_snapshots where id = obs.snapshot_id;
    if obs.snapshot_id is null or snap_count = 0 then
      raise exception 'Method % requires an evidence snapshot', v_method using errcode = 'check_violation';
    end if;
  end if;

  v_quality := case
    when obs.trust_state in ('verified','retailer_submitted','flyer_extracted','web_observed') then 'manually_verified'
    when obs.trust_state = 'manual_fact_entry' and v_method = any(evidence_methods) then 'manually_verified'
    when obs.trust_state = 'live_feed' then 'live_feed'
    when obs.trust_state = 'user_submitted' then 'user_submitted'
    else 'needs_review'
  end;
  if v_quality not in ('manually_verified','live_feed') then
    raise exception 'Observation % maps to % (not a verified tier)', p_observation_id, v_quality using errcode = 'check_violation';
  end if;
  if not (v_method = any(verify_capable_methods)) then
    raise exception 'Method % can never produce a verified price', v_method using errcode = 'check_violation';
  end if;

  v_min_conf := case v_method
    when 'store_visit' then 0.60 when 'receipt' then 0.60 when 'retailer_confirmation' then 0.60
    when 'phone' then 0.65 when 'flyer' then 0.65
    when 'website' then 0.70 when 'affiliate_feed' then 0.70 when 'partner_feed' then 0.70
    else 0.60 end;
  if coalesce(obs.confidence, 0) < v_min_conf then
    raise exception 'Confidence % below threshold % for method %', obs.confidence, v_min_conf, v_method using errcode = 'check_violation';
  end if;

  v_valid_until := coalesce(
    obs.valid_to,
    obs.observed_at + (case v_method
      when 'store_visit' then 14 when 'receipt' then 14 when 'retailer_confirmation' then 14 when 'phone' then 14
      when 'flyer' then 7 when 'website' then 7 when 'affiliate_feed' then 2 when 'partner_feed' then 2
      else 7 end || ' days')::interval
  );
  if v_valid_until <= v_now then
    raise exception 'Observation % validity window has already expired', p_observation_id using errcode = 'check_violation';
  end if;

  v_mapped_method := case
    when v_method in ('phone','website','flyer','receipt','store_visit','retailer_confirmation','user_submission') then v_method
    when v_method in ('affiliate_feed','partner_feed') then 'retailer_api'
    else null
  end;

  perform pg_advisory_xact_lock(
    hashtextextended(coalesce(obs.shop_id::text, '') || '|' || lower(btrim(coalesce(obs.product_name, ''))), 0)
  );

  if obs.product_id is not null then
    select id into v_product_id from public.products where id = obs.product_id and deleted_at is null;
  end if;
  if v_product_id is null and obs.shop_id is not null then
    select count(*) into v_match_count
      from public.products
     where shop_id = obs.shop_id and lower(btrim(name)) = lower(btrim(obs.product_name)) and deleted_at is null;
    if v_match_count > 1 then
      raise exception 'Ambiguous product match for observation % (% candidates)', p_observation_id, v_match_count using errcode = 'cardinality_violation';
    elsif v_match_count = 1 then
      select id into v_product_id
        from public.products
       where shop_id = obs.shop_id and lower(btrim(name)) = lower(btrim(obs.product_name)) and deleted_at is null
       limit 1;
    end if;
  end if;

  if v_product_id is not null then
    perform 1 from public.products
     where id = v_product_id
       and (shop_id is null or shop_id is not distinct from obs.shop_id)
       and (mall_id is null or mall_id is not distinct from obs.mall_id);
    if not found then
      raise exception 'Product % identity does not match observation % mall/shop', v_product_id, p_observation_id using errcode = 'check_violation';
    end if;
  end if;

  v_data_source := concat_ws('|',
    'retail_observation',
    'source:' || coalesce(src.source_type, 'unknown'),
    'trust:' || coalesce(obs.trust_state, 'unknown'),
    'method:' || coalesce(v_method, 'unknown'),
    'source_id:' || src.id::text,
    case when obs.snapshot_id is not null then 'snapshot_id:' || obs.snapshot_id::text end
  );

  if v_product_id is not null then
    select to_jsonb(p) into v_old from public.products p where p.id = v_product_id;
    update public.products set
      price                     = obs.price,
      original_price            = obs.original_price,
      is_on_special             = coalesce(obs.is_on_special, false),
      special_description       = obs.special_description,
      in_stock                  = coalesce(obs.in_stock, true),
      verified                  = true,
      data_quality_status       = v_quality,
      price_verified_at         = v_now,
      price_valid_until         = v_valid_until,
      price_verification_method = v_mapped_method,
      data_source               = v_data_source,
      verified_by               = v_verified_by,
      availability_scope        = obs.availability_scope,
      price_scope               = obs.price_scope,
      price_condition           = obs.price_condition,
      price_condition_label     = obs.price_condition_label
    where id = v_product_id;
    v_action := 'update';
  else
    insert into public.products (
      shop_id, mall_id, name, category, brand, model, price, original_price,
      is_on_special, special_description, image_url, in_stock, verified,
      data_quality_status, price_verified_at, price_valid_until,
      price_verification_method, data_source, verified_by, deleted_at,
      availability_scope, price_scope, price_condition, price_condition_label
    ) values (
      obs.shop_id, obs.mall_id, obs.product_name, obs.category, obs.brand, obs.model,
      obs.price, obs.original_price, coalesce(obs.is_on_special, false),
      obs.special_description, null, coalesce(obs.in_stock, true), true,
      v_quality, v_now, v_valid_until, v_mapped_method, v_data_source, v_verified_by, null,
      obs.availability_scope, obs.price_scope, obs.price_condition, obs.price_condition_label
    ) returning id into v_product_id;
    v_old := null;
    v_action := 'insert';
  end if;

  update public.retail_price_observations set
    review_status        = 'published',
    published_product_id = v_product_id,
    published_at         = v_now,
    updated_at           = v_now
  where id = p_observation_id;

  insert into public.admin_audit_log (admin_id, action, table_name, row_id, old_values, new_values)
  values (
    p_admin_id, 'publish_verified_observation', 'products', v_product_id, v_old,
    jsonb_build_object(
      'observation_id', p_observation_id, 'data_quality_status', v_quality, 'price', obs.price,
      'price_verified_at', v_now, 'price_valid_until', v_valid_until, 'verification_method', v_mapped_method,
      'source_id', src.id, 'snapshot_id', obs.snapshot_id, 'action', v_action,
      'availability_scope', obs.availability_scope, 'price_scope', obs.price_scope, 'price_condition', obs.price_condition
    )
  );

  published_product_id := v_product_id;
  action := v_action;
  return next;
end;
$$;

comment on function public.publish_verified_observation(uuid, uuid, text) is
  'Atomically publish an APPROVED evidence-backed retail_price_observation onto a product. '
  '2I: fail-closed rights gate + branch-claim gate; projects availability_scope, price_scope, '
  'price_condition and price_condition_label onto the product verbatim (no invented defaults). '
  'Online facts publish as truthfully-scoped products and cannot become a branch-stock claim.';

revoke all on function public.publish_verified_observation(uuid, uuid, text) from public;
revoke all on function public.publish_verified_observation(uuid, uuid, text) from anon;
revoke all on function public.publish_verified_observation(uuid, uuid, text) from authenticated;
grant execute on function public.publish_verified_observation(uuid, uuid, text) to service_role;
