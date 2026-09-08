-- Sprint 3A.4 — Crash-safe durable promotion ledger (additive, forward-only).
--
-- Problem (3A.3 limitation): promotion consumed the current run's in-memory OfferDrafts.
-- retail_intake_job_drafts persisted only {draft_ref, record_hash, conflict_state} — no
-- payload to rebuild the RPC call, and no state to know whether a draft was promoted. A
-- restart after draft persistence but before/around staging could not re-promote safely.
--
-- Fix (smallest safe design, option A): persist the NORMALIZED canonical candidate (the exact
-- stage_retail_feed_observation arguments) + a candidate_version on the draft, plus a promotion
-- ledger (state/outcome/observation_id/attempts). Recovery re-promotes from the persisted
-- candidate; the database RPC (md5 observation_hash + unique-pending index) stays the final
-- replay/conflict authority, so a re-promotion of an already-staged row returns 'replayed', never
-- a duplicate. Additive only; no second staging path; never writes products.

-- ── 1. Ledger columns on retail_intake_job_drafts ─────────────────────────────
alter table public.retail_intake_job_drafts
  add column if not exists staging_candidate   jsonb,
  add column if not exists candidate_version   text,
  add column if not exists promotion_state     text not null default 'eligible',
  add column if not exists promotion_outcome   text,
  add column if not exists observation_id      uuid,
  add column if not exists promotion_attempts  integer not null default 0,
  add column if not exists promoted_at         timestamptz;

do $$ begin
  alter table public.retail_intake_job_drafts add constraint retail_intake_job_drafts_promotion_state_chk
    check (promotion_state in ('eligible','promoted','failed','skipped'));
exception when duplicate_object then null; end $$;

comment on column public.retail_intake_job_drafts.staging_candidate is
  'Normalized canonical candidate = the exact stage_retail_feed_observation arguments, persisted '
  'so a restarted worker can deterministically re-promote without reconstructing from raw input. '
  'Carries no secrets and no invented rights; rights/lifecycle are re-checked by the RPC from the '
  'source registry at promotion time.';

-- Retry selection: eligible + failed drafts that already carry a persisted candidate.
create index if not exists retail_intake_job_drafts_promotable_idx
  on public.retail_intake_job_drafts (job_id)
  where promotion_state in ('eligible','failed');

-- ── 2. Ledger RPCs (SECURITY DEFINER, locked search_path, service_role only) ───
-- Persist the canonical candidate before the RPC call (idempotent; never overwrites a promoted row).
create or replace function public.persist_draft_staging_candidate(
  p_job_id uuid, p_draft_ref text, p_candidate jsonb, p_version text
) returns void
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  update public.retail_intake_job_drafts
     set staging_candidate = p_candidate, candidate_version = p_version
   where job_id = p_job_id and draft_ref = p_draft_ref and promotion_state <> 'promoted';
end;
$$;

-- Record the promotion outcome AFTER the RPC (idempotent; increments attempts).
create or replace function public.record_draft_promotion(
  p_job_id uuid, p_draft_ref text, p_state text, p_observation_id uuid, p_outcome text
) returns void
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if p_state not in ('eligible','promoted','failed','skipped') then
    raise exception 'invalid promotion_state %', p_state using errcode = 'check_violation';
  end if;
  update public.retail_intake_job_drafts
     set promotion_state = p_state,
         observation_id = coalesce(p_observation_id, observation_id),
         promotion_outcome = p_outcome,
         promotion_attempts = promotion_attempts + 1,
         promoted_at = case when p_state = 'promoted' then now() else promoted_at end
   where job_id = p_job_id and draft_ref = p_draft_ref;
end;
$$;

-- List drafts that still need promotion AND carry a persisted candidate (restart recovery).
create or replace function public.list_promotable_drafts(p_job_id uuid)
returns table (draft_ref text, staging_candidate jsonb, promotion_state text, promotion_attempts integer)
language sql security definer set search_path = pg_catalog, public as $$
  select d.draft_ref, d.staging_candidate, d.promotion_state, d.promotion_attempts
    from public.retail_intake_job_drafts d
   where d.job_id = p_job_id
     and d.promotion_state in ('eligible','failed')
     and d.staging_candidate is not null
   order by d.chunk_index, d.draft_ref;
$$;

revoke all on function public.persist_draft_staging_candidate(uuid,text,jsonb,text) from public, anon, authenticated;
revoke all on function public.record_draft_promotion(uuid,text,text,uuid,text) from public, anon, authenticated;
revoke all on function public.list_promotable_drafts(uuid) from public, anon, authenticated;
grant execute on function public.persist_draft_staging_candidate(uuid,text,jsonb,text) to service_role;
grant execute on function public.record_draft_promotion(uuid,text,text,uuid,text) to service_role;
grant execute on function public.list_promotable_drafts(uuid) to service_role;
