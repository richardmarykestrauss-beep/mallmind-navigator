/**
 * route.ts — generic shortest-path routing over a Venue Pack graph.
 *
 * Same Dijkstra the pilots used (a faithful port of the backend routingCore), now venue-agnostic:
 *   • weights are the pack's unit (metres for "m", pixels for "px") — never converted;
 *   • edges may be one-way; instructions are looked up for the DIRECTION walked;
 *   • node kinds (not names) drive generic wording; floors come from the pack;
 *   • metres/minutes exist only when EVERY traversed edge is measured;
 *   • the arrival step's wording comes from the destination's own arrival evidence.
 * Never fabricates a route: no path → fallback:true; unknown destination → found:false.
 */

import type { BackendNodeLike, BackendEdgeLike } from "../components/navigation/floorplanModel";
import type { RouteStep } from "@/context/ShoppingSessionContext";
import type { VenueFloor, VenuePolicies } from "./contract";
import { instructionFor, floorLabelFor } from "./instructions";
import { arrivalWording } from "./evidence";

/** Average indoor walking pace used ONLY for measured routes (metres per minute). */
export const WALK_METERS_PER_MINUTE = 72;

export interface RouteResult {
  found: boolean;
  fallback: boolean;
  steps: RouteStep[];
  metric: boolean;
  total_distance_meters: number | null;
  estimated_minutes: number | null;
  message: string | null;
}

/** The minimum a router needs; a LoadedVenue satisfies it, and tests can hand in bare graphs. */
export interface RoutableGraph {
  nodes: BackendNodeLike[];
  edges: BackendEdgeLike[];
  floors?: readonly VenueFloor[];
  policies?: Pick<VenuePolicies, "instructions" | "floors">;
}

const DEFAULT_INSTRUCTION_POLICY = { generic_fallback: true, start_prefix: true };

function edgeWeight(e: BackendEdgeLike): number {
  if (typeof e.weight === "number" && e.weight > 0) return e.weight;
  if (typeof e.distance_meters === "number" && e.distance_meters > 0) return e.distance_meters;
  return 1;
}

interface Hop { from: string; edge: BackendEdgeLike; forward: boolean }

function dijkstra(nodes: BackendNodeLike[], edges: BackendEdgeLike[], startId: string, endId: string): { path: string[]; hops: Hop[] } | null {
  const dist = new Map<string, number>();
  const prev = new Map<string, Hop | null>();
  const unvisited = new Set<string>();
  for (const n of nodes) { dist.set(n.id, Infinity); prev.set(n.id, null); unvisited.add(n.id); }
  if (!dist.has(startId) || !dist.has(endId)) return null;
  dist.set(startId, 0);

  // adjacency respecting one-way edges
  const adj = new Map<string, Array<{ to: string; edge: BackendEdgeLike; forward: boolean }>>();
  const push = (k: string, v: { to: string; edge: BackendEdgeLike; forward: boolean }) => { const a = adj.get(k); if (a) a.push(v); else adj.set(k, [v]); };
  for (const e of edges) {
    push(e.from_node_id, { to: e.to_node_id, edge: e, forward: true });
    if (e.bidirectional !== false) push(e.to_node_id, { to: e.from_node_id, edge: e, forward: false });
  }

  while (unvisited.size > 0) {
    let u: string | null = null;
    for (const id of unvisited) if (u === null || (dist.get(id) as number) < (dist.get(u) as number)) u = id;
    if (u === null || dist.get(u) === Infinity) break;
    if (u === endId) break;
    unvisited.delete(u);
    for (const { to, edge, forward } of adj.get(u) ?? []) {
      if (!unvisited.has(to)) continue;
      const alt = (dist.get(u) as number) + edgeWeight(edge);
      if (alt < (dist.get(to) as number)) { dist.set(to, alt); prev.set(to, { from: u, edge, forward }); }
    }
  }
  if (dist.get(endId) === Infinity) return null;
  const path: string[] = [];
  const hops: Hop[] = [];
  let cur = endId;
  while (prev.get(cur)) { const h = prev.get(cur) as Hop; path.unshift(cur); hops.unshift(h); cur = h.from; }
  path.unshift(startId);
  return { path, hops };
}

/**
 * Route from a start NODE to a destination (destination id, or the arrival node id itself).
 */
export function buildRoute(graph: RoutableGraph, startNodeId: string, destinationId: string): RouteResult {
  const empty = { steps: [] as RouteStep[], metric: false, total_distance_meters: null, estimated_minutes: null };
  const { nodes, edges } = graph;
  const destNode = nodes.find((n) => n.linked_shop_id === destinationId || n.id === destinationId);
  if (!destNode) return { found: false, fallback: false, ...empty, message: "That destination isn’t on this map yet." };
  if (!nodes.some((n) => n.id === startNodeId)) return { found: true, fallback: true, ...empty, message: "Please choose a starting point." };
  if (startNodeId === destNode.id) return { found: true, fallback: true, ...empty, message: "You’re already there." };

  const result = dijkstra(nodes, edges, startNodeId, destNode.id);
  if (!result || result.path.length < 2) {
    return { found: true, fallback: true, ...empty, message: `${destNode.name} isn’t connected to this map yet.` };
  }

  // Metres exist only if EVERY traversed edge was measured. One unmeasured leg → the whole route is unscaled.
  const metric = result.hops.every((h) => typeof h.edge.distance_meters === "number" && h.edge.distance_meters > 0);
  const policy = graph.policies?.instructions ?? DEFAULT_INSTRUCTION_POLICY;
  const floorDisplay = graph.policies?.floors.display ?? "label";
  const floors = graph.floors ?? [];
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  const steps: RouteStep[] = [];
  let total = 0;
  for (let i = 0; i < result.hops.length; i++) {
    const hop = result.hops[i];
    const from = nodeMap.get(result.path[i]) as BackendNodeLike;
    const to = nodeMap.get(result.path[i + 1]) as BackendNodeLike;
    const floorChange = Boolean(hop.edge.floor_change);
    const legMetres = metric ? (hop.edge.distance_meters as number) : null;
    if (legMetres !== null) total += legMetres;
    steps.push({
      step: i + 1,
      instruction: instructionFor({
        from, to, edge: hop.edge, forward: hop.forward, first: i === 0, floorChange,
        toFloorLabel: floors.length ? floorLabelFor(floors, to.floor, floorDisplay) : undefined,
        policy,
      }),
      node_id: to.id,
      node_name: to.name,
      floor: to.floor ?? null,
      distance_meters: legMetres,
      floor_change: floorChange,
      cumulative_meters: metric ? total : null,
      x_coordinate: to.x_coordinate,
      y_coordinate: to.y_coordinate,
    });
  }
  steps.push({
    step: steps.length + 1,
    instruction: arrivalWording(destNode.name, (destNode.arrival_evidence as "corridor_arrival" | "verified_public_door" | "unknown" | null) ?? undefined),
    node_id: destNode.id, node_name: destNode.name, floor: destNode.floor ?? null,
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
