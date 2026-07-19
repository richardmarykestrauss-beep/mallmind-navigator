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

-- ── Durable product index ────────────────────────────────────────────────────
-- 033 persists dedup keys but NOT the (product, source-category) → price index the
-- worker uses for cross-chunk conflict detection. Without it a resumed job silently
-- misses conflicts, because the in-memory working set dies with the process. This
-- table is that index's durable home; it stores a price, never a retail payload.
create table if not exists public.retail_intake_product_index (
  scope       text not null,
  product_key text not null,
  price       numeric(12,2) not null,
  draft_ref   text not null,
  created_at  timestamptz not null default now(),
  primary key (scope, product_key)
);

alter table public.retail_intake_product_index enable row level security;
alter table public.retail_intake_product_index force row level security;
revoke all on public.retail_intake_product_index from public, anon, authenticated;
grant select, insert, update, delete on public.retail_intake_product_index to service_role;

-- ── Durable staged-draft trace ───────────────────────────────────────────────
-- Which drafts a job staged, per chunk. 033 counts staged_drafts but never records
-- WHICH drafts, so review could not trace a draft back to the job/chunk that staged
-- it. Refs only — the draft bodies live in the review bridge, not here.
create table if not exists public.retail_intake_job_drafts (
  job_id         uuid not null references public.retail_intake_jobs(id) on delete cascade,
  chunk_index    integer not null,
  draft_ref      text not null,
  record_hash    text not null,
  conflict_state text not null default 'none',
  created_at     timestamptz not null default now(),
  primary key (job_id, draft_ref)
);
create index if not exists retail_intake_job_drafts_job_idx on public.retail_intake_job_drafts (job_id, chunk_index);

alter table public.retail_intake_job_drafts enable row level security;
alter table public.retail_intake_job_drafts force row level security;
revoke all on public.retail_intake_job_drafts from public, anon, authenticated;
grant select, insert, update, delete on public.retail_intake_job_drafts to service_role;

-- ── Replace commit_intake_chunk: same contract, now also durable product index ─
-- Additive + idempotent on rebuild: identical signature, identical return shape,
-- one extra bounded insert inside the SAME transaction, so chunk commit stays
-- all-or-nothing and stays idempotent on (job_id, chunk_index).
create or replace function public.commit_intake_chunk(p_job_id uuid, p_worker_id text, p_job_version bigint, p_chunk jsonb)
returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_version bigint; v_owner text; v_expires timestamptz;
  v_ix integer := (p_chunk->>'chunkIndex')::integer;
  v_scope text := p_chunk->>'dedupScope';
  v_new integer;
  v_c jsonb := p_chunk->'counters';
begin
  if pg_column_size(p_chunk) > 1048576 then raise exception 'chunk too large'; end if;  -- bounded payload
  select version into v_version from public.retail_intake_jobs where id = p_job_id for update;
  if v_version is null then raise exception 'unknown job'; end if;
  select worker_id, lease_expires_at into v_owner, v_expires from public.retail_intake_worker_leases where job_id = p_job_id;
  if v_owner is distinct from p_worker_id or v_expires <= now() then raise exception 'stale_worker: lease'; end if;
  if v_version <> p_job_version then raise exception 'stale_worker: version'; end if;

  insert into public.retail_intake_job_chunks (job_id, chunk_index, chunk_hash, row_offset_start, row_offset_end, staged, duplicates, conflicts, rejected, evidence_created, duration_ms, worker_id)
  values (p_job_id, v_ix, p_chunk->>'chunkHash', (p_chunk->>'rowOffsetStart')::int, (p_chunk->>'rowOffsetEnd')::int,
          (v_c->>'staged')::int, (v_c->>'duplicates')::int, (v_c->>'conflicts')::int, (v_c->>'rejected')::int, (v_c->>'evidenceCreated')::int,
          coalesce((p_chunk->>'durationMs')::int, 0), p_worker_id)
  on conflict (job_id, chunk_index) do nothing;                      -- idempotent chunk replay
  get diagnostics v_new = row_count;
  if v_new = 0 then
    return jsonb_build_object('committed', false, 'already_committed', true, 'job_version', v_version);
  end if;

  insert into public.retail_intake_dedup_keys (scope, record_hash, draft_ref)
  select v_scope, k.record_hash, k.draft_ref
  from jsonb_to_recordset(coalesce(p_chunk->'dedupRefs','[]'::jsonb)) as k(record_hash text, draft_ref text)
  on conflict (scope, record_hash) do nothing;                       -- unique (scope, record_hash)

  -- Durable product index: first writer per (scope, product_key) wins, matching the
  -- in-memory store's first-seen-price semantics for conflict detection.
  insert into public.retail_intake_product_index (scope, product_key, price, draft_ref)
  select v_scope, p.key, p.price, p.draft_ref
  from jsonb_to_recordset(coalesce(p_chunk->'productKeys','[]'::jsonb)) as p(key text, price numeric, draft_ref text)
  on conflict (scope, product_key) do nothing;

  -- Durable staged-draft trace (refs only; idempotent with the chunk replay guard).
  insert into public.retail_intake_job_drafts (job_id, chunk_index, draft_ref, record_hash, conflict_state)
  select p_job_id, v_ix, d.draft_ref, d.record_hash, coalesce(d.conflict_state, 'none')
  from jsonb_to_recordset(coalesce(p_chunk->'draftRefs','[]'::jsonb)) as d(draft_ref text, record_hash text, conflict_state text)
  on conflict (job_id, draft_ref) do nothing;

  insert into public.retail_intake_quarantine (job_id, chunk_index, record_index, source_ref, excerpt, record_hash, error_class, error_codes, retryable)
  select p_job_id, v_ix, q.record_index, q.source_ref, left(q.excerpt, 256), q.record_hash, q.error_class::public.retail_intake_error_class, q.error_codes, q.retryable
  from jsonb_to_recordset(coalesce(p_chunk->'quarantine','[]'::jsonb)) as q(record_index int, source_ref text, excerpt text, record_hash text, error_class text, error_codes text[], retryable boolean)
  on conflict (job_id, chunk_index, record_index) do nothing;

  update public.retail_intake_jobs set
    processed_rows = processed_rows + (v_c->>'staged')::int + (v_c->>'duplicates')::int + (v_c->>'conflicts')::int + (v_c->>'rejected')::int,
    valid_rows = valid_rows + (v_c->>'staged')::int + (v_c->>'conflicts')::int,
    staged_drafts = staged_drafts + (v_c->>'staged')::int + (v_c->>'conflicts')::int,
    evidence_created = evidence_created + (v_c->>'evidenceCreated')::int,
    duplicate_rows = duplicate_rows + (v_c->>'duplicates')::int,
    conflict_rows = conflict_rows + (v_c->>'conflicts')::int,
    rejected_rows = rejected_rows + (v_c->>'rejected')::int,
    current_chunk_index = v_ix + 1, current_row_offset = (p_chunk#>>'{checkpoint,rowOffset}')::int,
    last_record_hash = p_chunk#>>'{checkpoint,lastRecordHash}', status = 'processing',
    version = version + 1, updated_at = now()
  where id = p_job_id
  returning version into v_version;

  insert into public.retail_intake_checkpoints (job_id, chunk_index, row_offset, last_record_hash, input_cursor, worker_id, job_version)
  values (p_job_id, v_ix, (p_chunk#>>'{checkpoint,rowOffset}')::int, p_chunk#>>'{checkpoint,lastRecordHash}', p_chunk#>>'{checkpoint,inputCursor}', p_worker_id, v_version)
  on conflict (job_id) do update set chunk_index = excluded.chunk_index, row_offset = excluded.row_offset, last_record_hash = excluded.last_record_hash, input_cursor = excluded.input_cursor, committed_at = now(), worker_id = excluded.worker_id, job_version = excluded.job_version;

  insert into public.retail_intake_events (job_id, worker_id, event_type, chunk_index, trace_id)
  values (p_job_id, p_worker_id, 'intake.chunk_committed', v_ix, 'trace_' || p_job_id::text),
         (p_job_id, p_worker_id, 'intake.checkpoint_saved', v_ix, 'trace_' || p_job_id::text);

  return jsonb_build_object('committed', true, 'already_committed', false, 'job_version', v_version);
end $$;

revoke all on function public.commit_intake_chunk(uuid, text, bigint, jsonb) from public, anon, authenticated;
grant execute on function public.commit_intake_chunk(uuid, text, bigint, jsonb) to service_role;

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
