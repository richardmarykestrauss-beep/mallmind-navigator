/**
 * pilotRoute.ts — client-side route for the Mall@Reds navigation pilot.
 *
 * A FAITHFUL PORT of the backend Dijkstra in
 * google-cloud-backend/src/services/routingService.ts (same algorithm, same
 * mall_nodes/mall_edges shape, undirected edges weighted by distance_meters). It exists
 * only so the pilot is self-contained and demonstrable without seeding a hosted graph or
 * running the backend. When verified Mall@Reds nodes/edges are loaded, this can be replaced
 * by a call to the existing POST /build-route with no change to the graph shape or the UI.
 *
 * Pure + deterministic → unit-testable. Never fabricates a route: if there is no path it
 * returns `fallback:true` with empty steps; unknown tenants return `found:false`.
 */

import type { BackendNodeLike, BackendEdgeLike } from "./floorplanModel";
import type { RouteStep } from "@/context/ShoppingSessionContext";

export interface PilotRouteResult {
  found: boolean;               // was the destination tenant present in the pilot graph?
  fallback: boolean;            // present but not connected → no honest route
  steps: RouteStep[];
  total_distance_meters: number;
  estimated_minutes: number;
  message: string | null;       // honest failure text when found=false / fallback=true
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
      const alt = dist[u] + (e.distance_meters ?? 20);
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

function instruction(from: BackendNodeLike, to: BackendNodeLike, first: boolean, floorChange: boolean): string {
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
  const empty = { steps: [] as RouteStep[], total_distance_meters: 0, estimated_minutes: 0 };
  const destNode = nodes.find((n) => n.linked_shop_id === destinationShopId || n.id === destinationShopId);
  if (!destNode) return { found: false, fallback: false, ...empty, message: "That store isn’t in the Mall@Reds pilot yet." };
  if (!nodes.some((n) => n.id === startNodeId)) return { found: true, fallback: true, ...empty, message: "Please choose a starting point." };
  if (startNodeId === destNode.id) return { found: true, fallback: true, ...empty, message: "You’re already there." };

  const result = dijkstra(nodes, edges, startNodeId, destNode.id);
  if (!result || result.path.length < 2) {
    return { found: true, fallback: true, ...empty, message: `${destNode.name} isn’t connected to the pilot map yet.` };
  }

  const nodeMap = Object.fromEntries(nodes.map((n) => [n.id, n]));
  const steps: RouteStep[] = [];
  let total = 0;
  for (let i = 0; i < result.path.length - 1; i++) {
    const from = nodeMap[result.path[i]];
    const to = nodeMap[result.path[i + 1]];
    const edge = result.edges[i];
    const floorChange = Boolean(edge.floor_change);
    total += edge.distance_meters ?? 20;
    steps.push({
      step: i + 1,
      instruction: instruction(from, to, i === 0, floorChange),
      node_id: to.id,
      node_name: to.name,
      floor: to.floor ?? "G",
      distance_meters: edge.distance_meters ?? 20,
      floor_change: floorChange,
      cumulative_meters: total,
      x_coordinate: to.x_coordinate,
      y_coordinate: to.y_coordinate,
    });
  }
  steps.push({
    step: steps.length + 1, instruction: `You’ve arrived at ${destNode.name}.`,
    node_id: destNode.id, node_name: destNode.name, floor: destNode.floor ?? "G",
    distance_meters: 0, floor_change: false, cumulative_meters: total,
    x_coordinate: destNode.x_coordinate, y_coordinate: destNode.y_coordinate,
  });

  return { found: true, fallback: false, steps, total_distance_meters: total, estimated_minutes: Math.max(1, Math.round(total / 72)), message: null };
}
