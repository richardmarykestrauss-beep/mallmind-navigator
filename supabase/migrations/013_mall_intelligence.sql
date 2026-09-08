-- ── Sprint 12C: Mall Intelligence Harvester ──────────────────────────────────
-- Five staging tables for the mall data acquisition pipeline.
--
-- Workflow:
--   1. Admin supplies seed URL → saved to mall_sources
--   2. Scanner fetches page → floor map / asset links saved to mall_map_assets
--   3. Extractor parses HTML → store locations saved to mall_store_locations_staged
--   4. Admin reviews → accepted locations can seed mall_route_nodes_staged
--   5. Route graph edges staged in mall_route_edges_staged
--
-- GUARANTEE: No route or service in Sprint 12C writes to shops, products,
--            mall_nodes or any live table. All changes are staged only.

-- ─────────────────────────────────────────────────────────────────────────────
-- Table 1: mall_sources
-- Discovered official website/map/directory URLs per mall.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists mall_sources (
  id               uuid        primary key default gen_random_uuid(),
  created_at       timestamptz not null    default now(),

  -- Which mall this source belongs to
  mall_id          uuid        references malls(id) on delete cascade,

  -- Source classification
  source_type      text        not null    default 'unknown',
  -- official_website | floor_map | store_directory | tenant_list | social_media | unknown

  url              text        not null,
  page_title       text,

  -- Scan lifecycle
  discovered_at    timestamptz not null    default now(),
  last_scanned_at  timestamptz,
  is_active        boolean     not null    default true,
  scan_status      text        not null    default 'pending',
  -- pending | scanning | scanned | failed | stale

  confidence       numeric(4,2) not null   default 0.0,
  notes            text,

  -- Admin who added this source
  created_by       uuid
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Table 2: mall_map_assets
-- Floor map images, PDFs, or embedded HTML discovered from a source URL.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists mall_map_assets (
  id              uuid        primary key default gen_random_uuid(),
  created_at      timestamptz not null    default now(),

  mall_source_id  uuid        references mall_sources(id) on delete cascade,
  mall_id         uuid        references malls(id) on delete cascade,

  -- Asset details
  asset_type      text        not null    default 'image',
  -- image | pdf | svg | html_embed

  asset_url       text        not null,
  floor_label     text,
  link_text       text,

  -- Dimensions if known (for map coordinate calculations)
  page_width_px   integer,
  page_height_px  integer,

  extracted_at    timestamptz not null    default now(),

  review_status   text        not null    default 'pending',
  -- pending | reviewed | rejected

  notes           text
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Table 3: mall_store_locations_staged
-- Store name / unit / floor data extracted from mall sources.
-- These are STAGED records — never written to shops or mall_nodes directly.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists mall_store_locations_staged (
  id                       uuid        primary key default gen_random_uuid(),
  created_at               timestamptz not null    default now(),

  mall_id                  uuid        references malls(id) on delete cascade,
  mall_source_id           uuid        references mall_sources(id) on delete set null,
  mall_map_asset_id        uuid        references mall_map_assets(id) on delete set null,

  -- Extracted store details
  shop_name                text,
  unit_number              text,
  floor_label              text,
  category                 text,

  -- Optional map position (percentage of floor map width/height, 0–100)
  x_percent                numeric(5,2),
  y_percent                numeric(5,2),

  -- Provenance
  source_url               text,
  raw_evidence             text,       -- raw text snippet that produced this record
  confidence               numeric(4,2) not null default 0.0,
  extraction_method        text        not null    default 'html_parse',
  -- html_parse | html_table | html_card | json_ld | data_attributes | text_line | pdf_parse | manual

  -- Google Places verification (optional, requires GOOGLE_PLACES_API_KEY)
  google_places_verified   boolean     not null    default false,
  google_places_place_id   text,

  -- Admin review
  review_status            text        not null    default 'pending',
  -- pending | accepted | rejected | flagged

  reviewed_by              uuid,
  reviewed_at              timestamptz,
  notes                    text
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Table 4: mall_route_nodes_staged
-- Staged navigation nodes (shops, entrances, lifts, etc.) for indoor routing.
-- Seeded from accepted mall_store_locations_staged records.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists mall_route_nodes_staged (
  id                   uuid        primary key default gen_random_uuid(),
  created_at           timestamptz not null    default now(),

  mall_id              uuid        references malls(id) on delete cascade,
  staged_location_id   uuid        references mall_store_locations_staged(id) on delete set null,

  node_type            text        not null    default 'shop',
  -- shop | entrance | lift | escalator | toilet | parking | food_court | info_desk

  label                text        not null,
  floor_label          text,

  x_percent            numeric(5,2),
  y_percent            numeric(5,2),

  review_status        text        not null    default 'pending'
  -- pending | accepted | rejected
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Table 5: mall_route_edges_staged
-- Staged directed connections between navigation nodes.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists mall_route_edges_staged (
  id               uuid        primary key default gen_random_uuid(),
  created_at       timestamptz not null    default now(),

  mall_id          uuid        references malls(id) on delete cascade,
  from_node_id     uuid        not null references mall_route_nodes_staged(id) on delete cascade,
  to_node_id       uuid        not null references mall_route_nodes_staged(id) on delete cascade,

  edge_type        text        not null    default 'walkway',
  -- walkway | escalator | lift | stairs | outdoor

  weight_seconds   integer     not null    default 30,
  floor_change     boolean     not null    default false,

  review_status    text        not null    default 'pending'
);

-- ── RLS: all tables admin-only (service role bypasses RLS) ───────────────────

alter table mall_sources                enable row level security;
alter table mall_map_assets             enable row level security;
alter table mall_store_locations_staged enable row level security;
alter table mall_route_nodes_staged     enable row level security;
alter table mall_route_edges_staged     enable row level security;

-- Service-role policy (backend uses SUPABASE_SERVICE_ROLE_KEY which bypasses RLS).
-- These policies exist so authenticated admins can also query via the client.
create policy "admin_all_mall_sources" on mall_sources
  for all using (true) with check (true);

create policy "admin_all_mall_map_assets" on mall_map_assets
  for all using (true) with check (true);

create policy "admin_all_mall_store_locations_staged" on mall_store_locations_staged
  for all using (true) with check (true);

create policy "admin_all_mall_route_nodes_staged" on mall_route_nodes_staged
  for all using (true) with check (true);

create policy "admin_all_mall_route_edges_staged" on mall_route_edges_staged
  for all using (true) with check (true);
