/**
 * mallDatasets.ts — registry of bundled wayfinding datasets keyed by mall id, plus the
 * graph-bound helpers (points of interest, start options, anchors) that used to be bound to the
 * single Mall@Reds graph. Adding a mall = adding a dataset JSON to `SOURCES`. No UI change.
 *
 * Bundled today:
 *   • mallreds-pilot  — Mall@Reds, SCHEMATIC / unverified, metric (illustrative metres).
 *   • menlyn-park     — Menlyn Park, SOURCE-BACKED topology traced from the published Lower First
 *                       Level plan, UNSCALED (pixel lengths only, no metres, no minutes),
 *                       NOT field-verified. Controlled pilot dataset, not an official deployment.
 */

import type { BackendNodeLike } from "./floorplanModel";
import {
  loadPilotSpatialDataset, type LoadedPilotDataset, type PilotSpatialDataset, type DatasetStatus,
} from "./mallRedsPilotDataset";
import mallRedsDataset from "./data/mall-reds-pilot.dataset.json";
import menlynParkDataset from "./data/menlyn-park-lf-pilot.dataset.json";

const SOURCES: Record<string, PilotSpatialDataset> = Object.fromEntries(
  [mallRedsDataset, menlynParkDataset].map((d) => [d.mall_id, d as PilotSpatialDataset]),
);

const cache = new Map<string, LoadedPilotDataset>();

/** All malls with a bundled dataset, in registry order (the first is the default pilot). */
export function listWayfindingMalls(): Array<{ id: string; name: string; datasetStatus: DatasetStatus; metric: boolean; fieldVerified: boolean }> {
  return Object.keys(SOURCES).map((id) => {
    const g = getWayfindingMall(id)!;
    return { id, name: g.mallName, datasetStatus: g.datasetStatus, metric: g.metric, fieldVerified: g.fieldVerified };
  });
}

export const DEFAULT_WAYFINDING_MALL_ID = mallRedsDataset.mall_id;

/** Load (validated, cached) the dataset for a mall id, or null when no dataset exists — never throws for unknown ids. */
export function getWayfindingMall(mallId: string): LoadedPilotDataset | null {
  const source = SOURCES[mallId];
  if (!source) return null;
  let loaded = cache.get(mallId);
  if (!loaded) {
    loaded = loadPilotSpatialDataset(source);
    cache.set(mallId, loaded);
  }
  return loaded;
}

// ── Points of interest (destination-first finder) ────────────────────────────
export type PilotPoiKind = "store" | "amenity";
export interface PilotPoi { id: string; name: string; kind: PilotPoiKind; type: string; }

const AMENITY_TYPES = new Set(["toilet", "lift", "escalator", "stairs", "food_court", "landmark"]);
const START_NODE_TYPES = new Set(["entrance", "landmark"]);

type GraphLike = Pick<LoadedPilotDataset, "nodes" | "edges">;

function connectedNodeIds(g: GraphLike): Set<string> {
  return new Set(g.edges.flatMap((e) => [e.from_node_id, e.to_node_id]));
}

/** All routable destinations (real tenants + amenities), honestly limited to connected nodes. */
export function pointsOfInterest(g: GraphLike): PilotPoi[] {
  const connected = connectedNodeIds(g);
  const stores: PilotPoi[] = g.nodes
    .filter((n: BackendNodeLike) => n.type === "shop" && connected.has(n.id))
    .map((n) => ({ id: n.linked_shop_id ?? n.id, name: n.name, kind: "store", type: "shop" }));
  const amenities: PilotPoi[] = g.nodes
    .filter((n) => AMENITY_TYPES.has(n.type) && connected.has(n.id))
    .map((n) => ({ id: n.id, name: n.name, kind: "amenity", type: n.type }));
  return [...stores, ...amenities];
}

/** Search-as-you-type over the POI finder (case-insensitive substring). */
export function searchPois(g: GraphLike, query: string): PilotPoi[] {
  const q = query.trim().toLowerCase();
  if (!q) return pointsOfInterest(g);
  return pointsOfInterest(g).filter((p) => p.name.toLowerCase().includes(q));
}

/** Start points a shopper may choose (entrances + landmarks); never auto-detected. */
export function startOptions(g: GraphLike): Array<{ id: string; label: string }> {
  return g.nodes.filter((n) => START_NODE_TYPES.has(n.type)).map((n) => ({ id: n.id, label: n.name }));
}

// ── Current-location anchor abstraction (positioning seam) ───────────────────
/**
 * The route consumes ONLY `nodeId`; how it was obtained (`source`) is decoupled, so a future
 * positioning provider can set the anchor WITHOUT the route UI changing. No provider is built here.
 */
export type PilotAnchorSource =
  | "manual"        // the shopper chose a start point in the UI
  | "url"           // a /navigate?mall=&start= link (what printed QR signage encodes)
  | "qr"            // an in-app scanner resolved a QR code (not built yet)
  | "native" | "wifi_rtt" | "uwb" | "apple_indoor"; // future positioning providers (not built)
export interface PilotAnchor { nodeId: string; label: string; source: PilotAnchorSource; }

export function defaultAnchor(g: GraphLike): PilotAnchor {
  const first = startOptions(g)[0];
  return { nodeId: first.id, label: first.label, source: "manual" };
}

/** Build an anchor from a chosen start node (manual selection today; any provider later). */
export function anchorFor(g: GraphLike, nodeId: string, source: PilotAnchorSource = "manual"): PilotAnchor {
  const opt = startOptions(g).find((s) => s.id === nodeId);
  return { nodeId, label: opt?.label ?? nodeId, source };
}
