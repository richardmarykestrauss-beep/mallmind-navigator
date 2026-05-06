-- ================================================================
-- Migration 006 — Shopping routes
-- Run in Supabase SQL Editor after 005
-- ================================================================

CREATE TABLE IF NOT EXISTS shopping_routes (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id             UUID REFERENCES shopping_sessions(id) ON DELETE CASCADE,
  user_id                UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  mall_id                TEXT,
  destination_shop_ids   JSONB,           -- ordered array of shop ID strings
  route_steps            JSONB NOT NULL DEFAULT '[]',
  -- Each step: { step, instruction, node_id, node_name, floor, distance_meters, floor_change }
  total_distance_meters  DOUBLE PRECISION,
  estimated_minutes      INTEGER,
  status                 TEXT NOT NULL DEFAULT 'active'
                           CHECK (status IN ('active','completed','abandoned')),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at           TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS shopping_routes_session_idx ON shopping_routes (session_id);
CREATE INDEX IF NOT EXISTS shopping_routes_user_idx    ON shopping_routes (user_id);

ALTER TABLE shopping_routes ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'shopping_routes' AND policyname = 'Users manage own routes'
  ) THEN
    CREATE POLICY "Users manage own routes"
      ON shopping_routes FOR ALL
      USING (auth.uid() = user_id);
  END IF;
END $$;

-- Service role can manage all routes (needed by Edge Functions)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'shopping_routes' AND policyname = 'Service role full access routes'
  ) THEN
    CREATE POLICY "Service role full access routes"
      ON shopping_routes FOR ALL
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;
