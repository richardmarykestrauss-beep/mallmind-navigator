/**
 * routeNodeCoordinateHarness.ts — Sprint 12D.2
 *
 * Manual test harness for routeNodeCoordinateService.
 * Run with:
 *   npx ts-node --transpile-only src/services/mallIntelligence/__tests__/routeNodeCoordinateHarness.ts
 *
 * Tests pure functions only — no HTTP calls, no DB writes.
 */

export {};

// eslint-disable-next-line @typescript-eslint/no-require-imports
const {
  validateRouteNodeCoordinate,
  COORD_MIN,
  COORD_MAX,
} = require("../routeNodeCoordinateService") as
  typeof import("../routeNodeCoordinateService");

// ── Helpers ───────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string): void {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}`);
    failed++;
  }
}

function assertEqual<T>(actual: T, expected: T, label: string): void {
  assert(
    actual === expected,
    `${label} (got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)})`,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TC29 — Constants
// ─────────────────────────────────────────────────────────────────────────────

console.log("\nTC29 — Constants");
assertEqual(COORD_MIN, 0,   "COORD_MIN = 0");
assertEqual(COORD_MAX, 100, "COORD_MAX = 100");

// ─────────────────────────────────────────────────────────────────────────────
// TC30 — Valid input accepted
// ─────────────────────────────────────────────────────────────────────────────

console.log("\nTC30 — valid input accepted");
{
  const r = validateRouteNodeCoordinate("some-uuid-1234", 42.5, 67.3);
  assert(r.valid === true,          "valid=true for good input");
  assert(r.error === undefined,     "no error for good input");
}
{
  // Boundary values: exactly 0 and 100 are valid
  const r = validateRouteNodeCoordinate("abc", 0, 100);
  assert(r.valid === true,          "valid=true for (0, 100) boundary");
}
{
  // Both zero
  const r = validateRouteNodeCoordinate("abc", 0, 0);
  assert(r.valid === true,          "valid=true for (0, 0)");
}
{
  // Both 100
  const r = validateRouteNodeCoordinate("abc", 100, 100);
  assert(r.valid === true,          "valid=true for (100, 100)");
}

// ─────────────────────────────────────────────────────────────────────────────
// TC31 — Missing / empty route_node_id rejected
// ─────────────────────────────────────────────────────────────────────────────

console.log("\nTC31 — missing route_node_id rejected");
{
  const r = validateRouteNodeCoordinate(undefined, 50, 50);
  assert(r.valid === false,                       "valid=false for undefined id");
  assert(typeof r.error === "string" && r.error.length > 0, "error message present");
}
{
  const r = validateRouteNodeCoordinate("", 50, 50);
  assert(r.valid === false, "valid=false for empty string id");
}
{
  const r = validateRouteNodeCoordinate("   ", 50, 50);
  assert(r.valid === false, "valid=false for whitespace-only id");
}
{
  const r = validateRouteNodeCoordinate(null, 50, 50);
  assert(r.valid === false, "valid=false for null id");
}
{
  const r = validateRouteNodeCoordinate(123, 50, 50);
  assert(r.valid === false, "valid=false for numeric id");
}

// ─────────────────────────────────────────────────────────────────────────────
// TC32 — x_percent out of range rejected
// ─────────────────────────────────────────────────────────────────────────────

console.log("\nTC32 — x_percent out of range rejected");
{
  const r = validateRouteNodeCoordinate("abc", 101, 50);
  assert(r.valid === false,         "valid=false for x=101");
  assert(r.error?.includes("x_percent") ?? false, "error mentions x_percent");
}
{
  const r = validateRouteNodeCoordinate("abc", -0.01, 50);
  assert(r.valid === false,         "valid=false for x=-0.01");
  assert(r.error?.includes("x_percent") ?? false, "error mentions x_percent");
}
{
  const r = validateRouteNodeCoordinate("abc", 1000, 50);
  assert(r.valid === false,         "valid=false for x=1000");
}

// ─────────────────────────────────────────────────────────────────────────────
// TC33 — y_percent out of range rejected
// ─────────────────────────────────────────────────────────────────────────────

console.log("\nTC33 — y_percent out of range rejected");
{
  const r = validateRouteNodeCoordinate("abc", 50, 100.01);
  assert(r.valid === false,         "valid=false for y=100.01");
  assert(r.error?.includes("y_percent") ?? false, "error mentions y_percent");
}
{
  const r = validateRouteNodeCoordinate("abc", 50, -1);
  assert(r.valid === false,         "valid=false for y=-1");
  assert(r.error?.includes("y_percent") ?? false, "error mentions y_percent");
}

// ─────────────────────────────────────────────────────────────────────────────
// TC34 — Non-numeric coordinates rejected
// ─────────────────────────────────────────────────────────────────────────────

console.log("\nTC34 — non-numeric coordinates rejected");
{
  const r = validateRouteNodeCoordinate("abc", "50" as unknown as number, 50);
  assert(r.valid === false,         "valid=false for x=string");
  assert(r.error?.includes("x_percent") ?? false, "error mentions x_percent");
}
{
  const r = validateRouteNodeCoordinate("abc", 50, "50" as unknown as number);
  assert(r.valid === false,         "valid=false for y=string");
  assert(r.error?.includes("y_percent") ?? false, "error mentions y_percent");
}
{
  const r = validateRouteNodeCoordinate("abc", NaN, 50);
  assert(r.valid === false,         "valid=false for x=NaN");
}
{
  const r = validateRouteNodeCoordinate("abc", 50, NaN);
  assert(r.valid === false,         "valid=false for y=NaN");
}
{
  const r = validateRouteNodeCoordinate("abc", Infinity, 50);
  assert(r.valid === false,         "valid=false for x=Infinity");
}
{
  const r = validateRouteNodeCoordinate("abc", null as unknown as number, 50);
  assert(r.valid === false,         "valid=false for x=null");
}

// ─────────────────────────────────────────────────────────────────────────────
// Summary
// ─────────────────────────────────────────────────────────────────────────────

console.log(`\n${"─".repeat(60)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);

if (failed > 0) {
  console.error(`\n✗ ${failed} test(s) FAILED`);
  process.exit(1);
} else {
  console.log(`\n✓ All ${passed} tests passed`);
}
