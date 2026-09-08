-- Sprint 19C.1B — Retail Data Engine v1 foundation
-- Purpose:
--   Add a minimal, approval-gated provenance layer for MallMind retail data.
--   This does NOT publish prices automatically.
--   Approved observations can later be written through to public.products by a backend/admin script.
--
-- Safety:
--   - Additive only.
--   - Existing products/recommend-products flow remains unchanged.
--   - Staging/provenance tables are RLS locked down.
--   - No crawlers, no URL fetchers, no copied images/descriptions.

create table if not exists public.retail_data_sources (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),

  source_type text not null check (
    source_type in (
      'manual',
      'csv',
      'affiliate_feed',
      'flyer',
      'retailer_submission',
      'user_submission',
      'partner_feed'
    )
  ),

  name text not null,
  retailer_name text,
  mall_id uuid references public.malls(id) on delete set null,
  shop_id uuid references public.shops(id) on delete set null,

  base_trust numeric not null default 0.50 check (base_trust >= 0 and base_trust <= 1),
  legal_status text not null default 'manual_fact_entry' check (
    legal_status in (
      'manual_fact_entry',
      'licensed_feed',
      'retailer_supplied',
      'user_supplied',
      'partner_licensed',
      'reference_only',
      'needs_legal_review'
    )
  ),

  license_note text,
  attribution_required boolean not null default false,
  is_active boolean not null default true
);

comment on table public.retail_data_sources is
  'Source registry for MallMind retail facts. Stores provenance, legal status, and trust defaults.';

create table if not exists public.retail_source_snapshots (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),

  source_id uuid not null references public.retail_data_sources(id) on delete restrict,
  snapshot_type text not null default 'csv' check (
    snapshot_type in ('csv', 'manual_note', 'pdf', 'image', 'feed', 'retailer_upload', 'user_photo')
  ),

  ref_label text,
  ref_uri text,
  content_sha256 text,
  captured_by text,
  captured_at timestamptz not null default now(),

  notes text,

  unique nulls not distinct (source_id, content_sha256)
);

comment on table public.retail_source_snapshots is
  'Private provenance/evidence records for staged retail data. Do not expose publicly.';

create table if not exists public.retail_import_batches (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),

  source_id uuid not null references public.retail_data_sources(id) on delete restrict,
  snapshot_id uuid references public.retail_source_snapshots(id) on delete set null,

  mall_id uuid references public.malls(id) on delete set null,
  shop_id uuid references public.shops(id) on delete set null,

  status text not null default 'pending' check (
    status in ('pending', 'processing', 'staged', 'approved', 'rejected', 'failed')
  ),

  source_file text,
  total_rows integer not null default 0 check (total_rows >= 0),
  staged_rows integer not null default 0 check (staged_rows >= 0),
  approved_rows integer not null default 0 check (approved_rows >= 0),
  rejected_rows integer not null default 0 check (rejected_rows >= 0),
  error_summary text,

  created_by text
);

comment on table public.retail_import_batches is
  'Tracks CSV/manual retail-data imports before approval/publish.';

create table if not exists public.retail_price_observations (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  import_batch_id uuid references public.retail_import_batches(id) on delete set null,
  source_id uuid not null references public.retail_data_sources(id) on delete restrict,
  snapshot_id uuid references public.retail_source_snapshots(id) on delete set null,

  mall_id uuid not null references public.malls(id) on delete restrict,
  shop_id uuid not null references public.shops(id) on delete restrict,
  product_id uuid references public.products(id) on delete set null,

  product_name text not null,
  brand text,
  model text,
  category text,
  price numeric not null check (price >= 0),
  original_price numeric check (original_price is null or original_price >= 0),
  is_on_special boolean not null default false,
  special_description text,
  in_stock boolean not null default true,

  observed_at timestamptz not null default now(),
  valid_from timestamptz,
  valid_to timestamptz,

  trust_state text not null default 'needs_review' check (
    trust_state in (
      'verified',
      'retailer_submitted',
      'live_feed',
      'flyer_extracted',
      'user_submitted',
      'web_observed',
      'manual_fact_entry',
      'disputed',
      'needs_review',
      'expired',
      'stale'
    )
  ),

  verification_method text check (
    verification_method in (
      'phone',
      'website',
      'flyer',
      'receipt',
      'store_visit',
      'retailer_confirmation',
      'csv_manual',
      'affiliate_feed',
      'partner_feed',
      'user_submission'
    )
  ),

  confidence numeric not null default 0.50 check (confidence >= 0 and confidence <= 1),

  review_status text not null default 'pending' check (
    review_status in ('pending', 'approved', 'rejected', 'needs_more_info', 'published')
  ),

  reviewed_by text,
  reviewed_at timestamptz,
  review_note text,

  published_product_id uuid references public.products(id) on delete set null,
  published_at timestamptz,

  observation_hash text
);

comment on table public.retail_price_observations is
  'Approval-gated staged retail product/price observations. These do not affect shopper search until published to products.';

create index if not exists retail_data_sources_type_idx
  on public.retail_data_sources(source_type);

create index if not exists retail_data_sources_mall_shop_idx
  on public.retail_data_sources(mall_id, shop_id);

create index if not exists retail_source_snapshots_source_idx
  on public.retail_source_snapshots(source_id);

create index if not exists retail_import_batches_status_idx
  on public.retail_import_batches(status);

create index if not exists retail_import_batches_source_idx
  on public.retail_import_batches(source_id);

create index if not exists retail_price_observations_review_idx
  on public.retail_price_observations(review_status);

create index if not exists retail_price_observations_mall_shop_idx
  on public.retail_price_observations(mall_id, shop_id);

create index if not exists retail_price_observations_product_name_trgm_idx
  on public.retail_price_observations
  using gin (product_name gin_trgm_ops);

create index if not exists retail_price_observations_hash_idx
  on public.retail_price_observations(observation_hash);

create unique index if not exists retail_price_observations_unique_pending_hash_idx
  on public.retail_price_observations(observation_hash)
  where observation_hash is not null
    and review_status in ('pending', 'needs_more_info');

alter table public.retail_data_sources enable row level security;
alter table public.retail_source_snapshots enable row level security;
alter table public.retail_import_batches enable row level security;
alter table public.retail_price_observations enable row level security;

-- No anon/authenticated broad policies.
-- Backend service role can manage these tables. Supabase service_role bypasses RLS.
-- Future admin APIs should enforce admin authentication before using service role.
