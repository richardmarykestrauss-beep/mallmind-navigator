-- Migration 022 — Map Factory extraction provider tracking fields
-- Sprint 16: Google AI Provider Layer
--
-- Adds four columns to map_factory_extractions to track which AI provider
-- was used, the full provider attempt chain (for debugging fallbacks),
-- an extraction version counter, and a content hash for cache dedup.
--
-- All columns are nullable / have defaults so existing rows are unaffected.

ALTER TABLE map_factory_extractions
  ADD COLUMN IF NOT EXISTS provider_used       TEXT,
  ADD COLUMN IF NOT EXISTS provider_chain      JSONB    DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS extraction_version  INTEGER  DEFAULT 1,
  ADD COLUMN IF NOT EXISTS content_hash        TEXT;

-- Index content_hash + provider_used for cache-hit lookups
CREATE INDEX IF NOT EXISTS idx_mfe_content_hash_provider
  ON map_factory_extractions (content_hash, provider_used)
  WHERE content_hash IS NOT NULL;

COMMENT ON COLUMN map_factory_extractions.provider_used      IS 'Name of the AI provider that produced this extraction (mock | gemini_vision_extraction | google_vision_ocr | google_document_ai_layout)';
COMMENT ON COLUMN map_factory_extractions.provider_chain     IS 'Ordered list of provider names attempted before success, e.g. ["gemini_vision_extraction","mock"]';
COMMENT ON COLUMN map_factory_extractions.extraction_version IS 'Monotonically increasing version; bump when re-extracting the same asset';
COMMENT ON COLUMN map_factory_extractions.content_hash       IS 'SHA-256 of the raw asset bytes; used to skip re-extraction when asset unchanged';
