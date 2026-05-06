/**
 * build-route — MallMind Edge Function
 *
 * Builds a real step-by-step indoor route between stores using
 * mall_nodes (graph vertices) and mall_edges (graph edges).
 * Uses Dijkstra's algorithm for shortest path.
 *
 * Input:  { session_id, destination_shop_ids: string[], user_id? }
 * Output: { route_id, steps: RouteStep[], total_distance_meters, estimated_minutes }
 *
 * Each step:
 *   { step, instruction, node_id, node_name, floor, distance_meters, floor_change }
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ── Types ─────────────────────────────────────────────────────────────────────

interface MallNode {
  id: string;
  mall_id: string;
  name: string;
  type: string;
  floor: string | null;
  x_coordinate: number | null;
  y_coordinate: number | null;
  linked_shop_id: string | null;
}

interface MallEdge {
  id: string;
  mall_id: string;
  from_node_id: string;
  to_node_id: string;
  distance_meters: number;
  floor_change: boolean;
  instruction: string | null;
}

interface RouteStep {
  step: number;
  instruction: string;
  node_id: string;
  node_name: string;
  floor: string | null;
  distance_meters: number;
  floor_change: boolean;
  cumulative_meters: number;
}

// ── Dijkstra ──────────────────────────────────────────────────────────────────

interface DijkstraResult {
  path: string[];        // ordered node IDs
  edges: MallEdge[];     // edges traversed (same order as path transitions)
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
    // Greedy pick: unvisited node with smallest distance
    let u: string | null = null;
    for (const id of unvisited) {
      if (u === null || dist[id] < dist[u]) u = id;
    }
    if (!u || dist[u] === Infinity) break;
    if (u === endId) break;
    unvisited.delete(u);

    // Relax neighbours (edges are undirected)
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

  // Reconstruct path
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

// ── Instruction builder ───────────────────────────────────────────────────────

function buildInstruction(
  stepNum: number,
  fromNode: MallNode,
  toNode: MallNode,
  edge: MallEdge,
  isFirst: boolean,
  isLast: boolean
): string {
  if (isFirst) {
    return `Start on Floor ${toNode.floor ?? "G"} — head toward ${toNode.name}`;
  }
  if (isLast) {
    return `Arrive at ${toNode.name} (Floor ${toNode.floor ?? "?"}, Unit ${toNode.linked_shop_id ? "—" : "—"})`;
  }
  if (edge.floor_change) {
    const dir =
      (fromNode.y_coordinate ?? 0) < (toNode.y_coordinate ?? 0)
        ? "up"
        : "down";
    return `Take the escalator/lift ${dir} to Floor ${toNode.floor ?? "?"}`;
  }
  if (edge.instruction) return edge.instruction;
  return `Walk to ${toNode.name} on Floor ${toNode.floor ?? "?"}`;
}

// ── Main handler ──────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST")
    return new Response("Method not allowed", { status: 405, headers: CORS });

  try {
    const body = await req.json();
    const {
      session_id,
      destination_shop_ids,
      user_id,
    }: {
      session_id: string;
      destination_shop_ids: string[];
      user_id?: string;
    } = body;

    if (!session_id || !destination_shop_ids?.length) {
      return new Response(
        JSON.stringify({ error: "session_id and destination_shop_ids required" }),
        { status: 400, headers: { "Content-Type": "application/json", ...CORS } }
      );
    }

    // 1. Load session to get mall_id and current anchor
    const { data: session } = await supabase
      .from("shopping_sessions")
      .select("mall_id, current_anchor_node_id")
      .eq("id", session_id)
      .single();

    if (!session?.mall_id) {
      return new Response(
        JSON.stringify({ error: "Session not found or missing mall_id" }),
        { status: 404, headers: { "Content-Type": "application/json", ...CORS } }
      );
    }

    const mallId = session.mall_id;

    // 2. Load all nodes and edges for this mall
    const [{ data: allNodes }, { data: allEdges }] = await Promise.all([
      supabase.from("mall_nodes").select("*").eq("mall_id", mallId),
      supabase.from("mall_edges").select("*").eq("mall_id", mallId),
    ]);

    if (!allNodes?.length) {
      return new Response(
        JSON.stringify({ error: "No navigation graph found for this mall", steps: [] }),
        { headers: { "Content-Type": "application/json", ...CORS } }
      );
    }

    const nodes = allNodes as MallNode[];
    const edges = (allEdges ?? []) as MallEdge[];
    const nodeMap = Object.fromEntries(nodes.map((n) => [n.id, n]));

    // 3. Determine start node: session's anchor or mall entrance
    let startNodeId: string;
    if (session.current_anchor_node_id) {
      startNodeId = session.current_anchor_node_id;
    } else {
      const entrance = nodes.find((n) => n.type === "entrance");
      if (!entrance) {
        // Fallback: first Ground Floor shop node
        const groundShop = nodes.find((n) => n.floor === "G" && n.type === "shop");
        startNodeId = groundShop?.id ?? nodes[0].id;
      } else {
        startNodeId = entrance.id;
      }
    }

    // 4. Find destination nodes for each shop ID
    const destinationNodeIds: string[] = [];
    for (const shopId of destination_shop_ids) {
      const node = nodes.find((n) => n.linked_shop_id === shopId);
      if (node) destinationNodeIds.push(node.id);
    }

    if (!destinationNodeIds.length) {
      return new Response(
        JSON.stringify({
          error: "No navigation nodes found for the requested shops",
          steps: [],
          fallback: true,
        }),
        { headers: { "Content-Type": "application/json", ...CORS } }
      );
    }

    // 5. Build sequential route: start → dest1 → dest2 → ...
    const allSteps: RouteStep[] = [];
    let totalDistance = 0;
    let stepNum = 1;
    let currentStart = startNodeId;

    for (const destNodeId of destinationNodeIds) {
      if (currentStart === destNodeId) continue;

      const result = dijkstra(nodes, edges, currentStart, destNodeId);

      if (!result || result.path.length < 2) {
        // No path found via graph — generate a direct step
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

      // Translate path into steps
      for (let i = 0; i < result.path.length - 1; i++) {
        const fromId = result.path[i];
        const toId = result.path[i + 1];
        const fromNode = nodeMap[fromId];
        const toNode = nodeMap[toId];
        const edge = result.edges[i];
        const isFirst = stepNum === 1;
        const isLast = i === result.path.length - 2 && destNodeId === destinationNodeIds[destinationNodeIds.length - 1];

        const instruction = buildInstruction(stepNum, fromNode, toNode, edge, isFirst, isLast);
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

    // Add final arrival step
    const lastDest = destinationNodeIds[destinationNodeIds.length - 1];
    const lastNode = nodeMap[lastDest];
    if (allSteps.length > 0 && allSteps[allSteps.length - 1].node_id !== lastDest) {
      allSteps.push({
        step: stepNum,
        instruction: `You've arrived at ${lastNode?.name ?? "your destination"}`,
        node_id: lastDest,
        node_name: lastNode?.name ?? "Destination",
        floor: lastNode?.floor ?? null,
        distance_meters: 0,
        floor_change: false,
        cumulative_meters: totalDistance,
      });
    }

    const estimated_minutes = Math.max(1, Math.round(totalDistance / 72)); // ~72m/min walking

    // 6. Save route to shopping_routes
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

    // 7. Update session with active_route_id and first destination as anchor
    if (route_id) {
      await supabase
        .from("shopping_sessions")
        .update({
          active_route_id: route_id,
          last_seen_at: new Date().toISOString(),
        })
        .eq("id", session_id);
    }

    return new Response(
      JSON.stringify({
        route_id,
        steps: allSteps,
        total_distance_meters: totalDistance,
        estimated_minutes,
        stop_count: destinationNodeIds.length,
      }),
      { headers: { "Content-Type": "application/json", ...CORS } }
    );
  } catch (err) {
    console.error("build-route error:", err);
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { "Content-Type": "application/json", ...CORS } }
    );
  }
});
