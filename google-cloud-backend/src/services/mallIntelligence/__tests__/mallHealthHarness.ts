/**
 * mallHealthHarness.ts — Sprint 12D.3
 *
 * Manual test harness for mallHealthService.deriveReadiness (pure function).
 * Run with:
 *   npx ts-node --transpile-only src/services/mallIntelligence/__tests__/mallHealthHarness.ts
 *
 * No DB access, no HTTP calls.
 */

export {};

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { deriveReadiness } = require("../mallHealthService") as
  typeof import("../mallHealthService");

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

/** Minimal valid "ready" base so tests can override individual fields. */
function base() {
  return {
    mall_id:                        "mall-1",
    total_staged_stores:            10,
    stores_by_status:               { accepted: 5, pending: 5 },
    stores_with_floor_label:        10,
    stores_missing_floor_label:     0,
    stores_with_coordinates:        5,
    accepted_stores:                5,
    accepted_stores_missing_coords: 0,
    route_nodes_staged:             5,
    route_nodes_with_coordinates:   5,
    map_assets_total:               2,
    map_assets_image:               1,
    map_assets_image_missing_dims:  0,
    duplicate_asset_url_groups:     0,
    sources_linked:                 1,
    sources_missing_mall_id:        0,
    warnings:                       [] as string[],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// TC35 — blocked: no staged stores
// ─────────────────────────────────────────────────────────────────────────────
console.log("\nTC35 — blocked: no staged stores");
{
  const r = deriveReadiness({ ...base(), total_staged_stores: 0, accepted_stores: 0,
    stores_with_floor_label: 0, stores_missing_floor_label: 0,
    stores_with_coordinates: 0, accepted_stores_missing_coords: 0,
    route_nodes_staged: 0, route_nodes_with_coordinates: 0,
    stores_by_status: {} });
  assertEqual(r.readiness_status, "blocked", "status=blocked when 0 stores");
  assert(r.next_recommended_action.length > 0, "action message is non-empty");
  assert(r.next_recommended_action.toLowerCase().includes("import") ||
         r.next_recommended_action.toLowerCase().includes("extract"),
         "action hints at import/extract");
}

// ─────────────────────────────────────────────────────────────────────────────
// TC36 — blocked: stores staged but none accepted
// ─────────────────────────────────────────────────────────────────────────────
console.log("\nTC36 — blocked: stores staged but none accepted");
{
  const r = deriveReadiness({ ...base(), accepted_stores: 0,
    stores_by_status: { pending: 10 },
    accepted_stores_missing_coords: 0,
    route_nodes_staged: 0, route_nodes_with_coordinates: 0 });
  assertEqual(r.readiness_status, "blocked", "status=blocked when 0 accepted");
  assert(r.next_recommended_action.toLowerCase().includes("accept"),
         "action mentions 'accept'");
}

// ─────────────────────────────────────────────────────────────────────────────
// TC37 — blocked: accepted stores exist but no route nodes staged
// ─────────────────────────────────────────────────────────────────────────────
console.log("\nTC37 — blocked: no route nodes staged");
{
  const r = deriveReadiness({ ...base(),
    route_nodes_staged: 0, route_nodes_with_coordinates: 0,
    accepted_stores_missing_coords: 0 });
  assertEqual(r.readiness_status, "blocked", "status=blocked when 0 route nodes");
  assert(r.next_recommended_action.toLowerCase().includes("stage") ||
         r.next_recommended_action.toLowerCase().includes("node"),
         "action mentions staging nodes");
}

// ─────────────────────────────────────────────────────────────────────────────
// TC38 — partial: accepted stores missing coordinates
// ─────────────────────────────────────────────────────────────────────────────
console.log("\nTC38 — partial: accepted stores missing coordinates");
{
  const r = deriveReadiness({ ...base(), accepted_stores_missing_coords: 3 });
  assertEqual(r.readiness_status, "partial", "status=partial when accepted stores lack coords");
  assert(r.next_recommended_action.toLowerCase().includes("coordinat") ||
         r.next_recommended_action.toLowerCase().includes("pin"),
         "action mentions coordinates/pin");
}

// ─────────────────────────────────────────────────────────────────────────────
// TC39 — partial: some route nodes still unplaced
// ─────────────────────────────────────────────────────────────────────────────
console.log("\nTC39 — partial: some route nodes unplaced");
{
  const r = deriveReadiness({ ...base(),
    route_nodes_staged: 5, route_nodes_with_coordinates: 3,
    accepted_stores_missing_coords: 0 });
  assertEqual(r.readiness_status, "partial", "status=partial when not all nodes placed");
  assert(r.next_recommended_action.includes("3/5") ||
         r.next_recommended_action.toLowerCase().includes("node"),
         "action shows placed/total or mentions nodes");
}

// ─────────────────────────────────────────────────────────────────────────────
// TC40 — partial: image assets missing dimensions
// ─────────────────────────────────────────────────────────────────────────────
console.log("\nTC40 — partial: image assets missing dimensions");
{
  const r = deriveReadiness({ ...base(),
    accepted_stores_missing_coords: 0,
    map_assets_image_missing_dims: 2 });
  assertEqual(r.readiness_status, "partial", "status=partial when image dims missing");
  assert(r.next_recommended_action.toLowerCase().includes("scan") ||
         r.next_recommended_action.toLowerCase().includes("dimension"),
         "action mentions scan or dimension");
}

// ─────────────────────────────────────────────────────────────────────────────
// TC41 — partial: >30% stores missing floor labels
// ─────────────────────────────────────────────────────────────────────────────
console.log("\nTC41 — partial: >30% stores missing floor labels");
{
  // 4 of 10 stores missing floor labels = 40%
  const r = deriveReadiness({ ...base(),
    stores_missing_floor_label: 4,
    stores_with_floor_label:    6,
    accepted_stores_missing_coords: 0,
    map_assets_image_missing_dims:  0 });
  assertEqual(r.readiness_status, "partial", "status=partial when >30% missing floor");
  assert(r.next_recommended_action.toLowerCase().includes("floor"),
         "action mentions floor");
}

// ─────────────────────────────────────────────────────────────────────────────
// TC42 — ready: all critical fields populated
// ─────────────────────────────────────────────────────────────────────────────
console.log("\nTC42 — ready: all good");
{
  const r = deriveReadiness(base());
  assertEqual(r.readiness_status, "ready", "status=ready when everything is in order");
  assert(r.next_recommended_action.toLowerCase().includes("sprint 13") ||
         r.next_recommended_action.toLowerCase().includes("complete") ||
         r.next_recommended_action.toLowerCase().includes("proceed"),
         "action encourages next step");
}

// ─────────────────────────────────────────────────────────────────────────────
// TC43 — partial floor threshold boundary: exactly 30% is NOT blocked
// ─────────────────────────────────────────────────────────────────────────────
console.log("\nTC43 — floor-label threshold boundary (30% missing → not partial yet)");
{
  // exactly 30% missing — threshold is >30%, so this should be ready
  const r = deriveReadiness({ ...base(),
    total_staged_stores:         10,
    stores_missing_floor_label:  3,
    stores_with_floor_label:     7,
    accepted_stores_missing_coords: 0,
    map_assets_image_missing_dims: 0 });
  assertEqual(r.readiness_status, "ready", "exactly 30% missing is still ready (threshold is >30%)");
}

// ─────────────────────────────────────────────────────────────────────────────
// Summary
// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(60)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) { console.error(`\n✗ ${failed} test(s) FAILED`); process.exit(1); }
else            { console.log(`\n✓ All ${passed} tests passed`); }
