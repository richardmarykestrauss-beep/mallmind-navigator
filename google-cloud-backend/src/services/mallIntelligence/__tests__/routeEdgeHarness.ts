/**
 * routeEdgeHarness.ts — Sprint 13.1 / 13.2
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
  generateVerticalEdges,
  validateFloorChangeNode,
  dijkstra,
  VERTICAL_EDGE_WEIGHTS,
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

// ═════════════════════════════════════════════════════════════════════════════
// Sprint 13.2 — Floor Change Nodes
// ═════════════════════════════════════════════════════════════════════════════

/** Two-floor setup: one shop per floor + one lift node per floor (same label). */
function crossFloorWithLift() {
  return [
    // Ground Floor
    { id: "gf_shop",  label: "Adidas",        floor_label: "Ground Floor",  x_percent: 44, y_percent: 35, node_type: "store" },
    { id: "gf_lift",  label: "Central Lift",  floor_label: "Ground Floor",  x_percent: 50, y_percent: 50, node_type: "lift"  },
    // Lower Ground
    { id: "lg_shop",  label: "ABSA Bank",     floor_label: "Lower Ground",  x_percent: 64, y_percent: 60, node_type: "store" },
    { id: "lg_lift",  label: "Central Lift",  floor_label: "Lower Ground",  x_percent: 50, y_percent: 50, node_type: "lift"  },
  ];
}

/** Three-floor setup: shops on all three + one escalator per floor. */
function threeFloorEscalator() {
  return [
    { id: "ug_shop",   label: "Baobab",        floor_label: "Upper Level",   x_percent: 73, y_percent: 39, node_type: "store"     },
    { id: "ug_esc",    label: "Main Escalator", floor_label: "Upper Level",   x_percent: 55, y_percent: 55, node_type: "escalator" },
    { id: "gf_shop2",  label: "Apple iStore",   floor_label: "Ground Floor",  x_percent: 55, y_percent: 59, node_type: "store"     },
    { id: "gf_esc",    label: "Main Escalator", floor_label: "Ground Floor",  x_percent: 55, y_percent: 55, node_type: "escalator" },
    { id: "lg_shop2",  label: "ABSA Bank",      floor_label: "Lower Ground",  x_percent: 64, y_percent: 60, node_type: "store"     },
    { id: "lg_esc",    label: "Main Escalator", floor_label: "Lower Ground",  x_percent: 55, y_percent: 55, node_type: "escalator" },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// TC49 — floor-change nodes create vertical edges
// ─────────────────────────────────────────────────────────────────────────────
console.log("\nTC49 — floor-change nodes create vertical edges");
{
  const { edges, warnings } = generateVerticalEdges(crossFloorWithLift());
  // 2 lift nodes with same label on different floors → 1 vertical edge
  assertEqual(edges.length, 1, "1 vertical edge for same-label lift pair");
  assert(warnings.length === 0, "no warnings");
  assert(edges[0].floor_change === true, "floor_change=true on vertical edge");
  assert(edges[0].edge_type === "lift", "edge_type matches node_type 'lift'");
  assertEqual(
    edges[0].weight_seconds,
    VERTICAL_EDGE_WEIGHTS.lift,
    `lift weight = ${VERTICAL_EDGE_WEIGHTS.lift}s`,
  );
  // Dedup key is canonical
  const ids = [edges[0].from_node_id, edges[0].to_node_id].sort();
  assertEqual(edges[0].dedup_key, `${ids[0]}:${ids[1]}`, "dedup_key is canonical sorted pair");

  // Three floors: escalator → C(3,2) = 3 vertical edges
  const { edges: e3 } = generateVerticalEdges(threeFloorEscalator());
  assertEqual(e3.length, 3, "3-floor escalator → 3 vertical edges (pairwise)");
  assert(e3.every((e) => e.edge_type === "escalator"), "all edges are escalator type");
  assert(e3.every((e) => e.weight_seconds === VERTICAL_EDGE_WEIGHTS.escalator), "all escalator weights correct");

  // No floor-change nodes → no vertical edges, no warnings
  const noFc = generateVerticalEdges(sameFloorThree());
  assertEqual(noFc.edges.length, 0, "no vertical edges when no floor-change nodes");
  assertEqual(noFc.warnings.length, 0, "no warnings when no floor-change nodes");

  // Two lift nodes with DIFFERENT labels → no vertical edge (not the same connector)
  const diffLabel = [
    { id: "l1", label: "North Lift", floor_label: "Ground Floor",  x_percent: 20, y_percent: 20, node_type: "lift" },
    { id: "l2", label: "South Lift", floor_label: "Lower Ground",  x_percent: 80, y_percent: 80, node_type: "lift" },
  ];
  const { edges: diffE } = generateVerticalEdges(diffLabel);
  assertEqual(diffE.length, 0, "different labels → no vertical edge (not same connector)");
}

// ─────────────────────────────────────────────────────────────────────────────
// TC50 — cross-floor route works through lift connector
// ─────────────────────────────────────────────────────────────────────────────
console.log("\nTC50 — cross-floor route works through lift connector");
{
  const nodes = crossFloorWithLift();
  const { edges: sfEdges } = generateSameFloorEdges(nodes);
  const { edges: vtEdges } = generateVerticalEdges(nodes);
  const allEdges = [...sfEdges, ...vtEdges];

  // Should have: gf_shop↔gf_lift, lg_shop↔lg_lift (walkway) + gf_lift↔lg_lift (vertical)
  assert(allEdges.length >= 3, "at least 3 edges (2 walkway + 1 vertical)");

  // Route from ground floor shop → lower ground shop
  const result = dijkstra(nodes, allEdges, "gf_shop", "lg_shop");
  assert(result.path !== null, "cross-floor path found through lift");
  assert(result.total_seconds > 0, "total_seconds > 0 for cross-floor route");

  const path = result.path!;
  assertEqual(path[0].node_id,            "gf_shop", "path starts at gf_shop");
  assertEqual(path[path.length - 1].node_id, "lg_shop", "path ends at lg_shop");

  // Path must pass through both lift nodes
  const pathIds = path.map((s) => s.node_id);
  assert(pathIds.includes("gf_lift"), "path passes through gf_lift");
  assert(pathIds.includes("lg_lift"), "path passes through lg_lift");

  // Cumulative seconds is monotonically non-decreasing
  const isMono = path.every(
    (s, i) => i === 0 || s.cumulative_seconds >= path[i - 1].cumulative_seconds,
  );
  assert(isMono, "cumulative_seconds is monotonically non-decreasing");

  // Three-floor end-to-end: Upper Level → Lower Ground via escalator
  const n3 = threeFloorEscalator();
  const { edges: sf3 } = generateSameFloorEdges(n3);
  const { edges: vt3 } = generateVerticalEdges(n3);
  const r3 = dijkstra(n3, [...sf3, ...vt3], "ug_shop", "lg_shop2");
  assert(r3.path !== null, "3-floor route: Upper Level → Lower Ground path found");
  assert(r3.total_seconds > 0, "3-floor route has positive total_seconds");
}

// ─────────────────────────────────────────────────────────────────────────────
// TC51 — duplicate vertical edges share the same dedup_key
// ─────────────────────────────────────────────────────────────────────────────
console.log("\nTC51 — duplicate vertical edges share dedup_key");
{
  // Calling generateVerticalEdges twice with the same nodes must yield
  // identical dedup_keys — simulating the backend dedup check.
  const { edges: first  } = generateVerticalEdges(crossFloorWithLift());
  const { edges: second } = generateVerticalEdges(crossFloorWithLift());

  assert(first.length === 1 && second.length === 1, "both calls produce 1 edge");
  assertEqual(first[0].dedup_key, second[0].dedup_key, "identical dedup_key on both calls");

  // Simulate the backend set-based dedup: existing keys block re-insert
  const existingKeys = new Set([first[0].dedup_key]);
  const toInsert = second.filter((e) => !existingKeys.has(e.dedup_key));
  assertEqual(toInsert.length, 0, "all candidates filtered out when dedup_key already stored");

  // Same-floor lift pair (same floor) should NOT produce a vertical edge
  const sameFloorLifts = [
    { id: "la", label: "Lift", floor_label: "Ground Floor", x_percent: 10, y_percent: 10, node_type: "lift" },
    { id: "lb", label: "Lift", floor_label: "Ground Floor", x_percent: 20, y_percent: 20, node_type: "lift" },
  ];
  const { edges: sfl } = generateVerticalEdges(sameFloorLifts);
  assertEqual(sfl.length, 0, "same-floor lift pair produces 0 vertical edges");
}

// ─────────────────────────────────────────────────────────────────────────────
// TC52 — missing connector still returns warning for cross-floor route
// ─────────────────────────────────────────────────────────────────────────────
console.log("\nTC52 — missing connector returns warning for cross-floor route");
{
  // Two floors, no lift nodes — same setup as TC45
  const nodes = twoFloorNoConnector();
  const { edges: sfEdges } = generateSameFloorEdges(nodes);
  const { edges: vtEdges } = generateVerticalEdges(nodes);
  const allEdges = [...sfEdges, ...vtEdges];

  // Vertical edges should be 0 (no floor-change nodes)
  assertEqual(vtEdges.length, 0, "0 vertical edges without floor-change nodes");

  // Dijkstra should fail with a cross-floor warning
  const result = dijkstra(nodes, allEdges, "g1", "u1");
  assert(result.path === null, "no path without floor-change connector");
  assert(
    typeof result.warning === "string" && result.warning.length > 0,
    "warning returned when no connector",
  );
  assert(
    result.warning!.toLowerCase().includes("cross-floor") ||
    result.warning!.toLowerCase().includes("lift"),
    "warning explains cross-floor requirement",
  );

  // Adding a lift on only ONE floor does not enable cross-floor routing
  const halfConnector = [
    ...nodes,
    { id: "lone_lift", label: "Lone Lift", floor_label: "Ground Floor", x_percent: 50, y_percent: 50, node_type: "lift" },
  ];
  const { edges: vt2 } = generateVerticalEdges(halfConnector);
  assertEqual(vt2.length, 0, "single lift node on one floor → 0 vertical edges");
  const result2 = dijkstra(halfConnector, [
    ...generateSameFloorEdges(halfConnector).edges,
    ...vt2,
  ], "g1", "u1");
  assert(result2.path === null, "still no cross-floor path with lone lift node");
}

// ─────────────────────────────────────────────────────────────────────────────
// TC53 — validateFloorChangeNode rejects invalid input
// ─────────────────────────────────────────────────────────────────────────────
console.log("\nTC53 — validateFloorChangeNode rejects invalid input");
{
  /** Valid base input. */
  function validInput() {
    return {
      mall_id:     "mall-uuid-123",
      label:       "Central Lift",
      node_type:   "lift",
      floor_label: "Ground Floor",
      x_percent:   50,
      y_percent:   50,
    } as const;
  }

  // Happy path
  const ok = validateFloorChangeNode(validInput());
  assert(ok.valid === true, "valid input → valid=true");
  assert(ok.error === undefined, "valid input → no error message");

  // Missing mall_id
  const noMall = validateFloorChangeNode({ ...validInput(), mall_id: "" });
  assert(noMall.valid === false, "empty mall_id → invalid");
  assert(noMall.error!.toLowerCase().includes("mall_id"), "error mentions mall_id");

  // Missing label
  const noLabel = validateFloorChangeNode({ ...validInput(), label: "   " });
  assert(noLabel.valid === false, "blank label → invalid");

  // Invalid node_type
  const badType = validateFloorChangeNode({ ...validInput(), node_type: "elevator" });
  assert(badType.valid === false, "'elevator' → invalid node_type");
  assert(badType.error!.toLowerCase().includes("node_type"), "error mentions node_type");

  // Missing floor_label
  const noFloor = validateFloorChangeNode({ ...validInput(), floor_label: "" });
  assert(noFloor.valid === false, "empty floor_label → invalid");

  // x_percent out of range
  const xLow = validateFloorChangeNode({ ...validInput(), x_percent: -1 });
  assert(xLow.valid === false, "x_percent=-1 → invalid");
  const xHigh = validateFloorChangeNode({ ...validInput(), x_percent: 101 });
  assert(xHigh.valid === false, "x_percent=101 → invalid");

  // y_percent out of range
  const yHigh = validateFloorChangeNode({ ...validInput(), y_percent: 100.1 });
  assert(yHigh.valid === false, "y_percent=100.1 → invalid");

  // Boundary: exactly 0 and 100 are valid
  const corner = validateFloorChangeNode({ ...validInput(), x_percent: 0, y_percent: 100 });
  assert(corner.valid === true, "x=0, y=100 → valid (boundaries included)");

  // Non-numeric coordinates
  const strCoord = validateFloorChangeNode({ ...validInput(), x_percent: "50" as unknown as number });
  assert(strCoord.valid === false, "string x_percent → invalid");
}

// ─────────────────────────────────────────────────────────────────────────────
// Summary
// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(60)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) { console.error(`\n✗ ${failed} test(s) FAILED`); process.exit(1); }
else            { console.log(`\n✓ All ${passed} tests passed`); }
