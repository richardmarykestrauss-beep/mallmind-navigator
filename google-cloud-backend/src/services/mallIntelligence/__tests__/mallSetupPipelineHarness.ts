/**
 * mallSetupPipelineHarness.ts — Sprint 13.3
 *
 * Manual test harness for mallSetupPipelineService pure functions:
 *   validatePipelineInput, normalizeMallFloorLabel
 *
 * Run with:
 *   npx ts-node --transpile-only src/services/mallIntelligence/__tests__/mallSetupPipelineHarness.ts
 *
 * No DB access, no HTTP calls.
 */

export {};

// eslint-disable-next-line @typescript-eslint/no-require-imports
const {
  validatePipelineInput,
  normalizeMallFloorLabel,
} = require("../mallSetupPipelineService") as typeof import("../mallSetupPipelineService");

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

// ─────────────────────────────────────────────────────────────────────────────
// TC54 — validatePipelineInput rejects missing / empty mall_id
// ─────────────────────────────────────────────────────────────────────────────
console.log("\nTC54 — missing mall_id rejected");
{
  const VALID_SOURCE = "src-uuid-456";

  // Undefined mall_id
  const r1 = validatePipelineInput(undefined, VALID_SOURCE);
  assert(r1.valid === false, "undefined mall_id → invalid");
  assert(r1.error!.toLowerCase().includes("mall_id"), "error mentions mall_id");

  // Empty string
  const r2 = validatePipelineInput("", VALID_SOURCE);
  assert(r2.valid === false, "empty mall_id → invalid");

  // Whitespace-only
  const r3 = validatePipelineInput("   ", VALID_SOURCE);
  assert(r3.valid === false, "whitespace mall_id → invalid");

  // Null
  const r4 = validatePipelineInput(null, VALID_SOURCE);
  assert(r4.valid === false, "null mall_id → invalid");

  // Wrong type (number)
  const r5 = validatePipelineInput(42, VALID_SOURCE);
  assert(r5.valid === false, "numeric mall_id → invalid");
}

// ─────────────────────────────────────────────────────────────────────────────
// TC55 — validatePipelineInput rejects missing / empty source_id
// ─────────────────────────────────────────────────────────────────────────────
console.log("\nTC55 — missing source_id rejected");
{
  const VALID_MALL = "mall-uuid-123";

  const r1 = validatePipelineInput(VALID_MALL, undefined);
  assert(r1.valid === false, "undefined source_id → invalid");
  assert(r1.error!.toLowerCase().includes("source_id"), "error mentions source_id");

  const r2 = validatePipelineInput(VALID_MALL, "");
  assert(r2.valid === false, "empty source_id → invalid");

  const r3 = validatePipelineInput(VALID_MALL, "  \t ");
  assert(r3.valid === false, "whitespace source_id → invalid");

  const r4 = validatePipelineInput(VALID_MALL, null);
  assert(r4.valid === false, "null source_id → invalid");

  // Both invalid — should still return an error (first one found)
  const r5 = validatePipelineInput("", "");
  assert(r5.valid === false, "both empty → invalid");
  assert(typeof r5.error === "string" && r5.error.length > 0, "error message present when both invalid");
}

// ─────────────────────────────────────────────────────────────────────────────
// TC56 — normalizeMallFloorLabel maps known aliases to canonical names
// ─────────────────────────────────────────────────────────────────────────────
console.log("\nTC56 — normalizeMallFloorLabel: known aliases");
{
  // ── Lower Ground ──────────────────────────────────────────────────────────
  assertEqual(normalizeMallFloorLabel("lg"),              "Lower Ground", "'lg' → Lower Ground");
  assertEqual(normalizeMallFloorLabel("LG"),              "Lower Ground", "'LG' → Lower Ground (case-insensitive)");
  assertEqual(normalizeMallFloorLabel("lower ground"),    "Lower Ground", "'lower ground' → Lower Ground");
  assertEqual(normalizeMallFloorLabel("lower ground floor"), "Lower Ground", "'lower ground floor' → Lower Ground");
  assertEqual(normalizeMallFloorLabel("basement"),        "Lower Ground", "'basement' → Lower Ground");
  assertEqual(normalizeMallFloorLabel("B1"),              "Lower Ground", "'B1' → Lower Ground");

  // ── Ground Floor ──────────────────────────────────────────────────────────
  assertEqual(normalizeMallFloorLabel("gf"),              "Ground Floor", "'gf' → Ground Floor");
  assertEqual(normalizeMallFloorLabel("GF"),              "Ground Floor", "'GF' → Ground Floor");
  assertEqual(normalizeMallFloorLabel("ground"),          "Ground Floor", "'ground' → Ground Floor");
  assertEqual(normalizeMallFloorLabel("GROUND FLOOR"),    "Ground Floor", "'GROUND FLOOR' → Ground Floor");
  assertEqual(normalizeMallFloorLabel("Ground Floor"),    "Ground Floor", "'Ground Floor' → Ground Floor (already canonical)");
  assertEqual(normalizeMallFloorLabel("0"),               "Ground Floor", "'0' → Ground Floor");
  assertEqual(normalizeMallFloorLabel("level 0"),         "Ground Floor", "'level 0' → Ground Floor");

  // ── Upper Level ───────────────────────────────────────────────────────────
  assertEqual(normalizeMallFloorLabel("upper"),           "Upper Level",  "'upper' → Upper Level");
  assertEqual(normalizeMallFloorLabel("UPPER LEVEL"),     "Upper Level",  "'UPPER LEVEL' → Upper Level");
  assertEqual(normalizeMallFloorLabel("ul"),              "Upper Level",  "'ul' → Upper Level");
  assertEqual(normalizeMallFloorLabel("upper floor"),     "Upper Level",  "'upper floor' → Upper Level");
  assertEqual(normalizeMallFloorLabel("top floor"),       "Upper Level",  "'top floor' → Upper Level");

  // ── Numeric levels ────────────────────────────────────────────────────────
  assertEqual(normalizeMallFloorLabel("1"),               "Level 1",      "'1' → Level 1");
  assertEqual(normalizeMallFloorLabel("1st floor"),       "Level 1",      "'1st floor' → Level 1");
  assertEqual(normalizeMallFloorLabel("L1"),              "Level 1",      "'L1' → Level 1");
  assertEqual(normalizeMallFloorLabel("level 1"),         "Level 1",      "'level 1' → Level 1");
  assertEqual(normalizeMallFloorLabel("2nd floor"),       "Level 2",      "'2nd floor' → Level 2");
  assertEqual(normalizeMallFloorLabel("3"),               "Level 3",      "'3' → Level 3");
  assertEqual(normalizeMallFloorLabel("F4"),              "Level 4",      "'F4' → Level 4");
  assertEqual(normalizeMallFloorLabel("level 5"),         "Level 5",      "'level 5' → Level 5");
}

// ─────────────────────────────────────────────────────────────────────────────
// TC57 — validatePipelineInput passes for valid UUIDs
// ─────────────────────────────────────────────────────────────────────────────
console.log("\nTC57 — valid inputs pass validation");
{
  const ok = validatePipelineInput(
    "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "b2c3d4e5-f6a7-8901-bcde-f12345678901",
  );
  assert(ok.valid === true,      "valid UUIDs → valid=true");
  assert(ok.error === undefined, "valid UUIDs → no error");

  // Short but non-empty strings are also valid (format not checked)
  const short = validatePipelineInput("mall-1", "src-1");
  assert(short.valid === true, "short non-empty strings → valid");

  // Leading/trailing spaces are fine (we trim before checking)
  const padded = validatePipelineInput("  mall-id  ", "  src-id  ");
  assert(padded.valid === true, "padded strings → valid (trimmed internally)");
}

// ─────────────────────────────────────────────────────────────────────────────
// TC58 — normalizeMallFloorLabel handles edge cases and unknown values
// ─────────────────────────────────────────────────────────────────────────────
console.log("\nTC58 — normalizeMallFloorLabel: edge cases and unknown values");
{
  // Empty string → returned as-is
  assertEqual(normalizeMallFloorLabel(""), "", "empty string → empty string");

  // Already canonical values — must be idempotent
  assertEqual(normalizeMallFloorLabel("Lower Ground"), "Lower Ground", "idempotent: Lower Ground");
  assertEqual(normalizeMallFloorLabel("Ground Floor"), "Ground Floor", "idempotent: Ground Floor");
  assertEqual(normalizeMallFloorLabel("Upper Level"),  "Upper Level",  "idempotent: Upper Level");
  assertEqual(normalizeMallFloorLabel("Level 1"),      "Level 1",      "idempotent: Level 1");

  // Unknown values → title-cased passthrough (no data lost)
  assertEqual(normalizeMallFloorLabel("mezzanine"),    "Mezzanine",    "'mezzanine' title-cased");
  assertEqual(normalizeMallFloorLabel("FOOD COURT"),   "Food Court",   "'FOOD COURT' title-cased");
  assertEqual(normalizeMallFloorLabel("parking level"), "Parking Level", "'parking level' title-cased");

  // Leading/trailing whitespace stripped
  const trimCheck = normalizeMallFloorLabel("  Ground Floor  ");
  assertEqual(trimCheck, "Ground Floor", "trims whitespace before normalizing");

  // Mixed case unknown → title-case
  const mixed = normalizeMallFloorLabel("rooftop terrace");
  assertEqual(mixed, "Rooftop Terrace", "unknown 'rooftop terrace' → 'Rooftop Terrace'");

  // Sub-ground alias
  assertEqual(normalizeMallFloorLabel("sub ground"), "Lower Ground", "'sub ground' → Lower Ground");
}

// ─────────────────────────────────────────────────────────────────────────────
// Summary
// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(60)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) { console.error(`\n✗ ${failed} test(s) FAILED`); process.exit(1); }
else            { console.log(`\n✓ All ${passed} tests passed`); }
