/**
 * routeEdgeHarness.ts — Sprint 13.1
 *
 * Manual test harness for routeEdgeService pure functions:
 *   generateSameFloorEdges, dijkstra
 *
 * Run with:
 *   npx ts-node --transpile-only src/services/mallIntelligence/__tests__/routeEdgeHarness.ts
 *
 * No DB access, no HTTP calls.
 */

export {};

// eslint-disable-next-line @typescript-eslint/no-require-imports
const {
  generateSameFloorEdges,
  dijkstra,
} = require("../routeEdgeService") as typeof import("../routeEdgeService");

// ── Helpers ───────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(cond: boolean, label: string): void {
  if (cond) { console.log(`  ✓ ${label}`); passed++; }
  else       { console.error(`  ✗ ${label}`); failed++; }
}

function assertEqual<T>(actual: T, expected: T, label: string): void {
  assert(
    actual === expected,
    `${label} (got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)})`,
  );
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

/** Three nodes on the same floor. */
function sameFloorThree() {
  return [
    { id: "n1", label: "Shop A",   floor_label: "Ground Floor", x_percent: 10, y_percent: 10, node_type: "store" },
    { id: "n2", label: "Shop B",   floor_label: "Ground Floor", x_percent: 50, y_percent: 10, node_type: "store" },
    { id: "n3", label: "Food Court", floor_label: "Ground Floor", x_percent: 50, y_percent: 50, node_type: "store" },
  ];
}

/** Two nodes on Ground Floor, two on Level 1 — no floor-change nodes. */
function twoFloorNoConnector() {
  return [
    { id: "g1", label: "GF Shop 1", floor_label: "Ground Floor", x_percent: 20, y_percent: 20, node_type: "store" },
    { id: "g2", label: "GF Shop 2", floor_label: "Ground Floor", x_percent: 60, y_percent: 20, node_type: "store" },
    { id: "u1", label: "L1 Shop 1", floor_label: "Level 1",      x_percent: 20, y_percent: 70, node_type: "store" },
    { id: "u2", label: "L1 Shop 2", floor_label: "Level 1",      x_percent: 60, y_percent: 70, node_type: "store" },
  ];
}

/** Four nodes: two floors + one lift (floor-change node). */
function twoFloorWithLift() {
  return [
    { id: "g1", label: "GF Shop",  floor_label: "Ground Floor", x_percent: 20, y_percent: 20, node_type: "store" },
    { id: "g_lift", label: "Lift (GF)", floor_label: "Ground Floor", x_percent: 50, y_percent: 50, node_type: "lift" },
    { id: "u1", label: "L1 Shop",  floor_label: "Level 1",      x_percent: 20, y_percent: 20, node_type: "store" },
    { id: "u_lift", label: "Lift (L1)", floor_label: "Level 1",  x_percent: 50, y_percent: 50, node_type: "lift" },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// TC44 — same-floor nodes produce pairwise edges
// ─────────────────────────────────────────────────────────────────────────────
console.log("\nTC44 — same-floor nodes create pairwise edges");
{
  const { edges, warnings } = generateSameFloorEdges(sameFloorThree());
  // 3 nodes → C(3,2) = 3 edges
  assertEqual(edges.length, 3, "3 nodes on one floor → 3 edges");
  assert(warnings.length === 0, "no warnings for clean same-floor nodes");
  assert(
    edges.every((e) => e.edge_type === "walkway"),
    "all edges are walkway type",
  );
  assert(
    edges.every((e) => e.weight_seconds >= 5),
    "all weights >= MIN_EDGE_WEIGHT_SECONDS (5)",
  );
  assert(
    edges.every((e) => e.floor_change === false),
    "same-floor edges have floor_change=false",
  );
  // Dedup keys are canonical (sorted id order)
  const keys = edges.map((e) => e.dedup_key);
  assert(
    keys.every((k) => k.includes(":")),
    "all dedup_keys contain ':' separator",
  );
  // n1 < n2 < n3 lexicographically — verify one key
  const n1n2 = edges.find((e) => e.dedup_key === "n1:n2");
  assert(n1n2 !== undefined, "dedup_key 'n1:n2' exists");
}

// ─────────────────────────────────────────────────────────────────────────────
// TC45 — cross-floor without floor-change nodes → warning, no cross-floor edge
// ─────────────────────────────────────────────────────────────────────────────
console.log("\nTC45 — cross-floor without floor-change nodes emits warning");
{
  const { edges, warnings } = generateSameFloorEdges(twoFloorNoConnector());
  // 2 nodes per floor → 1 edge per floor = 2 edges total
  assertEqual(edges.length, 2, "2-floor × 2-nodes-each → 2 same-floor edges");
  assert(warnings.length > 0, "at least one warning emitted");
  assert(
    warnings.some(
      (w) => w.toLowerCase().includes("lift") || w.toLowerCase().includes("escalator"),
    ),
    "warning mentions lift/escalator",
  );
  // Confirm no cross-floor edges exist
  const groundIds = new Set(["g1", "g2"]);
  const level1Ids = new Set(["u1", "u2"]);
  const hasCrossFloor = edges.some(
    (e) =>
      (groundIds.has(e.from_node_id) && level1Ids.has(e.to_node_id)) ||
      (level1Ids.has(e.from_node_id) && groundIds.has(e.to_node_id)),
  );
  assert(!hasCrossFloor, "no cross-floor edges created without lift node");
}

// ─────────────────────────────────────────────────────────────────────────────
// TC46 — dedup_key is canonical regardless of node registration order
// ─────────────────────────────────────────────────────────────────────────────
console.log("\nTC46 — dedup_key canonical ordering");
{
  // Swap the order of nodes and confirm dedup_keys are identical
  const forwardNodes = [
    { id: "aaa", label: "A", floor_label: "G", x_percent: 0,  y_percent: 0, node_type: "store" },
    { id: "bbb", label: "B", floor_label: "G", x_percent: 10, y_percent: 0, node_type: "store" },
  ];
  const reverseNodes = [
    { id: "bbb", label: "B", floor_label: "G", x_percent: 10, y_percent: 0, node_type: "store" },
    { id: "aaa", label: "A", floor_label: "G", x_percent: 0,  y_percent: 0, node_type: "store" },
  ];

  const { edges: fwd } = generateSameFloorEdges(forwardNodes);
  const { edges: rev } = generateSameFloorEdges(reverseNodes);

  assertEqual(fwd.length, 1, "forward order → 1 edge");
  assertEqual(rev.length, 1, "reverse order → 1 edge");
  assertEqual(fwd[0].dedup_key, "aaa:bbb", "forward dedup_key is 'aaa:bbb'");
  assertEqual(rev[0].dedup_key, "aaa:bbb", "reverse dedup_key is also 'aaa:bbb'");
  assertEqual(fwd[0].weight_seconds, rev[0].weight_seconds, "same weight regardless of order");

  // lift/escalator/stairs presence suppresses the multi-floor warning
  const { warnings: warnWithLift } = generateSameFloorEdges(twoFloorWithLift());
  assert(
    !warnWithLift.some((w) =>
      w.includes("Cross-floor routing requires"),
    ),
    "no cross-floor warning when lift node present",
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TC47 — Dijkstra returns ordered path when route exists
// ─────────────────────────────────────────────────────────────────────────────
console.log("\nTC47 — Dijkstra returns ordered path");
{
  const nodes = sameFloorThree();
  const { edges } = generateSameFloorEdges(nodes);

  const result = dijkstra(nodes, edges, "n1", "n3");
  assert(result.path !== null, "path found between n1 and n3");
  assert(result.warning === undefined || result.warning === "", "no warning when path found");
  assert(result.total_seconds > 0, "total_seconds > 0 for non-trivial path");

  // Path must start at n1 and end at n3
  const path = result.path!;
  assertEqual(path[0].node_id, "n1", "path starts at n1");
  assertEqual(path[path.length - 1].node_id, "n3", "path ends at n3");

  // Cumulative seconds must be monotonically non-decreasing
  const isMono = path.every(
    (step, i) => i === 0 || step.cumulative_seconds >= path[i - 1].cumulative_seconds,
  );
  assert(isMono, "cumulative_seconds is monotonically non-decreasing");

  // Total seconds matches final step's cumulative_seconds
  assertEqual(
    result.total_seconds,
    path[path.length - 1].cumulative_seconds,
    "total_seconds equals final step cumulative_seconds",
  );

  // Same-node path (trivial)
  const trivial = dijkstra(nodes, edges, "n1", "n1");
  assert(trivial.path !== null, "trivial path (same node) found");
  assertEqual(trivial.path!.length, 1, "trivial path has exactly 1 step");
  assertEqual(trivial.total_seconds, 0, "trivial path has 0 total_seconds");
}

// ─────────────────────────────────────────────────────────────────────────────
// TC48 — Dijkstra returns warning when no path exists
// ─────────────────────────────────────────────────────────────────────────────
console.log("\nTC48 — Dijkstra returns warning for unreachable route");
{
  // Nodes on separate floors, no edges between them
  const isolatedNodes = twoFloorNoConnector();
  const { edges } = generateSameFloorEdges(isolatedNodes);
  // g1 ↔ g2 and u1 ↔ u2 exist but no inter-floor edge

  const result = dijkstra(isolatedNodes, edges, "g1", "u1");
  assert(result.path === null, "no path between floors without lift");
  assert(result.total_seconds === 0, "total_seconds=0 when no path");
  assert(
    typeof result.warning === "string" && result.warning.length > 0,
    "warning string returned",
  );
  assert(
    result.warning!.toLowerCase().includes("cross-floor") ||
    result.warning!.toLowerCase().includes("lift")        ||
    result.warning!.toLowerCase().includes("no path"),
    "warning explains cross-floor routing requirement",
  );

  // Missing start node
  const missingFrom = dijkstra(isolatedNodes, edges, "x999", "g1");
  assert(missingFrom.path === null, "null path when start node missing");
  assert(
    typeof missingFrom.warning === "string" && missingFrom.warning.length > 0,
    "warning returned for missing start node",
  );

  // Missing end node
  const missingTo = dijkstra(isolatedNodes, edges, "g1", "x999");
  assert(missingTo.path === null, "null path when end node missing");
  assert(
    typeof missingTo.warning === "string" && missingTo.warning.length > 0,
    "warning returned for missing end node",
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Summary
// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(60)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) { console.error(`\n✗ ${failed} test(s) FAILED`); process.exit(1); }
else            { console.log(`\n✓ All ${passed} tests passed`); }
