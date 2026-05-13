-- ── Sprint 9A: Mall Data Compiler Foundation ─────────────────────────────────
-- Two tables for collecting and reviewing publicly-sourced mall/shop/product
-- data before it is applied to the live shops/products records.
--
-- Workflow:
--   1. Admin adds a research source (website, document, etc.)
--   2. Admin or tool logs individual findings against that source
--   3. Admin reviews each finding → approved / rejected
--   4. Approved findings can later be applied to shops/products (future sprint)
--
-- NOTE: This sprint only collects and reviews findings.
--       No automatic writes to shops/products/mall_nodes.

-- ── Reuse existing trigger function (defined in 011, idempotent) ──────────────
-- set_updated_at() already exists — no need to redefine.

-- ─────────────────────────────────────────────────────────────────────────────
-- Table 1: mall_research_sources
-- Tracks the origin of each batch of research findings.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists mall_research_sources (
  id          uuid        primary key default gen_random_uuid(),
  created_at  timestamptz not null    default now(),
  updated_at  timestamptz not null    default now(),

  -- Which mall this research batch belongs to
  mall_id     uuid not null references malls(id) on delete cascade,

  -- Human-readable label, e.g. "Sandton City official website – May 2026"
  label       text not null,

  -- Source classification
  -- Allowed: official_website | retail_directory | public_flyer |
  --          manual_survey | press_release | social_media | other
  source_type text not null default 'other',

  -- Full URL or description of origin
  source_url  text null,

  -- Free-form notes for the admin who captured this
  notes       text null,

  -- Who added this source (admin user_id)
  created_by  uuid null,

  -- Whether this source is still considered active / trustworthy
  is_active   boolean not null default true
);

drop trigger if exists set_mall_research_sources_updated_at on mall_research_sources;
create trigger set_mall_research_sources_updated_at
  before update on mall_research_sources
  for each row execute function set_updated_at();

-- Indexes
create index if not exists mrs_mall_id_idx
  on mall_research_sources (mall_id);

create index if not exists mrs_source_type_idx
  on mall_research_sources (source_type);

create index if not exists mrs_created_at_idx
  on mall_research_sources (created_at desc);

-- RLS: service role bypasses; admins can read via policy
alter table mall_research_sources enable row level security;

create policy "admins_can_read_mall_research_sources"
  on mall_research_sources
  for select
  using (
    exists (
      select 1 from profiles
      where profiles.id = auth.uid()
        and profiles.is_admin = true
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- Table 2: mall_source_findings
-- One row per discrete data point extracted from a research source.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists mall_source_findings (
  id          uuid        primary key default gen_random_uuid(),
  created_at  timestamptz not null    default now(),
  updated_at  timestamptz not null    default now(),

  -- Foreign key back to the source this finding came from
  source_id   uuid not null references mall_research_sources(id) on delete cascade,

  -- Which mall (denormalised for query convenience)
  mall_id     uuid not null references malls(id),

  -- What kind of entity this finding describes
  -- Allowed: shop | product | mall_hours | shop_hours | floor_layout | promotion | other
  finding_type text not null default 'other',

  -- Subject identifiers (nullable — not all findings reference existing DB rows)
  shop_id     uuid null references shops(id),
  product_id  uuid null references products(id),

  -- Core extracted content
  -- Structured as JSON so it can hold whatever fields are relevant to the finding_type.
  -- Examples:
  --   shop:        { "name": "Game", "floor": "G", "unit": "G14", "category": "Electronics" }
  --   product:     { "name": "Sony 65\" TV", "price": 12999, "brand": "Sony" }
  --   shop_hours:  { "shop_name": "Woolworths", "opens": "09:00", "closes": "20:00" }
  data        jsonb not null default '{}'::jsonb,

  -- Optional raw text snippet that was the basis for this finding
  raw_snippet text null,

  -- Review workflow
  -- Allowed: pending | approved | rejected | needs_more_info
  status      text not null default 'pending',

  -- Admin review fields
  admin_note  text        null,
  reviewed_by uuid        null,   -- admin user_id
  reviewed_at timestamptz null,

  -- Who logged the finding (may differ from the source creator)
  created_by  uuid null,

  -- Confidence (0–100) — can be set manually or by a future scraper
  confidence  int  null check (confidence >= 0 and confidence <= 100)
);

drop trigger if exists set_mall_source_findings_updated_at on mall_source_findings;
create trigger set_mall_source_findings_updated_at
  before update on mall_source_findings
  for each row execute function set_updated_at();

-- Indexes
create index if not exists msf_source_id_idx
  on mall_source_findings (source_id);

create index if not exists msf_mall_id_idx
  on mall_source_findings (mall_id);

create index if not exists msf_status_idx
  on mall_source_findings (status);

create index if not exists msf_finding_type_idx
  on mall_source_findings (finding_type);

create index if not exists msf_shop_id_idx
  on mall_source_findings (shop_id)
  where shop_id is not null;

create index if not exists msf_product_id_idx
  on mall_source_findings (product_id)
  where product_id is not null;

create index if not exists msf_created_at_idx
  on mall_source_findings (created_at desc);

-- RLS
alter table mall_source_findings enable row level security;

create policy "admins_can_read_mall_source_findings"
  on mall_source_findings
  for select
  using (
    exists (
      select 1 from profiles
      where profiles.id = auth.uid()
        and profiles.is_admin = true
    )
  );
