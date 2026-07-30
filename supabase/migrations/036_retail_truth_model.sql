-- Sprint 2I — Retail truth-model fields for lawful live product acquisition (additive).
--
-- Purpose:
--   Prepare the EXISTING retail ingestion spine (retail_data_sources → snapshots →
--   retail_price_observations → publish_verified_observation → products) to hold real
--   retailer data honestly, WITHOUT collapsing four different kinds of truth:
--     • catalogue truth   (this retailer sells this)
--     • price truth        (this price, at this time, under these conditions)
--     • availability truth (which channel — online vs a specific branch)
--     • location truth      (the physical Mall@Reds store)
--
-- What it adds (all additive / relaxing — never destructive, no data rewrite):
--   1. retail_data_sources: tri-state RIGHTS flags (NULL=undetermined) + a
--      rights_review_state + an operational lifecycle_state (orthogonal axes).
--   2. retail_source_listings: the deterministic, dedup-able source-LISTING identity
--      (unique per source) — the correct home for uniqueness, because observations are
--      append-only price readings and the same listing is observed many times.
--   3. retail_price_observations: price_scope + availability_scope (separate), price
--      conditions (loyalty/bulk/…), as-observed identity fields, and NULLABLE shop_id /
--      mall_id so an online-national fact is never forced to claim a branch.
--   4. products: honest availability_scope / price_condition projection + NULLABLE
--      category (an unknown category must be NULL, never invented).
--   5. publish_verified_observation(): fail-closed RIGHTS gate + a branch-claim gate
--      (branch_confirmed requires shop∈mall, a cross-table check a CHECK cannot do) +
--      projects scope/condition onto the product. Online facts are still publishable —
--      truthfully scoped — they just cannot become a Mall@Reds branch-stock claim.
--
-- Safety: additive/relaxing only; no seed data; RLS preserved (new table is RLS-on,
--   service_role-only like the other retail_* tables); no broad grants. Backfill is
--   fail-closed: every existing source becomes lifecycle_state='discovered' +
--   rights_review_state='unreviewed' (never auto-promoted to active/approved).
--   NOT auto-applied to any hosted project by this sprint — see the rollback file
--   supabase/rollback/036_retail_truth_model_rollback.sql.

-- ══ 1. retail_data_sources — rights (tri-state), review state, lifecycle ═══════
alter table public.retail_data_sources
  add column if not exists lifecycle_state          text not null default 'discovered',
  add column if not exists rights_review_state      text not null default 'unreviewed',
  add column if not exists commercial_use_allowed    boolean,   -- NULL = not yet determined
  add column if not exists storage_allowed           boolean,   -- true = permitted, false = prohibited
  add column if not exists image_reuse_allowed        boolean,
  add column if not exists description_reuse_allowed  boolean;

do $$ begin
  alter table public.retail_data_sources add constraint retail_data_sources_lifecycle_state_check
    check (lifecycle_state in ('discovered','testing','active','degraded','suspended','retired','revoked'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.retail_data_sources add constraint retail_data_sources_rights_review_state_check
    check (rights_review_state in ('unreviewed','under_review','approved','restricted','rejected','expired'));
exception when duplicate_object then null; end $$;

comment on column public.retail_data_sources.lifecycle_state is
  'Operational state (separate from legal/rights): discovered|testing|active|degraded|suspended|retired|revoked. Existing rows backfilled to ''discovered'' — never auto-promoted.';
comment on column public.retail_data_sources.rights_review_state is
  'Rights/legal review state (separate from lifecycle): unreviewed|under_review|approved|restricted|rejected|expired. Publication requires ''approved''.';
comment on column public.retail_data_sources.commercial_use_allowed is
  'Tri-state: NULL=not yet determined, true=explicitly permitted, false=explicitly prohibited. Publication requires TRUE (fail-closed on NULL).';
comment on column public.retail_data_sources.storage_allowed is
  'Tri-state (NULL/true/false). Whether MallMind may store captured evidence for this source. Publication requires TRUE.';
comment on column public.retail_data_sources.image_reuse_allowed is
  'Tri-state (NULL/true/false). Gate image storage/publication for this source; only required when images are actually used.';
comment on column public.retail_data_sources.description_reuse_allowed is
  'Tri-state (NULL/true/false). Gate description reuse; only required when descriptions are actually published.';

-- ══ 2. retail_source_listings — deterministic, dedup-able listing identity ═════
-- Uniqueness belongs HERE, not on observations: observations are append-only price
-- readings (the same listing is observed repeatedly). A refresh upserts the listing
-- (updating last_seen) while each reading remains a new observation row.
create table if not exists public.retail_source_listings (
  id                uuid primary key default gen_random_uuid(),
  source_id         uuid not null references public.retail_data_sources(id) on delete cascade,
  source_product_id text,          -- the retailer's own product id (highest-precedence identity)
  retailer_sku      text,          -- retailer SKU (second-precedence)
  barcode           text,          -- GTIN — TEXT so leading zeros are preserved; NOT globally unique
  source_url        text,          -- canonical LISTING url (distinct from the evidence snapshot)
  variant           text,
  pack_size         text,          -- raw as-seen; a quantity_value/unit/pack_count split is deferred
  product_name      text,          -- last-seen human-readable name (never the sole refresh identity)
  first_seen        timestamptz not null default now(),
  last_seen         timestamptz not null default now(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- Deterministic identity, per source, when an id/sku is present. Precedence:
-- source_product_id → retailer_sku → barcode+attrs → manual (never name-only).
create unique index if not exists retail_source_listings_source_product_uidx
  on public.retail_source_listings (source_id, source_product_id) where source_product_id is not null;
create unique index if not exists retail_source_listings_source_sku_uidx
  on public.retail_source_listings (source_id, retailer_sku) where retailer_sku is not null;
-- Barcode is a LOOKUP index, never unique — the same GTIN legitimately spans retailers.
create index if not exists retail_source_listings_barcode_idx
  on public.retail_source_listings (barcode) where barcode is not null;

comment on table public.retail_source_listings is
  'Deterministic, dedup-able source-listing identity (unique per source). Keeps observations append-only: refreshes upsert the listing, not the price history.';
comment on column public.retail_source_listings.barcode is
  'GTIN as TEXT (leading zeros preserved). NOT unique — the same barcode appears across retailers/sources/dates.';

alter table public.retail_source_listings enable row level security;
-- No anon/authenticated policy → service_role only (bypasses RLS), matching the other retail_* tables.

-- ══ 3. retail_price_observations — scope, conditions, identity, nullable branch ═
alter table public.retail_price_observations
  add column if not exists listing_id            uuid references public.retail_source_listings(id) on delete set null,
  add column if not exists price_scope           text not null default 'unknown',
  add column if not exists availability_scope    text not null default 'unknown',
  add column if not exists price_condition       text not null default 'unknown',
  add column if not exists price_condition_label text,
  add column if not exists loyalty_program       text,
  add column if not exists minimum_quantity      integer,
  add column if not exists promotion_text        text,
  add column if not exists source_product_id     text,   -- as-observed identity (raw; canonical lives on the listing)
  add column if not exists retailer_sku          text,
  add column if not exists barcode               text,
  add column if not exists source_url            text,   -- listing url; the snapshot remains the captured evidence
  add column if not exists variant               text,
  add column if not exists pack_size             text;

-- Honest branch identity: an online-national observation must not be FORCED to claim
-- a physical branch. Existing rows keep their current shop_id/mall_id values verbatim.
alter table public.retail_price_observations alter column shop_id drop not null;
alter table public.retail_price_observations alter column mall_id drop not null;

do $$ begin alter table public.retail_price_observations add constraint rpo_price_scope_check
  check (price_scope in ('online_national','online_regional','branch_specific','catalogue_national','unknown'));
exception when duplicate_object then null; end $$;
do $$ begin alter table public.retail_price_observations add constraint rpo_availability_scope_check
  check (availability_scope in ('online','delivery_area','click_collect','branch_confirmed','unknown','not_observed'));
exception when duplicate_object then null; end $$;
do $$ begin alter table public.retail_price_observations add constraint rpo_price_condition_check
  check (price_condition in ('standard','loyalty','promotional','bulk','bundle','online_only','unknown'));
exception when duplicate_object then null; end $$;

-- branch_confirmed availability REQUIRES a branch identity (same-row guard). The
-- shop∈mall coherence is a CROSS-table check and lives in the publisher, not here.
do $$ begin alter table public.retail_price_observations add constraint rpo_branch_confirmed_requires_branch_check
  check (availability_scope <> 'branch_confirmed' or (shop_id is not null and mall_id is not null));
exception when duplicate_object then null; end $$;

-- Conditional-price integrity.
do $$ begin alter table public.retail_price_observations add constraint rpo_min_qty_positive_check
  check (minimum_quantity is null or minimum_quantity > 0);
exception when duplicate_object then null; end $$;
do $$ begin alter table public.retail_price_observations add constraint rpo_bulk_requires_min_qty_check
  check (price_condition not in ('bulk','bundle') or minimum_quantity is not null);
exception when duplicate_object then null; end $$;
do $$ begin alter table public.retail_price_observations add constraint rpo_loyalty_requires_label_check
  check (price_condition <> 'loyalty' or (loyalty_program is not null or price_condition_label is not null));
exception when duplicate_object then null; end $$;
do $$ begin alter table public.retail_price_observations add constraint rpo_standard_no_min_qty_check
  check (price_condition <> 'standard' or minimum_quantity is null);
exception when duplicate_object then null; end $$;

-- Lookup indexes (NON-unique — append-only; uniqueness is on retail_source_listings).
create index if not exists rpo_source_product_idx on public.retail_price_observations (source_id, source_product_id) where source_product_id is not null;
create index if not exists rpo_source_sku_idx     on public.retail_price_observations (source_id, retailer_sku)      where retailer_sku is not null;
create index if not exists rpo_listing_idx        on public.retail_price_observations (listing_id)                   where listing_id is not null;

comment on column public.retail_price_observations.availability_scope is
  'Where the product was seen available: online|delivery_area|click_collect|branch_confirmed|unknown|not_observed. A Mall@Reds branch-stock claim requires branch_confirmed (enforced in the publisher).';
comment on column public.retail_price_observations.price_scope is
  'Scope of the PRICE (separate from availability): online_national|online_regional|branch_specific|catalogue_national|unknown.';
comment on column public.retail_price_observations.source_url is
  'Canonical listing URL for this observation. Distinct from snapshot_id, which is the immutable captured evidence.';

-- ══ 4. products — honest scope/condition projection + nullable category ═══════
alter table public.products
  add column if not exists availability_scope    text,
  add column if not exists price_condition       text,
  add column if not exists price_condition_label text;

-- Relax NOT NULL: an unverified/unknown category must be representable as NULL,
-- never invented as ''/'Other'/'Uncategorized'. Existing category values are untouched.
alter table public.products alter column category drop not null;

do $$ begin alter table public.products add constraint products_availability_scope_check
  check (availability_scope is null or availability_scope in ('online','delivery_area','click_collect','branch_confirmed','unknown','not_observed'));
exception when duplicate_object then null; end $$;

comment on column public.products.category is
  'Store/product category. Nullable: NULL = not yet classified (render honestly, never as ''Other''/''Uncategorized''). Existing rows unchanged.';
comment on column public.products.availability_scope is
  'Projected from the published observation. The assistant may claim Mall@Reds branch availability ONLY when this is ''branch_confirmed''.';

-- ══ 5. publish_verified_observation — rights gate + branch-claim gate + projection
-- Rebuilt (CREATE OR REPLACE) from migration 027 with three additive gates. All prior
-- behaviour is preserved; existing observations (scope defaults to 'unknown') publish
-- exactly as before, minus the new fail-closed RIGHTS requirement.
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

  -- NEW (2I): fail-closed RIGHTS gate. Rights live in governed data, never adapter code.
  -- Publication requires an approved review and explicit commercial-use + storage rights.
  -- NULL (undetermined) is treated as NOT permitted.
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

  -- NEW (2I): branch-claim gate. A branch-stock claim is permitted ONLY when the
  -- observation is branch_confirmed AND its shop actually belongs to its mall. This
  -- cross-table coherence is exactly what a same-row CHECK cannot express.
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
    -- Only shop-scoped observations resolve by (shop + name). Online (shop_id NULL)
    -- observations always insert a fresh, branchless product.
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
      availability_scope, price_condition, price_condition_label
    ) values (
      obs.shop_id, obs.mall_id, obs.product_name, obs.category, obs.brand, obs.model,
      obs.price, obs.original_price, coalesce(obs.is_on_special, false),
      obs.special_description, null, coalesce(obs.in_stock, true), true,
      v_quality, v_now, v_valid_until, v_mapped_method, v_data_source, v_verified_by, null,
      obs.availability_scope, obs.price_condition, obs.price_condition_label
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
      'availability_scope', obs.availability_scope, 'price_condition', obs.price_condition
    )
  );

  published_product_id := v_product_id;
  action := v_action;
  return next;
end;
$$;

comment on function public.publish_verified_observation(uuid, uuid, text) is
  'Atomically publish an APPROVED evidence-backed retail_price_observation onto a product '
  '(verified projection), mark it published, link the product, and audit. 2I: adds a '
  'fail-closed rights gate (rights_review_state=approved + commercial_use_allowed + '
  'storage_allowed) and a branch-claim gate (branch_confirmed requires shop belongs to '
  'its mall); projects availability_scope/price_condition onto the product. Online facts '
  'publish as truthfully-scoped products and cannot become a branch-stock claim.';

revoke all on function public.publish_verified_observation(uuid, uuid, text) from public;
revoke all on function public.publish_verified_observation(uuid, uuid, text) from anon;
revoke all on function public.publish_verified_observation(uuid, uuid, text) from authenticated;
grant execute on function public.publish_verified_observation(uuid, uuid, text) to service_role;
