-- Sprint 3A.4 rollback — reverses 041_retail_intake_promotion_ledger.sql. NOT auto-executed.
-- Additive migration → reversible. Drops the ledger RPCs, the retry index, and the added
-- columns on retail_intake_job_drafts. Durable drafts themselves survive (only the ledger
-- columns are removed; export promotion state first if needed). Migration 040 is unaffected.

drop function if exists public.list_promotable_drafts(uuid);
drop function if exists public.record_draft_promotion(uuid,text,text,uuid,text);
drop function if exists public.persist_draft_staging_candidate(uuid,text,jsonb,text);

drop index if exists public.retail_intake_job_drafts_promotable_idx;

alter table public.retail_intake_job_drafts
  drop constraint if exists retail_intake_job_drafts_promotion_state_chk;

alter table public.retail_intake_job_drafts
  drop column if exists staging_candidate,
  drop column if exists candidate_version,
  drop column if exists promotion_state,
  drop column if exists promotion_outcome,
  drop column if exists observation_id,
  drop column if exists promotion_attempts,
  drop column if exists promoted_at;
