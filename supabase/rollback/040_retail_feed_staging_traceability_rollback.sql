-- Sprint 3A.3 rollback — reverses 040_retail_feed_staging_traceability.sql. NOT auto-executed.
-- Additive migration → reversible. Drops the 28-arg function + the added columns/index.
-- To restore the prior staging RPC, re-apply migration 039 after this rollback (it recreates
-- the 26-arg stage_retail_feed_observation). Any observations already staged retain their core
-- rows; only the two additive traceability columns are dropped (export first if needed).

drop function if exists public.stage_retail_feed_observation(uuid,uuid,text,text,text,text,text,text,text,text,text,bigint,bigint,boolean,text,text,text,text,text,text,text,timestamptz,text,integer,text,jsonb,uuid,text);

drop index if exists public.rpo_intake_job_idx;

alter table public.retail_price_observations
  drop column if exists intake_job_id,
  drop column if exists intake_draft_ref;

-- Re-apply supabase/migrations/039_retail_feed_staging_bridge.sql to restore the 26-arg RPC.
