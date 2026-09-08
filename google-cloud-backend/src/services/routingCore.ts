/**
 * routingCore.ts — pure, I/O-free indoor route planning over a mall graph.
 *
 * Everything here is deterministic and testable without Supabase. The I/O
 * wrapper (routingService.ts) loads mall_nodes / mall_edges, calls
 * `buildRouteResultFromGraph`, and persists only REAL routes.
 *
 * TRUTHFULNESS CONTRACT
 *   A destination the graph cannot reach yields an explicit unroutable result:
 *   zero steps, zero distance, zero minutes, `fallback: true` with a reason.
 *   Nothing in this module ever invents a step, a distance, a floor, a
 *   direction or a travel time. (Before Sept 2026 the router inserted a
 *   fabricated 100 m "Head to X on Floor ?" step for such legs; that path is
 *   gone and guarded by routingServiceHarness.ts.)
 */

import type { MallNode, MallEdge, RouteStep } from "../lib/types.js";

// ── Dijkstra ──────────────────────────────────────────────────────────────────

interface DijkstraResult {
  path: string[];
  edges: MallEdge[];
  totalDistance: number;
}

function dijkstra(
  nodes: MallNode[],
  edges: MallEdge[],
  startId: string,
  endId: string
): DijkstraResult | null {
  const dist: Record<string, number> = {};
  const prev: Record<string, { from: string; edge: MallEdge } | null> = {};
  const unvisited = new Set<string>();

  for (const n of nodes) {
    dist[n.id] = Infinity;
    prev[n.id] = null;
    unvisited.add(n.id);
  }
  if (!(startId in dist) || !(endId in dist)) return null;
  dist[startId] = 0;

  while (unvisited.size > 0) {
    let u: string | null = null;
    for (const id of unvisited) {
      if (u === null || dist[id] < dist[u]) u = id;
    }
    if (!u || dist[u] === Infinity) break;
    if (u === endId) break;
    unvisited.delete(u);

    // Edges are undirected
    const neighbours = edges.filter(
      (e) => e.from_node_id === u || e.to_node_id === u
    );
    for (const e of neighbours) {
      const v = e.from_node_id === u ? e.to_node_id : e.from_node_id;
      if (!unvisited.has(v)) continue;
      const alt = dist[u] + e.distance_meters;
      if (alt < dist[v]) {
        dist[v] = alt;
        prev[v] = { from: u, edge: e };
      }
    }
  }

  if (dist[endId] === Infinity) return null;

  const path: string[] = [];
  const traversedEdges: MallEdge[] = [];
  let cur = endId;
  while (prev[cur]) {
    const { from, edge } = prev[cur]!;
    path.unshift(cur);
    traversedEdges.unshift(edge);
    cur = from;
  }
  path.unshift(startId);

  return { path, edges: traversedEdges, totalDistance: dist[endId] };
}

// ── Instruction text ──────────────────────────────────────────────────────────

function formatFloorLabel(floor: string | null | undefined): string {
  if (!floor) return "the mall";

  const trimmed = String(floor).trim();
  if (trimmed === "G") return "Ground Floor";

  const levelMatch = trimmed.match(/^L(\d+)$/i);
  if (levelMatch) return `Level ${levelMatch[1]}`;

  return trimmed;
}

function isInternalNavigationNode(node: MallNode | undefined): boolean {
  if (!node) return false;
  if (node.linked_shop_id) return false;

  const name = (node.name ?? "").toLowerCase();
  const nodeType = String(node.type ?? "");

  return (
    nodeType === "corridor" ||
    name.includes("spine") ||
    name.includes("corridor") ||
    name.includes("junction") ||
    /\bnode\s*\d+\b/i.test(name)
  );
}

function buildInstruction(
  fromNode: MallNode,
  toNode: MallNode,
  edge: MallEdge,
  isFirst: boolean
): string {
  const floorLabel = formatFloorLabel(toNode.floor ?? fromNode.floor);

  if (isFirst) {
    const startName = isInternalNavigationNode(fromNode) ? null : fromNode.name;
    if (startName) return `Start at ${startName} and head into ${floorLabel}.`;
    return `Start in ${floorLabel} and head into the main corridor.`;
  }

  if (edge.floor_change) {
    return `Take the escalator or lift to ${floorLabel}.`;
  }

  if (isInternalNavigationNode(toNode)) {
    return `Continue along the ${floorLabel} corridor.`;
  }

  return `Walk toward ${toNode.name}.`;
}

// ── Planning ──────────────────────────────────────────────────────────────────

/**
 * Why a route could not be built honestly. Every reason means "no steps, no
 * distance, no time" — the caller must show an explicit unavailable state and
 * must never invent a substitute route.
 */
export type RouteFallbackReason =
  | "no_graph"                  // the mall has no mall_nodes at all
  | "destination_not_in_graph"  // none of the requested shops has a graph node
  | "no_path";                  // graph exists but at least one leg is disconnected

export type GraphRoutePlan =
  | { ok: true; steps: RouteStep[]; totalDistance: number; stopCount: number }
  | { ok: false; reason: RouteFallbackReason; unroutable: string[] };

/**
 * Plan a sequential route start → dest1 → dest2 … over an in-memory graph.
 * If ANY leg has no graph path the whole plan fails with `reason: "no_path"`
 * and names every unreachable destination. No partial or synthetic routes.
 */
export function planGraphRoute(
  nodes: MallNode[],
  edges: MallEdge[],
  startNodeId: string,
  destNodeIds: string[]
): GraphRoutePlan {
  const nodeMap = Object.fromEntries(nodes.map((n) => [n.id, n]));
  const allSteps: RouteStep[] = [];
  const unroutable: string[] = [];
  let totalDistance = 0;
  let stepNum = 1;
  let currentStart = startNodeId;

  for (const destNodeId of destNodeIds) {
    if (currentStart === destNodeId) continue;

    const result = dijkstra(nodes, edges, currentStart, destNodeId);

    if (!result || result.path.length < 2) {
      const destNode = nodeMap[destNodeId];
      unroutable.push(destNode?.name ?? destNodeId);
      // Keep evaluating the remaining legs from the same start so the caller
      // learns every unreachable destination, not just the first.
      continue;
    }

    for (let i = 0; i < result.path.length - 1; i++) {
      const fromId = result.path[i];
      const toId = result.path[i + 1];
      const fromNode = nodeMap[fromId];
      const toNode = nodeMap[toId];
      const edge = result.edges[i];
      const instruction = buildInstruction(fromNode, toNode, edge, stepNum === 1);
      totalDistance += edge.distance_meters;

      allSteps.push({
        step: stepNum++,
        instruction,
        node_id: toId,
        node_name: toNode?.name ?? "—",
        floor: toNode?.floor ?? null,
        distance_meters: edge.distance_meters,
        floor_change: edge.floor_change,
        cumulative_meters: totalDistance,
        x_coordinate: toNode?.x_coordinate ?? null,
        y_coordinate: toNode?.y_coordinate ?? null,
      });
    }

    currentStart = destNodeId;
  }

  if (unroutable.length) {
    return { ok: false, reason: "no_path", unroutable };
  }

  const lastNode = nodeMap[destNodeIds[destNodeIds.length - 1]];
  if (allSteps.length) {
    allSteps.push({
      step: stepNum,
      instruction: `You've arrived at ${lastNode?.name ?? "your destination"}`,
      node_id: destNodeIds[destNodeIds.length - 1],
      node_name: lastNode?.name ?? "Destination",
      floor: lastNode?.floor ?? null,
      distance_meters: 0,
      floor_change: false,
      cumulative_meters: totalDistance,
      x_coordinate: lastNode?.x_coordinate ?? null,
      y_coordinate: lastNode?.y_coordinate ?? null,
    });
  }

  return { ok: true, steps: allSteps, totalDistance, stopCount: destNodeIds.length };
}

/** Pick the start node: an explicit anchor, else an entrance, else a ground-floor shop, else the first node. */
export function pickStartNode(nodes: MallNode[], anchorNodeId?: string | null): string {
  if (anchorNodeId && nodes.some((n) => n.id === anchorNodeId)) return anchorNodeId;
  const entrance = nodes.find((n) => n.type === "entrance");
  const groundShop = nodes.find((n) => n.floor === "G" && n.type === "shop");
  return entrance?.id ?? groundShop?.id ?? nodes[0].id;
}

/** Resolve requested shop ids to graph node ids (order preserved; unknown shops dropped). */
export function resolveDestinationNodes(nodes: MallNode[], destination_shop_ids: string[]): string[] {
  const destNodeIds: string[] = [];
  for (const shopId of destination_shop_ids) {
    const node = nodes.find((n) => n.linked_shop_id === shopId);
    if (node) destNodeIds.push(node.id);
  }
  return destNodeIds;
}

// ── Result shape ──────────────────────────────────────────────────────────────

export interface BuildRouteResult {
  route_id: string | null;
  steps: RouteStep[];
  total_distance_meters: number;
  estimated_minutes: number;
  stop_count: number;
  /** true → no honest route exists; steps is empty and distance/time are 0. */
  fallback: boolean;
  /** Why `fallback` is true; null when a real route was built. */
  fallback_reason: RouteFallbackReason | null;
  /** Destination names the graph could not reach (only for `no_path`). */
  unroutable_destinations: string[];
}

export function unroutableResult(
  reason: RouteFallbackReason,
  stop_count: number,
  unroutable: string[] = []
): BuildRouteResult {
  return {
    route_id: null,
    steps: [],
    total_distance_meters: 0,
    estimated_minutes: 0,
    stop_count,
    fallback: true,
    fallback_reason: reason,
    unroutable_destinations: unroutable,
  };
}

export interface MallGraph {
  nodes: MallNode[];
  edges: MallEdge[];
}

/** Average indoor walking pace used for the time estimate (metres per minute). */
export const WALK_METERS_PER_MINUTE = 72;

/**
 * Build the full (unpersisted) route result for a graph. `route_id` is always
 * null here; the I/O layer fills it in after persisting a REAL route.
 */
export function buildRouteResultFromGraph(
  graph: MallGraph,
  destination_shop_ids: string[],
  anchorNodeId?: string | null
): BuildRouteResult {
  const { nodes, edges } = graph;
  if (!nodes.length) return unroutableResult("no_graph", destination_shop_ids.length);

  const destNodeIds = resolveDestinationNodes(nodes, destination_shop_ids);
  if (!destNodeIds.length) {
    return unroutableResult("destination_not_in_graph", destination_shop_ids.length);
  }

  const plan = planGraphRoute(nodes, edges, pickStartNode(nodes, anchorNodeId), destNodeIds);
  if (!plan.ok) return unroutableResult(plan.reason, destination_shop_ids.length, plan.unroutable);

  return {
    route_id: null,
    steps: plan.steps,
    total_distance_meters: plan.totalDistance,
    estimated_minutes: Math.max(1, Math.round(plan.totalDistance / WALK_METERS_PER_MINUTE)),
    stop_count: plan.stopCount,
    fallback: false,
    fallback_reason: null,
    unroutable_destinations: [],
  };
}
