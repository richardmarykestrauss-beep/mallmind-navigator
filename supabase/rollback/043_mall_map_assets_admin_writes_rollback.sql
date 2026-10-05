-- Rollback for 043: restore the migration-018 policies (any authenticated user may insert/delete).
drop policy if exists "mall_map_assets_admin_insert" on storage.objects;
drop policy if exists "mall_map_assets_admin_delete" on storage.objects;

create policy "mall_map_assets_auth_insert"
  on storage.objects
  for insert
  with check (bucket_id = 'mall-map-assets' and auth.role() = 'authenticated');

create policy "mall_map_assets_auth_delete"
  on storage.objects
  for delete
  using (bucket_id = 'mall-map-assets' and auth.role() = 'authenticated');
