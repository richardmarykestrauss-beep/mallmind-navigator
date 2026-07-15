-- Sprint 2D — Retail Intelligence Fabric: durable intake infrastructure (additive).
--
-- Purpose:
--   Persist the bulk-intake job/checkpoint/quarantine/event model so the pure
--   engine (Sprint 2C) becomes crash-safe across Cloud Run restarts, worker
--   replacement, retries and concurrent workers. Import NEVER publishes an offer;
--   it only stages drafts for the existing human review + publication gates.
--
-- Design (documented, one coherent mechanism):
--   • worker leasing via `SELECT ... FOR UPDATE SKIP LOCKED` + an optimistic
--     `version` guard → exactly one live owner; a stale worker cannot commit.
--   • atomic chunk commit via a single SECURITY DEFINER RPC that persists chunk +
--     dedup keys + quarantine + counters + checkpoint + event in ONE transaction,
--     idempotent on (job_id, chunk_index) and unique (scope, record_hash).
--   • Postgres holds only object REFERENCES + bounded rows — never a raw payload.
--
-- Safety: additive only; SECURITY DEFINER; locked search_path; schema-qualified;
--   RLS enabled with NO anon/authenticated policies (service_role bypasses RLS);
--   EXECUTE granted to service_role only. NOT auto-applied by this sprint —
--   see docs/retail-fabric-sprint-2d.md for the reviewed apply/rollback plan.
--   Rollback anchor: commit 1d1e116 (Sprint 2C).

-- ── Enums (idempotent) ───────────────────────────────────────────────────────
do $$ begin
  create type public.retail_intake_status as enum
    ('queued','claimed','validating','processing','paused','needs_review','completed','completed_with_errors','failed','cancelled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.retail_intake_error_class as enum
    ('structural','validation','policy','identity','evidence','conflict','storage','transient','internal');
exception when duplicate_object then null; end $$;

-- ── Tables ───────────────────────────────────────────────────────────────────
create table if not exists public.retail_intake_jobs (
  id                        uuid primary key default gen_random_uuid(),
  source_id                 uuid not null,
  adapter_id                text,
  input_ref                 text not null,                      -- gs://bucket/object#generation (a reference, never the payload)
  input_hash                text not null,
  input_content_type        text not null,
  mode                      text not null,
  status                    public.retail_intake_status not null default 'queued',
  requested_by              text not null,
  priority                  integer not null default 0,
  total_bytes               bigint,
  estimated_rows            integer,
  processed_rows            integer not null default 0,
  valid_rows                integer not null default 0,
  rejected_rows             integer not null default 0,
  duplicate_rows            integer not null default 0,
  conflict_rows             integer not null default 0,
  staged_drafts             integer not null default 0,
  evidence_created          integer not null default 0,
  retry_count               integer not null default 0,
  max_retries               integer not null default 3,
  current_chunk_index       integer not null default 0,
  current_row_offset        integer not null default 0,
  last_record_hash          text,
  cancellation_requested_at timestamptz,
  paused_at                 timestamptz,
  started_at                timestamptz,
  completed_at              timestamptz,
  failed_at                 timestamptz,
  failure_code              text,
  failure_message_sanitized text,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  version                   bigint not null default 1,
  constraint retail_intake_jobs_input_hash_chk check (char_length(input_hash) between 8 and 200),
  constraint retail_intake_jobs_fail_msg_len_chk check (failure_message_sanitized is null or char_length(failure_message_sanitized) <= 500)
);
create index if not exists retail_intake_jobs_claimable_idx on public.retail_intake_jobs (status, priority desc, created_at);

create table if not exists public.retail_intake_worker_leases (
  job_id            uuid primary key references public.retail_intake_jobs(id) on delete cascade,
  worker_id         text not null,
  claimed_at        timestamptz not null default now(),
  lease_expires_at  timestamptz not null,
  heartbeat_at      timestamptz not null default now()
);

create table if not exists public.retail_intake_job_chunks (
  job_id          uuid not null references public.retail_intake_jobs(id) on delete cascade,
  chunk_index     integer not null,
  chunk_hash      text not null,
  row_offset_start integer not null,
  row_offset_end  integer not null,
  staged          integer not null default 0,
  duplicates      integer not null default 0,
  conflicts       integer not null default 0,
  rejected        integer not null default 0,
  evidence_created integer not null default 0,
  duration_ms     integer not null default 0,
  worker_id       text not null,
  committed_at    timestamptz not null default now(),
  primary key (job_id, chunk_index)                            -- idempotent chunk replay
);

create table if not exists public.retail_intake_checkpoints (
  job_id           uuid primary key references public.retail_intake_jobs(id) on delete cascade,
  chunk_index      integer not null,
  row_offset       integer not null,
  last_record_hash text,
  input_cursor     text,
  committed_at     timestamptz not null default now(),
  worker_id        text not null,
  job_version      bigint not null
);

create table if not exists public.retail_intake_quarantine (
  id              uuid primary key default gen_random_uuid(),
  job_id          uuid not null references public.retail_intake_jobs(id) on delete cascade,
  chunk_index     integer not null,
  record_index    integer not null,
  source_ref      text not null,
  excerpt         text not null,
  record_hash     text,
  error_class     public.retail_intake_error_class not null,
  error_codes     text[] not null default '{}',
  retryable       boolean not null default false,
  disposition     text not null default 'quarantined',
  created_at      timestamptz not null default now(),
  resolved_at     timestamptz,
  resolved_by     text,
  resolution_note text,
  constraint retail_intake_quarantine_excerpt_len_chk check (char_length(excerpt) <= 256),   -- bounded, no raw blob
  unique (job_id, chunk_index, record_index)
);

create table if not exists public.retail_intake_events (
  event_id     uuid primary key default gen_random_uuid(),
  job_id       uuid not null references public.retail_intake_jobs(id) on delete cascade,
  worker_id    text,
  event_type   text not null,
  chunk_index  integer,
  counts_delta jsonb,
  trace_id     text not null,
  created_at   timestamptz not null default now(),
  metadata     jsonb not null default '{}'::jsonb,
  constraint retail_intake_events_meta_bounded_chk check (pg_column_size(metadata) <= 4096)  -- bounded; no raw retail payload
);
create index if not exists retail_intake_events_job_idx on public.retail_intake_events (job_id, created_at);

create table if not exists public.retail_intake_dedup_keys (
  scope       text not null,
  record_hash text not null,
  draft_ref   text not null,
  created_at  timestamptz not null default now(),
  primary key (scope, record_hash)                             -- same record never multiplies
);

-- ── RLS: deny anon/authenticated; service_role bypasses RLS ──────────────────
do $$
declare t text;
begin
  foreach t in array array['retail_intake_jobs','retail_intake_worker_leases','retail_intake_job_chunks','retail_intake_checkpoints','retail_intake_quarantine','retail_intake_events','retail_intake_dedup_keys']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to service_role', t);
  end loop;
end $$;

-- ── RPC: claim the next queued/expired job (atomic; FOR UPDATE SKIP LOCKED) ───
drop function if exists public.claim_next_intake_job(text, integer);
create function public.claim_next_intake_job(p_worker_id text, p_lease_seconds integer)
returns public.retail_intake_jobs
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_job public.retail_intake_jobs;
begin
  if p_worker_id is null or char_length(p_worker_id) > 80 then raise exception 'invalid worker_id'; end if;
  if p_lease_seconds is null or p_lease_seconds < 1 or p_lease_seconds > 3600 then raise exception 'invalid lease_seconds'; end if;

  select j.* into v_job
  from public.retail_intake_jobs j
  left join public.retail_intake_worker_leases l on l.job_id = j.id
  where j.status in ('queued','claimed','validating','processing','paused')
    and j.cancellation_requested_at is null
    and (l.job_id is null or l.lease_expires_at <= now())
  order by j.priority desc, j.created_at
  for update of j skip locked
  limit 1;

  if v_job.id is null then return null; end if;

  insert into public.retail_intake_worker_leases (job_id, worker_id, claimed_at, lease_expires_at, heartbeat_at)
  values (v_job.id, p_worker_id, now(), now() + make_interval(secs => p_lease_seconds), now())
  on conflict (job_id) do update set worker_id = excluded.worker_id, claimed_at = now(), lease_expires_at = excluded.lease_expires_at, heartbeat_at = now();

  update public.retail_intake_jobs
     set status = case when status = 'queued' then 'claimed' else status end,
         started_at = coalesce(started_at, now()), version = version + 1, updated_at = now()
   where id = v_job.id
  returning * into v_job;

  insert into public.retail_intake_events (job_id, worker_id, event_type, trace_id, metadata)
  values (v_job.id, p_worker_id, 'intake.job_claimed', 'trace_' || v_job.id::text, '{}'::jsonb);
  return v_job;
end $$;

-- ── RPC: renew lease (heartbeat) with optimistic version guard ────────────────
drop function if exists public.renew_intake_lease(uuid, text, integer, bigint);
create function public.renew_intake_lease(p_job_id uuid, p_worker_id text, p_lease_seconds integer, p_job_version bigint)
returns boolean
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_version bigint; v_owner text; v_expires timestamptz;
begin
  select version into v_version from public.retail_intake_jobs where id = p_job_id for update;
  if v_version is null then raise exception 'unknown job'; end if;
  if v_version <> p_job_version then raise exception 'stale_worker: version'; end if;
  select worker_id, lease_expires_at into v_owner, v_expires from public.retail_intake_worker_leases where job_id = p_job_id for update;
  if v_owner is distinct from p_worker_id or v_expires <= now() then raise exception 'stale_worker: lease'; end if;
  update public.retail_intake_worker_leases set lease_expires_at = now() + make_interval(secs => p_lease_seconds), heartbeat_at = now() where job_id = p_job_id;
  insert into public.retail_intake_events (job_id, worker_id, event_type, trace_id) values (p_job_id, p_worker_id, 'intake.lease_renewed', 'trace_' || p_job_id::text);
  return true;
end $$;

-- ── RPC: atomic chunk commit (all-or-nothing; idempotent) ─────────────────────
-- p_chunk is a BOUNDED jsonb chunk result (never a whole-job payload). This RPC
-- validates the caller's lease + version, then persists chunk + dedup + quarantine
-- + counters + checkpoint + event in ONE transaction. Returns {committed, already_committed, job_version}.
drop function if exists public.commit_intake_chunk(uuid, text, bigint, jsonb);
create function public.commit_intake_chunk(p_job_id uuid, p_worker_id text, p_job_version bigint, p_chunk jsonb)
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

-- ── RPC: pause / resume / cancel / finalize ──────────────────────────────────
drop function if exists public.set_intake_job_control(uuid, text);
create function public.set_intake_job_control(p_job_id uuid, p_action text)
returns public.retail_intake_jobs
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_job public.retail_intake_jobs;
begin
  if p_action not in ('pause','resume','cancel') then raise exception 'invalid action'; end if;
  update public.retail_intake_jobs set
    paused_at = case p_action when 'pause' then now() when 'resume' then null else paused_at end,
    cancellation_requested_at = case p_action when 'cancel' then now() else cancellation_requested_at end,
    version = version + 1, updated_at = now()
  where id = p_job_id returning * into v_job;
  if v_job.id is null then raise exception 'unknown job'; end if;
  insert into public.retail_intake_events (job_id, event_type, trace_id)
  values (p_job_id, 'intake.job_' || (case p_action when 'pause' then 'paused' when 'resume' then 'resumed' else 'cancelled' end), 'trace_' || p_job_id::text);
  return v_job;
end $$;

-- ── Grants: service_role only; deny everyone else ────────────────────────────
do $$
declare fn text;
begin
  foreach fn in array array[
    'public.claim_next_intake_job(text, integer)',
    'public.renew_intake_lease(uuid, text, integer, bigint)',
    'public.commit_intake_chunk(uuid, text, bigint, jsonb)',
    'public.set_intake_job_control(uuid, text)'
  ]
  loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end $$;
