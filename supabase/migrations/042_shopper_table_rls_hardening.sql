-- ============================================================================
-- Migration 042 — Real-wayfinding MVP foundation: shopper-table RLS hardening
--
-- Closes the four table-level exposures confirmed by the 3 Sept 2026 audit:
--
--   1. shopping_routes carried a policy "Service role full access routes"
--      written as USING (true) WITH CHECK (true) with NO role clause (006).
--      Postgres applies a policy without TO to PUBLIC, so anon/authenticated
--      could read, update and delete every user's routes. The service role
--      bypasses RLS anyway, so the policy is simply dropped. "Users manage own
--      routes" (auth.uid() = user_id) remains. The Cloud Run backend keeps
--      writing routes through the service role, unaffected.
--
--   2. mall_nodes / mall_edges never had RLS (005). The navigation graph is
--      legitimately PUBLIC-READ (a shopper may see the map) but must never be
--      client-writable. Enable RLS, allow SELECT to anon+authenticated, and
--      revoke every write privilege from client roles. The backend (service
--      role) and admin importers are unaffected.
--
--   3. search_events / app_events never had RLS (004). The frontend inserts
--      into them with the anon key (src/lib/analytics.ts), so INSERT must stay
--      open to clients — but constrained so a caller can only attribute an
--      event to nobody (null) or to themselves. Reads are admin-only (the same
--      is_admin pattern as analytics_events in 010). No client update/delete.
--
--   4. import_jobs / admin_audit_log (009) and achievements (000) never had
--      RLS. import_jobs and admin_audit_log become admin-read, no client write.
--      achievements is a public catalogue the frontend reads
--      (src/lib/achievements.ts) → public SELECT, no client write.
--
-- Least privilege, no new tables, no data change. Idempotent: safe to re-run
-- against a hosted project whose policy set has drifted from the migrations.
-- Rollback: supabase/rollback/042_shopper_table_rls_hardening_rollback.sql
-- ============================================================================

-- ── 1. shopping_routes ─────────────────────────────────────────────────────
drop policy if exists "Service role full access routes" on public.shopping_routes;

-- ── 2. Navigation graph: public read, never client-writable ────────────────
alter table public.mall_nodes enable row level security;
alter table public.mall_edges enable row level security;

drop policy if exists mall_nodes_public_read on public.mall_nodes;
create policy mall_nodes_public_read
  on public.mall_nodes
  for select
  to anon, authenticated
  using (true);

drop policy if exists mall_edges_public_read on public.mall_edges;
create policy mall_edges_public_read
  on public.mall_edges
  for select
  to anon, authenticated
  using (true);

revoke insert, update, delete, truncate, references, trigger
  on table public.mall_nodes from anon, authenticated;
revoke insert, update, delete, truncate, references, trigger
  on table public.mall_edges from anon, authenticated;

-- ── 3. Behavioural event tables: client insert (self or anonymous), admin read
alter table public.search_events enable row level security;
alter table public.app_events    enable row level security;

drop policy if exists search_events_client_insert on public.search_events;
create policy search_events_client_insert
  on public.search_events
  for insert
  to anon, authenticated
  with check (user_id is null or user_id = auth.uid());

drop policy if exists search_events_admin_read on public.search_events;
create policy search_events_admin_read
  on public.search_events
  for select
  to authenticated
  using (
    exists (
      select 1 from public.profiles
       where profiles.id = auth.uid()
         and profiles.is_admin = true
    )
  );

drop policy if exists app_events_client_insert on public.app_events;
create policy app_events_client_insert
  on public.app_events
  for insert
  to anon, authenticated
  with check (user_id is null or user_id = auth.uid());

drop policy if exists app_events_admin_read on public.app_events;
create policy app_events_admin_read
  on public.app_events
  for select
  to authenticated
  using (
    exists (
      select 1 from public.profiles
       where profiles.id = auth.uid()
         and profiles.is_admin = true
    )
  );

revoke update, delete, truncate, references, trigger
  on table public.search_events from anon, authenticated;
revoke update, delete, truncate, references, trigger
  on table public.app_events from anon, authenticated;
revoke select on table public.search_events from anon;
revoke select on table public.app_events    from anon;

-- ── 4a. Admin operational tables: admin read, no client write ──────────────
alter table public.import_jobs     enable row level security;
alter table public.admin_audit_log enable row level security;

drop policy if exists import_jobs_admin_read on public.import_jobs;
create policy import_jobs_admin_read
  on public.import_jobs
  for select
  to authenticated
  using (
    exists (
      select 1 from public.profiles
       where profiles.id = auth.uid()
         and profiles.is_admin = true
    )
  );

drop policy if exists admin_audit_log_admin_read on public.admin_audit_log;
create policy admin_audit_log_admin_read
  on public.admin_audit_log
  for select
  to authenticated
  using (
    exists (
      select 1 from public.profiles
       where profiles.id = auth.uid()
         and profiles.is_admin = true
    )
  );

revoke insert, update, delete, truncate, references, trigger
  on table public.import_jobs from anon, authenticated;
revoke insert, update, delete, truncate, references, trigger
  on table public.admin_audit_log from anon, authenticated;
revoke select on table public.import_jobs     from anon;
revoke select on table public.admin_audit_log from anon;

-- ── 4b. achievements: public catalogue, never client-writable ──────────────
alter table public.achievements enable row level security;

drop policy if exists achievements_public_read on public.achievements;
create policy achievements_public_read
  on public.achievements
  for select
  to anon, authenticated
  using (true);

revoke insert, update, delete, truncate, references, trigger
  on table public.achievements from anon, authenticated;

comment on policy mall_nodes_public_read on public.mall_nodes is
  'Navigation graph is public-read for shoppers; writes only via service role / admin import paths (migration 042).';
comment on policy search_events_client_insert on public.search_events is
  'Clients may log a search for themselves or anonymously; never for another user (migration 042).';
