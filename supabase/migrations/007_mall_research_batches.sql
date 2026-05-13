-- ================================================================
-- Migration 007 — Mall Research Batch Workflow
-- Sprint 9E · MallMind Navigator
-- Run in Supabase SQL Editor after 006
-- ================================================================
--
-- Creates two tables:
--   mall_research_batches      — one batch per mall per research session
--   mall_research_batch_items  — individual data points collected in a batch
--
-- No writes to shops / products / mall_nodes — this is a staging workspace only.
-- ================================================================

-- ── set_updated_at trigger function (idempotent) ──────────────────────────────

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- ── mall_research_batches ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS mall_research_batches (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  mall_id         UUID        REFERENCES malls(id) ON DELETE SET NULL,
  title           TEXT        NOT NULL,
  description     TEXT,
  status          TEXT        NOT NULL DEFAULT 'open'
                                CHECK (status IN ('open', 'in_progress', 'complete', 'archived')),
  notes           TEXT,
  item_count      INTEGER     NOT NULL DEFAULT 0,
  reviewed_count  INTEGER     NOT NULL DEFAULT 0,
  created_by      UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS mall_research_batches_mall_id_idx
  ON mall_research_batches (mall_id);

CREATE INDEX IF NOT EXISTS mall_research_batches_status_idx
  ON mall_research_batches (status);

CREATE INDEX IF NOT EXISTS mall_research_batches_created_at_idx
  ON mall_research_batches (created_at DESC);

CREATE TRIGGER trg_mall_research_batches_updated_at
  BEFORE UPDATE ON mall_research_batches
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── mall_research_batch_items ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS mall_research_batch_items (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id         UUID        NOT NULL REFERENCES mall_research_batches(id) ON DELETE CASCADE,
  sequence_number  INTEGER,
  finding_type     TEXT        NOT NULL DEFAULT 'other'
                                 CHECK (finding_type IN (
                                   'shop', 'product', 'trading_hours',
                                   'floor_layout', 'promotion', 'other'
                                 )),
  raw_text         TEXT,
  source_url       TEXT,
  source_name      TEXT,
  status           TEXT        NOT NULL DEFAULT 'pending'
                                 CHECK (status IN (
                                   'pending', 'reviewed', 'accepted', 'rejected', 'flagged'
                                 )),
  admin_notes      TEXT,
  -- JSONB fields — staging area for bot outputs and extracted structured data.
  -- Never written to shops/products/mall_nodes automatically.
  bot_hints_used   JSONB       NOT NULL DEFAULT '{}',
  extracted_data   JSONB       NOT NULL DEFAULT '{}',
  reviewed_by      UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at      TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS mall_research_batch_items_batch_id_idx
  ON mall_research_batch_items (batch_id);

CREATE INDEX IF NOT EXISTS mall_research_batch_items_status_idx
  ON mall_research_batch_items (status);

CREATE INDEX IF NOT EXISTS mall_research_batch_items_finding_type_idx
  ON mall_research_batch_items (finding_type);

CREATE TRIGGER trg_mall_research_batch_items_updated_at
  BEFORE UPDATE ON mall_research_batch_items
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── RLS ───────────────────────────────────────────────────────────────────────
--
-- Both tables are admin-only.  Regular users have no access.
-- The google-cloud-backend service role bypasses RLS entirely.

ALTER TABLE mall_research_batches      ENABLE ROW LEVEL SECURITY;
ALTER TABLE mall_research_batch_items  ENABLE ROW LEVEL SECURITY;

-- Admins (is_admin = true in profiles) can do everything.

CREATE POLICY "admins_all_batches" ON mall_research_batches
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.is_admin = TRUE
    )
  );

CREATE POLICY "admins_all_batch_items" ON mall_research_batch_items
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.is_admin = TRUE
    )
  );

-- ── Comments ──────────────────────────────────────────────────────────────────

COMMENT ON TABLE mall_research_batches IS
  'Sprint 9E — Admin workspace for per-mall research sessions. '
  'Each batch groups multiple data findings for one mall. '
  'Never writes to shops/products/mall_nodes automatically.';

COMMENT ON TABLE mall_research_batch_items IS
  'Sprint 9E — Individual data points (findings) within a research batch. '
  'bot_hints_used stores outputs from Data Intelligence Bots for reference. '
  'extracted_data is a staging copy — never auto-applied to live tables.';
