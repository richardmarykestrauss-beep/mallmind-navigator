-- Migration 015: GeoDirectory unique staging index
-- Sprint 12C.2.1
--
-- Adds a partial unique index on (mall_source_id, geodir_store_id) to enable
-- efficient batch upsert deduplication in importGeoDirectoryStoresForSource.
--
-- Why partial? Rows imported by other extraction methods have geodir_store_id = NULL,
-- and NULL != NULL in Postgres unique constraints, so a plain index would allow
-- duplicate nulls. The WHERE clause limits uniqueness enforcement to GeoDirectory rows.
--
-- PostgREST / Supabase JS client upsert with onConflict respects partial unique
-- indexes when the column list matches.

create unique index if not exists uq_staged_mall_source_geodir_store
  on mall_store_locations_staged (mall_source_id, geodir_store_id)
  where geodir_store_id is not null;
