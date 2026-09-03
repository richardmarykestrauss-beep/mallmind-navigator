/**
 * pilotRoute.ts — client-side route for the wayfinding pilots.
 *
 * A FAITHFUL PORT of the backend Dijkstra in
 * google-cloud-backend/src/services/routingCore.ts (same algorithm, same mall_nodes/mall_edges
 * shape, undirected edges). It exists so the pilot is self-contained and demonstrable without
 * seeding a hosted graph or running the backend.
 *
 * DISTANCE TRUTH. Shortest-path uses the unit-agnostic edge `weight` (metres for metric data,
 * pixels for an unscaled source). Metres are reported ONLY when every traversed edge carries
 * measured `distance_meters`; otherwise `total_distance_meters` and `estimated_minutes` are null,
 * every step's `distance_meters` is null, and `metric` is false. Nothing here converts pixels to
 * metres. Never fabricates a route: no path → `fallback:true`; unknown tenant → `found:false`.
 */

import type { BackendNodeLike, BackendEdgeLike } from "./floorplanModel";
import type { RouteStep } from "@/context/ShoppingSessionContext";

/** Average indoor walking pace used for the time estimate (metres per minute). */
export const WALK_METERS_PER_MINUTE = 72;

export interface PilotRouteResult {
  found: boolean;               // was the destination tenant present in the graph?
  fallback: boolean;            // present but not connected → no honest route
  steps: RouteStep[];
  /** true only when every traversed edge has measured metres. */
  metric: boolean;
  /** null when the route is unscaled (never derived from pixels). */
  total_distance_meters: number | null;
  /** null when the route is unscaled. */
  estimated_minutes: number | null;
  message: string | null;       // honest failure text when found=false / fallback=true
}

/** Shortest-path weight: dataset weight, else measured metres, else 1 hop. Never a distance claim. */
function edgeWeight(e: BackendEdgeLike): number {
  if (typeof e.weight === "number" && e.weight > 0) return e.weight;
  if (typeof e.distance_meters === "number" && e.distance_meters > 0) return e.distance_meters;
  return 1;
}

function dijkstra(nodes: BackendNodeLike[], edges: BackendEdgeLike[], startId: string, endId: string):
  { path: string[]; edges: BackendEdgeLike[]; total: number } | null {
  const dist: Record<string, number> = {};
  const prev: Record<string, { from: string; edge: BackendEdgeLike } | null> = {};
  const unvisited = new Set<string>();
  for (const n of nodes) { dist[n.id] = Infinity; prev[n.id] = null; unvisited.add(n.id); }
  if (!(startId in dist) || !(endId in dist)) return null;
  dist[startId] = 0;

  while (unvisited.size > 0) {
    let u: string | null = null;
    for (const id of unvisited) if (u === null || dist[id] < dist[u]) u = id;
    if (!u || dist[u] === Infinity) break;
    if (u === endId) break;
    unvisited.delete(u);
    for (const e of edges.filter((x) => x.from_node_id === u || x.to_node_id === u)) {
      const v = e.from_node_id === u ? e.to_node_id : e.from_node_id;
      if (!unvisited.has(v)) continue;
      const alt = dist[u] + edgeWeight(e);
      if (alt < dist[v]) { dist[v] = alt; prev[v] = { from: u, edge: e }; }
    }
  }
  if (dist[endId] === Infinity) return null;
  const path: string[] = [];
  const traversed: BackendEdgeLike[] = [];
  let cur = endId;
  while (prev[cur]) { const p = prev[cur]!; path.unshift(cur); traversed.unshift(p.edge); cur = p.from; }
  path.unshift(startId);
  return { path, edges: traversed, total: dist[endId] };
}

function isInternal(node: BackendNodeLike | undefined): boolean {
  if (!node) return false;
  const t = String(node.type ?? "");
  return t === "corridor" || /corridor|junction|spine|\bnode\s*\d+\b/i.test(node.name ?? "");
}

function instruction(from: BackendNodeLike, to: BackendNodeLike, edge: BackendEdgeLike, first: boolean, floorChange: boolean): string {
  // A dataset may supply the topological wording for a leg (e.g. "Continue straight across the
  // cross corridor; Clicks is on your right."). It is used verbatim — it never carries distances.
  const supplied = edge.instruction?.trim();
  if (supplied) return first ? `Start at ${from.name}. ${supplied}` : supplied;
  if (first) return isInternal(from) ? "Start and head into the concourse." : `Start at ${from.name} and head into the concourse.`;
  if (floorChange) return "Take the escalator or lift to the next level.";
  if (isInternal(to)) return "Continue along the concourse.";
  return `Walk toward ${to.name}.`;
}

/**
 * Route from a start node to a destination tenant (resolved by linked_shop_id, like
 * routingService). `startNodeId` must be a node in the graph (a chosen entrance/landmark).
 */
export function pilotBuildRoute(
  nodes: BackendNodeLike[],
  edges: BackendEdgeLike[],
  startNodeId: string,
  destinationShopId: string,
): PilotRouteResult {
  const empty = { steps: [] as RouteStep[], metric: false, total_distance_meters: null, estimated_minutes: null };
  const destNode = nodes.find((n) => n.linked_shop_id === destinationShopId || n.id === destinationShopId);
  if (!destNode) return { found: false, fallback: false, ...empty, message: "That destination isn’t on this map yet." };
  if (!nodes.some((n) => n.id === startNodeId)) return { found: true, fallback: true, ...empty, message: "Please choose a starting point." };
  if (startNodeId === destNode.id) return { found: true, fallback: true, ...empty, message: "You’re already there." };

  const result = dijkstra(nodes, edges, startNodeId, destNode.id);
  if (!result || result.path.length < 2) {
    return { found: true, fallback: true, ...empty, message: `${destNode.name} isn’t connected to this map yet.` };
  }

  // Metres exist only if EVERY traversed edge was measured. One unscaled leg → the whole route is unscaled.
  const metric = result.edges.every((e) => typeof e.distance_meters === "number" && e.distance_meters > 0);

  const nodeMap = Object.fromEntries(nodes.map((n) => [n.id, n]));
  const steps: RouteStep[] = [];
  let total = 0;
  for (let i = 0; i < result.path.length - 1; i++) {
    const from = nodeMap[result.path[i]];
    const to = nodeMap[result.path[i + 1]];
    const edge = result.edges[i];
    const floorChange = Boolean(edge.floor_change);
    const legMetres = metric ? (edge.distance_meters as number) : null;
    if (legMetres !== null) total += legMetres;
    steps.push({
      step: i + 1,
      instruction: instruction(from, to, edge, i === 0, floorChange),
      node_id: to.id,
      node_name: to.name,
      floor: to.floor ?? "G",
      distance_meters: legMetres,
      floor_change: floorChange,
      cumulative_meters: metric ? total : null,
      x_coordinate: to.x_coordinate,
      y_coordinate: to.y_coordinate,
    });
  }
  steps.push({
    step: steps.length + 1, instruction: `You’ve arrived at ${destNode.name}.`,
    node_id: destNode.id, node_name: destNode.name, floor: destNode.floor ?? "G",
    distance_meters: metric ? 0 : null, floor_change: false, cumulative_meters: metric ? total : null,
    x_coordinate: destNode.x_coordinate, y_coordinate: destNode.y_coordinate,
  });

  return {
    found: true,
    fallback: false,
    steps,
    metric,
    total_distance_meters: metric ? total : null,
    estimated_minutes: metric ? Math.max(1, Math.round(total / WALK_METERS_PER_MINUTE)) : null,
    message: null,
  };
}
