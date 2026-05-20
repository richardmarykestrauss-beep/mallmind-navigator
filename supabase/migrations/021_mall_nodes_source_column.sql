-- 021_mall_nodes_source_column.sql — Sprint 15.5
--
-- Adds a 'source' column to mall_nodes to track data provenance.
-- This enables Map Factory to distinguish its own generated nodes from
-- manually curated or GeoDirectory-imported nodes, so it can safely
-- repair stale floor labels without overwriting human-verified data.
--
-- Values:
--   map_factory  — created/repaired by the Map Factory pipeline
--   geodirectory — imported from Menlyn GeoDirectory (do NOT auto-modify)
--   admin        — manually entered/verified by an admin (do NOT auto-modify)
--   manual       — alias for admin
--   NULL         — legacy / unknown origin (treated as safe to repair)

ALTER TABLE mall_nodes
  ADD COLUMN IF NOT EXISTS source TEXT DEFAULT NULL;

COMMENT ON COLUMN mall_nodes.source IS
  'Data provenance: map_factory | geodirectory | admin | manual | NULL (legacy).
   Map Factory may auto-repair nodes where source IS NULL or source = ''map_factory''.
   Nodes with source = ''geodirectory'', ''admin'', or ''manual'' are never auto-modified.';
