-- Migration 023 — map_factory_assets.content_hash
-- Sprint 16.2: formalise the live hotfix applied after the Sprint 16 Cloud Run
-- deployment failure ("column map_factory_assets.content_hash does not exist").
--
-- The existing column is named "hash"; the backend extraction service queries
-- "content_hash" for cache deduplication.  This migration adds content_hash,
-- backfills it from hash, and creates an index so cache lookups are fast.
--
-- Safe to run on the already-hotfixed database — all three statements are
-- idempotent (IF NOT EXISTS / WHERE content_hash IS NULL).

-- 1. Add the column (no-op if the hotfix already added it)
ALTER TABLE public.map_factory_assets
  ADD COLUMN IF NOT EXISTS content_hash TEXT;

-- 2. Backfill from the existing hash column where content_hash is still null
UPDATE public.map_factory_assets
   SET content_hash = hash
 WHERE content_hash IS NULL
   AND hash IS NOT NULL;

-- 3. Index for O(1) cache-hit lookups in extractAsset()
CREATE INDEX IF NOT EXISTS idx_map_factory_assets_content_hash
  ON public.map_factory_assets (content_hash);

COMMENT ON COLUMN public.map_factory_assets.content_hash IS
  'SHA-256 of the raw asset bytes; used by the Map Factory extraction service '
  'to skip re-extraction when the asset has not changed. Backfilled from the '
  'legacy "hash" column. See mapFactoryExtractionService.ts.';
