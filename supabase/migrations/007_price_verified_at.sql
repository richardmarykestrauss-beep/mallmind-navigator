-- ── Migration 007 — price_verified_at ───────────────────────────────────────
-- Adds the price_verified_at column.
-- See migration 008 for the full data quality model.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS price_verified_at timestamptz;

COMMENT ON COLUMN products.price_verified_at IS
  'When this price was last manually verified against the real store price. '
  'Must only be set alongside data_quality_status = ''manually_verified''. '
  'NULL means the price has never been independently confirmed.';
