-- ── Sprint 15: Map Factory — Autonomous Mall Cartography Engine ───────────────
--
-- Eight staging tables that power the Map Factory pipeline.
-- NO writes to live tables (shops, products, mall_nodes) from this migration.
-- All tables are isolated staging/audit tables.
--
-- Safe to run repeatedly (ON CONFLICT / CREATE TABLE IF NOT EXISTS).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. map_factory_jobs
--    Top-level job record: one per mall per "cartography run".
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists map_factory_jobs (
  id                uuid         primary key default gen_random_uuid(),
  mall_id           uuid         not null references malls(id) on delete cascade,
  status            text         not null default 'pending'
                                 check (status in ('pending','running','paused','complete','failed')),
  stage             text         not null default 'source_discovery'
                                 check (stage in (
                                   'source_discovery',
                                   'asset_harvest',
                                   'ai_extraction',
                                   'layout_intelligence',
                                   'floorplan_generation',
                                   'route_graph_build',
                                   'qa_review',
                                   'publish'
                                 )),
  readiness_score   numeric(5,2) default 0  check (readiness_score between 0 and 100),
  notes             text,
  created_by        uuid,
  created_at        timestamptz  not null default now(),
  updated_at        timestamptz  not null default now()
);

create index if not exists map_factory_jobs_mall_id_idx  on map_factory_jobs(mall_id);
create index if not exists map_factory_jobs_status_idx   on map_factory_jobs(status);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. map_factory_sources
--    Evidence sources classified for a job (URLs, file paths, API refs, etc.).
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists map_factory_sources (
  id              uuid        primary key default gen_random_uuid(),
  job_id          uuid        not null references map_factory_jobs(id) on delete cascade,
  mall_id         uuid        not null references malls(id) on delete cascade,
  source_type     text        not null
                              check (source_type in (
                                'mall_website',
                                'evacuation_map_image',
                                'directory_pdf',
                                'google_maps_screenshot',
                                'retailer_website',
                                'geo_directory_api',
                                'crowdsource_submission',
                                'admin_manual_upload',
                                'existing_mall_map_asset',
                                'street_view_image',
                                'satellite_image',
                                'social_media_image',
                                'news_article',
                                'press_release',
                                'lease_plan'
                              )),
  url             text,
  asset_id        uuid        references mall_map_assets(id) on delete set null,
  title           text,
  confidence      numeric(4,3) default 0.5 check (confidence between 0 and 1),
  status          text        not null default 'discovered'
                              check (status in ('discovered','harvested','extraction_queued','extracted','failed','skipped')),
  hash            text,          -- SHA-256 of fetched content — dedup guard
  raw_content     text,          -- truncated preview of fetched content
  notes           text,
  created_at      timestamptz not null default now()
);

create index if not exists map_factory_sources_job_id_idx  on map_factory_sources(job_id);
create index if not exists map_factory_sources_mall_id_idx on map_factory_sources(mall_id);
create index if not exists map_factory_sources_hash_idx    on map_factory_sources(hash);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. map_factory_assets
--    Raw binary/media assets harvested for a job (images, PDFs, etc.).
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists map_factory_assets (
  id              uuid        primary key default gen_random_uuid(),
  job_id          uuid        not null references map_factory_jobs(id) on delete cascade,
  source_id       uuid        references map_factory_sources(id) on delete set null,
  mall_id         uuid        not null references malls(id) on delete cascade,
  asset_url       text        not null,
  asset_type      text        not null default 'image'
                              check (asset_type in ('image','pdf','screenshot','svg','archive')),
  mime_type       text,
  file_size_bytes bigint,
  width_px        integer,
  height_px       integer,
  floor_label     text,
  hash            text,
  harvest_status  text        not null default 'pending'
                              check (harvest_status in ('pending','complete','failed')),
  created_at      timestamptz not null default now()
);

create index if not exists map_factory_assets_job_id_idx on map_factory_assets(job_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. map_factory_extractions
--    AI extraction results for each asset — anchors, corridors, layout hints.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists map_factory_extractions (
  id                  uuid        primary key default gen_random_uuid(),
  job_id              uuid        not null references map_factory_jobs(id) on delete cascade,
  asset_id            uuid        references map_factory_assets(id) on delete set null,
  mall_id             uuid        not null references malls(id) on delete cascade,
  floor_label         text,
  provider            text        not null default 'mock',
  extraction_mode     text        not null default 'full'
                                  check (extraction_mode in ('anchors','corridors','full')),
  detected_anchors    jsonb       not null default '[]',
  detected_corridors  jsonb       not null default '[]',
  warnings            jsonb       not null default '[]',
  anchors_saved       integer     not null default 0,
  anchors_skipped     integer     not null default 0,
  status              text        not null default 'pending'
                                  check (status in ('pending','complete','failed')),
  error_message       text,
  created_at          timestamptz not null default now()
);

create index if not exists map_factory_extractions_job_id_idx on map_factory_extractions(job_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. map_factory_layout_models
--    Merged evidence model: conflict resolution + confidence weighting.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists map_factory_layout_models (
  id              uuid        primary key default gen_random_uuid(),
  job_id          uuid        not null references map_factory_jobs(id) on delete cascade,
  mall_id         uuid        not null references malls(id) on delete cascade,
  floor_label     text,
  merged_anchors  jsonb       not null default '[]',
  conflicts       jsonb       not null default '[]',
  coverage_score  numeric(5,2) default 0 check (coverage_score between 0 and 100),
  status          text        not null default 'pending'
                              check (status in ('pending','merging','complete','failed')),
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists map_factory_layout_models_job_id_idx on map_factory_layout_models(job_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. map_factory_generated_floorplans
--    Proprietary artificial floor plan records (MallMind's own artwork).
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists map_factory_generated_floorplans (
  id              uuid        primary key default gen_random_uuid(),
  job_id          uuid        not null references map_factory_jobs(id) on delete cascade,
  mall_id         uuid        not null references malls(id) on delete cascade,
  floor_label     text        not null,
  version         integer     not null default 1,
  layout_json     jsonb       not null default '{}',
  -- layout_json schema:
  --   { width, height, corridors: [{x,y,w,h}], zones: [{id,label,x,y,w,h,color}], nodes: [{id,label,x,y,type}] }
  svg_output      text,          -- generated SVG string (customer-facing)
  thumbnail_url   text,
  status          text        not null default 'draft'
                              check (status in ('draft','review','approved','published','superseded')),
  notes           text,
  created_at      timestamptz not null default now(),
  published_at    timestamptz
);

create index if not exists map_factory_generated_floorplans_job_id_idx   on map_factory_generated_floorplans(job_id);
create index if not exists map_factory_generated_floorplans_mall_id_idx  on map_factory_generated_floorplans(mall_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. map_factory_qa_reports
--    QA check results and readiness scores before publishing.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists map_factory_qa_reports (
  id                uuid        primary key default gen_random_uuid(),
  job_id            uuid        not null references map_factory_jobs(id) on delete cascade,
  mall_id           uuid        not null references malls(id) on delete cascade,
  readiness_score   numeric(5,2) not null default 0 check (readiness_score between 0 and 100),
  checks            jsonb       not null default '[]',
  -- checks schema: [{ check_name, passed, severity, detail }]
  blocking_issues   integer     not null default 0,
  warnings          integer     not null default 0,
  passed            boolean     not null default false,
  reviewed_by       text,
  created_at        timestamptz not null default now()
);

create index if not exists map_factory_qa_reports_job_id_idx on map_factory_qa_reports(job_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. map_factory_publish_records
--    Immutable audit trail of every publish action.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists map_factory_publish_records (
  id              uuid        primary key default gen_random_uuid(),
  job_id          uuid        not null references map_factory_jobs(id) on delete cascade,
  mall_id         uuid        not null references malls(id) on delete cascade,
  floorplan_id    uuid        references map_factory_generated_floorplans(id) on delete set null,
  nodes_published integer     not null default 0,
  edges_published integer     not null default 0,
  published_by    text,
  qa_score        numeric(5,2),
  notes           text,
  created_at      timestamptz not null default now()
);

create index if not exists map_factory_publish_records_job_id_idx  on map_factory_publish_records(job_id);
create index if not exists map_factory_publish_records_mall_id_idx on map_factory_publish_records(mall_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS: enable but allow service_role full access (admin backend only)
-- ─────────────────────────────────────────────────────────────────────────────
alter table map_factory_jobs                  enable row level security;
alter table map_factory_sources               enable row level security;
alter table map_factory_assets                enable row level security;
alter table map_factory_extractions           enable row level security;
alter table map_factory_layout_models         enable row level security;
alter table map_factory_generated_floorplans  enable row level security;
alter table map_factory_qa_reports            enable row level security;
alter table map_factory_publish_records       enable row level security;

-- Service role bypasses RLS — backend uses service_role key.
-- No additional policies needed for the admin pipeline.
