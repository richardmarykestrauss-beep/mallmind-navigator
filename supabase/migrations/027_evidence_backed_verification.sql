-- Sprint 20A.8E — Evidence-backed verification: atomic publish RPC
--
-- Purpose:
--   Make "an approved evidence-backed observation becomes the product's
--   verified projection" a SINGLE atomic, server-side operation, so the product
--   update, observation publish, identity linkage and audit log cannot diverge.
--
--   The product row stays the current shopper-facing projection; the
--   retail_price_observation stays the historical source of truth.
--
-- Safety:
--   - Additive only (one nullable column + one function).
--   - SECURITY DEFINER; execute granted to service_role only (backend admin).
--   - Re-validates eligibility independently of the Node policy (defence in depth).
--   - Refuses already-published observations (no silent double-publish).
--   - Refuses ambiguous product matches (never auto-picks a product).
--   - Row-level identity guards (mall/shop consistency).
--   - No secrets in error messages.
--
-- NOTE: This migration is NOT auto-applied by this sprint. Apply it in Supabase
--       (staging first) BEFORE deploying the backend that calls the RPC.

-- ── 1. Source-aware freshness horizon on products ───────────────────────────
alter table public.products
  add column if not exists price_valid_until timestamptz;

comment on column public.products.price_valid_until is
  'Source-aware freshness horizon projected from the approved observation '
  '(valid_to or method validity policy). When set, priceTrust expires the '
  'verified price after this instant instead of the legacy fixed window.';

-- ── 2. Atomic publish function ──────────────────────────────────────────────
create or replace function public.publish_verified_observation(
  p_observation_id uuid,
  p_admin_id       uuid,
  p_verified_by    text default null
)
returns table (published_product_id uuid, action text)
language plpgsql
security definer
-- Locked search_path (SECURITY DEFINER hardening): callers cannot redirect
-- object resolution; every object below is also explicitly schema-qualified.
set search_path = pg_catalog, public
as $$
declare
  obs            public.retail_price_observations%rowtype;
  src            public.retail_data_sources%rowtype;
  snap_count     integer;
  v_method       text;
  v_quality      text;
  v_mapped_method text;
  v_min_conf     numeric;
  v_valid_until  timestamptz;
  v_now          timestamptz := now();
  v_product_id   uuid;
  v_match_count  integer;
  v_data_source  text;
  v_verified_by  text;
  v_old          jsonb;
  v_action       text;
  -- CANONICAL MATRIX (must mirror retailVerificationPolicy.METHOD_POLICY):
  --   evidence/snapshot methods, verify-capable methods, confidence + validity.
  evidence_methods text[] := array[
    'phone','website','flyer','receipt','store_visit','retailer_confirmation'
  ];
  snapshot_methods text[] := array[
    'phone','website','flyer','receipt','store_visit','retailer_confirmation'
  ];
  verify_capable_methods text[] := array[
    'phone','website','flyer','receipt','store_visit','retailer_confirmation',
    'affiliate_feed','partner_feed'
  ];
begin
  -- ── Authorisation + attribution ───────────────────────────────────────────
  -- admin_id is the AUTHENTICATED actor and must resolve to a current admin.
  -- verified_by is human-readable ATTRIBUTION only — never an auth credential.
  if p_admin_id is null then
    raise exception 'admin_id is required' using errcode = 'check_violation';
  end if;
  if not exists (
    select 1 from public.profiles where id = p_admin_id and is_admin is true
  ) then
    raise exception 'admin_id is not a current admin' using errcode = 'insufficient_privilege';
  end if;
  v_verified_by := nullif(btrim(coalesce(p_verified_by, '')), '');

  -- Lock the observation for the duration of the transaction.
  select * into obs
    from public.retail_price_observations
   where id = p_observation_id
   for update;

  if not found then
    raise exception 'Observation % not found', p_observation_id
      using errcode = 'no_data_found';
  end if;

  -- Idempotency: refuse an already-published observation (no double-publish).
  if obs.review_status = 'published'
     or obs.published_product_id is not null
     or obs.published_at is not null then
    raise exception 'Observation % is already published', p_observation_id
      using errcode = 'unique_violation';
  end if;

  -- Gate: approved, priced, observed, valid method.
  if obs.review_status <> 'approved' then
    raise exception 'Observation % is not approved (status=%)', p_observation_id, obs.review_status
      using errcode = 'check_violation';
  end if;
  if obs.price is null or obs.price <= 0 then
    raise exception 'Observation % has a non-positive price', p_observation_id
      using errcode = 'check_violation';
  end if;
  if obs.observed_at is null then
    raise exception 'Observation % has no observed_at', p_observation_id
      using errcode = 'check_violation';
  end if;

  v_method := coalesce(obs.verification_method, '');

  -- Gate: source exists, active, legally clear.
  select * into src from public.retail_data_sources where id = obs.source_id;
  if not found then
    raise exception 'Observation % has no linked data source', p_observation_id
      using errcode = 'check_violation';
  end if;
  if src.is_active is false then
    raise exception 'Source % is inactive', src.id using errcode = 'check_violation';
  end if;
  if src.legal_status in ('needs_legal_review','reference_only') then
    raise exception 'Source legal_status % blocks publication', src.legal_status
      using errcode = 'check_violation';
  end if;

  -- Gate: evidence snapshot present when the method requires it.
  if v_method = any(snapshot_methods) then
    select count(*) into snap_count
      from public.retail_source_snapshots
     where id = obs.snapshot_id;
    if obs.snapshot_id is null or snap_count = 0 then
      raise exception 'Method % requires an evidence snapshot', v_method
        using errcode = 'check_violation';
    end if;
  end if;

  -- Projected product quality (mirrors retailTrustMapper doctrine).
  v_quality := case
    when obs.trust_state in ('verified','retailer_submitted','flyer_extracted','web_observed')
      then 'manually_verified'
    when obs.trust_state = 'manual_fact_entry' and v_method = any(evidence_methods)
      then 'manually_verified'
    when obs.trust_state = 'live_feed' then 'live_feed'
    when obs.trust_state = 'user_submitted' then 'user_submitted'
    else 'needs_review'
  end;

  if v_quality not in ('manually_verified','live_feed') then
    raise exception 'Observation % maps to % (not a verified tier)', p_observation_id, v_quality
      using errcode = 'check_violation';
  end if;

  -- A method that can never verify (csv_manual / user_submission) must not
  -- produce a verified projection, even if trust_state claims 'verified'.
  if not (v_method = any(verify_capable_methods)) then
    raise exception 'Method % can never produce a verified price', v_method
      using errcode = 'check_violation';
  end if;

  -- Gate: confidence threshold for the method.
  v_min_conf := case v_method
    when 'store_visit' then 0.60 when 'receipt' then 0.60 when 'retailer_confirmation' then 0.60
    when 'phone' then 0.65 when 'flyer' then 0.65
    when 'website' then 0.70 when 'affiliate_feed' then 0.70 when 'partner_feed' then 0.70
    else 0.60 end;
  if coalesce(obs.confidence, 0) < v_min_conf then
    raise exception 'Confidence % below threshold % for method %',
      obs.confidence, v_min_conf, v_method using errcode = 'check_violation';
  end if;

  -- Freshness horizon: explicit valid_to, else method policy from observed_at.
  v_valid_until := coalesce(
    obs.valid_to,
    obs.observed_at + (case v_method
      when 'store_visit' then 14 when 'receipt' then 14
      when 'retailer_confirmation' then 14 when 'phone' then 14
      when 'flyer' then 7 when 'website' then 7
      when 'affiliate_feed' then 2 when 'partner_feed' then 2
      else 7 end || ' days')::interval
  );
  if v_valid_until <= v_now then
    raise exception 'Observation % validity window has already expired', p_observation_id
      using errcode = 'check_violation';
  end if;

  -- Map verification method to a products.price_verification_method value.
  v_mapped_method := case
    when v_method in ('phone','website','flyer','receipt','store_visit',
                      'retailer_confirmation','user_submission') then v_method
    when v_method in ('affiliate_feed','partner_feed') then 'retailer_api'
    else null
  end;

  -- Serialise concurrent publishes that could otherwise BOTH insert the same
  -- new product (same shop + normalized name), preventing duplicate creation
  -- under load. The lock is released at transaction end.
  perform pg_advisory_xact_lock(
    hashtextextended(
      coalesce(obs.shop_id::text, '') || '|' || lower(btrim(coalesce(obs.product_name, ''))),
      0
    )
  );

  -- Resolve the target product: product_id first, else shop_id + normalized name.
  -- This is a GUARDED update-or-insert (never a blind upsert): exact product_id,
  -- else exactly one shop+name match, else insert; >1 match is refused.
  if obs.product_id is not null then
    select id into v_product_id
      from public.products
     where id = obs.product_id and deleted_at is null;
  end if;

  if v_product_id is null then
    select count(*) into v_match_count
      from public.products
     where shop_id = obs.shop_id
       and lower(btrim(name)) = lower(btrim(obs.product_name))
       and deleted_at is null;

    if v_match_count > 1 then
      raise exception 'Ambiguous product match for observation % (% candidates)',
        p_observation_id, v_match_count using errcode = 'cardinality_violation';
    elsif v_match_count = 1 then
      select id into v_product_id
        from public.products
       where shop_id = obs.shop_id
         and lower(btrim(name)) = lower(btrim(obs.product_name))
         and deleted_at is null
       limit 1;
    end if;
  end if;

  -- Identity guard: a resolved product must share the observation's mall/shop.
  if v_product_id is not null then
    perform 1 from public.products
     where id = v_product_id
       and (shop_id is null or shop_id = obs.shop_id)
       and (mall_id is null or mall_id = obs.mall_id);
    if not found then
      raise exception 'Product % identity does not match observation % mall/shop',
        v_product_id, p_observation_id using errcode = 'check_violation';
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
    -- Guarded UPDATE of the single resolved product (identity already checked).
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
      verified_by               = v_verified_by
    where id = v_product_id;

    v_action := 'update';
  else
    -- Guarded INSERT (publish-plan insert_new doctrine): no matching product
    -- exists; advisory lock above prevents a concurrent duplicate insert.
    insert into public.products (
      shop_id, mall_id, name, category, brand, model, price, original_price,
      is_on_special, special_description, image_url, in_stock, verified,
      data_quality_status, price_verified_at, price_valid_until,
      price_verification_method, data_source, verified_by, deleted_at
    ) values (
      obs.shop_id, obs.mall_id, obs.product_name, obs.category, obs.brand, obs.model,
      obs.price, obs.original_price, coalesce(obs.is_on_special, false),
      obs.special_description, null, coalesce(obs.in_stock, true), true,
      v_quality, v_now, v_valid_until, v_mapped_method, v_data_source, v_verified_by, null
    )
    returning id into v_product_id;

    v_old := null;
    v_action := 'insert';
  end if;

  -- Mark the observation published and link the product (source of truth trail).
  update public.retail_price_observations set
    review_status         = 'published',
    published_product_id  = v_product_id,
    published_at          = v_now,
    updated_at            = v_now
  where id = p_observation_id;

  -- Audit (best-effort columns; matches admin_audit_log shape used elsewhere).
  insert into public.admin_audit_log (admin_id, action, table_name, row_id, old_values, new_values)
  values (
    p_admin_id,
    'publish_verified_observation',
    'products',
    v_product_id,
    v_old,
    jsonb_build_object(
      'observation_id', p_observation_id,
      'data_quality_status', v_quality,
      'price', obs.price,
      'price_verified_at', v_now,
      'price_valid_until', v_valid_until,
      'verification_method', v_mapped_method,
      'source_id', src.id,
      'snapshot_id', obs.snapshot_id,
      'action', v_action
    )
  );

  published_product_id := v_product_id;
  action := v_action;
  return next;
end;
$$;

comment on function public.publish_verified_observation(uuid, uuid, text) is
  'Atomically publish an APPROVED evidence-backed retail_price_observation onto '
  'a product (verified projection), mark the observation published, link '
  'published_product_id, and audit. Refuses unapproved, expired, low-confidence, '
  'evidence-less, ambiguous, or already-published observations.';

-- ── 3. Lock down execution to the backend service role only ─────────────────
revoke all on function public.publish_verified_observation(uuid, uuid, text) from public;
revoke all on function public.publish_verified_observation(uuid, uuid, text) from anon;
revoke all on function public.publish_verified_observation(uuid, uuid, text) from authenticated;
grant execute on function public.publish_verified_observation(uuid, uuid, text) to service_role;
