-- ── Sprint 12C.2: GeoDirectory Store Enrichment ──────────────────────────────
--
-- Adds nullable enrichment columns to mall_store_locations_staged so that
-- structured data imported from the WordPress GeoDirectory API can be stored
-- alongside the standard extraction fields.
--
-- Also adds two columns to mall_sources so the admin UI can track whether
-- a source has a confirmed GeoDirectory API and where that endpoint is.
--
-- GUARANTEE: Does not modify shops, products, mall_nodes, or any live table.
-- All data remains staged and admin-reviewed before promotion.

-- ─────────────────────────────────────────────────────────────────────────────
-- Enrichment columns on mall_store_locations_staged
-- ─────────────────────────────────────────────────────────────────────────────

alter table mall_store_locations_staged
  add column if not exists geodir_store_id    integer,
  add column if not exists phone              text,
  add column if not exists website            text,
  add column if not exists latitude           numeric(10,6),
  add column if not exists longitude          numeric(10,6),
  add column if not exists parking_hint       text,
  add column if not exists entrance_hint      text,
  add column if not exists road_name          text,
  add column if not exists source_modified_at timestamptz,
  add column if not exists image_url          text;

comment on column mall_store_locations_staged.geodir_store_id
  is 'WordPress GeoDirectory store post ID — used for upsert deduplication';

comment on column mall_store_locations_staged.phone
  is 'Store phone number extracted from GeoDirectory content';

comment on column mall_store_locations_staged.website
  is 'Store website URL from GeoDirectory Website: field';

comment on column mall_store_locations_staged.latitude
  is 'GPS latitude provided by GeoDirectory API';

comment on column mall_store_locations_staged.longitude
  is 'GPS longitude provided by GeoDirectory API';

comment on column mall_store_locations_staged.parking_hint
  is '"Park in the: ..." text extracted from store content';

comment on column mall_store_locations_staged.entrance_hint
  is '"Enter at entrance: ..." text extracted from store content';

comment on column mall_store_locations_staged.road_name
  is '"Road Name: ..." text extracted from store content';

comment on column mall_store_locations_staged.source_modified_at
  is 'Last-modified timestamp from the source API (GeoDirectory modified field)';

comment on column mall_store_locations_staged.image_url
  is 'Store featured image URL from GeoDirectory';

-- ─────────────────────────────────────────────────────────────────────────────
-- GeoDirectory API tracking columns on mall_sources
-- ─────────────────────────────────────────────────────────────────────────────

alter table mall_sources
  add column if not exists geodir_detected boolean not null default false,
  add column if not exists geodir_api_url  text;

comment on column mall_sources.geodir_detected
  is 'True when the source URL was confirmed to host a GeoDirectory /stores API';

comment on column mall_sources.geodir_api_url
  is 'Base URL of the confirmed GeoDirectory API, e.g. https://www.menlynpark.co.za/wp-json/geodir/v2';
