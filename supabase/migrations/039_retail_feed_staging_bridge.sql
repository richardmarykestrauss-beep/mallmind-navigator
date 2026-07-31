-- Sprint 2L-B — Disposable pending-review retail feed staging bridge (additive).
--
-- Purpose:
--   A single, fail-closed database boundary that stages VALIDATED canonical retailer-feed
--   candidates into the EXISTING truth model (retail_source_listings + retail_price_observations)
--   at review_status='pending' ONLY. It resolves internal mall/shop ids EXCLUSIVELY from a
--   governed, approved external-location mapping; it can never mark a row verified, never
--   publish, never accept caller-supplied verification/publication/internal-id fields, and
--   never makes anything shopper-visible. Idempotent on a deterministic observation identity.
--
--   authorised feed → RetailerFeedContractV1 → canonical candidate → approved mapping (if branch)
--   → THIS bridge (pending) → human review → existing publish_verified_observation gate.
--
-- Safety: additive only (one table + a few nullable columns + one function). SECURITY DEFINER
--   with a locked search_path; schema-qualified; parameterized (no dynamic SQL); validates
--   inputs; least privilege (EXECUTE revoked from public/anon/authenticated, granted to
--   service_role only); RLS on the new table with no anon/authenticated policy. No seed data.
--   NOT auto-applied to any hosted project — see the rollback file.

-- ══ 1. Governed external-location mapping table (ExternalRetailLocationMappingV1) ══
create table if not exists public.retail_external_location_mappings (
  id                  uuid primary key default gen_random_uuid(),
  mapping_version     integer not null default 1,
  retailer_source_id  uuid not null references public.retail_data_sources(id) on delete cascade,
  external_branch_id  text,
  external_branch_name text,
  external_mall_id    text,
  external_mall_name  text,
  internal_retailer_id uuid,
  internal_shop_id    uuid references public.shops(id) on delete set null,
  internal_mall_id    uuid references public.malls(id) on delete set null,
  status              text not null default 'draft',
  match_method        text,
  approved_by         uuid,
  approved_at         timestamptz,
  valid_from          timestamptz,
  valid_until         timestamptz,
  source_reference    text,
  notes               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint relm_status_check check (status in ('draft','pending_review','approved','rejected','expired','superseded')),
  -- An approved mapping MUST carry approval metadata, internal ids, and provenance.
  constraint relm_approved_requires_metadata check (
    status <> 'approved' or (
      approved_by is not null and approved_at is not null
      and internal_shop_id is not null and internal_mall_id is not null
      and source_reference is not null
      and external_branch_id is not null
    )
  ),
  -- Validity dates must be coherent.
  constraint relm_validity_coherent check (valid_from is null or valid_until is null or valid_from <= valid_until),
  -- Identity anchor: a branch id or a branch name must be present.
  constraint relm_identity_present check (external_branch_id is not null or external_branch_name is not null)
);

-- Deterministic uniqueness: at most one APPROVED mapping per (retailer, external_branch_id)
-- may exist at a time → conflicting approved mappings cannot silently coexist.
create unique index if not exists relm_one_approved_per_branch_uidx
  on public.retail_external_location_mappings (retailer_source_id, external_branch_id)
  where status = 'approved' and external_branch_id is not null;

comment on table public.retail_external_location_mappings is
  'Governed external retailer branch → internal MallMind identity mapping. Only an approved, '
  'currently-valid, unique, provenance-bearing mapping may supply internal ids. Proves identity '
  'alignment ONLY — never stock, price, permission, or publication. Local/synthetic; no hosted seed.';

alter table public.retail_external_location_mappings enable row level security;
-- No anon/authenticated policy → service_role only (bypasses RLS), like the other retail_* tables.

-- ══ 2. Additive feed/provenance columns on retail_price_observations ═══════════
alter table public.retail_price_observations
  add column if not exists branch_external_id   text,
  add column if not exists feed_content_hash     text,
  add column if not exists feed_source_row       integer,
  add column if not exists feed_file_name         text,
  add column if not exists feed_parse_warnings    jsonb,
  add column if not exists staged_actor           uuid;

comment on column public.retail_price_observations.feed_content_hash is
  'md5 of the full canonical candidate content. With observation_hash (the deterministic feed '
  'identity), lets the staging bridge tell an identical replay (same content) from a conflict '
  '(same identity, different content) without overwriting evidence.';

-- ══ 3. Fail-closed staging RPC ════════════════════════════════════════════════
-- Accepts ONLY minimal canonical + provenance inputs. It does NOT accept verified/approved/
-- published/verified_by/publication-timestamp/trust-score or arbitrary internal ids — those
-- are impossible to inject because they are not parameters. Internal ids come solely from a
-- governed approved mapping resolved inside this function.
create or replace function public.stage_retail_feed_observation(
  p_actor                 uuid,
  p_source_id             uuid,
  p_source_product_id     text,
  p_retailer_sku          text,
  p_gtin                  text,
  p_barcode               text,
  p_product_name          text,
  p_brand                 text,
  p_pack_size             text,
  p_category              text,
  p_currency              text,
  p_current_price_cents   bigint,
  p_original_price_cents  bigint,
  p_promotion_indicator   boolean,
  p_price_condition       text,
  p_price_condition_label text,
  p_price_scope           text,
  p_availability_scope    text,
  p_branch_external_id    text,
  p_external_branch_name  text,
  p_stock_status          text,
  p_observed_at           timestamptz,
  p_source_url            text,
  p_source_row_number     integer,
  p_source_file_name      text,
  p_parse_warnings        jsonb
)
returns table (
  outcome text, observation_id uuid, listing_id uuid, review_status text,
  mapping_outcome text, observation_identity text, explanation text
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  src               public.retail_data_sources%rowtype;
  v_identity_str    text;
  v_identity        text;
  v_content         text;
  v_price           numeric;
  v_orig            numeric;
  v_mall_id         uuid := null;
  v_shop_id         uuid := null;
  v_map_outcome     text := 'not_applicable';
  v_usable          integer;
  v_any_branch      integer;
  v_map             public.retail_external_location_mappings%rowtype;
  v_intends_branch  boolean;
  v_listing_id      uuid;
  v_obs_id          uuid;
  v_existing_id     uuid;
  v_existing_content text;
begin
  -- Actor + source context (fail safe on missing).
  if p_actor is null then raise exception 'actor context is required' using errcode = 'check_violation'; end if;
  if p_source_id is null then raise exception 'source_id is required' using errcode = 'check_violation'; end if;
  select * into src from public.retail_data_sources where id = p_source_id;
  if not found then raise exception 'source % not found', p_source_id using errcode = 'no_data_found'; end if;

  -- Rights boundary: reference-only / needs-legal-review / rejected / expired sources cannot stage.
  if src.legal_status in ('reference_only','needs_legal_review')
     or coalesce(src.rights_review_state, 'unreviewed') in ('rejected','expired') then
    return query select 'rejected', null::uuid, null::uuid, null::text, 'not_applicable', null::text,
      format('source rights do not permit staging (legal_status=%s, rights_review_state=%s)', src.legal_status, src.rights_review_state);
    return;
  end if;

  -- Minimal required canonical facts.
  if p_product_name is null or btrim(p_product_name) = '' then
    return query select 'rejected', null::uuid, null::uuid, null::text, 'not_applicable', null::text, 'product_name is required'; return;
  end if;
  if p_current_price_cents is null or p_current_price_cents < 0 then
    return query select 'rejected', null::uuid, null::uuid, null::text, 'not_applicable', null::text, 'current_price_cents must be >= 0'; return;
  end if;
  if p_observed_at is null then
    return query select 'rejected', null::uuid, null::uuid, null::text, 'not_applicable', null::text, 'observed_at is required'; return;
  end if;
  if coalesce(p_source_product_id, p_retailer_sku, p_gtin, p_barcode) is null then
    return query select 'rejected', null::uuid, null::uuid, null::text, 'not_applicable', null::text, 'at least one product identity is required'; return;
  end if;

  v_price := p_current_price_cents::numeric / 100;
  v_orig  := case when p_original_price_cents is null then null else p_original_price_cents::numeric / 100 end;
  v_intends_branch := (p_availability_scope = 'branch_confirmed' or p_price_scope = 'branch_specific');

  -- ── Governed branch-mapping resolution (internal ids ONLY from an approved mapping) ──
  if p_branch_external_id is not null then
    select count(*) into v_any_branch from public.retail_external_location_mappings
     where external_branch_id = p_branch_external_id;
    if v_any_branch > 0 and not exists (
      select 1 from public.retail_external_location_mappings
       where external_branch_id = p_branch_external_id and retailer_source_id = p_source_id
    ) then
      v_map_outcome := 'retailer_mismatch';
    else
      select count(*) into v_usable
        from public.retail_external_location_mappings m
       where m.retailer_source_id = p_source_id
         and m.external_branch_id = p_branch_external_id
         and m.status = 'approved'
         and (m.valid_from is null or p_observed_at >= m.valid_from)
         and (m.valid_until is null or p_observed_at <= m.valid_until)
         and m.internal_shop_id is not null and m.internal_mall_id is not null
         and m.source_reference is not null;
      if v_usable = 1 then
        select * into v_map from public.retail_external_location_mappings m
         where m.retailer_source_id = p_source_id and m.external_branch_id = p_branch_external_id
           and m.status = 'approved'
           and (m.valid_from is null or p_observed_at >= m.valid_from)
           and (m.valid_until is null or p_observed_at <= m.valid_until)
           and m.internal_shop_id is not null and m.internal_mall_id is not null
           and m.source_reference is not null
         limit 1;
        v_mall_id := v_map.internal_mall_id; v_shop_id := v_map.internal_shop_id; v_map_outcome := 'resolved';
      elsif v_usable > 1 then
        v_map_outcome := 'mapping_collision';
      else
        v_map_outcome := 'mapping_invalid';   -- unapproved / expired / not-yet-valid / missing ids or provenance
      end if;
    end if;
  elsif p_external_branch_name is not null then
    v_map_outcome := 'ambiguous';              -- name-only is never a deterministic identity
  end if;

  -- A branch-intending row without a resolved mapping cannot be staged as a branch claim.
  if v_intends_branch and v_map_outcome <> 'resolved' then
    return query select 'mapping_required', null::uuid, null::uuid, null::text, v_map_outcome, null::text,
      format('branch claim requires a unique approved mapping (got %s)', v_map_outcome);
    return;
  end if;

  -- ── Deterministic identity + content hashes ──
  v_identity_str := concat_ws('|', p_source_id::text, coalesce(p_source_product_id, p_retailer_sku, p_gtin, p_barcode),
    to_char(p_observed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), coalesce(p_price_scope,'unknown'),
    coalesce(p_branch_external_id,''), p_current_price_cents::text);
  v_identity := md5(v_identity_str);
  v_content := md5(concat_ws('|', v_identity_str, p_product_name, coalesce(p_brand,''), coalesce(p_pack_size,''),
    coalesce(p_original_price_cents::text,''), coalesce(p_price_condition,''), coalesce(p_availability_scope,''),
    coalesce(p_stock_status,''), coalesce(v_shop_id::text,''), coalesce(v_mall_id::text,'')));

  -- ── Idempotency: identical replay vs conflict vs new ──
  select rpo.id, rpo.feed_content_hash into v_existing_id, v_existing_content
    from public.retail_price_observations rpo
   where rpo.observation_hash = v_identity and rpo.review_status in ('pending','needs_more_info')
   limit 1;
  if v_existing_id is not null then
    if v_existing_content is not distinct from v_content then
      return query select 'replayed', v_existing_id,
        (select rpo.listing_id from public.retail_price_observations rpo where rpo.id = v_existing_id),
        'pending', v_map_outcome, v_identity, 'identical replay — existing pending observation returned'; return;
    else
      return query select 'conflict', v_existing_id, null::uuid, 'pending', v_map_outcome, v_identity,
        'same observation identity with materially different content — not overwritten'; return;
    end if;
  end if;

  -- ── Upsert source listing identity ──
  if p_source_product_id is not null then
    insert into public.retail_source_listings (source_id, source_product_id, retailer_sku, barcode, source_url, variant, pack_size, product_name, last_seen, updated_at)
    values (p_source_id, p_source_product_id, p_retailer_sku, coalesce(p_barcode, p_gtin), p_source_url, null, p_pack_size, p_product_name, now(), now())
    on conflict (source_id, source_product_id) where source_product_id is not null
    do update set last_seen = now(), updated_at = now(), product_name = excluded.product_name
    returning id into v_listing_id;
  end if;

  -- ── Insert the PENDING observation (never verified, never published) ──
  insert into public.retail_price_observations (
    source_id, listing_id, mall_id, shop_id,
    product_name, brand, category, price, original_price, is_on_special, in_stock,
    observed_at, trust_state, verification_method, confidence, review_status,
    source_product_id, retailer_sku, barcode, source_url, pack_size,
    price_scope, availability_scope, price_condition, price_condition_label,
    branch_external_id, observation_hash, feed_content_hash, feed_source_row, feed_file_name,
    feed_parse_warnings, staged_actor
  ) values (
    p_source_id, v_listing_id, v_mall_id, v_shop_id,
    p_product_name, p_brand, p_category, v_price, v_orig, coalesce(p_promotion_indicator, false),
    (p_stock_status = 'in_stock'),
    p_observed_at, 'needs_review', null, 0.50, 'pending',
    p_source_product_id, p_retailer_sku, coalesce(p_barcode, p_gtin), p_source_url, p_pack_size,
    p_price_scope, p_availability_scope, p_price_condition, p_price_condition_label,
    p_branch_external_id, v_identity, v_content, p_source_row_number, p_source_file_name,
    p_parse_warnings, p_actor
  ) returning id into v_obs_id;

  insert into public.admin_audit_log (admin_id, action, table_name, row_id, new_values)
  values (p_actor, 'stage_retail_feed_observation', 'retail_price_observations', v_obs_id,
    jsonb_build_object('source_id', p_source_id, 'observation_identity', v_identity, 'review_status', 'pending',
      'mapping_outcome', v_map_outcome, 'internal_shop_id', v_shop_id, 'internal_mall_id', v_mall_id));

  return query select 'staged', v_obs_id, v_listing_id, 'pending', v_map_outcome, v_identity,
    'staged as pending (unverified, not published)';
end;
$$;

comment on function public.stage_retail_feed_observation is
  'Fail-closed pending-review staging bridge for canonical retailer-feed candidates. Stages into '
  'retail_source_listings + retail_price_observations at review_status=pending ONLY; resolves '
  'internal ids solely from an approved governed mapping; idempotent on a deterministic identity; '
  'never verifies, never publishes, never accepts verification/publication/internal-id inputs.';

revoke all on function public.stage_retail_feed_observation(uuid,uuid,text,text,text,text,text,text,text,text,text,bigint,bigint,boolean,text,text,text,text,text,text,text,timestamptz,text,integer,text,jsonb) from public;
revoke all on function public.stage_retail_feed_observation(uuid,uuid,text,text,text,text,text,text,text,text,text,bigint,bigint,boolean,text,text,text,text,text,text,text,timestamptz,text,integer,text,jsonb) from anon;
revoke all on function public.stage_retail_feed_observation(uuid,uuid,text,text,text,text,text,text,text,text,text,bigint,bigint,boolean,text,text,text,text,text,text,text,timestamptz,text,integer,text,jsonb) from authenticated;
grant execute on function public.stage_retail_feed_observation(uuid,uuid,text,text,text,text,text,text,text,text,text,bigint,bigint,boolean,text,text,text,text,text,text,text,timestamptz,text,integer,text,jsonb) to service_role;
