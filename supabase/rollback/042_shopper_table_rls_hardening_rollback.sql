-- Rollback for 042_shopper_table_rls_hardening.sql. NOT auto-executed.
--
-- Restores the pre-042 state EXCEPT the shopping_routes PUBLIC policy, which is
-- a confirmed data exposure and is deliberately not recreated. Everything else
-- (RLS enablement, policies, revoked privileges) is reversed so the hosted
-- project can be returned to its previous behaviour if the frontend breaks.

-- 4b. achievements
drop policy if exists achievements_public_read on public.achievements;
alter table public.achievements disable row level security;
grant insert, update, delete on table public.achievements to anon, authenticated;

-- 4a. import_jobs / admin_audit_log
drop policy if exists import_jobs_admin_read on public.import_jobs;
drop policy if exists admin_audit_log_admin_read on public.admin_audit_log;
alter table public.import_jobs     disable row level security;
alter table public.admin_audit_log disable row level security;
grant select, insert, update, delete on table public.import_jobs     to anon, authenticated;
grant select, insert, update, delete on table public.admin_audit_log to anon, authenticated;

-- 3. search_events / app_events
drop policy if exists search_events_client_insert on public.search_events;
drop policy if exists search_events_admin_read   on public.search_events;
drop policy if exists app_events_client_insert   on public.app_events;
drop policy if exists app_events_admin_read      on public.app_events;
alter table public.search_events disable row level security;
alter table public.app_events    disable row level security;
grant select, insert, update, delete on table public.search_events to anon, authenticated;
grant select, insert, update, delete on table public.app_events    to anon, authenticated;

-- 2. mall_nodes / mall_edges
drop policy if exists mall_nodes_public_read on public.mall_nodes;
drop policy if exists mall_edges_public_read on public.mall_edges;
alter table public.mall_nodes disable row level security;
alter table public.mall_edges disable row level security;
grant insert, update, delete on table public.mall_nodes to anon, authenticated;
grant insert, update, delete on table public.mall_edges to anon, authenticated;

-- 1. shopping_routes: the PUBLIC USING(true) policy is intentionally NOT restored.
