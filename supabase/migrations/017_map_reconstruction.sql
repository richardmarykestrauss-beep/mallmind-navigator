-- ── Sprint 14A: Mall Map Reconstruction Foundation ────────────────────────────
--
-- 1. Extend mall_map_assets with reconstruction-specific metadata columns.
-- 2. Create mall_manual_map_anchors_staged for manual/AI anchor extraction.
--
-- Safe to run repeatedly (IF NOT EXISTS / ADD COLUMN IF NOT EXISTS).
-- No destructive changes. All new columns are nullable or have safe defaults.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Extend mall_map_assets
-- ─────────────────────────────────────────────────────────────────────────────

alter table mall_map_assets
  add column if not exists source_kind      text,
  -- web_scan | physical_map_photo | evacuation_map_photo | archive_map_asset | manual_reconstruction
  add column if not exists confidence_score numeric(4,3),
  add column if not exists is_base_map      boolean not null default false,
  add column if not exists is_corridor_ref  boolean not null default false;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. mall_manual_map_anchors_staged
--    Manual or AI-extracted anchor points from physical/scan map sources.
--    Stores named landmarks, shops, entrances, parking zones, etc. with
--    optional x_percent/y_percent placement on a reference map image.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists mall_manual_map_anchors_staged (
  id               uuid        primary key default gen_random_uuid(),
  created_at       timestamptz not null    default now(),

  mall_id          uuid        not null references malls(id) on delete cascade,
  map_asset_id     uuid        references mall_map_assets(id) on delete set null,

  floor_label      text        not null,
  label            text        not null,

  anchor_type      text        not null    default 'shop',
  -- shop | entrance | parking | lift | escalator | stairs |
  -- toilet | corridor_node | emergency_exit | landmark

  raw_text         text,       -- raw text snippet from physical map scan

  -- Optional placement on a reference map image (0–100 percent of image dims)
  x_percent        numeric(5,2),
  y_percent        numeric(5,2),

  confidence_score numeric(4,3) not null   default 0.0,
  source_note      text,       -- e.g. "Level 5 evacuation map photo, top-left quadrant"

  -- Admin review
  review_status    text        not null    default 'pending',
  -- pending | accepted | rejected | flagged
  reviewed_by      uuid,
  reviewed_at      timestamptz,
  notes            text,

  -- Prevent duplicate anchor names per floor per mall
  unique (mall_id, floor_label, label)
);

-- ── RLS ───────────────────────────────────────────────────────────────────────

alter table mall_manual_map_anchors_staged enable row level security;

create policy "admin_all_mall_manual_map_anchors_staged"
  on mall_manual_map_anchors_staged
  for all using (true) with check (true);

-- ── Indexes ───────────────────────────────────────────────────────────────────

create index if not exists idx_map_anchors_mall_floor
  on mall_manual_map_anchors_staged (mall_id, floor_label);

create index if not exists idx_map_anchors_review_status
  on mall_manual_map_anchors_staged (review_status);
