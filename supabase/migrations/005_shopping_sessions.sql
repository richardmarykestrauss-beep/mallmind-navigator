-- ================================================================
-- Migration 005 — Shopping sessions + Mall navigation graph
-- Run in Supabase SQL Editor
-- ================================================================

-- ── shopping_sessions ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS shopping_sessions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  mall_id               TEXT,
  started_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  current_lat           DOUBLE PRECISION,
  current_lng           DOUBLE PRECISION,
  current_floor         TEXT,
  current_anchor_node_id UUID,
  parking_spot_id       UUID,
  status                TEXT NOT NULL DEFAULT 'active'
                          CHECK (status IN ('active','completed','abandoned')),
  active_route_id       UUID,
  shopping_intent       TEXT,
  route_stop_ids        JSONB,   -- array of shop IDs in current route
  metadata              JSONB
);

CREATE INDEX IF NOT EXISTS shopping_sessions_user_active_idx
  ON shopping_sessions (user_id, last_seen_at DESC)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS shopping_sessions_mall_idx
  ON shopping_sessions (mall_id);

ALTER TABLE shopping_sessions ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'shopping_sessions' AND policyname = 'Users manage own sessions'
  ) THEN
    CREATE POLICY "Users manage own sessions"
      ON shopping_sessions FOR ALL
      USING (auth.uid() = user_id);
  END IF;
END $$;

-- ── mall_nodes ───────────────────────────────────────────────────
-- One node per shop + entrance/escalator nodes added later
CREATE TABLE IF NOT EXISTS mall_nodes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mall_id         TEXT NOT NULL,
  name            TEXT NOT NULL,
  type            TEXT NOT NULL DEFAULT 'shop'
                    CHECK (type IN ('shop','entrance','escalator','lift','toilet','food_court','parking')),
  floor           TEXT,
  lat             DOUBLE PRECISION,
  lng             DOUBLE PRECISION,
  x_coordinate    DOUBLE PRECISION,  -- relative mall grid position
  y_coordinate    DOUBLE PRECISION,
  linked_shop_id  TEXT,              -- TEXT to support both UUID and integer shop IDs
  metadata        JSONB
);

CREATE INDEX IF NOT EXISTS mall_nodes_mall_floor_idx ON mall_nodes (mall_id, floor);
CREATE INDEX IF NOT EXISTS mall_nodes_shop_idx       ON mall_nodes (linked_shop_id);

-- ── mall_edges ───────────────────────────────────────────────────
-- Connections between nodes for step-by-step routing
CREATE TABLE IF NOT EXISTS mall_edges (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mall_id              TEXT NOT NULL,
  from_node_id         UUID REFERENCES mall_nodes(id) ON DELETE CASCADE,
  to_node_id           UUID REFERENCES mall_nodes(id) ON DELETE CASCADE,
  distance_meters      DOUBLE PRECISION NOT NULL DEFAULT 50,
  floor_change         BOOLEAN NOT NULL DEFAULT FALSE,
  instruction          TEXT,        -- e.g. "Walk past the food court"
  accessibility_notes  TEXT
);

CREATE INDEX IF NOT EXISTS mall_edges_from_idx ON mall_edges (from_node_id);
CREATE INDEX IF NOT EXISTS mall_edges_to_idx   ON mall_edges (to_node_id);

-- ── Seed mall_nodes from existing shops ─────────────────────────
-- Each shop becomes a navigable node. X position derived from unit
-- number digits; Y from floor order. Safe to re-run (checks first).
INSERT INTO mall_nodes (mall_id, name, type, floor, linked_shop_id, x_coordinate, y_coordinate)
SELECT
  s.mall_id::TEXT,
  s.name,
  'shop',
  s.floor,
  s.id::TEXT,
  -- X: first numeric run in unit_number, fallback 50
  COALESCE(
    (regexp_match(COALESCE(s.unit_number, ''), '\d+'))[1]::DOUBLE PRECISION,
    50
  ),
  -- Y: floor order (G=1, L1=2, L2=3, L3=4, L4=5, B1=0)
  CASE s.floor
    WHEN 'B1' THEN 0
    WHEN 'G'  THEN 1
    WHEN 'L1' THEN 2
    WHEN 'L2' THEN 3
    WHEN 'L3' THEN 4
    WHEN 'L4' THEN 5
    ELSE 1
  END
FROM shops s
WHERE s.mall_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM mall_nodes mn WHERE mn.linked_shop_id = s.id::TEXT
  );

-- Seed entrance nodes (one per mall, Ground Floor)
INSERT INTO mall_nodes (mall_id, name, type, floor, x_coordinate, y_coordinate)
SELECT DISTINCT
  m.id::TEXT,
  'Main Entrance',
  'entrance',
  'G',
  0,
  1
FROM malls m
WHERE NOT EXISTS (
  SELECT 1 FROM mall_nodes mn
  WHERE mn.mall_id = m.id::TEXT AND mn.type = 'entrance'
);

-- ── Auto-generate edges on same floor ───────────────────────────
-- Connect each shop node to the 3 nearest neighbours on the same floor
-- (by x_coordinate). This gives the routing graph a basic structure
-- without needing real floor plan data.
INSERT INTO mall_edges (mall_id, from_node_id, to_node_id, distance_meters, floor_change, instruction)
SELECT
  a.mall_id,
  a.id AS from_node_id,
  b.id AS to_node_id,
  ABS(a.x_coordinate - b.x_coordinate) * 5 + 30 AS distance_meters,  -- rough estimate
  FALSE,
  'Walk along ' || COALESCE(a.floor, 'G') || ' level'
FROM mall_nodes a
JOIN mall_nodes b
  ON  a.mall_id = b.mall_id
  AND a.floor   = b.floor
  AND a.id     <> b.id
  AND a.type    = 'shop'
  AND b.type    = 'shop'
-- Only keep edges to the nearest 3 neighbours per node (by x distance)
WHERE (
  SELECT COUNT(*) FROM mall_nodes c
  WHERE c.mall_id = a.mall_id
    AND c.floor   = a.floor
    AND c.id     <> a.id
    AND c.type    = 'shop'
    AND ABS(c.x_coordinate - a.x_coordinate) < ABS(b.x_coordinate - a.x_coordinate)
) < 3
AND NOT EXISTS (
  SELECT 1 FROM mall_edges e
  WHERE e.from_node_id = a.id AND e.to_node_id = b.id
);

-- Connect entrance nodes to nearest Ground Floor shop per mall
INSERT INTO mall_edges (mall_id, from_node_id, to_node_id, distance_meters, floor_change, instruction)
SELECT
  entr.mall_id,
  entr.id,
  shop.id,
  60,
  FALSE,
  'Walk from main entrance'
FROM mall_nodes entr
JOIN LATERAL (
  SELECT s.id FROM mall_nodes s
  WHERE s.mall_id = entr.mall_id
    AND s.floor   = 'G'
    AND s.type    = 'shop'
  ORDER BY s.x_coordinate ASC
  LIMIT 1
) shop ON TRUE
WHERE entr.type = 'entrance'
AND NOT EXISTS (
  SELECT 1 FROM mall_edges e
  WHERE e.from_node_id = entr.id AND e.to_node_id = shop.id
);
