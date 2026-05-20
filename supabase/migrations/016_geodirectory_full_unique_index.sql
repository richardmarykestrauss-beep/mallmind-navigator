-- Migration 016: GeoDirectory full unique index for upsert conflict detection
-- Sprint 12C.2.2
--
-- Problem: Supabase/PostgREST upsert with onConflict does not accept the
-- partial unique index created in migration 015 as a valid ON CONFLICT target.
-- The error is: "there is no unique or exclusion constraint matching the
-- ON CONFLICT specification".
--
-- Fix: add a normal (non-partial) unique index on the same two columns.
-- Postgres allows multiple NULL values in a unique index, so non-GeoDirectory
-- staged rows with geodir_store_id = NULL will not conflict with each other.
-- The partial index from migration 015 is kept as-is.

create unique index if not exists uq_staged_mall_source_geodir_store_full
  on mall_store_locations_staged (mall_source_id, geodir_store_id);
