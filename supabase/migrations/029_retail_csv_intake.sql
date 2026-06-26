-- Sprint 20A.9 — Retail Fuel Intake: atomic CSV staging RPC (security-hardened)
--
-- Purpose:
--   Stage an APPROVED admin CSV import into the existing retail provenance
--   tables in ONE transaction, so a partial failure can never leave an orphan
--   source/snapshot/batch (the old script could). This RPC only STAGES
--   observations as review_status='pending'; it never publishes to products and
--   never verifies — publication still goes through the Sprint 20A.8
--   verification policy + publish_verified_observation RPC.
--
-- Hardening (independent security review):
--   This SECURITY DEFINER function VALIDATES ITS OWN INPUTS and never trusts the
--   TypeScript layer as the only gate. It defensively checks JSON container
--   types, every source/snapshot field, and every observation BEFORE any cast or
--   insert, so a malformed cast can never be the only line of defence. It also
--   enforces mall/shop/product coherence inside the database, de-duplicates the
--   incoming payload by observation_hash, and serialises concurrent source reuse
--   with a transactional advisory lock keyed on the deterministic source
--   identity.
--
-- product_id rule (documented safe rule, requirement #5):
--   If an observation supplies product_id, it MUST reference an existing,
--   non-deleted product whose shop_id/mall_id (when set) match the observation's
--   shop/mall. CSV intake never binds the observation to a *published* product
--   (published_product_id stays null) — that linkage happens only at publish time
--   under Sprint 20A.8. An incoherent product_id is rejected, not silently kept.
--
-- Safety: SECURITY DEFINER, locked search_path, schema-qualified, EXECUTE granted
--   to service_role only. NOT auto-applied by this sprint.

drop function if exists public.stage_retail_csv_import(uuid, jsonb, jsonb, jsonb, jsonb);

create function public.stage_retail_csv_import(
  p_admin_id      uuid,
  p_source        jsonb,
  p_snapshot      jsonb,
  p_batch         jsonb,
  p_observations  jsonb
)
returns table (
  source_id            uuid,
  snapshot_id          uuid,
  batch_id             uuid,
  input_rows           integer,
  unique_incoming      integer,
  duplicate_in_payload integer,
  skipped_existing     integer,
  staged_rows          integer,
  total_rows           integer,
  reused_source        boolean,
  reused_snapshot      boolean
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  c_uuid_re constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  c_sha_re  constant text := '^[0-9a-f]{64}$';
  c_num_re  constant text := '^[0-9]+(\.[0-9]+)?$';  -- non-negative decimal

  v_source_id     uuid;
  v_snapshot_id   uuid;
  v_batch_id      uuid;

  v_source_type   text := btrim(coalesce(p_source->>'source_type', ''));
  v_name          text := btrim(coalesce(p_source->>'name', ''));
  v_legal         text := btrim(coalesce(p_source->>'legal_status', ''));
  v_retailer      text := nullif(btrim(coalesce(p_source->>'retailer_name', '')), '');
  v_base_trust    numeric;
  v_attr_required boolean;
  v_mall_id       uuid;

  v_sha           text := btrim(coalesce(p_snapshot->>'content_sha256', ''));
  v_ref_label     text := nullif(btrim(coalesce(p_snapshot->>'ref_label', '')), '');
  v_captured_by   text := nullif(btrim(coalesce(p_snapshot->>'captured_by', '')), '');
  v_snap_notes    text := nullif(btrim(coalesce(p_snapshot->>'notes', '')), '');

  v_input         integer;
  v_unique        integer := 0;
  v_dup_payload   integer := 0;
  v_skipped       integer := 0;
  v_staged        integer := 0;
  v_reused_source boolean := false;
  v_reused_snap   boolean := false;

  v_o             jsonb;
  v_idx           integer;
  v_lock_key      text;
begin
  -- ── 0. Authorisation: admin_id must resolve to a current admin ────────────
  if p_admin_id is null then
    raise exception 'admin_id is required' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from public.profiles where id = p_admin_id and is_admin is true) then
    raise exception 'admin_id is not a current admin' using errcode = 'insufficient_privilege';
  end if;

  -- ── 1. Validate JSON container types (NEVER length-check before type) ──────
  if jsonb_typeof(p_source) is distinct from 'object' then
    raise exception 'p_source must be a JSON object' using errcode = 'check_violation';
  end if;
  if jsonb_typeof(p_snapshot) is distinct from 'object' then
    raise exception 'p_snapshot must be a JSON object' using errcode = 'check_violation';
  end if;
  if jsonb_typeof(p_batch) is distinct from 'object' then
    raise exception 'p_batch must be a JSON object' using errcode = 'check_violation';
  end if;
  if jsonb_typeof(p_observations) is distinct from 'array' then
    raise exception 'p_observations must be a JSON array' using errcode = 'check_violation';
  end if;
  v_input := jsonb_array_length(p_observations);  -- safe: type verified above
  if v_input < 1 then
    raise exception 'at least one observation is required' using errcode = 'check_violation';
  end if;

  -- ── 2. Validate required source fields ────────────────────────────────────
  if v_source_type = '' then
    raise exception 'source.source_type is required' using errcode = 'check_violation';
  end if;
  if v_source_type not in ('manual','csv','affiliate_feed','flyer','retailer_submission','user_submission','partner_feed') then
    raise exception 'source.source_type % is not a supported enum value', v_source_type using errcode = 'check_violation';
  end if;
  if v_name = '' then
    raise exception 'source.name is required' using errcode = 'check_violation';
  end if;
  if v_legal = '' then
    raise exception 'source.legal_status is required' using errcode = 'check_violation';
  end if;
  if v_legal not in ('manual_fact_entry','licensed_feed','retailer_supplied','user_supplied','partner_licensed','reference_only','needs_legal_review') then
    raise exception 'source.legal_status % is not a supported enum value', v_legal using errcode = 'check_violation';
  end if;
  if coalesce(p_source->>'mall_id', '') !~ c_uuid_re then
    raise exception 'source.mall_id is required and must be a UUID' using errcode = 'check_violation';
  end if;
  v_mall_id := (p_source->>'mall_id')::uuid;
  if not exists (select 1 from public.malls where id = v_mall_id) then
    raise exception 'source.mall_id references an unknown mall' using errcode = 'check_violation';
  end if;
  if coalesce(p_source->>'base_trust', '') !~ c_num_re then
    raise exception 'source.base_trust is required and must be a number' using errcode = 'check_violation';
  end if;
  v_base_trust := (p_source->>'base_trust')::numeric;
  if v_base_trust < 0 or v_base_trust > 1 then
    raise exception 'source.base_trust must be between 0 and 1' using errcode = 'check_violation';
  end if;
  -- optional source.shop_id (when present, must be a UUID in this mall)
  if nullif(btrim(coalesce(p_source->>'shop_id', '')), '') is not null then
    if (p_source->>'shop_id') !~ c_uuid_re then
      raise exception 'source.shop_id must be a UUID' using errcode = 'check_violation';
    end if;
    if not exists (select 1 from public.shops s where s.id = (p_source->>'shop_id')::uuid and s.mall_id = v_mall_id) then
      raise exception 'source.shop_id is unknown or not in the source mall' using errcode = 'check_violation';
    end if;
  end if;
  -- attribution_required: optional, but when present must be a real boolean
  if nullif(p_source->>'attribution_required', '') is not null
     and (p_source->>'attribution_required') not in ('true','false') then
    raise exception 'source.attribution_required must be a boolean' using errcode = 'check_violation';
  end if;
  v_attr_required := coalesce(nullif(p_source->>'attribution_required', '')::boolean, false);

  -- ── 3. Validate snapshot identity (never reuse on a null/blank hash) ───────
  if v_sha = '' then
    raise exception 'snapshot.content_sha256 is required' using errcode = 'check_violation';
  end if;
  if v_sha !~ c_sha_re then
    raise exception 'snapshot.content_sha256 must be exactly 64 lowercase hex chars' using errcode = 'check_violation';
  end if;
  if v_ref_label is null and v_captured_by is null and v_snap_notes is null then
    raise exception 'snapshot requires a ref_label or another deliberate evidence label' using errcode = 'check_violation';
  end if;

  -- ── 4. Validate EVERY observation defensively (before any insert) ─────────
  for v_idx in 0 .. v_input - 1 loop
    v_o := p_observations -> v_idx;

    if jsonb_typeof(v_o) is distinct from 'object' then
      raise exception 'observation % must be a JSON object', v_idx using errcode = 'check_violation';
    end if;

    -- deterministic hash: nonblank, exactly 64 lowercase hex
    if coalesce(v_o->>'observation_hash', '') !~ c_sha_re then
      raise exception 'observation % has a missing or malformed observation_hash', v_idx using errcode = 'check_violation';
    end if;

    -- mall coherence: valid UUID AND equal to the source mall
    if coalesce(v_o->>'mall_id', '') !~ c_uuid_re then
      raise exception 'observation % has an invalid mall_id', v_idx using errcode = 'check_violation';
    end if;
    if lower(v_o->>'mall_id') <> lower(v_mall_id::text) then
      raise exception 'observation % mall_id does not match the source mall', v_idx using errcode = 'check_violation';
    end if;

    -- shop: valid UUID
    if coalesce(v_o->>'shop_id', '') !~ c_uuid_re then
      raise exception 'observation % has an invalid shop_id', v_idx using errcode = 'check_violation';
    end if;

    if btrim(coalesce(v_o->>'product_name', '')) = '' then
      raise exception 'observation % is missing product_name', v_idx using errcode = 'check_violation';
    end if;

    -- price: numeric, non-negative
    if coalesce(v_o->>'price', '') !~ c_num_re then
      raise exception 'observation % has a non-numeric or negative price', v_idx using errcode = 'check_violation';
    end if;
    -- original_price: optional, but non-negative numeric when present
    if nullif(btrim(coalesce(v_o->>'original_price', '')), '') is not null
       and (v_o->>'original_price') !~ c_num_re then
      raise exception 'observation % has an invalid original_price', v_idx using errcode = 'check_violation';
    end if;

    -- booleans
    if coalesce(v_o->>'is_on_special', '') not in ('true','false') then
      raise exception 'observation % has an invalid is_on_special', v_idx using errcode = 'check_violation';
    end if;
    if coalesce(v_o->>'in_stock', '') not in ('true','false') then
      raise exception 'observation % has an invalid in_stock', v_idx using errcode = 'check_violation';
    end if;

    -- confidence: 0..1
    if coalesce(v_o->>'confidence', '') !~ c_num_re then
      raise exception 'observation % has a non-numeric confidence', v_idx using errcode = 'check_violation';
    end if;
    if (v_o->>'confidence')::numeric < 0 or (v_o->>'confidence')::numeric > 1 then
      raise exception 'observation % confidence must be between 0 and 1', v_idx using errcode = 'check_violation';
    end if;

    -- trust_state: supported enum
    if coalesce(v_o->>'trust_state', '') not in (
      'verified','retailer_submitted','live_feed','flyer_extracted','user_submitted',
      'web_observed','manual_fact_entry','disputed','needs_review','expired','stale'
    ) then
      raise exception 'observation % has an unsupported trust_state', v_idx using errcode = 'check_violation';
    end if;

    -- verification_method: supported enum OR null/none
    if nullif(v_o->>'verification_method', '') is not null
       and (v_o->>'verification_method') not in (
         'phone','website','flyer','receipt','store_visit','retailer_confirmation',
         'csv_manual','affiliate_feed','partner_feed','user_submission'
       ) then
      raise exception 'observation % has an unsupported verification_method', v_idx using errcode = 'check_violation';
    end if;

    -- optional timestamps: malformed values become a CONTROLLED error
    begin
      perform nullif(btrim(coalesce(v_o->>'observed_at', '')), '')::timestamptz;
      perform nullif(btrim(coalesce(v_o->>'valid_from', '')), '')::timestamptz;
      perform nullif(btrim(coalesce(v_o->>'valid_to', '')), '')::timestamptz;
    exception when others then
      raise exception 'observation % has an invalid timestamp', v_idx using errcode = 'check_violation';
    end;

    -- shop coherence: shop exists AND belongs to the source/observation mall
    if not exists (
      select 1 from public.shops s
       where s.id = (v_o->>'shop_id')::uuid and s.mall_id = v_mall_id
    ) then
      raise exception 'observation % shop_id is unknown or not in the source mall', v_idx using errcode = 'check_violation';
    end if;

    -- product_id coherence (documented safe rule above)
    if nullif(btrim(coalesce(v_o->>'product_id', '')), '') is not null then
      if (v_o->>'product_id') !~ c_uuid_re then
        raise exception 'observation % has an invalid product_id', v_idx using errcode = 'check_violation';
      end if;
      if not exists (
        select 1 from public.products p
         where p.id = (v_o->>'product_id')::uuid
           and p.deleted_at is null
           and (p.shop_id is null or p.shop_id = (v_o->>'shop_id')::uuid)
           and (p.mall_id is null or p.mall_id = v_mall_id)
      ) then
        raise exception 'observation % product_id is unknown or incoherent with its mall/shop', v_idx using errcode = 'check_violation';
      end if;
    end if;

    -- review_status is FORCED to pending below; reject any other declared value
    if nullif(v_o->>'review_status', '') is not null and (v_o->>'review_status') <> 'pending' then
      raise exception 'observation % review_status must be pending (CSV intake stages only)', v_idx using errcode = 'check_violation';
    end if;
  end loop;

  -- ── 5. Reuse or create the source (concurrency-safe) ──────────────────────
  -- Source reuse has no natural unique constraint (is_active is mutable), so we
  -- serialise concurrent calls that share the same deterministic source identity
  -- with a transactional advisory lock. Two simultaneous identical imports then
  -- deterministically reuse one source instead of racing to create two.
  v_lock_key := concat_ws('|',
    'retail_source',
    lower(v_source_type),
    lower(v_name),
    lower(coalesce(v_retailer, '')),
    lower(v_mall_id::text),
    lower(v_legal)
  );
  perform pg_advisory_xact_lock(hashtextextended(v_lock_key, 0));

  select id into v_source_id
    from public.retail_data_sources
   where source_type = v_source_type
     and name = v_name
     and coalesce(retailer_name, '') = coalesce(v_retailer, '')
     and mall_id is not distinct from v_mall_id
     and legal_status = v_legal
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
      v_source_type,
      v_name,
      v_retailer,
      v_mall_id,
      nullif(p_source->>'shop_id', '')::uuid,
      v_base_trust,
      v_legal,
      nullif(p_source->>'license_note', ''),
      v_attr_required,
      true
    )
    returning id into v_source_id;
  end if;

  -- ── 6. Reuse or create the evidence snapshot by (source_id, sha256) ───────
  select id into v_snapshot_id
    from public.retail_source_snapshots
   where source_id = v_source_id
     and content_sha256 = v_sha
   limit 1;

  if v_snapshot_id is not null then
    v_reused_snap := true;
  else
    insert into public.retail_source_snapshots (
      source_id, snapshot_type, ref_label, content_sha256, captured_by, notes
    ) values (
      v_source_id, 'csv', v_ref_label, v_sha, v_captured_by, v_snap_notes
    )
    on conflict (source_id, content_sha256)
      do update set ref_label = public.retail_source_snapshots.ref_label
    returning id into v_snapshot_id;
    if v_snapshot_id is null then
      select id into v_snapshot_id from public.retail_source_snapshots
        where source_id = v_source_id and content_sha256 = v_sha limit 1;
    end if;
  end if;

  -- ── 7. Create the import batch ────────────────────────────────────────────
  insert into public.retail_import_batches (
    source_id, snapshot_id, mall_id, status, source_file, total_rows, staged_rows, created_by
  ) values (
    v_source_id, v_snapshot_id, v_mall_id, 'processing',
    nullif(p_batch->>'source_file', ''), v_input, 0, p_admin_id::text
  )
  returning id into v_batch_id;

  -- ── 8. Dedup IN-PAYLOAD by hash, anti-join existing, stage as pending ─────
  -- distinct on (h) collapses repeated hashes in this payload to their FIRST
  -- occurrence so two same-hash rows can never collide on the pending unique
  -- index; the anti-join drops hashes that already exist in the DB; the
  -- on-conflict-do-nothing is a final guard against a concurrent insert of the
  -- same pending hash. review_status is FORCED to 'pending'.
  select count(distinct lower(elem->>'observation_hash'))
    into v_unique
    from jsonb_array_elements(p_observations) as elem;
  v_dup_payload := v_input - v_unique;

  with incoming as (
    select t.elem as o, t.ord as ord, lower(t.elem->>'observation_hash') as h
      from jsonb_array_elements(p_observations) with ordinality as t(elem, ord)
  ),
  deduped as (
    select distinct on (h) o, h from incoming order by h, ord
  ),
  fresh as (
    select d.o as o
      from deduped d
     where not exists (
       select 1 from public.retail_price_observations p
        where p.observation_hash = d.o->>'observation_hash'
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
      (o->>'mall_id')::uuid, (o->>'shop_id')::uuid, nullif(btrim(o->>'product_id'), '')::uuid,
      o->>'product_name', nullif(o->>'brand', ''), nullif(o->>'model', ''), nullif(o->>'category', ''),
      (o->>'price')::numeric, nullif(btrim(o->>'original_price'), '')::numeric, (o->>'is_on_special')::boolean,
      nullif(o->>'special_description', ''), (o->>'in_stock')::boolean,
      nullif(btrim(o->>'observed_at'), '')::timestamptz, nullif(btrim(o->>'valid_from'), '')::timestamptz,
      nullif(btrim(o->>'valid_to'), '')::timestamptz,
      o->>'trust_state', nullif(o->>'verification_method', ''), (o->>'confidence')::numeric,
      'pending',                              -- FORCED: CSV intake never publishes/verifies
      nullif(o->>'source_note', ''),
      o->>'observation_hash'
    from fresh
    on conflict do nothing
    returning 1
  )
  select count(*) into v_staged from inserted;

  -- skipped_existing = unique incoming hashes that already existed in the DB
  -- (semantically accurate: in-payload duplicates are NOT counted here).
  v_skipped := v_unique - v_staged;

  -- ── 9. Finalise batch + audit ─────────────────────────────────────────────
  update public.retail_import_batches
     set status = 'staged', staged_rows = v_staged
   where id = v_batch_id;

  insert into public.admin_audit_log (admin_id, action, table_name, row_id, old_values, new_values)
  values (
    p_admin_id, 'stage_retail_csv_import', 'retail_import_batches', v_batch_id, null,
    jsonb_build_object(
      'source_id', v_source_id, 'snapshot_id', v_snapshot_id, 'batch_id', v_batch_id,
      'input_rows', v_input, 'unique_incoming', v_unique, 'duplicate_in_payload', v_dup_payload,
      'skipped_existing', v_skipped, 'staged_rows', v_staged,
      'reused_source', v_reused_source, 'reused_snapshot', v_reused_snap
    )
  );

  source_id            := v_source_id;
  snapshot_id          := v_snapshot_id;
  batch_id             := v_batch_id;
  input_rows           := v_input;
  unique_incoming      := v_unique;
  duplicate_in_payload := v_dup_payload;
  skipped_existing     := v_skipped;
  staged_rows          := v_staged;
  total_rows           := v_input;
  reused_source        := v_reused_source;
  reused_snapshot      := v_reused_snap;
  return next;
end;
$$;

comment on function public.stage_retail_csv_import(uuid, jsonb, jsonb, jsonb, jsonb) is
  'Atomically stage an admin CSV import (defensive JSON/field/observation '
  'validation, mall/shop/product coherence, advisory-locked source reuse, '
  'snapshot reuse by (source_id,sha256), in-payload + existing hash dedup, '
  'pending observations, audit). Never publishes to products and never '
  'verifies — staging only.';

revoke all on function public.stage_retail_csv_import(uuid, jsonb, jsonb, jsonb, jsonb) from public;
revoke all on function public.stage_retail_csv_import(uuid, jsonb, jsonb, jsonb, jsonb) from anon;
revoke all on function public.stage_retail_csv_import(uuid, jsonb, jsonb, jsonb, jsonb) from authenticated;
grant execute on function public.stage_retail_csv_import(uuid, jsonb, jsonb, jsonb, jsonb) to service_role;
