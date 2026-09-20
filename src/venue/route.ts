/**
 * route.ts — generic shortest-path routing over a Venue Pack graph.
 *
 * Same Dijkstra the pilots used (a faithful port of the backend routingCore), now venue-agnostic:
 *   • ROUTING COST is separate from PHYSICAL DISTANCE: horizontal edges cost their pack-unit
 *     length (metres for "m", pixels for "px" — never converted); vertical connector edges cost a
 *     policy value (policies.routing.connector_cost, else code defaults) and carry NO distance;
 *   • a route preference may exclude connectors ("step_free": stairs, escalators and any connector
 *     with step_free field_verified_no) or make floor changes expensive ("fewest_changes");
 *   • edges may be one-way; instructions are looked up for the DIRECTION walked;
 *   • node kinds (not names) drive generic wording; floors come from the pack;
 *   • metres exist only when EVERY horizontal edge walked is measured; minutes only when, in
 *     addition, every connector ridden has a measured traversal time; nothing is estimated;
 *   • the arrival step's wording comes from the destination's own arrival evidence.
 * Never fabricates a route: no path → fallback:true; unknown destination → found:false.
 */

import type { BackendNodeLike, BackendEdgeLike } from "../components/navigation/floorplanModel";
import type { RouteStep, RouteStepVia } from "@/context/ShoppingSessionContext";
import type { VenueFloor, VenuePolicies, VerticalKind, RoutePreference } from "./contract";
import { instructionFor, floorLabelFor } from "./instructions";
import { arrivalWording } from "./evidence";

/** Average indoor walking pace used ONLY for measured routes (metres per minute). */
export const WALK_METERS_PER_MINUTE = 72;

export interface RouteResult {
  found: boolean;
  fallback: boolean;
  steps: RouteStep[];
  /** Every HORIZONTAL edge walked is measured → walking distance is truthful. */
  metric: boolean;
  /** Sum of measured horizontal metres (connectors add nothing); null when not metric. */
  total_distance_meters: number | null;
  /** Walking minutes + measured connector times; null unless metric AND every connector ridden has a measured time. */
  estimated_minutes: number | null;
  /** Floor changes on this route (connector rides). */
  connector_count: number;
  /** Connector rides without a measured traversal time (why minutes may be withheld). */
  unmeasured_connectors: number;
  message: string | null;
}

export interface RouteOptions {
  /** Overrides policies.routing.preference. */
  preference?: RoutePreference;
}

/** The minimum a router needs; a LoadedVenue satisfies it, and tests can hand in bare graphs. */
export interface RoutableGraph {
  nodes: BackendNodeLike[];
  edges: BackendEdgeLike[];
  floors?: readonly VenueFloor[];
  policies?: Pick<VenuePolicies, "instructions" | "floors"> & Partial<Pick<VenuePolicies, "routing">>;
}

const DEFAULT_INSTRUCTION_POLICY = { generic_fallback: true, start_prefix: true };

/**
 * Default connector ROUTING COSTS (pack distance-unit equivalents; a preference, never a claim,
 * never displayed). Venues override them in policies.routing.connector_cost.
 */
export const DEFAULT_CONNECTOR_COST: Record<"m" | "px", Record<VerticalKind, number>> = {
  m: { lift: 30, escalator: 20, stairs: 25, ramp: 15 },
  px: { lift: 150, escalator: 100, stairs: 120, ramp: 80 },
};
/** "fewest_changes" makes every floor change cost this many horizontal units more. */
const FLOOR_CHANGE_PENALTY: Record<"m" | "px", number> = { m: 1000, px: 5000 };

const isVertical = (e: BackendEdgeLike) => e.floor_change === true;

/** Edge routing cost: physical length for horizontal edges; policy for vertical ones; Infinity = excluded. */
function edgeCost(e: BackendEdgeLike, unit: "m" | "px", pref: RoutePreference, costs: Record<VerticalKind, number>): number {
  if (!isVertical(e)) {
    if (typeof e.weight === "number" && e.weight > 0) return e.weight;
    if (typeof e.distance_meters === "number" && e.distance_meters > 0) return e.distance_meters;
    return 1;
  }
  const kind = (e.vertical_kind ?? "stairs") as VerticalKind;
  if (pref === "step_free" && (kind === "stairs" || kind === "escalator" || e.step_free === "field_verified_no")) return Infinity;
  return costs[kind] + (pref === "fewest_changes" ? FLOOR_CHANGE_PENALTY[unit] : 0);
}

interface Hop { from: string; edge: BackendEdgeLike; forward: boolean }

function dijkstra(nodes: BackendNodeLike[], edges: BackendEdgeLike[], startId: string, endId: string, cost: (e: BackendEdgeLike) => number): { path: string[]; hops: Hop[] } | null {
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
      const c = cost(edge);
      if (!Number.isFinite(c)) continue; // excluded by preference (e.g. stairs under step_free)
      const alt = (dist.get(u) as number) + c;
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

/** Up or down between two floors by declared order; null when unknown. */
function floorDirection(floors: readonly VenueFloor[], fromFloor: string | null | undefined, toFloor: string | null | undefined): "up" | "down" | null {
  const a = floors.find((f) => f.id === fromFloor)?.order, b = floors.find((f) => f.id === toFloor)?.order;
  if (a == null || b == null || a === b) return null;
  return b > a ? "up" : "down";
}

/**
 * Route from a start NODE to a destination (destination id, or the arrival node id itself).
 */
export function buildRoute(graph: RoutableGraph, startNodeId: string, destinationId: string, options: RouteOptions = {}): RouteResult {
  const empty = { steps: [] as RouteStep[], metric: false, total_distance_meters: null, estimated_minutes: null, connector_count: 0, unmeasured_connectors: 0 };
  const { nodes, edges } = graph;
  // Unit of the horizontal weights: metres when every horizontal edge carries metres, else pixels.
  const horizontal = edges.filter((e) => !isVertical(e));
  const unit: "m" | "px" = horizontal.length > 0 && horizontal.every((e) => typeof e.distance_meters === "number" && e.distance_meters > 0) ? "m" : "px";
  const routing = graph.policies?.routing;
  const pref: RoutePreference = options.preference ?? routing?.preference ?? "shortest";
  const costs: Record<VerticalKind, number> = { ...DEFAULT_CONNECTOR_COST[unit], ...(routing?.connector_cost ?? {}) };
  const cost = (e: BackendEdgeLike) => edgeCost(e, unit, pref, costs);
  const destNode = nodes.find((n) => n.linked_shop_id === destinationId || n.id === destinationId);
  if (!destNode) return { found: false, fallback: false, ...empty, message: "That destination isn’t on this map yet." };
  if (!nodes.some((n) => n.id === startNodeId)) return { found: true, fallback: true, ...empty, message: "Please choose a starting point." };
  if (startNodeId === destNode.id) return { found: true, fallback: true, ...empty, message: "You’re already there." };

  const result = dijkstra(nodes, edges, startNodeId, destNode.id, cost);
  if (!result || result.path.length < 2) {
    return { found: true, fallback: true, ...empty, message: `${destNode.name} isn’t connected to this map yet.` };
  }

  // Metres exist only if EVERY HORIZONTAL edge walked was measured (connectors carry no distance).
  // One unmeasured horizontal leg → the whole route is unscaled. Minutes need measured connector times too.
  const walked = result.hops.filter((h) => !isVertical(h.edge));
  const ridden = result.hops.filter((h) => isVertical(h.edge));
  const metric = walked.every((h) => typeof h.edge.distance_meters === "number" && h.edge.distance_meters > 0);
  const unmeasuredConnectors = ridden.filter((h) => typeof h.edge.traversal_seconds !== "number").length;
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
    const legMetres = metric && !floorChange ? (hop.edge.distance_meters as number) : null;
    if (legMetres !== null) total += legMetres;
    const via: RouteStepVia | null = floorChange
      ? { connector_id: hop.edge.connector_id ?? hop.edge.id, kind: (hop.edge.vertical_kind ?? "stairs") as RouteStepVia["kind"], from_floor: from.floor ?? "", to_floor: to.floor ?? "", traversal_seconds: typeof hop.edge.traversal_seconds === "number" ? hop.edge.traversal_seconds : null }
      : null;
    steps.push({
      step: i + 1,
      instruction: instructionFor({
        from, to, edge: hop.edge, forward: hop.forward, first: i === 0, floorChange,
        toFloorLabel: floors.length ? floorLabelFor(floors, to.floor, floorDisplay) : undefined,
        direction: floorChange ? floorDirection(floors, from.floor, to.floor) : null,
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
      via,
    });
  }
  steps.push({
    step: steps.length + 1,
    instruction: arrivalWording(destNode.name, (destNode.arrival_evidence as "corridor_arrival" | "verified_public_door" | "unknown" | null) ?? undefined),
    node_id: destNode.id, node_name: destNode.name, floor: destNode.floor ?? null,
    distance_meters: metric ? 0 : null, floor_change: false, cumulative_meters: metric ? total : null,
    x_coordinate: destNode.x_coordinate, y_coordinate: destNode.y_coordinate,
  });

  const rideSeconds = ridden.reduce((s, h) => s + (typeof h.edge.traversal_seconds === "number" ? h.edge.traversal_seconds : 0), 0);
  const timeComplete = metric && unmeasuredConnectors === 0;
  return {
    found: true,
    fallback: false,
    steps,
    metric,
    total_distance_meters: metric ? total : null,
    estimated_minutes: timeComplete ? Math.max(1, Math.round(total / WALK_METERS_PER_MINUTE + rideSeconds / 60)) : null,
    connector_count: ridden.length,
    unmeasured_connectors: unmeasuredConnectors,
    message: null,
  };
}
