/**
 * mallRedsPilotGraph.ts — Mall@Reds NAVIGATION PILOT graph (schematic).
 *
 * A small, coherent, deterministic graph in the EXISTING backend mall_nodes / mall_edges shape
 * (0..100 percent coordinates, linked_shop_id, from/to edges), so `toFloorplanModel()` renders it
 * with the existing IndoorMapCanvas and `pilotBuildRoute()` (a faithful port of routingService's
 * Dijkstra) routes over it.
 *
 * HONESTY: this is PILOT / SCHEMATIC geometry — NOT an official Mall@Reds floorplan and NOT
 * surveyed positions. Tenant NAMES are real (Mall@Reds anchors); amenity TYPES (toilets, lifts,
 * food court, information desk, entrances) are real categories every mall has — but every
 * COORDINATE here is illustrative and awaits on-site verification (same honesty level for tenants
 * and amenities alike). Verified amenity positions are the next DATA task, not a code change:
 * swapping in real mall_nodes/mall_edges replaces this constant with no UI or routing rewrite.
 */

import type { BackendNodeLike, BackendEdgeLike } from "./floorplanModel";

export const MALL_REDS_PILOT_MALL_ID = "mallreds-pilot";
export const MALL_REDS_PILOT_MALL_NAME = "Mall@Reds";
const G = "G"; // Ground — the pilot is single-floor (multi-floor awaits verified data).

/** Pilot nodes: entrances, amenities, a corridor spine, and real anchor tenants. */
export const MALL_REDS_PILOT_NODES: BackendNodeLike[] = [
  { id: "entrance-main", name: "Main Entrance", type: "entrance", floor: G, x_coordinate: 5, y_coordinate: 50 },
  { id: "entrance-2", name: "Entrance 2", type: "entrance", floor: G, x_coordinate: 95, y_coordinate: 55 },
  { id: "info-desk", name: "Information Desk", type: "landmark", floor: G, x_coordinate: 50, y_coordinate: 70 },
  { id: "c1", name: "Concourse", type: "corridor", floor: G, x_coordinate: 18, y_coordinate: 50 },
  { id: "c2", name: "Concourse", type: "corridor", floor: G, x_coordinate: 35, y_coordinate: 50 },
  { id: "c3", name: "Concourse", type: "corridor", floor: G, x_coordinate: 50, y_coordinate: 50 },
  { id: "c4", name: "Concourse", type: "corridor", floor: G, x_coordinate: 68, y_coordinate: 50 },
  { id: "c5", name: "Concourse", type: "corridor", floor: G, x_coordinate: 85, y_coordinate: 50 },
  // Real Mall@Reds anchor tenants (names real; positions schematic).
  { id: "woolworths", name: "Woolworths", type: "shop", floor: G, x_coordinate: 18, y_coordinate: 24, linked_shop_id: "woolworths" },
  { id: "clicks", name: "Clicks", type: "shop", floor: G, x_coordinate: 35, y_coordinate: 80, linked_shop_id: "clicks" },
  { id: "dischem", name: "Dis-Chem", type: "shop", floor: G, x_coordinate: 50, y_coordinate: 24, linked_shop_id: "dischem" },
  { id: "picknpay", name: "Pick n Pay", type: "shop", floor: G, x_coordinate: 68, y_coordinate: 80, linked_shop_id: "picknpay" },
  { id: "game", name: "Game", type: "shop", floor: G, x_coordinate: 92, y_coordinate: 26, linked_shop_id: "game" },
  // Amenities (real categories; schematic positions).
  { id: "lifts", name: "Lifts", type: "lift", floor: G, x_coordinate: 35, y_coordinate: 22 },
  { id: "toilets", name: "Toilets", type: "toilet", floor: G, x_coordinate: 68, y_coordinate: 22 },
  { id: "food-court", name: "Food Court", type: "food_court", floor: G, x_coordinate: 85, y_coordinate: 80 },
];

/** Pilot edges: a connected corridor spine + one entry edge per tenant/amenity. Undirected. */
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
  { id: "e-c2-lf", from_node_id: "c2", to_node_id: "lifts", distance_meters: 16 },
  { id: "e-c4-wc", from_node_id: "c4", to_node_id: "toilets", distance_meters: 16 },
  { id: "e-c5-fc", from_node_id: "c5", to_node_id: "food-court", distance_meters: 18 },
];

// ── Points of interest (destination-first finder) ────────────────────────────
export type PilotPoiKind = "store" | "amenity";
export interface PilotPoi { id: string; name: string; kind: PilotPoiKind; type: string; }

const AMENITY_TYPES = new Set(["toilet", "lift", "escalator", "stairs", "food_court", "landmark"]);

function connectedNodeIds(): Set<string> {
  return new Set(MALL_REDS_PILOT_EDGES.flatMap((e) => [e.from_node_id, e.to_node_id]));
}

/** All routable destinations (real tenants + amenities), honestly limited to connected nodes. */
export function pilotPointsOfInterest(): PilotPoi[] {
  const connected = connectedNodeIds();
  const stores: PilotPoi[] = MALL_REDS_PILOT_NODES
    .filter((n) => n.type === "shop" && connected.has(n.id))
    .map((n) => ({ id: n.linked_shop_id ?? n.id, name: n.name, kind: "store", type: "shop" }));
  const amenities: PilotPoi[] = MALL_REDS_PILOT_NODES
    .filter((n) => AMENITY_TYPES.has(n.type) && connected.has(n.id))
    .map((n) => ({ id: n.id, name: n.name, kind: "amenity", type: n.type }));
  return [...stores, ...amenities];
}

/** Search-as-you-type over the POI finder (case-insensitive substring). */
export function searchPilotPois(query: string): PilotPoi[] {
  const q = query.trim().toLowerCase();
  if (!q) return pilotPointsOfInterest();
  return pilotPointsOfInterest().filter((p) => p.name.toLowerCase().includes(q));
}

/** Curated store-only list (kept for back-compat). */
export function pilotDestinations(): Array<{ shopId: string; name: string }> {
  return pilotPointsOfInterest().filter((p) => p.kind === "store").map((p) => ({ shopId: p.id, name: p.name }));
}

// ── Start points + future-positioning anchor abstraction (PART 9 seam) ───────
const START_NODE_TYPES = new Set(["entrance", "landmark"]);
export function pilotStartOptions(): Array<{ id: string; label: string }> {
  return MALL_REDS_PILOT_NODES.filter((n) => START_NODE_TYPES.has(n.type)).map((n) => ({ id: n.id, label: n.name }));
}

/**
 * The current-location abstraction the route depends on. The route consumes ONLY `nodeId`; how it
 * was obtained (`source`) is decoupled, so a future positioning provider (QR, native indoor, Wi-Fi
 * RTT, UWB, Apple indoor) can set the anchor WITHOUT the route UI changing. No provider is built here.
 */
export type PilotAnchorSource = "manual" | "qr" | "native" | "wifi_rtt" | "uwb" | "apple_indoor";
export interface PilotAnchor { nodeId: string; label: string; source: PilotAnchorSource; }

export function defaultPilotAnchor(): PilotAnchor {
  const first = pilotStartOptions()[0];
  return { nodeId: first.id, label: first.label, source: "manual" };
}

/** Build an anchor from a chosen start node (manual selection today; any provider later). */
export function anchorFromStart(nodeId: string, source: PilotAnchorSource = "manual"): PilotAnchor {
  const opt = pilotStartOptions().find((s) => s.id === nodeId);
  return { nodeId, label: opt?.label ?? nodeId, source };
}
