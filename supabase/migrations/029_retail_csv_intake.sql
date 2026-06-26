-- Sprint 20A.9 — Retail Fuel Intake: atomic CSV staging RPC
--
-- Purpose:
--   Stage an APPROVED admin CSV import into the existing retail provenance
--   tables in ONE transaction, so a partial failure can never leave an orphan
--   source/snapshot/batch (the old script could). This RPC only STAGES
--   observations as review_status='pending'; it never publishes to products and
--   never verifies — publication still goes through the Sprint 20A.8
--   verification policy + publish_verified_observation RPC.
--
-- Behaviour:
--   - reuse an active, legally-clear source matching type/name/retailer/mall/
--     legal_status, else create one;
--   - reuse the evidence snapshot by (source_id, content_sha256), else create it;
--   - create the import batch;
--   - de-duplicate incoming rows against existing observation_hash values;
--   - insert only fresh rows as review_status='pending';
--   - mark the batch 'staged' and audit. All-or-nothing.
--
-- Safety: SECURITY DEFINER, locked search_path, schema-qualified, EXECUTE granted
--   to service_role only. NOT auto-applied by this sprint.

create or replace function public.stage_retail_csv_import(
  p_admin_id      uuid,
  p_source        jsonb,
  p_snapshot      jsonb,
  p_batch         jsonb,
  p_observations  jsonb
)
returns table (
  source_id        uuid,
  snapshot_id      uuid,
  batch_id         uuid,
  total_rows       integer,
  staged_rows      integer,
  skipped_existing integer,
  reused_source    boolean,
  reused_snapshot  boolean
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_source_id     uuid;
  v_snapshot_id   uuid;
  v_batch_id      uuid;
  v_mall_id       uuid := nullif(p_source->>'mall_id', '')::uuid;
  v_total         integer := coalesce(jsonb_array_length(p_observations), 0);
  v_staged        integer := 0;
  v_reused_source boolean := false;
  v_reused_snap   boolean := false;
begin
  -- Authorisation: admin_id must resolve to a current admin.
  if p_admin_id is null then
    raise exception 'admin_id is required' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from public.profiles where id = p_admin_id and is_admin is true) then
    raise exception 'admin_id is not a current admin' using errcode = 'insufficient_privilege';
  end if;

  if v_mall_id is null then
    raise exception 'source.mall_id is required' using errcode = 'check_violation';
  end if;

  -- ── 1. Reuse or create the source (never reuse inactive/illegal) ──────────
  select id into v_source_id
    from public.retail_data_sources
   where source_type = p_source->>'source_type'
     and name = p_source->>'name'
     and coalesce(retailer_name, '') = coalesce(p_source->>'retailer_name', '')
     and mall_id is not distinct from v_mall_id
     and legal_status = p_source->>'legal_status'
     and is_active = true
     and legal_status not in ('needs_legal_review', 'reference_only')
   limit 1;

  if v_source_id is not null then
    v_reused_source := true;
  else
    insert into public.retail_data_sources (
      source_type, name, retailer_name, mall_id, shop_id,
      base_trust, legal_status, license_note, attribution_required, is_active
    ) values (
      p_source->>'source_type',
      p_source->>'name',
      nullif(p_source->>'retailer_name', ''),
      v_mall_id,
      nullif(p_source->>'shop_id', '')::uuid,
      coalesce((p_source->>'base_trust')::numeric, 0.50),
      coalesce(p_source->>'legal_status', 'manual_fact_entry'),
      nullif(p_source->>'license_note', ''),
      coalesce((p_source->>'attribution_required')::boolean, false),
      true
    )
    returning id into v_source_id;
  end if;

  -- ── 2. Reuse or create the evidence snapshot by (source_id, sha256) ───────
  select id into v_snapshot_id
    from public.retail_source_snapshots
   where source_id = v_source_id
     and content_sha256 = p_snapshot->>'content_sha256'
   limit 1;

  if v_snapshot_id is not null then
    v_reused_snap := true;
  else
    insert into public.retail_source_snapshots (
      source_id, snapshot_type, ref_label, content_sha256, captured_by, notes
    ) values (
      v_source_id,
      'csv',
      nullif(p_snapshot->>'ref_label', ''),
      p_snapshot->>'content_sha256',
      nullif(p_snapshot->>'captured_by', ''),
      nullif(p_snapshot->>'notes', '')
    )
    on conflict (source_id, content_sha256)
      do update set ref_label = public.retail_source_snapshots.ref_label
    returning id into v_snapshot_id;
    if v_snapshot_id is null then
      select id into v_snapshot_id from public.retail_source_snapshots
        where source_id = v_source_id and content_sha256 = p_snapshot->>'content_sha256' limit 1;
    end if;
  end if;

  -- ── 3. Create the import batch ────────────────────────────────────────────
  insert into public.retail_import_batches (
    source_id, snapshot_id, mall_id, status, source_file, total_rows, staged_rows, created_by
  ) values (
    v_source_id, v_snapshot_id, v_mall_id, 'processing',
    nullif(p_batch->>'source_file', ''), v_total, 0, p_admin_id::text
  )
  returning id into v_batch_id;

  -- ── 4. Insert fresh observations (dedup vs existing hashes), always pending ─
  with incoming as (
    select o
    from jsonb_array_elements(coalesce(p_observations, '[]'::jsonb)) as o
  ),
  fresh as (
    select i.o as o
    from incoming i
    where not exists (
      select 1 from public.retail_price_observations p
       where p.observation_hash = i.o->>'observation_hash'
    )
  ),
  inserted as (
    insert into public.retail_price_observations (
      import_batch_id, source_id, snapshot_id, mall_id, shop_id, product_id,
      product_name, brand, model, category, price, original_price, is_on_special,
      special_description, in_stock, observed_at, valid_from, valid_to,
      trust_state, verification_method, confidence, review_status, review_note,
      observation_hash
    )
    select
      v_batch_id, v_source_id, v_snapshot_id,
      (o->>'mall_id')::uuid, (o->>'shop_id')::uuid, nullif(o->>'product_id', '')::uuid,
      o->>'product_name', nullif(o->>'brand', ''), nullif(o->>'model', ''), nullif(o->>'category', ''),
      (o->>'price')::numeric, nullif(o->>'original_price', '')::numeric, (o->>'is_on_special')::boolean,
      nullif(o->>'special_description', ''), (o->>'in_stock')::boolean,
      nullif(o->>'observed_at', '')::timestamptz, nullif(o->>'valid_from', '')::timestamptz,
      nullif(o->>'valid_to', '')::timestamptz,
      o->>'trust_state', nullif(o->>'verification_method', ''), (o->>'confidence')::numeric,
      'pending',                              -- FORCED: CSV intake never publishes/verifies
      nullif(o->>'source_note', ''),
      o->>'observation_hash'
    from fresh
    returning 1
  )
  select count(*) into v_staged from inserted;

  -- ── 5. Finalise batch + audit ─────────────────────────────────────────────
  update public.retail_import_batches
     set status = 'staged', staged_rows = v_staged
   where id = v_batch_id;

  insert into public.admin_audit_log (admin_id, action, table_name, row_id, old_values, new_values)
  values (
    p_admin_id, 'stage_retail_csv_import', 'retail_import_batches', v_batch_id, null,
    jsonb_build_object(
      'source_id', v_source_id, 'snapshot_id', v_snapshot_id, 'batch_id', v_batch_id,
      'total_rows', v_total, 'staged_rows', v_staged, 'skipped_existing', v_total - v_staged,
      'reused_source', v_reused_source, 'reused_snapshot', v_reused_snap
    )
  );

  source_id        := v_source_id;
  snapshot_id      := v_snapshot_id;
  batch_id         := v_batch_id;
  total_rows       := v_total;
  staged_rows      := v_staged;
  skipped_existing := v_total - v_staged;
  reused_source    := v_reused_source;
  reused_snapshot  := v_reused_snap;
  return next;
end;
$$;

comment on function public.stage_retail_csv_import(uuid, jsonb, jsonb, jsonb, jsonb) is
  'Atomically stage an admin CSV import (source reuse/create, snapshot reuse by '
  '(source_id,sha256), batch, hash-dedup, pending observations, audit). Never '
  'publishes to products and never verifies — staging only.';

revoke all on function public.stage_retail_csv_import(uuid, jsonb, jsonb, jsonb, jsonb) from public;
revoke all on function public.stage_retail_csv_import(uuid, jsonb, jsonb, jsonb, jsonb) from anon;
revoke all on function public.stage_retail_csv_import(uuid, jsonb, jsonb, jsonb, jsonb) from authenticated;
grant execute on function public.stage_retail_csv_import(uuid, jsonb, jsonb, jsonb, jsonb) to service_role;
