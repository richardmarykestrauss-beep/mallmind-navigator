-- ================================================================
-- Migration 004 — Admin, analytics event tables
--
-- Run this in Supabase → SQL Editor
-- ================================================================

-- ── Fix xp column name (was xp_points in DB, xp in code) ────────
ALTER TABLE profiles RENAME COLUMN xp_points TO xp;

-- ── Admin + retailer flags on profiles ──────────────────────────
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_admin    BOOLEAN DEFAULT FALSE;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_retailer BOOLEAN DEFAULT FALSE;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS shop_id     UUID;

-- ── search_events ────────────────────────────────────────────────
-- Every search query — core of behavioural analytics
CREATE TABLE IF NOT EXISTS search_events (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID,
  mall_id      UUID,
  mall_name    TEXT,
  query        TEXT NOT NULL,
  result_count INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS search_events_created_idx ON search_events (created_at DESC);
CREATE INDEX IF NOT EXISTS search_events_query_idx   ON search_events (query text_pattern_ops);
CREATE INDEX IF NOT EXISTS search_events_mall_idx    ON search_events (mall_id);

-- ── app_events ───────────────────────────────────────────────────
-- Generic event stream: routes, AI chats, price alerts, etc.
CREATE TABLE IF NOT EXISTS app_events (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID,
  event_type TEXT NOT NULL,
  mall_id    UUID,
  mall_name  TEXT,
  metadata   JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS app_events_type_created_idx ON app_events (event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS app_events_created_idx      ON app_events (created_at DESC);

-- ── Promote yourself to admin (run once after migration) ─────────
-- UPDATE profiles SET is_admin = TRUE WHERE id = '<your-user-uuid>';
