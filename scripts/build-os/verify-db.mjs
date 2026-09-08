import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import process from "node:process";

function run(name, command, args, options = {}) {
  console.log(`\n▶ ${name}`);

  const startedAt = Date.now();
  const result = spawnSync(command, args, {
    cwd: ".",
    stdio: "inherit",
    shell: process.platform === "win32",
    env: process.env,
    ...options,
  });

  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);

  if (result.status !== 0) {
    console.error(`\n✖ ${name} failed after ${seconds}s`);
    process.exit(result.status ?? 1);
  }

  console.log(`✔ ${name} (${seconds}s)`);
}

const config = readFileSync("supabase/config.toml", "utf8");
const projectMatch = config.match(/^project_id\s*=\s*"([^"]+)"/m);

if (!projectMatch) {
  console.error("Unable to determine project_id from supabase/config.toml.");
  process.exit(1);
}

const projectId = projectMatch[1];
const databaseContainer = `supabase_db_${projectId}`;

const assertions = String.raw`
\set ON_ERROR_STOP on

do $$
declare
  migration_count integer;
  public_table_count integer;
  public_function_count integer;
  policy_count integer;
begin
  select count(*)
    into migration_count
    from supabase_migrations.schema_migrations;

  if migration_count <> 43 then
    raise exception
      'Expected 43 applied migrations (000-042), found %',
      migration_count;
  end if;

  if not exists (
    select 1
      from supabase_migrations.schema_migrations
     where version = '000'
  ) then
    raise exception 'Baseline migration 000 is missing';
  end if;

  if not exists (
    select 1
      from supabase_migrations.schema_migrations
     where version = '041'
  ) then
    raise exception 'Latest migration 041 is missing';
  end if;

  select count(*)
    into public_table_count
    from pg_tables
   where schemaname = 'public';

  if public_table_count < 44 then
    raise exception
      'Expected at least 44 public tables, found %',
      public_table_count;
  end if;

  select count(*)
    into public_function_count
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public';

  if public_function_count < 35 then
    raise exception
      'Expected at least 35 public functions, found %',
      public_function_count;
  end if;

  -- Migration 042 — shopper-table RLS hardening (3 Sept 2026 audit blockers).
  -- Assert row security is ENABLED on every table the audit found open, that
  -- the PUBLIC shopping_routes policy is gone, and that the navigation graph
  -- is readable by shoppers but not writable by them.
  if exists (
    select 1
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relname in (
         'shopping_routes', 'search_events', 'app_events', 'mall_nodes',
         'mall_edges', 'import_jobs', 'admin_audit_log', 'achievements'
       )
       and c.relrowsecurity = false
  ) then
    raise exception 'Migration 042: row level security must be enabled on shopper/graph/admin tables';
  end if;

  if exists (
    select 1 from pg_policies
     where schemaname = 'public'
       and tablename = 'shopping_routes'
       and policyname = 'Service role full access routes'
  ) then
    raise exception 'Migration 042: PUBLIC USING(true) policy on shopping_routes must be dropped';
  end if;

  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'mall_nodes'
       and policyname = 'mall_nodes_public_read' and cmd = 'SELECT'
  ) or not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'mall_edges'
       and policyname = 'mall_edges_public_read' and cmd = 'SELECT'
  ) then
    raise exception 'Migration 042: navigation graph public-read policies are missing';
  end if;

  if exists (
    select 1 from pg_policies
     where schemaname = 'public'
       and tablename in ('mall_nodes', 'mall_edges', 'achievements', 'import_jobs', 'admin_audit_log')
       and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
  ) then
    raise exception 'Migration 042: no client write policy may exist on graph/admin/catalogue tables';
  end if;

  if exists (
    select 1
      from unnest(array['mall_nodes', 'mall_edges', 'achievements', 'import_jobs', 'admin_audit_log']) as t(name)
     cross join unnest(array['anon', 'authenticated']) as r(role)
     where has_table_privilege(r.role, 'public.' || t.name, 'INSERT')
        or has_table_privilege(r.role, 'public.' || t.name, 'UPDATE')
        or has_table_privilege(r.role, 'public.' || t.name, 'DELETE')
  ) then
    raise exception 'Migration 042: anon/authenticated must hold no write privilege on graph/admin/catalogue tables';
  end if;

  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'search_events'
       and policyname = 'search_events_client_insert' and cmd = 'INSERT'
  ) or not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'app_events'
       and policyname = 'app_events_client_insert' and cmd = 'INSERT'
  ) then
    raise exception 'Migration 042: analytics client-insert policies are missing (frontend analytics would break)';
  end if;

  select count(*)
    into policy_count
    from pg_policies
   where schemaname in ('public', 'storage');

  if policy_count < 24 then
    raise exception
      'Expected at least 24 public/storage policies, found %',
      policy_count;
  end if;

  if to_regclass('public.malls') is null
     or to_regclass('public.shops') is null
     or to_regclass('public.products') is null
     or to_regclass('public.retail_price_observations') is null
     or to_regclass('public.map_factory_jobs') is null then
    raise exception 'One or more critical MallMind tables are missing';
  end if;

  if not exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'profiles'
       and column_name = 'xp'
  ) then
    raise exception 'profiles.xp is missing';
  end if;

  if exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'profiles'
       and column_name = 'xp_points'
  ) then
    raise exception 'Legacy profiles.xp_points still exists';
  end if;

  if not exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'products'
       and column_name = 'data_quality_status'
  ) then
    raise exception 'products.data_quality_status is missing';
  end if;

  -- Sprint 2G (migration 035) — mall directory truth fields on shops.
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'shops'
       and column_name in ('store_number','zone','branch_status','verification_status',
                           'confidence_score','observed_at','last_verified_at',
                           'primary_source_url','source_owner','contradiction_notes',
                           'normalized_retailer_name')
     group by table_name having count(*) = 11
  ) then
    raise exception '035 shops directory/provenance columns are missing or incomplete';
  end if;

  -- The dangerous invented-value defaults must be GONE (no fabricated floor/hours).
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'shops'
       and column_name in ('floor','opening_time','closing_time')
       and column_default is not null
  ) then
    raise exception '035: shops.floor/opening_time/closing_time still carry a DEFAULT (invented value)';
  end if;

  -- category must be nullable so "unknown" is representable without inventing.
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'shops'
       and column_name = 'category' and is_nullable = 'NO'
  ) then
    raise exception '035: shops.category is still NOT NULL (cannot represent unknown category)';
  end if;

  -- Sprint 2I (migration 036) — retail truth-model.
  if to_regclass('public.retail_source_listings') is null then
    raise exception '036: retail_source_listings table is missing';
  end if;
  if not exists (
    select 1 from information_schema.columns
     where table_schema='public' and table_name='retail_data_sources'
       and column_name in ('lifecycle_state','rights_review_state','commercial_use_allowed',
                           'storage_allowed','image_reuse_allowed','description_reuse_allowed')
     group by table_name having count(*) = 6
  ) then
    raise exception '036: retail_data_sources rights/lifecycle columns are missing or incomplete';
  end if;
  if not exists (
    select 1 from information_schema.columns
     where table_schema='public' and table_name='retail_price_observations'
       and column_name in ('listing_id','price_scope','availability_scope','price_condition',
                           'price_condition_label','loyalty_program','minimum_quantity','promotion_text',
                           'source_product_id','retailer_sku','barcode','source_url','variant','pack_size')
     group by table_name having count(*) = 14
  ) then
    raise exception '036: retail_price_observations truth-model columns are missing or incomplete';
  end if;
  if exists (
    select 1 from information_schema.columns
     where table_schema='public' and table_name='retail_price_observations'
       and column_name in ('shop_id','mall_id') and is_nullable = 'NO'
  ) then
    raise exception '036: retail_price_observations shop_id/mall_id are still NOT NULL';
  end if;
  if exists (
    select 1 from information_schema.columns
     where table_schema='public' and table_name='products'
       and column_name = 'category' and is_nullable = 'NO'
  ) then
    raise exception '036: products.category is still NOT NULL';
  end if;
  if not exists (
    select 1 from information_schema.columns
     where table_schema='public' and table_name='products'
       and column_name in ('availability_scope','price_condition','price_condition_label')
     group by table_name having count(*) = 3
  ) then
    raise exception '036: products scope/condition columns are missing';
  end if;
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.retail_price_observations'::regclass
       and conname = 'rpo_branch_confirmed_requires_branch_check'
  ) then
    raise exception '036: branch-confirmed CHECK constraint is missing';
  end if;

  -- Migration 037 — products.price_condition CHECK (matches the observation vocabulary).
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.products'::regclass
       and conname = 'products_price_condition_check'
  ) then
    raise exception '037: products_price_condition_check constraint is missing';
  end if;

  -- Migration 038 — products.price_scope column + CHECK.
  if not exists (
    select 1 from information_schema.columns
     where table_schema='public' and table_name='products' and column_name='price_scope'
  ) then
    raise exception '038: products.price_scope column is missing';
  end if;
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.products'::regclass
       and conname = 'products_price_scope_check'
  ) then
    raise exception '038: products_price_scope_check constraint is missing';
  end if;

  -- Migration 039 — governed mapping table + fail-closed staging RPC.
  if to_regclass('public.retail_external_location_mappings') is null then
    raise exception '039: retail_external_location_mappings table is missing';
  end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'stage_retail_feed_observation'
  ) then
    raise exception '039: stage_retail_feed_observation RPC is missing';
  end if;
  if not exists (
    select 1 from information_schema.columns
     where table_schema='public' and table_name='retail_price_observations'
       and column_name in ('branch_external_id','feed_content_hash','feed_source_row','feed_file_name','feed_parse_warnings','staged_actor')
     group by table_name having count(*) = 6
  ) then
    raise exception '039: retail_price_observations feed/staging columns are missing or incomplete';
  end if;
  -- Migration 040 — canonical-funnel traceability columns on retail_price_observations.
  if not exists (
    select 1 from information_schema.columns
     where table_schema='public' and table_name='retail_price_observations'
       and column_name in ('intake_job_id','intake_draft_ref')
     group by table_name having count(*) = 2
  ) then
    raise exception '040: retail_price_observations traceability columns (intake_job_id, intake_draft_ref) are missing';
  end if;
  -- staging RPC (040 signature: +p_intake_job_id, +p_intake_draft_ref) must be execute-revoked
  -- from public/anon/authenticated and granted to service_role.
  if has_function_privilege('public','public.stage_retail_feed_observation(uuid,uuid,text,text,text,text,text,text,text,text,text,bigint,bigint,boolean,text,text,text,text,text,text,text,timestamptz,text,integer,text,jsonb,uuid,text)','EXECUTE')
     or has_function_privilege('anon','public.stage_retail_feed_observation(uuid,uuid,text,text,text,text,text,text,text,text,text,bigint,bigint,boolean,text,text,text,text,text,text,text,timestamptz,text,integer,text,jsonb,uuid,text)','EXECUTE')
     or has_function_privilege('authenticated','public.stage_retail_feed_observation(uuid,uuid,text,text,text,text,text,text,text,text,text,bigint,bigint,boolean,text,text,text,text,text,text,text,timestamptz,text,integer,text,jsonb,uuid,text)','EXECUTE') then
    raise exception '040: staging RPC is executable by public/anon/authenticated';
  end if;

  -- Migration 041 — durable promotion ledger on retail_intake_job_drafts + ledger RPCs.
  if not exists (
    select 1 from information_schema.columns
     where table_schema='public' and table_name='retail_intake_job_drafts'
       and column_name in ('staging_candidate','candidate_version','promotion_state','promotion_outcome','observation_id','promotion_attempts','promoted_at')
     group by table_name having count(*) = 7
  ) then
    raise exception '041: retail_intake_job_drafts promotion-ledger columns are missing or incomplete';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='persist_draft_staging_candidate')
     or not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='record_draft_promotion')
     or not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='list_promotable_drafts') then
    raise exception '041: promotion-ledger RPCs are missing';
  end if;
  if has_function_privilege('anon','public.record_draft_promotion(uuid,text,text,uuid,text)','EXECUTE')
     or has_function_privilege('authenticated','public.record_draft_promotion(uuid,text,text,uuid,text)','EXECUTE') then
    raise exception '041: ledger RPC executable by anon/authenticated';
  end if;

  if not exists (
    select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = 'stage_retail_csv_import'
  ) then
    raise exception 'stage_retail_csv_import RPC is missing';
  end if;

  if not exists (
    select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = 'publish_verified_observation'
  ) then
    raise exception 'publish_verified_observation RPC is missing';
  end if;

  -- Sprint 2D/2E — durable intake contract must survive a full rebuild.
  if to_regclass('public.retail_intake_jobs') is null
     or to_regclass('public.retail_intake_job_chunks') is null
     or to_regclass('public.retail_intake_checkpoints') is null
     or to_regclass('public.retail_intake_dedup_keys') is null then
    raise exception 'One or more durable intake tables are missing';
  end if;

  -- Presence: all four durable intake RPC names must exist. Scalar count, so it
  -- works on every Postgres version (the earlier group-by form did not).
  if (
    select count(distinct p.proname)
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('commit_intake_chunk', 'claim_next_intake_job', 'create_intake_job', 'intake_job_reconciliation')
  ) <> 4 then
    raise exception 'One or more durable intake RPCs are missing';
  end if;

  -- Signatures: a name-only check would pass for an overloaded or wrong-argument
  -- function, so assert each RPC's exact input-argument types (033 + 034).
  -- oidvectortypes(proargtypes) yields the types ONLY ("uuid, text, ..."), unlike
  -- pg_get_function_identity_arguments which also embeds the parameter names.
  if (
    select count(*)
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and (p.proname, oidvectortypes(p.proargtypes)) in (
         ('commit_intake_chunk',        'uuid, text, bigint, jsonb'),
         ('claim_next_intake_job',      'text, integer'),
         ('create_intake_job',          'uuid, text, text, text, text, text, integer, bigint, integer, integer, boolean, text, boolean'),
         ('intake_job_reconciliation',  'uuid')
       )
  ) <> 4 then
    raise exception 'Durable intake RPCs have unexpected signatures';
  end if;

  if not exists (
    select 1
      from storage.buckets
     where id = 'mall-map-assets'
  ) then
    raise exception 'mall-map-assets storage bucket is missing';
  end if;

  if (
    select count(*)
      from pg_policies
     where schemaname = 'storage'
       and tablename = 'objects'
       and policyname in (
         'mall_map_assets_public_read',
         'mall_map_assets_auth_insert',
         'mall_map_assets_auth_delete'
       )
  ) <> 3 then
    raise exception 'Mall map storage policies are incomplete';
  end if;
end
$$;

select
  'database verification passed'
  || ' | migrations='
  || (select count(*) from supabase_migrations.schema_migrations)
  || ' | tables='
  || (select count(*) from pg_tables where schemaname = 'public')
  || ' | functions='
  || (
    select count(*)
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
  )
  || ' | policies='
  || (
    select count(*)
      from pg_policies
     where schemaname in ('public', 'storage')
  ) as result;
`;

console.log("MallMind Build OS Database Verification");
console.log(`Node ${process.versions.node}`);
console.log(`Supabase project ID: ${projectId}`);

run(
  "Start disposable local Supabase stack",
  "npx",
  ["supabase", "start"],
);

run(
  "Rebuild database from migrations 000-042",
  "npx",
  ["supabase", "db", "reset"],
);

const psqlArgs = [
  "exec", "-i", databaseContainer,
  "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1",
];

run(
  "Assert final database contract",
  "docker",
  psqlArgs,
  { input: assertions, stdio: ["pipe", "inherit", "inherit"] },
);

// Sprint 2I — prove the retail truth-model end-to-end on throwaway data (the ten
// hard cases: online/branch scope, rights gate, price conditions, dedup, null category).
run(
  "Assert retail truth-model (036) fixture",
  "docker",
  psqlArgs,
  { input: readFileSync("scripts/build-os/retail-036-fixture.sql", "utf8"), stdio: ["pipe", "inherit", "inherit"] },
);

// Sprint 2L-B — prove the pending-review staging bridge end-to-end on real Postgres
// (staging, idempotency, mapping governance, role security, publication boundary).
run(
  "Assert retail staging bridge (039) fixture",
  "docker",
  psqlArgs,
  { input: readFileSync("scripts/build-os/retail-staging-fixture.sql", "utf8"), stdio: ["pipe", "inherit", "inherit"] },
);

console.log("\n✔ DATABASE VERIFICATION PASSED");
