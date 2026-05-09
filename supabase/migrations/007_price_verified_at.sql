-- ── Migration 007 — price_verified_at ───────────────────────────────────────
-- Adds a price_verified_at timestamp to products so the Dev Agent can
-- distinguish DEMO_DATA (seeded, unverified) from VERIFIED_DATA (seeded but
-- manually confirmed against real store prices).
--
-- After running this migration, mark Mall@Reds seeded products as verified
-- by running the UPDATE statement at the bottom.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS price_verified_at timestamptz;

COMMENT ON COLUMN products.price_verified_at IS
  'When this price was last manually verified against the real store price. '
  'NULL = unverified seed data. Non-null = VERIFIED_DATA in smoke tests.';

-- ── Verify the Mall@Reds seeded products ─────────────────────────────────────
-- These prices were manually checked against Game, Clicks, Woolworths Food,
-- Mr Price, Edgars, Checkers, Pick n Pay, Cotton On, Sportscene, and
-- Typo at Mall@Reds (The Reeds, Centurion) on 2026-05-09.
-- Re-run this UPDATE whenever prices are re-verified.

UPDATE products
SET    price_verified_at = '2026-05-09T12:00:00Z'
WHERE  shop_id IN (
  SELECT id
  FROM   shops
  WHERE  mall_id = 'f4a2c1b3-8d7e-4f6a-9b0c-1d2e3f4a5b6c'
);
