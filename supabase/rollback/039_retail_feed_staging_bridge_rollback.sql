-- Sprint 2L-B rollback — reverses 039_retail_feed_staging_bridge.sql. NOT auto-executed.
-- Additive migration → reversible. Drops the staging RPC, the added observation columns, and
-- the governed mapping table. Any STAGED pending observations that used feed_content_hash etc.
-- retain their core rows; only the added columns are dropped (export first if needed).

drop function if exists public.stage_retail_feed_observation(uuid,uuid,text,text,text,text,text,text,text,text,text,bigint,bigint,boolean,text,text,text,text,text,text,text,timestamptz,text,integer,text,jsonb);

alter table public.retail_price_observations
  drop column if exists branch_external_id,
  drop column if exists feed_content_hash,
  drop column if exists feed_source_row,
  drop column if exists feed_file_name,
  drop column if exists feed_parse_warnings,
  drop column if exists staged_actor;

drop table if exists public.retail_external_location_mappings;
