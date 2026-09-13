/**
 * pilotRoute.ts — compatibility entry point for the generic Venue Pack router (src/venue/route.ts).
 *
 * `pilotBuildRoute(nodes, edges, start, destination)` keeps the graph-array signature older call
 * sites and tests use; a LoadedVenue can be passed directly to `buildRoute` for floor labels and
 * instruction policy. DISTANCE TRUTH and ARRIVAL TRUTH live in src/venue (never converted here).
 */

import type { BackendNodeLike, BackendEdgeLike } from "./floorplanModel";
import { buildRoute, WALK_METERS_PER_MINUTE, type RouteResult, type RoutableGraph } from "@/venue/route";

export { WALK_METERS_PER_MINUTE };
export type PilotRouteResult = RouteResult;

/** Route over a bare graph (no venue policy: generic fallback + start prefix on, floor ids shown as-is). */
export function pilotBuildRoute(nodes: BackendNodeLike[], edges: BackendEdgeLike[], startNodeId: string, destinationId: string): PilotRouteResult {
  return buildRoute({ nodes, edges } satisfies RoutableGraph, startNodeId, destinationId);
}
