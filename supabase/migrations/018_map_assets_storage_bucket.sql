-- ── Sprint 14A.2: Mall Map Assets Storage Bucket ─────────────────────────────
--
-- Creates the `mall-map-assets` Supabase Storage bucket used by the admin
-- file-upload flow.  Physical map photos, evacuation map scans, and archive
-- images are uploaded here and the resulting public URL is saved as
-- mall_map_assets.asset_url.
--
-- Safe to run repeatedly (ON CONFLICT DO NOTHING).
-- No destructive changes.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Create the bucket (public — URLs need no auth to render in the admin UI)
-- ─────────────────────────────────────────────────────────────────────────────

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'mall-map-assets',
  'mall-map-assets',
  true,
  20971520,  -- 20 MB per file
  array[
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/gif',
    'image/webp',
    'image/svg+xml',
    'application/pdf'
  ]
)
on conflict (id) do nothing;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. RLS policies on storage.objects
--    • Public SELECT  — so the admin UI can render images without a signed URL
--    • Authenticated INSERT / DELETE — only signed-in users (admins) can upload
-- ─────────────────────────────────────────────────────────────────────────────

-- Allow anyone to read objects in this bucket (images rendered in the UI)
create policy if not exists "mall_map_assets_public_read"
  on storage.objects
  for select
  using (bucket_id = 'mall-map-assets');

-- Allow authenticated users (admins) to upload files
create policy if not exists "mall_map_assets_auth_insert"
  on storage.objects
  for insert
  with check (
    bucket_id = 'mall-map-assets'
    and auth.role() = 'authenticated'
  );

-- Allow authenticated users to delete their own uploads
create policy if not exists "mall_map_assets_auth_delete"
  on storage.objects
  for delete
  using (
    bucket_id = 'mall-map-assets'
    and auth.role() = 'authenticated'
  );
