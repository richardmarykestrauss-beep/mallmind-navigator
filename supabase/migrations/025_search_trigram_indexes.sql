-- Sprint 19B.4 — Product search scale hardening
--
-- Purpose:
-- Current product/store search uses ILIKE '%query%'.
-- That pattern does not scale well without trigram indexes.
--
-- This migration:
-- 1. Enables pg_trgm.
-- 2. Adds GIN trigram indexes for product name/category.
-- 3. Adds GIN trigram index for shop name.
--
-- Notes:
-- - This keeps existing code working.
-- - Future backend search can move toward ranked search using similarity(),
--   full text search, or hybrid scoring.
-- - This does not expose new data.
-- - This does not change RLS.

create extension if not exists pg_trgm;

create index if not exists products_name_trgm_idx
  on public.products
  using gin (name gin_trgm_ops);

create index if not exists products_category_trgm_idx
  on public.products
  using gin (category gin_trgm_ops);

create index if not exists shops_name_trgm_idx
  on public.shops
  using gin (name gin_trgm_ops);
