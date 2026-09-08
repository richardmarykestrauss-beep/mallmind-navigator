-- ── Sprint 15.3: Extend mall_nodes type CHECK constraint ─────────────────────
--
-- The original CHECK in migration 005 only allows:
--   shop | entrance | escalator | lift | toilet | food_court | parking
--
-- Map Factory introduces canonical types that require additional values:
--   corridor | landmark | stairs | emergency_exit | info_desk
--
-- Safe to run repeatedly (constraint names are idempotent via IF EXISTS).

-- Drop the existing inline CHECK (PostgreSQL auto-names it {table}_{col}_check)
ALTER TABLE mall_nodes DROP CONSTRAINT IF EXISTS mall_nodes_type_check;

-- Re-add with extended set of valid types
ALTER TABLE mall_nodes
  ADD CONSTRAINT mall_nodes_type_check
  CHECK (type IN (
    'shop',
    'entrance',
    'escalator',
    'lift',
    'toilet',
    'food_court',
    'parking',
    'corridor',
    'landmark',
    'stairs',
    'emergency_exit',
    'info_desk'
  ));
