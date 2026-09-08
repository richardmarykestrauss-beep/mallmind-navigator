-- Sprint 19B.1 — Security hardening for profiles + mall staging tables
--
-- Purpose:
-- 1. Prevent normal users from directly updating sensitive profile fields such as is_admin and xp.
-- 2. Remove public ALL access from mall intelligence / map staging tables.
-- 3. Keep staging tables backend/admin-service controlled only.
--
-- Notes:
-- - Service role bypasses RLS and remains the intended path for Cloud Run admin/import operations.
-- - Shopper/frontend clients must not write to staging tables.
-- - Future safe profile edits should go through explicit backend endpoints.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Lock down profiles UPDATE
-- ─────────────────────────────────────────────────────────────────────────────

drop policy if exists "Users can update own profile" on public.profiles;

revoke update on table public.profiles from anon;
revoke update on table public.profiles from authenticated;
revoke update on table public.profiles from public;

-- Keep SELECT policy untouched:
-- "Users can view own profile" using (auth.uid() = id)


-- ─────────────────────────────────────────────────────────────────────────────
-- 2) Remove public ALL policies from staging/source tables
-- ─────────────────────────────────────────────────────────────────────────────

drop policy if exists "admin_all_mall_map_assets"
  on public.mall_map_assets;

drop policy if exists "admin_all_mall_route_edges_staged"
  on public.mall_route_edges_staged;

drop policy if exists "admin_all_mall_route_nodes_staged"
  on public.mall_route_nodes_staged;

drop policy if exists "admin_all_mall_sources"
  on public.mall_sources;

drop policy if exists "admin_all_mall_store_locations_staged"
  on public.mall_store_locations_staged;

drop policy if exists "admin_all_mall_manual_map_anchors_staged"
  on public.mall_manual_map_anchors_staged;


-- ─────────────────────────────────────────────────────────────────────────────
-- 3) Remove direct anon/authenticated/public table privileges
-- ─────────────────────────────────────────────────────────────────────────────

revoke all on table public.mall_map_assets
  from anon, authenticated, public;

revoke all on table public.mall_route_edges_staged
  from anon, authenticated, public;

revoke all on table public.mall_route_nodes_staged
  from anon, authenticated, public;

revoke all on table public.mall_sources
  from anon, authenticated, public;

revoke all on table public.mall_store_locations_staged
  from anon, authenticated, public;

revoke all on table public.mall_manual_map_anchors_staged
  from anon, authenticated, public;
