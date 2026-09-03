/**
 * routingServiceHarness.ts — route truthfulness regression harness.
 *
 * Proves that the routing service can no longer fabricate a route: an
 * unreachable destination yields an explicit unroutable result with ZERO
 * steps, ZERO distance and ZERO minutes, and is never persisted. Pure graph
 * planning is exercised directly; the async builders run with an injected
 * graph loader (no Supabase, no network, no secrets).
 *
 * Run: npm run test:routing
 */

export {};

/* eslint-disable @typescript-eslint/no-require-imports */
// routingCore is the pure planner (no Supabase import); routingService only
// adds I/O on top and delegates to buildRouteResultFromGraph.
const {
  planGraphRoute, buildRouteResultFromGraph, pickStartNode, resolveDestinationNodes,
} = require("../routingCore") as typeof import("../routingCore");
type MallGraph = import("../routingCore").MallGraph;
const buildRouteNoSession = async (
  _mall: string, dests: string[], deps: { loadGraph: () => Promise<MallGraph> },
) => buildRouteResultFromGraph(await deps.loadGraph(), dests);
type MallNode = import("../../lib/types").MallNode;
type MallEdge = import("../../lib/types").MallEdge;

let passed = 0, failed = 0;
function assert(cond: boolean, label: string): void {
  if (cond) { console.log(`  ✓ ${label}`); passed++; }
  else      { console.error(`  ✗ ${label}`); failed++; }
}

const MALL = "mall-test";
function node(id: string, type: MallNode["type"], shop: string | null = null, floor = "G"): MallNode {
  return { id, mall_id: MALL, name: id.replace(/-/g, " "), type, floor, x_coordinate: 0, y_coordinate: 0, linked_shop_id: shop };
}
function edge(from: string, to: string, d: number, floor_change = false): MallEdge {
  return { id: `${from}>${to}`, mall_id: MALL, from_node_id: from, to_node_id: to, distance_meters: d, floor_change, instruction: null };
}

// Connected spine: entrance → c1 → c2 → clicks ; plus an ORPHAN shop with no edges.
const NODES: MallNode[] = [
  node("entrance-main", "entrance"),
  node("c1", "shop"), // named like a corridor below so the instruction builder treats it as internal
  node("c2", "shop"),
  node("clicks", "shop", "clicks"),
  node("game", "shop", "game"),
  node("orphan", "shop", "orphan"),
];
NODES[1].name = "corridor 1";
NODES[2].name = "corridor 2";
const EDGES: MallEdge[] = [
  edge("entrance-main", "c1", 22),
  edge("c1", "c2", 24),
  edge("c2", "clicks", 20),
  edge("c2", "game", 30),
];

console.log("\nplanGraphRoute — real path");
{
  const plan = planGraphRoute(NODES, EDGES, "entrance-main", ["clicks"]);
  assert(plan.ok, "connected destination plans a route");
  if (plan.ok) {
    assert(plan.steps.length === 4, `4 steps (3 legs + arrival), got ${plan.steps.length}`);
    assert(plan.totalDistance === 66, `distance is the sum of traversed edges (66), got ${plan.totalDistance}`);
    assert(plan.steps[plan.steps.length - 1].instruction.includes("arrived at clicks"), "ends with an arrival step");
    assert(plan.steps.every((s) => Number.isFinite(s.distance_meters)), "every step carries a real edge distance");
  }
}

console.log("\nplanGraphRoute — unreachable destination is NEVER fabricated");
{
  const plan = planGraphRoute(NODES, EDGES, "entrance-main", ["orphan"]);
  assert(!plan.ok, "disconnected destination fails the plan");
  if (!plan.ok) {
    assert(plan.reason === "no_path", `reason is no_path, got ${plan.reason}`);
    assert(plan.unroutable.length === 1 && plan.unroutable[0] === "orphan", "names the unreachable destination");
  }
  const asAny = plan as unknown as { steps?: unknown[] };
  assert(!asAny.steps, "no steps object leaks out of a failed plan");
}

console.log("\nplanGraphRoute — multi-stop with one unreachable leg fails as a whole");
{
  const plan = planGraphRoute(NODES, EDGES, "entrance-main", ["clicks", "orphan", "game"]);
  assert(!plan.ok, "one disconnected leg fails the whole multi-stop plan (no silent partial route)");
  if (!plan.ok) {
    assert(plan.unroutable.includes("orphan"), "reports the disconnected leg");
    assert(!plan.unroutable.includes("clicks") && !plan.unroutable.includes("game"), "does not blame reachable legs");
  }
}

console.log("\nplanGraphRoute — unknown ids");
{
  const plan = planGraphRoute(NODES, EDGES, "does-not-exist", ["clicks"]);
  assert(!plan.ok && plan.reason === "no_path", "unknown start node cannot produce a route");
}

console.log("\nhelpers");
{
  assert(pickStartNode(NODES, "c2") === "c2", "anchor node wins when it exists in the graph");
  assert(pickStartNode(NODES, "ghost") === "entrance-main", "unknown anchor falls back to the entrance");
  assert(resolveDestinationNodes(NODES, ["game", "lacoste"]).join(",") === "game", "unknown shops are dropped, known ones resolve");
}

console.log("\nbuildRouteResultFromGraph — explicit unavailable results (pure, no DB)");
(async () => {
  const withGraph = { loadGraph: async () => ({ nodes: NODES, edges: EDGES }) };

  const ok = await buildRouteNoSession(MALL, ["clicks"], withGraph);
  assert(!ok.fallback && ok.fallback_reason === null, "real route: fallback=false, reason=null");
  assert(ok.total_distance_meters === 66 && ok.estimated_minutes >= 1, "real route carries real distance/time");

  const noPath = await buildRouteNoSession(MALL, ["orphan"], withGraph);
  assert(noPath.fallback === true, "unreachable: fallback=true");
  assert(noPath.fallback_reason === "no_path", "unreachable: reason=no_path");
  assert(noPath.steps.length === 0, "unreachable: ZERO steps (no fabricated 'Head to X' step)");
  assert(noPath.total_distance_meters === 0, "unreachable: ZERO distance (no fabricated 100 m)");
  assert(noPath.estimated_minutes === 0, "unreachable: ZERO minutes (no fabricated travel time)");
  assert(noPath.unroutable_destinations.join(",") === "orphan", "unreachable: names the destination");
  assert(noPath.route_id === null, "unreachable: never persisted");

  const notInGraph = await buildRouteNoSession(MALL, ["lacoste"], withGraph);
  assert(notInGraph.fallback && notInGraph.fallback_reason === "destination_not_in_graph" && notInGraph.steps.length === 0,
    "shop with no graph node: destination_not_in_graph, zero steps");

  const noGraph = await buildRouteNoSession(MALL, ["clicks"], { loadGraph: async () => ({ nodes: [], edges: [] }) });
  assert(noGraph.fallback && noGraph.fallback_reason === "no_graph" && noGraph.total_distance_meters === 0,
    "empty graph: no_graph, zero distance");

  const partial = await buildRouteNoSession(MALL, ["clicks", "orphan"], withGraph);
  assert(partial.fallback && partial.steps.length === 0, "multi-stop with an unreachable leg returns no steps at all");

  console.log(`\nrouting harness: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
