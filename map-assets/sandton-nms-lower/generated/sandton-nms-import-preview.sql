-- MallMind Sandton/NMS asset import dry-run SQL
-- APPROVAL REQUIRED before adapting this for live Supabase execution.
-- This preview is intentionally not executed by the importer.

-- 1. Generated floorplan preview
/*
insert into map_factory_generated_floorplans
  (mall_id, floor_label, version, layout_json, svg_output, status)
values
  ('059ee9b0-c4f9-46c3-835e-0a4b30b9de0a', 'Ground Floor', 1, '{"asset_id":"sandton-nms-lower-v0","status":"stub","reality_label":"reference-led-proprietary-stub","source_policy":"reference evidence only; no third-party map artwork copied","viewBox":"0 0 1000 620","coordinate_system":"percent-based MallMind node coordinates","known_target":{"shop_name":"69 Belmont","shop_number":"L41","confidence":"metadata confirmed; geometry approximate"}}'::jsonb, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 620" width="1000" height="620" role="img" aria-label="MallMind proprietary Sandton NMS lower-level sch...', 'draft');
*/

-- 2. Node preview
-- node: NMS Entry Reference
-- type=entrance, floor=Ground Floor, x=14.8, y=19.7, id_hint=sandton-nms-lower-v0_nms_entry_reference
-- node: NMS Lower Spine Node 1
-- type=corridor, floor=Ground Floor, x=20.3, y=50.6, id_hint=sandton-nms-lower-v0_nms_lower_spine_node_1
-- node: 69 Belmont
-- type=shop, floor=Ground Floor, x=20.3, y=66.3, id_hint=sandton-nms-lower-v0_69_belmont
-- node: NMS Public Square Reference
-- type=landmark, floor=Ground Floor, x=50, y=50.6, id_hint=sandton-nms-lower-v0_nms_public_square_reference
-- node: Sandton City Connection Reference
-- type=connector, floor=Ground Floor, x=86, y=50.6, id_hint=sandton-nms-lower-v0_sandton_city_connection_reference

-- 3. Edge preview
-- edge: NMS Entry Reference -> NMS Lower Spine Node 1, distance=28m, floor_change=false
-- edge: NMS Lower Spine Node 1 -> 69 Belmont, distance=14m, floor_change=false
-- edge: NMS Lower Spine Node 1 -> NMS Public Square Reference, distance=35m, floor_change=false
-- edge: NMS Public Square Reference -> Sandton City Connection Reference, distance=42m, floor_change=false
