/**
 * Finding Extractor — Manual Test Harness
 *
 * Hotfix 12B.1 — MallMind Navigator
 *
 * Run with:
 *   npx ts-node --skip-project src/services/dataBots/__tests__/findingExtractorHarness.ts
 *
 * No external API calls. No database reads. Pure deterministic output.
 * All test cases verify parsing improvements from Hotfix 12B.1.
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { runFindingExtractorBot } = require("../findingExtractorBot") as typeof import("../findingExtractorBot");

// ── ANSI colour helpers ───────────────────────────────────────────────────────

const GREEN  = "\x1b[32m";
const RED    = "\x1b[31m";
const YELLOW = "\x1b[33m";
const CYAN   = "\x1b[36m";
const DIM    = "\x1b[2m";
const RESET  = "\x1b[0m";

const pass  = (msg: string) => console.log(`  ${GREEN}✓${RESET} ${msg}`);
const fail  = (msg: string) => console.log(`  ${RED}✗${RESET} ${msg}`);
const info  = (msg: string) => console.log(`  ${DIM}${msg}${RESET}`);
const title = (msg: string) => console.log(`\n${CYAN}${msg}${RESET}`);

// ── Test runner ───────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function expect(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected) ||
             (typeof expected === "string" && typeof actual === "string" &&
              actual.toLowerCase() === expected.toLowerCase());
  if (ok) {
    passed++;
    pass(`${label}: ${JSON.stringify(actual)}`);
  } else {
    failed++;
    fail(`${label}\n    Expected: ${JSON.stringify(expected)}\n    Got:      ${JSON.stringify(actual)}`);
  }
}

function expectTruthy(label: string, actual: unknown): void {
  if (actual) {
    passed++;
    pass(`${label}: ${JSON.stringify(actual)}`);
  } else {
    failed++;
    fail(`${label} — expected truthy, got: ${JSON.stringify(actual)}`);
  }
}

function expectFalsy(label: string, actual: unknown): void {
  if (!actual) {
    passed++;
    pass(`${label}: (not present — correct)`);
  } else {
    failed++;
    fail(`${label} — expected absent/falsy, got: ${JSON.stringify(actual)}`);
  }
}

function getField(raw: string, fieldName: string): string | undefined {
  const result = runFindingExtractorBot({ raw_text: raw });
  const fields = result.extracted_findings[0]?.fields ?? [];
  return fields.find((f) => f.field === fieldName)?.value;
}

function getType(raw: string): string {
  const result = runFindingExtractorBot({ raw_text: raw });
  return result.extracted_findings[0]?.finding_type ?? "unknown";
}

// ─────────────────────────────────────────────────────────────────────────────
// Test Case 1 — Shop directory "listed as" pattern
// ─────────────────────────────────────────────────────────────────────────────

title("TC1: Game is listed as Shop G01 on Ground Floor. Category Electronics");
const tc1 = "Game is listed as Shop G01 on Ground Floor. Category Electronics";
const tc1Result = runFindingExtractorBot({ raw_text: tc1 });
const tc1Fields = tc1Result.extracted_findings[0]?.fields ?? [];

info(`finding_type: ${tc1Result.extracted_findings[0]?.finding_type}`);
info(`fields: ${JSON.stringify(tc1Fields.map((f) => ({ [f.field]: f.value })))}`);

const tc1ShopName = tc1Fields.find((f) => f.field === "shop_name")?.value;
const tc1Unit     = tc1Fields.find((f) => f.field === "unit_number")?.value;
const tc1Floor    = tc1Fields.find((f) => f.field === "floor")?.value;
const tc1Cat      = tc1Fields.find((f) => f.field === "category")?.value;

expect("shop_name",    tc1ShopName, "Game");
expect("unit_number",  tc1Unit,     "G01");
expect("floor",        tc1Floor,    "Ground Floor");
expect("category",     tc1Cat,      "Electronics");
expect("finding_type", tc1Result.extracted_findings[0]?.finding_type, "shop_listing");

// Ensure "Game is listed as" is NOT the shop name
if (tc1ShopName && tc1ShopName.toLowerCase().includes("is listed as")) {
  failed++;
  fail(`shop_name contains connector phrase: "${tc1ShopName}"`);
} else {
  passed++;
  pass("shop_name does NOT contain connector phrase");
}

// ─────────────────────────────────────────────────────────────────────────────
// Test Case 2 — Dash-separated mall directory line
// ─────────────────────────────────────────────────────────────────────────────

title("TC2: Clicks - Shop U12 - Upper Level - Health & Beauty");
const tc2 = "Clicks - Shop U12 - Upper Level - Health & Beauty";
const tc2Fields = runFindingExtractorBot({ raw_text: tc2 }).extracted_findings[0]?.fields ?? [];
info(`fields: ${JSON.stringify(tc2Fields.map((f) => ({ [f.field]: f.value })))}`);

expect("shop_name",   tc2Fields.find((f) => f.field === "shop_name")?.value,   "Clicks");
expect("unit_number", tc2Fields.find((f) => f.field === "unit_number")?.value, "U12");
expect("floor",       tc2Fields.find((f) => f.field === "floor")?.value,       "Upper Level");
expect("category",    tc2Fields.find((f) => f.field === "category")?.value,    "Health & Beauty");

// ─────────────────────────────────────────────────────────────────────────────
// Test Case 3 — Comma-separated mall directory line
// ─────────────────────────────────────────────────────────────────────────────

title("TC3: Woolworths, Ground Floor, Shop G15, Fashion");
const tc3 = "Woolworths, Ground Floor, Shop G15, Fashion";
const tc3Fields = runFindingExtractorBot({ raw_text: tc3 }).extracted_findings[0]?.fields ?? [];
info(`fields: ${JSON.stringify(tc3Fields.map((f) => ({ [f.field]: f.value })))}`);

expect("shop_name",   tc3Fields.find((f) => f.field === "shop_name")?.value,   "Woolworths");
expect("floor",       tc3Fields.find((f) => f.field === "floor")?.value,       "Ground Floor");
expect("unit_number", tc3Fields.find((f) => f.field === "unit_number")?.value, "G15");

// ─────────────────────────────────────────────────────────────────────────────
// Test Case 4 — Pipe-separated mall directory line
// ─────────────────────────────────────────────────────────────────────────────

title("TC4: Dis-Chem Pharmacy | Lower Level | L23 | Pharmacy");
const tc4 = "Dis-Chem Pharmacy | Lower Level | L23 | Pharmacy";
const tc4Fields = runFindingExtractorBot({ raw_text: tc4 }).extracted_findings[0]?.fields ?? [];
info(`fields: ${JSON.stringify(tc4Fields.map((f) => ({ [f.field]: f.value })))}`);

expect("shop_name",   tc4Fields.find((f) => f.field === "shop_name")?.value,   "Dis-Chem Pharmacy");
expect("floor",       tc4Fields.find((f) => f.field === "floor")?.value,       "Lower Level");
expect("unit_number", tc4Fields.find((f) => f.field === "unit_number")?.value, "L23");

// ─────────────────────────────────────────────────────────────────────────────
// Test Case 5 — Trading hours: time-first pattern
// ─────────────────────────────────────────────────────────────────────────────

title("TC5: 09:00–19:00 Saturday:");
const tc5 = "09:00–19:00 Saturday:";
const tc5Result = runFindingExtractorBot({ raw_text: tc5 });
const tc5Fields = tc5Result.extracted_findings[0]?.fields ?? [];
info(`finding_type: ${tc5Result.extracted_findings[0]?.finding_type}`);
info(`fields: ${JSON.stringify(tc5Fields.map((f) => ({ [f.field]: f.value })))}`);

expect("finding_type", tc5Result.extracted_findings[0]?.finding_type, "trading_hours");
expect("open_time",    tc5Fields.find((f) => f.field === "open_time")?.value,  "09:00");
expect("close_time",   tc5Fields.find((f) => f.field === "close_time")?.value, "19:00");
expect("day",          tc5Fields.find((f) => f.field === "day")?.value?.toLowerCase(), "saturday");

// ─────────────────────────────────────────────────────────────────────────────
// Test Case 6 — Trading hours: Sunday
// ─────────────────────────────────────────────────────────────────────────────

title("TC6: 08:00–17:00 Sunday:");
const tc6 = "08:00–17:00 Sunday:";
const tc6Fields = runFindingExtractorBot({ raw_text: tc6 }).extracted_findings[0]?.fields ?? [];
expect("finding_type", getType(tc6), "trading_hours");
expect("open_time",    tc6Fields.find((f) => f.field === "open_time")?.value,  "08:00");
expect("close_time",   tc6Fields.find((f) => f.field === "close_time")?.value, "17:00");
expect("day",          tc6Fields.find((f) => f.field === "day")?.value?.toLowerCase(), "sunday");

// ─────────────────────────────────────────────────────────────────────────────
// Test Case 7 — Trading hours: Public Holidays
// ─────────────────────────────────────────────────────────────────────────────

title("TC7: 09:00–17:00 Public Holidays:");
const tc7 = "09:00–17:00 Public Holidays:";
const tc7Fields = runFindingExtractorBot({ raw_text: tc7 }).extracted_findings[0]?.fields ?? [];
expect("finding_type", getType(tc7), "trading_hours");
expect("open_time",    tc7Fields.find((f) => f.field === "open_time")?.value,  "09:00");
expect("day",          tc7Fields.find((f) => f.field === "day")?.value?.toLowerCase(), "public holidays");

// ─────────────────────────────────────────────────────────────────────────────
// Test Case 8 — Trading hours: day-first pattern
// ─────────────────────────────────────────────────────────────────────────────

title("TC8: Saturday 09:00 - 19:00");
const tc8 = "Saturday 09:00 - 19:00";
const tc8Fields = runFindingExtractorBot({ raw_text: tc8 }).extracted_findings[0]?.fields ?? [];
expect("finding_type", getType(tc8), "trading_hours");
expect("day",          tc8Fields.find((f) => f.field === "day")?.value?.toLowerCase(), "saturday");
expect("open_time",    tc8Fields.find((f) => f.field === "open_time")?.value,  "09:00");
expect("close_time",   tc8Fields.find((f) => f.field === "close_time")?.value, "19:00");

// ─────────────────────────────────────────────────────────────────────────────
// Test Case 9 — CTA/junk line: "FIND ON GOOGLE MAPS"
// Tests sourceIngestionService filtering — we test the pattern directly here
// ─────────────────────────────────────────────────────────────────────────────

title("TC9: FIND ON GOOGLE MAPS (should produce low-value extraction)");
const tc9 = "FIND ON GOOGLE MAPS";
const tc9Result = runFindingExtractorBot({ raw_text: tc9 });
info(`signals found: ${tc9Result.total_signals_found}, recommendation: ${tc9Result.recommendation}`);

// This line has no structured signals — extractor should find nothing useful
expectTruthy("total_signals_found is 0 or very low (≤ 1)", tc9Result.total_signals_found <= 1);
// The ingestion service (tested separately) would skip this as restricted_source_reference

// ─────────────────────────────────────────────────────────────────────────────
// Test Case 10 — Product price: "is R3499 at Game until Sunday"
// ─────────────────────────────────────────────────────────────────────────────

title("TC10: Hisense 43 inch FHD LED TV is R3499 at Game until Sunday.");
const tc10 = "Hisense 43 inch FHD LED TV is R3499 at Game until Sunday.";
const tc10Result = runFindingExtractorBot({ raw_text: tc10 });
const tc10Fields = tc10Result.extracted_findings[0]?.fields ?? [];
info(`finding_type: ${tc10Result.extracted_findings[0]?.finding_type}`);
info(`fields: ${JSON.stringify(tc10Fields.map((f) => ({ [f.field]: f.value })))}`);

const tc10Price   = tc10Fields.find((f) => f.field === "price")?.value;
const tc10Shop    = tc10Fields.find((f) => f.field === "shop_name")?.value;
const tc10Until   = tc10Fields.find((f) => f.field === "valid_until_text")?.value;
const tc10PName   = tc10Fields.find((f) => f.field === "product_name")?.value;

expectTruthy("price extracted",                 tc10Price);
expect("price is numeric string",               tc10Price, "3499");
expectTruthy("shop_name extracted (Game)",       tc10Shop === "Game" || tc10Shop?.includes("Game"));
expectTruthy("valid_until_text extracted",      tc10Until);
expectTruthy("product_name extracted (Hisense)", tc10PName && tc10PName.includes("Hisense"));

// ─────────────────────────────────────────────────────────────────────────────
// Test Case 11 — Product price: "Samsung 65" TV for R12,999 on special at Game"
// ─────────────────────────────────────────────────────────────────────────────

title(`TC11: Samsung 65" TV for R12,999 on special at Game`);
const tc11 = `Samsung 65" TV for R12,999 on special at Game`;
const tc11Result = runFindingExtractorBot({ raw_text: tc11 });
const tc11Fields = tc11Result.extracted_findings[0]?.fields ?? [];
info(`finding_type: ${tc11Result.extracted_findings[0]?.finding_type}`);
info(`fields: ${JSON.stringify(tc11Fields.map((f) => ({ [f.field]: f.value })))}`);

const tc11Price = tc11Fields.find((f) => f.field === "price")?.value;
const tc11Shop  = tc11Fields.find((f) => f.field === "shop_name")?.value;
const tc11Promo = tc11Fields.find((f) => f.field === "promotion_signal" || f.field === "promotion")?.value;

expectTruthy("price extracted",     tc11Price);
expect("price is 12999",            tc11Price, "12999");
expectTruthy("shop_name (Game)",    tc11Shop === "Game" || tc11Shop?.includes("Game"));
expectTruthy("promotion signal",    tc11Promo);

// ─────────────────────────────────────────────────────────────────────────────
// Test Case 12 — Floor normalisation
// ─────────────────────────────────────────────────────────────────────────────

title("TC12: Floor normalisation — no 'Floor Floor' duplication");
const tc12 = "Edgars on Ground Floor unit G5";
const tc12Fields = runFindingExtractorBot({ raw_text: tc12 }).extracted_findings[0]?.fields ?? [];
const floorFields = tc12Fields.filter((f) => f.field === "floor");
info(`floor fields: ${JSON.stringify(floorFields)}`);

// Should be exactly one floor field, not two
expect("exactly 1 floor field",  floorFields.length, 1);
expect("floor value is normalised", floorFields[0]?.value, "Ground Floor");

// Floor value must not start with "Floor" when the phrase is "Ground Floor"
const floorVal = floorFields[0]?.value ?? "";
if (floorVal.toLowerCase().startsWith("floor floor") || floorVal.toLowerCase() === "floor") {
  failed++;
  fail(`floor value is wrong: "${floorVal}"`);
} else {
  passed++;
  pass(`floor value is clean: "${floorVal}"`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Summary
// ─────────────────────────────────────────────────────────────────────────────

console.log(`\n${"─".repeat(50)}`);
console.log(`${GREEN}Passed: ${passed}${RESET}   ${failed > 0 ? RED : ""}Failed: ${failed}${RESET}`);
console.log(`Total:  ${passed + failed}`);

if (failed > 0) {
  process.exit(1);
}
