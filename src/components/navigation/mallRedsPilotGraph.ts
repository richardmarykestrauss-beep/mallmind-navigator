/**
 * mallRedsPilotGraph.ts — Mall@Reds bindings over the multi-mall registry (`mallDatasets.ts`).
 *
 * Kept so existing imports and tests keep working unchanged. Every helper here is the generic
 * registry helper bound to the Mall@Reds dataset. New code should use `mallDatasets.ts` with an
 * explicit mall id.
 *
 * HONESTY: Mall@Reds is PILOT / SCHEMATIC geometry — NOT an official Mall@Reds floorplan and NOT
 * surveyed positions. Tenant NAMES are real; every COORDINATE is illustrative and awaits on-site
 * verification (`dataset_status: schematic` / `evidence_status: unverified`).
 */

import type { BackendNodeLike, BackendEdgeLike, FloorImageMap } from "./floorplanModel";
import type { DatasetStatus, EvidenceStatus } from "./mallRedsPilotDataset";
import {
  getWayfindingMall, pointsOfInterest, searchPois, startOptions, defaultAnchor, anchorFor,
  DEFAULT_WAYFINDING_MALL_ID,
  type PilotPoi, type PilotPoiKind, type PilotAnchor, type PilotAnchorSource,
} from "./mallDatasets";

export type { PilotPoi, PilotPoiKind, PilotAnchor, PilotAnchorSource };

const PILOT = getWayfindingMall(DEFAULT_WAYFINDING_MALL_ID)!;

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

/** All routable destinations (real tenants + amenities), honestly limited to connected nodes. */
export function pilotPointsOfInterest(): PilotPoi[] { return pointsOfInterest(PILOT); }

/** Search-as-you-type over the POI finder (case-insensitive substring). */
export function searchPilotPois(query: string): PilotPoi[] { return searchPois(PILOT, query); }

/** Curated store-only list (kept for back-compat). */
export function pilotDestinations(): Array<{ shopId: string; name: string }> {
  return pilotPointsOfInterest().filter((p) => p.kind === "store").map((p) => ({ shopId: p.id, name: p.name }));
}

export function pilotStartOptions(): Array<{ id: string; label: string }> { return startOptions(PILOT); }

export function defaultPilotAnchor(): PilotAnchor { return defaultAnchor(PILOT); }

/** Build an anchor from a chosen start node (manual selection today; any provider later). */
export function anchorFromStart(nodeId: string, source: PilotAnchorSource = "manual"): PilotAnchor {
  return anchorFor(PILOT, nodeId, source);
}
