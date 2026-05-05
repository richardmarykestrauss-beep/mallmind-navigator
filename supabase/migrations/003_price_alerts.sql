-- ================================================================
-- Migration 003 — Price alerts + push subscriptions
--
-- Run this in Supabase → SQL Editor
-- ================================================================

-- ── price_alerts ─────────────────────────────────────────────────────────────
-- One row per "I want to know when this product gets cheaper"
CREATE TABLE IF NOT EXISTS price_alerts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  product_id   UUID NOT NULL,   -- references products.id (no FK to avoid type mismatch)
  target_price NUMERIC,         -- NULL = notify on ANY price drop
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, product_id)  -- one alert per product per user
);

ALTER TABLE price_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY price_alerts_own ON price_alerts
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS price_alerts_product_idx ON price_alerts (product_id);
CREATE INDEX IF NOT EXISTS price_alerts_user_idx    ON price_alerts (user_id);


-- ── push_subscriptions ────────────────────────────────────────────────────────
-- Browser Web Push subscription per user per device
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint   TEXT NOT NULL,
  p256dh     TEXT NOT NULL,
  auth_key   TEXT NOT NULL,       -- "auth" is a reserved word — use auth_key
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, endpoint)
);

ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY push_subscriptions_own ON push_subscriptions
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS push_subscriptions_user_idx ON push_subscriptions (user_id);
