-- Sprint 2E — Retail Intelligence Fabric: additive RPCs for the real durable store.
--
-- Purpose:
--   033 shipped the durable tables + claim-next/renew/commit/control RPCs. The
--   real PostgresDurableIntakeStore additionally needs: create-job (with the
--   fixture-only guard), claim of a SPECIFIC job, finalize/fail, and a counter
--   reconciliation summary. This migration is ADDITIVE only.
--
-- Fixture-only boundary:
--   retail_intake_jobs gains `is_fixture` + `trace_id`. `create_intake_job`
--   REFUSES a non-fixture job while the deployed worker runs in fixture-only mode,
--   with the exact operator wording required by the sprint.
--
-- Safety: SECURITY DEFINER; locked search_path; schema-qualified; EXECUTE granted
--   to service_role only. NOT auto-applied. Rollback anchor: commit a0f612c
--   (tag rollback/pre-sprint-2e). Rollback: supabase/rollback/034_*.sql

-- ── Additive columns ─────────────────────────────────────────────────────────
alter table public.retail_intake_jobs add column if not exists is_fixture boolean not null default false;
alter table public.retail_intake_jobs add column if not exists trace_id text;
create index if not exists retail_intake_jobs_identity_idx on public.retail_intake_jobs (source_id, input_hash, mode);

-- ── RPC: create a durable intake job (fixture-guarded, idempotent by identity) ─
drop function if exists public.create_intake_job(uuid, text, text, text, text, text, integer, bigint, integer, integer, boolean, text, boolean);
create function public.create_intake_job(
  p_source_id          uuid,
  p_input_ref          text,
  p_input_hash         text,
  p_input_content_type text,
  p_mode               text,
  p_requested_by       text,
  p_estimated_rows     integer,
  p_total_bytes        bigint,
  p_max_retries        integer,
  p_priority           integer,
  p_is_fixture         boolean,
  p_trace_id           text,
  p_fixture_only_mode  boolean
)
returns public.retail_intake_jobs
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_job public.retail_intake_jobs;
begin
  -- Fixture-only boundary (deployed dev worker).
  if p_fixture_only_mode and coalesce(p_is_fixture, false) = false then
    raise exception 'Durable worker is currently restricted to generated development fixtures.';
  end if;
  if p_source_id is null then raise exception 'source_id is required'; end if;
  if p_input_ref is null or p_input_ref !~ '^gs://[a-z0-9][a-z0-9._-]{0,220}/[^#]+#[0-9]+$' then
    raise exception 'input_ref must be gs://bucket/object#generation';
  end if;
  if p_input_hash is null or char_length(p_input_hash) not between 8 and 200 then raise exception 'invalid input_hash'; end if;
  if p_mode is null or char_length(p_mode) > 40 then raise exception 'invalid mode'; end if;
  if p_requested_by is null or char_length(p_requested_by) > 200 then raise exception 'invalid requested_by'; end if;
  if coalesce(p_total_bytes, 0) < 0 then raise exception 'invalid total_bytes'; end if;

  -- Idempotent by job identity (source, input_hash, mode) while a run is live.
  select * into v_job from public.retail_intake_jobs
   where source_id = p_source_id and input_hash = p_input_hash and mode = p_mode
     and status in ('queued','claimed','validating','processing','paused')
   limit 1;
  if v_job.id is not null then return v_job; end if;

  insert into public.retail_intake_jobs (
    source_id, input_ref, input_hash, input_content_type, mode, status, requested_by,
    priority, total_bytes, estimated_rows, max_retries, is_fixture, trace_id
  ) values (
    p_source_id, p_input_ref, p_input_hash, p_input_content_type, p_mode, 'queued', p_requested_by,
    coalesce(p_priority, 0), p_total_bytes, p_estimated_rows, coalesce(p_max_retries, 3),
    coalesce(p_is_fixture, false), p_trace_id
  ) returning * into v_job;

  insert into public.retail_intake_events (job_id, event_type, trace_id, metadata)
  values (v_job.id, 'intake.job_created', coalesce(p_trace_id, 'trace_' || v_job.id::text),
          jsonb_build_object('is_fixture', coalesce(p_is_fixture, false)));
  return v_job;
end $$;

-- ── RPC: claim a SPECIFIC job (atomic; respects a live lease held by another) ──
drop function if exists public.claim_intake_job(uuid, text, integer);
create function public.claim_intake_job(p_job_id uuid, p_worker_id text, p_lease_seconds integer)
returns public.retail_intake_jobs
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_job public.retail_intake_jobs; v_owner text; v_expires timestamptz;
begin
  if p_worker_id is null or char_length(p_worker_id) > 80 then raise exception 'invalid worker_id'; end if;
  if p_lease_seconds is null or p_lease_seconds < 1 or p_lease_seconds > 3600 then raise exception 'invalid lease_seconds'; end if;

  select * into v_job from public.retail_intake_jobs where id = p_job_id for update;
  if v_job.id is null then raise exception 'unknown job'; end if;

  select worker_id, lease_expires_at into v_owner, v_expires
    from public.retail_intake_worker_leases where job_id = p_job_id for update;
  if v_owner is not null and v_owner <> p_worker_id and v_expires > now() then
    raise exception 'stale_worker: job is leased by %', v_owner;
  end if;

  insert into public.retail_intake_worker_leases (job_id, worker_id, claimed_at, lease_expires_at, heartbeat_at)
  values (p_job_id, p_worker_id, now(), now() + make_interval(secs => p_lease_seconds), now())
  on conflict (job_id) do update set worker_id = excluded.worker_id, claimed_at = now(),
                                     lease_expires_at = excluded.lease_expires_at, heartbeat_at = now();

  update public.retail_intake_jobs
     set status = case when status = 'queued' then 'claimed' else status end,
         started_at = coalesce(started_at, now()), version = version + 1, updated_at = now()
   where id = p_job_id returning * into v_job;

  insert into public.retail_intake_events (job_id, worker_id, event_type, trace_id)
  values (p_job_id, p_worker_id, 'intake.job_claimed', coalesce(v_job.trace_id, 'trace_' || p_job_id::text));
  return v_job;
end $$;

-- ── RPC: finalize (completed / completed_with_errors / needs_review / cancelled) ─
drop function if exists public.finalize_intake_job(uuid, text, bigint, text);
create function public.finalize_intake_job(p_job_id uuid, p_worker_id text, p_job_version bigint, p_status text)
returns public.retail_intake_jobs
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_job public.retail_intake_jobs; v_version bigint;
begin
  if p_status not in ('completed','completed_with_errors','needs_review','cancelled','paused') then
    raise exception 'invalid finalize status';
  end if;
  select version into v_version from public.retail_intake_jobs where id = p_job_id for update;
  if v_version is null then raise exception 'unknown job'; end if;
  if v_version <> p_job_version then raise exception 'stale_worker: version'; end if;

  update public.retail_intake_jobs
     set status = p_status::public.retail_intake_status,
         completed_at = case when p_status in ('completed','completed_with_errors','needs_review') then now() else completed_at end,
         version = version + 1, updated_at = now()
   where id = p_job_id returning * into v_job;

  insert into public.retail_intake_events (job_id, worker_id, event_type, trace_id, metadata)
  values (p_job_id, p_worker_id,
          case when p_status = 'cancelled' then 'intake.job_cancelled' else 'intake.job_completed' end,
          coalesce(v_job.trace_id, 'trace_' || p_job_id::text), jsonb_build_object('status', p_status));
  return v_job;
end $$;

-- ── RPC: fail a job (bounded retry accounting; sanitized message) ─────────────
drop function if exists public.fail_intake_job(uuid, text, bigint, text, text);
create function public.fail_intake_job(p_job_id uuid, p_worker_id text, p_job_version bigint, p_code text, p_message_sanitized text)
returns public.retail_intake_jobs
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_job public.retail_intake_jobs; v_version bigint;
begin
  select version into v_version from public.retail_intake_jobs where id = p_job_id for update;
  if v_version is null then raise exception 'unknown job'; end if;
  if v_version <> p_job_version then raise exception 'stale_worker: version'; end if;

  update public.retail_intake_jobs
     set status = 'failed', failed_at = now(), failure_code = left(coalesce(p_code, 'internal'), 80),
         failure_message_sanitized = left(coalesce(p_message_sanitized, ''), 500),
         retry_count = retry_count + 1, version = version + 1, updated_at = now()
   where id = p_job_id returning * into v_job;

  insert into public.retail_intake_events (job_id, worker_id, event_type, trace_id, metadata)
  values (p_job_id, p_worker_id, 'intake.job_failed', coalesce(v_job.trace_id, 'trace_' || p_job_id::text),
          jsonb_build_object('code', left(coalesce(p_code, 'internal'), 80)));
  return v_job;
end $$;

-- ── RPC: counter reconciliation summary (durable source of truth) ─────────────
drop function if exists public.intake_job_reconciliation(uuid);
create function public.intake_job_reconciliation(p_job_id uuid)
returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare j public.retail_intake_jobs; v_chunks int; v_quar int; v_dedup int; v_offset int;
begin
  select * into j from public.retail_intake_jobs where id = p_job_id;
  if j.id is null then raise exception 'unknown job'; end if;
  select count(*) into v_chunks from public.retail_intake_job_chunks where job_id = p_job_id;
  select count(*) into v_quar   from public.retail_intake_quarantine  where job_id = p_job_id;
  select count(*) into v_dedup  from public.retail_intake_dedup_keys d
    where d.scope = j.source_id::text;
  select row_offset into v_offset from public.retail_intake_checkpoints where job_id = p_job_id;

  return jsonb_build_object(
    'jobId', j.id, 'processedRows', j.processed_rows, 'validRows', j.valid_rows,
    'rejectedRows', j.rejected_rows, 'duplicateRows', j.duplicate_rows, 'conflictRows', j.conflict_rows,
    'stagedDrafts', j.staged_drafts, 'evidenceCreated', j.evidence_created,
    'committedChunks', v_chunks, 'quarantineRows', v_quar, 'dedupKeys', v_dedup,
    'checkpointRowOffset', v_offset,
    'reconciles', (j.valid_rows + j.duplicate_rows + j.rejected_rows = j.processed_rows)
                  and (j.staged_drafts = j.valid_rows)
  );
end $$;

-- ── Grants: service_role only ────────────────────────────────────────────────
do $$
declare fn text;
begin
  foreach fn in array array[
    'public.create_intake_job(uuid, text, text, text, text, text, integer, bigint, integer, integer, boolean, text, boolean)',
    'public.claim_intake_job(uuid, text, integer)',
    'public.finalize_intake_job(uuid, text, bigint, text)',
    'public.fail_intake_job(uuid, text, bigint, text, text)',
    'public.intake_job_reconciliation(uuid)'
  ]
  loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end $$;
