/**
 * routingService.ts — I/O wrapper around the pure planner in routingCore.ts.
 *
 * Loads mall_nodes / mall_edges (and the shopping session) from Supabase,
 * plans the route, and persists ONLY real routes. Unroutable results are
 * returned explicitly (fallback + reason) and never written to shopping_routes.
 */

import { getSupabaseClient } from "../lib/supabase.js";
import type { MallNode, MallEdge } from "../lib/types.js";
import {
  buildRouteResultFromGraph,
  type BuildRouteResult,
  type MallGraph,
} from "./routingCore.js";

export type {
  BuildRouteResult, RouteFallbackReason, GraphRoutePlan, MallGraph,
} from "./routingCore.js";
export {
  planGraphRoute, pickStartNode, resolveDestinationNodes, buildRouteResultFromGraph,
} from "./routingCore.js";

async function loadMallGraph(mall_id: string): Promise<MallGraph> {
  const supabase = getSupabaseClient();
  const [
    { data: allNodes, error: nodesError },
    { data: allEdges, error: edgesError },
  ] = await Promise.all([
    supabase.from("mall_nodes").select("*").eq("mall_id", mall_id),
    supabase.from("mall_edges").select("*").eq("mall_id", mall_id),
  ]);

  if (nodesError) throw new Error(`Failed to load mall nodes: ${nodesError.message}`);
  if (edgesError) throw new Error(`Failed to load mall edges: ${edgesError.message}`);

  return { nodes: (allNodes ?? []) as MallNode[], edges: (allEdges ?? []) as MallEdge[] };
}

export interface RouteBuildDeps {
  /** Injectable graph loader (tests); defaults to Supabase mall_nodes / mall_edges. */
  loadGraph?: (mall_id: string) => Promise<MallGraph>;
}

/**
 * Builds a step-by-step indoor route using Dijkstra over mall_nodes/mall_edges.
 * Does NOT require a session — uses mall_id directly.
 * Returns steps but does not persist the route (route_id is always null).
 *
 * Use this when the assistant has route intent but no active session_id.
 */
export async function buildRouteNoSession(
  mall_id: string,
  destination_shop_ids: string[],
  deps: RouteBuildDeps = {}
): Promise<BuildRouteResult> {
  const graph = await (deps.loadGraph ?? loadMallGraph)(mall_id);
  return buildRouteResultFromGraph(graph, destination_shop_ids);
}

/**
 * Builds a step-by-step indoor route using Dijkstra over mall_nodes/mall_edges.
 * Saves the result to shopping_routes and updates shopping_sessions.active_route_id.
 * A route that cannot be built honestly is never persisted.
 */
export async function buildRoute(
  session_id: string,
  destination_shop_ids: string[],
  user_id: string | null,
  deps: RouteBuildDeps = {}
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

  // 2. Load graph + plan (start = session anchor > entrance > ground shop > first node)
  const graph = await (deps.loadGraph ?? loadMallGraph)(mallId);
  const result = buildRouteResultFromGraph(
    graph,
    destination_shop_ids,
    (session.current_anchor_node_id as string | null) ?? null
  );

  // Unroutable → explicit, truthful, and never persisted
  if (result.fallback) return result;

  // 3. Persist the real route
  const { data: savedRoute, error: routeInsertError } = await supabase
    .from("shopping_routes")
    .insert({
      session_id,
      user_id: user_id ?? null,
      mall_id: mallId,
      // JSONB columns should receive native JS arrays/objects, not JSON.stringify strings.
      destination_shop_ids,
      route_steps: result.steps,
      total_distance_meters: result.total_distance_meters,
      estimated_minutes: result.estimated_minutes,
      status: "active",
    })
    .select("id")
    .single();

  if (routeInsertError) {
    console.error("[buildRoute] Failed to save shopping_routes row:", routeInsertError.message);
  }

  const route_id = savedRoute?.id ?? null;

  if (route_id) {
    await supabase
      .from("shopping_sessions")
      .update({ active_route_id: route_id, last_seen_at: new Date().toISOString() })
      .eq("id", session_id);
  }

  return { ...result, route_id };
}
