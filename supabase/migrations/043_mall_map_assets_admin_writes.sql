-- ── Sprint 8: mall-map-assets write policies → admins only ────────────────────
--
-- Migration 018 let ANY authenticated user insert into and delete from the public
-- `mall-map-assets` bucket (which accepts SVG and PDF). The only legitimate writer
-- is the admin Mall Intelligence tab (an is_admin user uploading from the browser).
-- This narrows insert/delete to is_admin profiles. Public read is unchanged (the
-- admin UI renders the images by URL). This bucket must NOT be reused for future
-- Venue Factory customer uploads (see docs/architecture/legacy-spatial-retirement.md).
-- Rollback: supabase/rollback/043_mall_map_assets_admin_writes_rollback.sql

drop policy if exists "mall_map_assets_auth_insert" on storage.objects;
drop policy if exists "mall_map_assets_auth_delete" on storage.objects;

create policy "mall_map_assets_admin_insert"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'mall-map-assets'
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true)
  );

create policy "mall_map_assets_admin_delete"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'mall-map-assets'
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true)
  );
