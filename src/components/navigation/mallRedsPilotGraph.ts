/**
 * mallRedsPilotGraph.ts — Mall@Reds NAVIGATION PILOT graph + destination-first finder.
 *
 * The pilot's spatial data now lives as an explicit, reusable DATA asset
 * (`data/mall-reds-pilot.dataset.json`) and is turned into the backend mall_nodes / mall_edges
 * graph shape by the adapter in `mallRedsPilotDataset.ts`. This module consumes that derived graph
 * (`MALL_REDS_PILOT_NODES` / `MALL_REDS_PILOT_EDGES`) so `toFloorplanModel()` renders it with the
 * existing IndoorMapCanvas and `pilotBuildRoute()` (a faithful port of routingService's Dijkstra)
 * routes over it — exactly as before. Only the SOURCE of the graph changed (data-driven, not a
 * literal); the shape, ids, coordinates and distances are identical.
 *
 * HONESTY: this is PILOT / SCHEMATIC geometry — NOT an official Mall@Reds floorplan and NOT
 * surveyed positions. Tenant NAMES are real (Mall@Reds anchors); amenity TYPES (toilets, lifts,
 * food court, information desk, entrances) are real categories every mall has — but every
 * COORDINATE is illustrative and awaits on-site verification (see the dataset's `dataset_status:
 * schematic` / `evidence_status: unverified`). Making the pilot truthful is a DATA task, not a code
 * change: swap the dataset JSON for a source-backed / on-site-verified one in the same shape.
 */

import type { BackendNodeLike, BackendEdgeLike, FloorImageMap } from "./floorplanModel";
import { loadPilotSpatialDataset, type DatasetStatus, type EvidenceStatus } from "./mallRedsPilotDataset";

const PILOT = loadPilotSpatialDataset();

export const MALL_REDS_PILOT_MALL_ID = PILOT.mallId;
export const MALL_REDS_PILOT_MALL_NAME = PILOT.mallName;

/** Pilot nodes derived from the spatial dataset (entrances, amenities, corridor spine, tenants). */
export const MALL_REDS_PILOT_NODES: BackendNodeLike[] = PILOT.nodes;

/** Pilot edges derived from the spatial dataset (corridor spine + one entry edge per POI). */
export const MALL_REDS_PILOT_EDGES: BackendEdgeLike[] = PILOT.edges;

/** Floor label → plan image URL when the dataset declares a real plan (empty for the schematic pilot). */
export const MALL_REDS_PILOT_FLOOR_IMAGES: FloorImageMap = PILOT.floorImages;

/** The dataset's self-declared truth level — schematic/unverified until real geometry is loaded. */
export function pilotDatasetStatus(): { datasetStatus: DatasetStatus; evidenceStatus: EvidenceStatus } {
  return { datasetStatus: PILOT.datasetStatus, evidenceStatus: PILOT.evidenceStatus };
}

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
export type PilotAnchorSource =
  | "manual"        // the shopper chose a start point in the UI
  | "url"           // a /navigate?mall=&start= link (what printed QR signage encodes)
  | "qr"            // an in-app scanner resolved a QR code (not built yet)
  | "native" | "wifi_rtt" | "uwb" | "apple_indoor"; // future positioning providers (not built)
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
