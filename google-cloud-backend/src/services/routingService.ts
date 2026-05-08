import { getSupabaseClient } from "../lib/supabase.js";
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

function buildInstruction(
  fromNode: MallNode,
  toNode: MallNode,
  edge: MallEdge,
  isFirst: boolean
): string {
  if (isFirst) {
    return `Start on Floor ${toNode.floor ?? "G"} — head toward ${toNode.name}`;
  }
  if (edge.floor_change) {
    const dir =
      (fromNode.y_coordinate ?? 0) < (toNode.y_coordinate ?? 0) ? "up" : "down";
    return `Take the escalator/lift ${dir} to Floor ${toNode.floor ?? "?"}`;
  }
  if (edge.instruction) return edge.instruction;
  return `Walk to ${toNode.name} on Floor ${toNode.floor ?? "?"}`;
}

// ── Main function ─────────────────────────────────────────────────────────────

export interface BuildRouteResult {
  route_id: string | null;
  steps: RouteStep[];
  total_distance_meters: number;
  estimated_minutes: number;
  stop_count: number;
  fallback: boolean;
}

/**
 * Builds a step-by-step indoor route using Dijkstra over mall_nodes/mall_edges.
 * Saves the result to shopping_routes and updates shopping_sessions.active_route_id.
 */
export async function buildRoute(
  session_id: string,
  destination_shop_ids: string[],
  user_id: string | null
): Promise<BuildRouteResult> {
  const supabase = getSupabaseClient();

  // 1. Load session
  const { data: session, error: sessionError } = await supabase
    .from("shopping_sessions")
    .select("mall_id, current_anchor_node_id")
    .eq("id", session_id)
    .single();

  if (sessionError) throw new Error(`Failed to load session: ${sessionError.message}`);
  if (!session?.mall_id) {
    throw new Error(`Session ${session_id} not found or missing mall_id.`);
  }

  const mallId = session.mall_id as string;

  // 2. Load graph
  const [
    { data: allNodes, error: nodesError },
    { data: allEdges, error: edgesError },
  ] = await Promise.all([
    supabase.from("mall_nodes").select("*").eq("mall_id", mallId),
    supabase.from("mall_edges").select("*").eq("mall_id", mallId),
  ]);

  if (nodesError) throw new Error(`Failed to load mall nodes: ${nodesError.message}`);
  if (edgesError) throw new Error(`Failed to load mall edges: ${edgesError.message}`);

  const nodes = (allNodes ?? []) as MallNode[];
  const edges = (allEdges ?? []) as MallEdge[];
  const nodeMap = Object.fromEntries(nodes.map((n) => [n.id, n]));

  // No graph data — return fallback flag
  if (!nodes.length) {
    return {
      route_id: null,
      steps: [],
      total_distance_meters: 0,
      estimated_minutes: 0,
      stop_count: destination_shop_ids.length,
      fallback: true,
    };
  }

  // 3. Determine start node
  let startNodeId: string;
  if (session.current_anchor_node_id) {
    startNodeId = session.current_anchor_node_id as string;
  } else {
    const entrance = nodes.find((n) => n.type === "entrance");
    const groundShop = nodes.find((n) => n.floor === "G" && n.type === "shop");
    startNodeId = entrance?.id ?? groundShop?.id ?? nodes[0].id;
  }

  // 4. Find destination nodes
  const destNodeIds: string[] = [];
  for (const shopId of destination_shop_ids) {
    const node = nodes.find((n) => n.linked_shop_id === shopId);
    if (node) destNodeIds.push(node.id);
  }

  if (!destNodeIds.length) {
    return {
      route_id: null,
      steps: [],
      total_distance_meters: 0,
      estimated_minutes: 0,
      stop_count: destination_shop_ids.length,
      fallback: true,
    };
  }

  // 5. Build sequential path: start → dest1 → dest2 → …
  const allSteps: RouteStep[] = [];
  let totalDistance = 0;
  let stepNum = 1;
  let currentStart = startNodeId;

  for (const destNodeId of destNodeIds) {
    if (currentStart === destNodeId) continue;

    const result = dijkstra(nodes, edges, currentStart, destNodeId);

    if (!result || result.path.length < 2) {
      // No graph path — insert a direct step
      const destNode = nodeMap[destNodeId];
      allSteps.push({
        step: stepNum++,
        instruction: `Head to ${destNode?.name ?? "the store"} on Floor ${destNode?.floor ?? "?"}`,
        node_id: destNodeId,
        node_name: destNode?.name ?? "Store",
        floor: destNode?.floor ?? null,
        distance_meters: 100,
        floor_change: false,
        cumulative_meters: totalDistance + 100,
      });
      totalDistance += 100;
      currentStart = destNodeId;
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
      });
    }

    currentStart = destNodeId;
  }

  // Final arrival step
  const lastNode = nodeMap[destNodeIds[destNodeIds.length - 1]];
  if (allSteps.length && allSteps[allSteps.length - 1].node_id !== destNodeIds[destNodeIds.length - 1]) {
    allSteps.push({
      step: stepNum,
      instruction: `You've arrived at ${lastNode?.name ?? "your destination"}`,
      node_id: destNodeIds[destNodeIds.length - 1],
      node_name: lastNode?.name ?? "Destination",
      floor: lastNode?.floor ?? null,
      distance_meters: 0,
      floor_change: false,
      cumulative_meters: totalDistance,
    });
  }

  const estimated_minutes = Math.max(1, Math.round(totalDistance / 72));

  // 6. Persist route
  const { data: savedRoute } = await supabase
    .from("shopping_routes")
    .insert({
      session_id,
      user_id: user_id ?? null,
      mall_id: mallId,
      destination_shop_ids: JSON.stringify(destination_shop_ids),
      route_steps: JSON.stringify(allSteps),
      total_distance_meters: totalDistance,
      estimated_minutes,
      status: "active",
    })
    .select("id")
    .single();

  const route_id = savedRoute?.id ?? null;

  if (route_id) {
    await supabase
      .from("shopping_sessions")
      .update({ active_route_id: route_id, last_seen_at: new Date().toISOString() })
      .eq("id", session_id);
  }

  return {
    route_id,
    steps: allSteps,
    total_distance_meters: totalDistance,
    estimated_minutes,
    stop_count: destNodeIds.length,
    fallback: false,
  };
}
