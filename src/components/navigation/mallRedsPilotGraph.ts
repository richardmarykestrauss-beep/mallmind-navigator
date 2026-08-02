/**
 * mallRedsPilotGraph.ts — Mall@Reds NAVIGATION PILOT graph (schematic).
 *
 * A small, coherent, deterministic graph in the EXISTING backend mall_nodes /
 * mall_edges shape (0..100 percent coordinates, linked_shop_id, from/to edges), so:
 *   • `toFloorplanModel()` renders it with the existing IndoorMapCanvas, and
 *   • `pilotBuildRoute()` (a faithful port of routingService's Dijkstra) routes over it.
 *
 * HONESTY: this is PILOT / SCHEMATIC geometry — NOT an official Mall@Reds floorplan and
 * NOT surveyed positions. Tenant NAMES are real (Mall@Reds anchors); node COORDINATES are
 * illustrative and await on-site verification. Swapping in a verified map later is a DATA
 * replacement (real mall_nodes / mall_edges), not a frontend or routing rewrite — see
 * docs/implementation/navigation-first-pilot.md.
 */

import type { BackendNodeLike, BackendEdgeLike } from "./floorplanModel";

export const MALL_REDS_PILOT_MALL_ID = "mallreds-pilot";
export const MALL_REDS_PILOT_MALL_NAME = "Mall@Reds";
const G = "G"; // Ground — the pilot is single-floor (multi-floor awaits verified data).

/** Pilot nodes: entrances, an information desk, a corridor spine, and real anchor tenants. */
export const MALL_REDS_PILOT_NODES: BackendNodeLike[] = [
  { id: "entrance-main", name: "Main Entrance", type: "entrance", floor: G, x_coordinate: 5, y_coordinate: 50 },
  { id: "entrance-2", name: "Entrance 2", type: "entrance", floor: G, x_coordinate: 95, y_coordinate: 55 },
  { id: "info-desk", name: "Information Desk", type: "landmark", floor: G, x_coordinate: 50, y_coordinate: 70 },
  { id: "c1", name: "Concourse", type: "corridor", floor: G, x_coordinate: 18, y_coordinate: 50 },
  { id: "c2", name: "Concourse", type: "corridor", floor: G, x_coordinate: 35, y_coordinate: 50 },
  { id: "c3", name: "Concourse", type: "corridor", floor: G, x_coordinate: 50, y_coordinate: 50 },
  { id: "c4", name: "Concourse", type: "corridor", floor: G, x_coordinate: 68, y_coordinate: 50 },
  { id: "c5", name: "Concourse", type: "corridor", floor: G, x_coordinate: 85, y_coordinate: 50 },
  // Real Mall@Reds anchor tenants (names are real; positions are schematic).
  { id: "woolworths", name: "Woolworths", type: "shop", floor: G, x_coordinate: 18, y_coordinate: 24, linked_shop_id: "woolworths" },
  { id: "clicks", name: "Clicks", type: "shop", floor: G, x_coordinate: 35, y_coordinate: 80, linked_shop_id: "clicks" },
  { id: "dischem", name: "Dis-Chem", type: "shop", floor: G, x_coordinate: 50, y_coordinate: 24, linked_shop_id: "dischem" },
  { id: "picknpay", name: "Pick n Pay", type: "shop", floor: G, x_coordinate: 68, y_coordinate: 80, linked_shop_id: "picknpay" },
  { id: "game", name: "Game", type: "shop", floor: G, x_coordinate: 92, y_coordinate: 26, linked_shop_id: "game" },
];

/** Pilot edges: a connected corridor spine + one shop-entry edge per anchor. Undirected. */
export const MALL_REDS_PILOT_EDGES: BackendEdgeLike[] = [
  { id: "e-em-c1", from_node_id: "entrance-main", to_node_id: "c1", distance_meters: 22 },
  { id: "e-c1-c2", from_node_id: "c1", to_node_id: "c2", distance_meters: 24 },
  { id: "e-c2-c3", from_node_id: "c2", to_node_id: "c3", distance_meters: 22 },
  { id: "e-c3-c4", from_node_id: "c3", to_node_id: "c4", distance_meters: 24 },
  { id: "e-c4-c5", from_node_id: "c4", to_node_id: "c5", distance_meters: 22 },
  { id: "e-c5-e2", from_node_id: "c5", to_node_id: "entrance-2", distance_meters: 18 },
  { id: "e-c3-info", from_node_id: "c3", to_node_id: "info-desk", distance_meters: 12 },
  { id: "e-c1-ww", from_node_id: "c1", to_node_id: "woolworths", distance_meters: 20 },
  { id: "e-c2-cl", from_node_id: "c2", to_node_id: "clicks", distance_meters: 20 },
  { id: "e-c3-dc", from_node_id: "c3", to_node_id: "dischem", distance_meters: 20 },
  { id: "e-c4-pnp", from_node_id: "c4", to_node_id: "picknpay", distance_meters: 20 },
  { id: "e-c5-gm", from_node_id: "c5", to_node_id: "game", distance_meters: 22 },
];

/** Start points the shopper may choose (never auto-detected). Ordered for display. */
export const MALL_REDS_PILOT_START_NODE_TYPES = new Set(["entrance", "landmark"]);
export function pilotStartOptions(): Array<{ id: string; label: string }> {
  return MALL_REDS_PILOT_NODES
    .filter((n) => MALL_REDS_PILOT_START_NODE_TYPES.has(n.type))
    .map((n) => ({ id: n.id, label: n.name }));
}

/** Curated, HONEST list of destinations that are actually connected in the pilot graph. */
export function pilotDestinations(): Array<{ shopId: string; name: string }> {
  const connected = new Set(MALL_REDS_PILOT_EDGES.flatMap((e) => [e.from_node_id, e.to_node_id]));
  return MALL_REDS_PILOT_NODES
    .filter((n) => n.type === "shop" && n.linked_shop_id && connected.has(n.id))
    .map((n) => ({ shopId: n.linked_shop_id as string, name: n.name }));
}
