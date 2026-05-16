/**
 * GeoDirectory Connector — Manual Test Harness
 *
 * Sprint 12C.2 — MallMind Navigator
 *
 * Run with:
 *   npx ts-node --transpile-only src/services/mallIntelligence/__tests__/geoDirectoryConnectorHarness.ts
 *
 * Tests pure functions only — no HTTP calls, no DB access.
 * detectGeoDirectoryApi / fetchGeoDirectoryStores are NOT called here because
 * they require a live endpoint; they are covered by integration tests.
 */

export {};

// eslint-disable-next-line @typescript-eslint/no-require-imports
const {
  inferFloorFromStoreCode,
  stripGeoHtml,
  parseGeoDirectoryContent,
  normalizeGeoDirectoryStore,
} = require("../geoDirectoryConnectorService") as
  typeof import("../geoDirectoryConnectorService");

// ── ANSI helpers ──────────────────────────────────────────────────────────────

const GREEN  = "\x1b[32m";
const RED    = "\x1b[31m";
const CYAN   = "\x1b[36m";
const DIM    = "\x1b[2m";
const RESET  = "\x1b[0m";

const pass  = (msg: string) => console.log(`  ${GREEN}✓${RESET} ${msg}`);
const fail  = (msg: string) => console.log(`  ${RED}✗${RESET} ${msg}`);
const info  = (msg: string) => console.log(`  ${DIM}${msg}${RESET}`);
const title = (msg: string) => console.log(`\n${CYAN}${msg}${RESET}`);

let passed = 0;
let failed = 0;

function expect(label: string, actual: unknown, expected: unknown): void {
  const ok =
    JSON.stringify(actual) === JSON.stringify(expected) ||
    (typeof expected === "string" &&
     typeof actual   === "string" &&
     actual.toLowerCase() === expected.toLowerCase());
  if (ok) { passed++; pass(`${label}: ${JSON.stringify(actual)}`); }
  else     { failed++; fail(`${label}\n    Expected: ${JSON.stringify(expected)}\n    Got:      ${JSON.stringify(actual)}`); }
}

function expectTruthy(label: string, actual: unknown): void {
  if (actual) { passed++; pass(`${label}: ${JSON.stringify(actual)}`); }
  else        { failed++; fail(`${label} — expected truthy, got: ${JSON.stringify(actual)}`); }
}

function expectFalsy(label: string, actual: unknown): void {
  if (!actual) { passed++; pass(`${label}: (absent — correct)`); }
  else         { failed++; fail(`${label} — expected absent, got: ${JSON.stringify(actual)}`); }
}

// ── TC1: inferFloorFromStoreCode ──────────────────────────────────────────────

title("TC1: inferFloorFromStoreCode — prefix mapping");

expect("GF 001 → Ground Floor",  inferFloorFromStoreCode("GF 001"), "Ground Floor");
expect("LF 111 → Lower Ground",  inferFloorFromStoreCode("LF 111"), "Lower Ground");
expect("UF 019 → Upper Level",   inferFloorFromStoreCode("UF 019"), "Upper Level");
expect("FF 202 → First Floor",   inferFloorFromStoreCode("FF 202"), "First Floor");
expect("1F 007 → First Floor",   inferFloorFromStoreCode("1F 007"), "First Floor");
expect("2F 012 → Second Floor",  inferFloorFromStoreCode("2F 012"), "Second Floor");
expect("3F 033 → Third Floor",   inferFloorFromStoreCode("3F 033"), "Third Floor");
expect("BF 005 → Basement",      inferFloorFromStoreCode("BF 005"), "Basement");
expect("B1 003 → Basement",      inferFloorFromStoreCode("B1 003"), "Basement");
expectFalsy("XX 999 → undefined",  inferFloorFromStoreCode("XX 999"));
expectFalsy("empty string → undefined", inferFloorFromStoreCode(""));

// ── TC2: stripGeoHtml ─────────────────────────────────────────────────────────

title("TC2: stripGeoHtml — HTML tag removal and entity decoding");

expect(
  "strips tags",
  stripGeoHtml("<p>Hello <strong>World</strong></p>"),
  "Hello World",
);
expect(
  "decodes &amp;",
  stripGeoHtml("H&amp;M"),
  "H&M",
);
expect(
  "decodes &nbsp;",
  stripGeoHtml("Floor&nbsp;1"),
  "Floor 1",
);
expect(
  "collapses whitespace",
  stripGeoHtml("  foo   bar  "),
  "foo bar",
);
expect(
  "handles empty string",
  stripGeoHtml(""),
  "",
);
expect(
  "strips complex markup",
  stripGeoHtml('<div class="x"><a href="/link">Click</a></div>'),
  "Click",
);

// ── TC3: parseGeoDirectoryContent — full Menlyn Park format ──────────────────

title("TC3: parseGeoDirectoryContent — standard Menlyn Park content block");

const CONTENT_FULL = `
<p>Website: https://www.homechoice.co.za</p>
<p>Contact Details: 082 400 5253</p>
<p><strong>How to find us</strong></p>
<p>Brands: @Home, HomeChoice</p>
<p>Road Name: Atterbury Road</p>
<p>Park in the: Yellow Parking</p>
<p>Enter at entrance: 14</p>
<p>Store Code: LF 111</p>
`;

const p3 = parseGeoDirectoryContent(CONTENT_FULL);
info(`parsed: ${JSON.stringify(p3)}`);

expect("unit_number",    p3.unit_number,   "LF 111");
expect("floor_label",    p3.floor_label,   "Lower Ground");
expect("parking_hint",   p3.parking_hint,  "Yellow Parking");
expect("entrance_hint",  p3.entrance_hint, "14");
expect("road_name",      p3.road_name,     "Atterbury Road");
expect("website",        p3.website,       "https://www.homechoice.co.za");
expect("phone",          p3.phone,         "082 400 5253");

// ── TC4: parseGeoDirectoryContent — GF (Ground Floor) code ───────────────────

title("TC4: parseGeoDirectoryContent — GF store code → Ground Floor");

const CONTENT_GF = `
<p>Store Code: GF 042</p>
<p>Park in the: Blue Parking</p>
<p>Enter at entrance: 3</p>
`;

const p4 = parseGeoDirectoryContent(CONTENT_GF);
expect("unit_number",    p4.unit_number,   "GF 042");
expect("floor_label",    p4.floor_label,   "Ground Floor");
expect("parking_hint",   p4.parking_hint,  "Blue Parking");
expect("entrance_hint",  p4.entrance_hint, "3");

// ── TC5: parseGeoDirectoryContent — UF (Upper Level) code ────────────────────

title("TC5: parseGeoDirectoryContent — UF store code → Upper Level");

const p5 = parseGeoDirectoryContent("<p>Store Code: UF 019</p><p>Road Name: William Nicol Drive</p>");
expect("unit_number",  p5.unit_number, "UF 019");
expect("floor_label",  p5.floor_label, "Upper Level");
expect("road_name",    p5.road_name,   "William Nicol Drive");

// ── TC6: parseGeoDirectoryContent — no store code ────────────────────────────

title("TC6: parseGeoDirectoryContent — content with no Store Code");

const p6 = parseGeoDirectoryContent("<p>Website: https://example.com</p><p>Contact Details: 012 111 2222</p>");
expectFalsy("unit_number absent", p6.unit_number);
expectFalsy("floor_label absent", p6.floor_label);
expect("website extracted",   p6.website, "https://example.com");
expect("phone extracted",     p6.phone,   "012 111 2222");

// ── TC7: normalizeGeoDirectoryStore — full record ─────────────────────────────

title("TC7: normalizeGeoDirectoryStore — @home living record");

const RAW_STORE = {
  id:       157,
  title:    { raw: "@home living", rendered: "@home living" },
  link:     "https://www.menlynpark.co.za/stores/home-living/",
  modified: "2024-11-15T10:30:00",
  content:  {
    raw: `Website: https://www.homechoice.co.za
Contact Details: 082 400 5253
How to find us
Road Name: Atterbury Road
Park in the: Yellow Parking
Enter at entrance: 14
Store Code: LF 111`,
    rendered: "",
  },
  post_category:  [{ id: 4, name: "Home & Decor", slug: "home-decor" }],
  street:         "Shop LF 111, Menlyn Park Shopping Centre, Atterbury Road, Menlyn",
  latitude:       -25.7861,
  longitude:      28.2777,
  featured_image: "https://www.menlynpark.co.za/wp-content/uploads/home-living.jpg",
  images:         [],
};

const n7 = normalizeGeoDirectoryStore(RAW_STORE, "https://www.menlynpark.co.za/stores/");
info(`shop_name:    ${n7.shop_name}`);
info(`unit_number:  ${n7.unit_number}`);
info(`floor_label:  ${n7.floor_label}`);
info(`category:     ${n7.category}`);
info(`confidence:   ${n7.confidence}`);
info(`parking_hint: ${n7.parking_hint}`);

expect("shop_name",       n7.shop_name,      "@home living");
expect("unit_number",     n7.unit_number,    "LF 111");
expect("floor_label",     n7.floor_label,    "Lower Ground");
expect("category",        n7.category,       "Home & Decor");
expect("confidence",      n7.confidence,     0.90);
expect("extraction_method", n7.extraction_method, "geodirectory_api");
expect("geodir_store_id", n7.geodir_store_id, 157);
expect("parking_hint",    n7.parking_hint,   "Yellow Parking");
expect("entrance_hint",   n7.entrance_hint,  "14");
expect("road_name",       n7.road_name,      "Atterbury Road");
expect("website",         n7.website,        "https://www.homechoice.co.za");
expect("phone",           n7.phone,          "082 400 5253");
expect("source_modified_at", n7.source_modified_at, "2024-11-15T10:30:00");
expect("image_url",       n7.image_url,      "https://www.menlynpark.co.za/wp-content/uploads/home-living.jpg");
expectTruthy("latitude set",  n7.latitude);
expectTruthy("longitude set", n7.longitude);
expect("source_url",      n7.source_url,     "https://www.menlynpark.co.za/stores/home-living/");
expect("no warnings for complete record", n7.warnings.length, 0);

// ── TC8: normalizeGeoDirectoryStore — no store code ──────────────────────────

title("TC8: normalizeGeoDirectoryStore — record without Store Code → 0.85 confidence");

const RAW_NO_CODE = {
  id:       99,
  title:    { raw: "Food Lovers Market", rendered: "Food Lovers Market" },
  link:     "https://www.menlynpark.co.za/stores/food-lovers/",
  modified: "2024-10-01T08:00:00",
  content:  { raw: "Website: https://www.foodlovers.co.za", rendered: "" },
  featured_image: null,
  images:   [],
};

const n8 = normalizeGeoDirectoryStore(RAW_NO_CODE, "https://www.menlynpark.co.za/stores/");
expect("shop_name",    n8.shop_name,  "Food Lovers Market");
expect("confidence",   n8.confidence, 0.85);
expectFalsy("unit_number absent",  n8.unit_number);
expectFalsy("floor_label absent",  n8.floor_label);
expectTruthy("warning emitted",    n8.warnings.length > 0);
expectTruthy("website extracted",  n8.website);

// ── TC9: normalizeGeoDirectoryStore — coordinates parsed from strings ─────────

title("TC9: normalizeGeoDirectoryStore — string coordinates parsed to numbers");

const RAW_STRING_COORDS = {
  id:       200,
  title:    { raw: "Test Store" },
  link:     "https://example.com/stores/test/",
  modified: "2024-01-01T00:00:00",
  content:  { raw: "" },
  latitude:  "-25.7861",
  longitude: "28.2777",
  featured_image: null,
  images:   [],
};

const n9 = normalizeGeoDirectoryStore(RAW_STRING_COORDS as never, "https://example.com/");
expectTruthy("latitude is number",  typeof n9.latitude  === "number");
expectTruthy("longitude is number", typeof n9.longitude === "number");
expect("latitude value",  n9.latitude,  -25.7861);
expect("longitude value", n9.longitude,  28.2777);

// ── TC10: normalizeGeoDirectoryStore — zero coords treated as absent ───────────

title("TC10: normalizeGeoDirectoryStore — zero lat/lng → undefined");

const RAW_ZERO_COORDS = {
  id:       201,
  title:    { raw: "No Coords Store" },
  link:     "https://example.com/stores/nocoords/",
  modified: "2024-01-01T00:00:00",
  content:  { raw: "Store Code: GF 010" },
  latitude:  0,
  longitude: 0,
  featured_image: null,
  images:   [],
};

const n10 = normalizeGeoDirectoryStore(RAW_ZERO_COORDS as never, "https://example.com/");
expectFalsy("latitude absent for zero", n10.latitude);
expectFalsy("longitude absent for zero", n10.longitude);

// ── TC11: normalizeGeoDirectoryStore — title HTML stripped ────────────────────

title("TC11: normalizeGeoDirectoryStore — HTML in title stripped");

const RAW_HTML_TITLE = {
  id:       300,
  title:    { raw: "<strong>Pick n Pay</strong>", rendered: "<strong>Pick n Pay</strong>" },
  link:     "https://example.com/stores/pnp/",
  modified: "2024-01-01T00:00:00",
  content:  { raw: "Store Code: GF 005" },
  featured_image: null,
  images:   [],
};

const n11 = normalizeGeoDirectoryStore(RAW_HTML_TITLE as never, "https://example.com/");
expect("title HTML stripped", n11.shop_name, "Pick n Pay");

// ── TC12: normalizeGeoDirectoryStore — image fallback to images[0].src ────────

title("TC12: normalizeGeoDirectoryStore — featured_image null → images[0].src fallback");

const RAW_IMAGE_FALLBACK = {
  id:       400,
  title:    { raw: "Woolworths" },
  link:     "https://example.com/stores/woolworths/",
  modified: "2024-01-01T00:00:00",
  content:  { raw: "" },
  featured_image: null,
  images:   [{ src: "https://example.com/wp-content/uploads/woolworths.jpg" }],
};

const n12 = normalizeGeoDirectoryStore(RAW_IMAGE_FALLBACK as never, "https://example.com/");
expect("image_url from images[0]", n12.image_url, "https://example.com/wp-content/uploads/woolworths.jpg");

// ── TC13: Dedup / update path — simulation ────────────────────────────────────

title("TC13: Dedup simulation — same geodir_store_id gets update payload, not duplicate insert");

// Simulate two imports of the same store record (id=157) with different content.
const STORE_IMPORT_1 = { ...RAW_STORE, content: { raw: "Store Code: LF 111", rendered: "" } };
const STORE_IMPORT_2 = { ...RAW_STORE, content: { raw: "Store Code: LF 111\nPark in the: Red Parking", rendered: "" } };

const norm1 = normalizeGeoDirectoryStore(STORE_IMPORT_1, "https://www.menlynpark.co.za/stores/");
const norm2 = normalizeGeoDirectoryStore(STORE_IMPORT_2, "https://www.menlynpark.co.za/stores/");

// Both should have the same geodir_store_id
expect("same geodir_store_id", norm1.geodir_store_id, norm2.geodir_store_id);
// Second import should carry updated parking_hint
expect("import 1 parking_hint absent", norm1.parking_hint, undefined);
expect("import 2 parking_hint present", norm2.parking_hint, "Red Parking");
// Extraction method unchanged
expect("extraction_method consistent", norm1.extraction_method, norm2.extraction_method);

// ── TC14: Pagination stop — simulated empty page ──────────────────────────────

title("TC14: Pagination logic — stops correctly on partial or empty page");

// We can't call fetchGeoDirectoryStores (HTTP), but we test the stop condition logic:
// A page returning fewer records than per_page (e.g. 3 out of 100) should stop.
const simulateShouldStop = (returned: number, perPage: number): boolean =>
  returned === 0 || returned < perPage;

expectTruthy("stops on empty page (0 < 100)",       simulateShouldStop(0, 100));
expectTruthy("stops on partial page (3 < 100)",     simulateShouldStop(3, 100));
expectTruthy("stops on partial page (99 < 100)",    simulateShouldStop(99, 100));
expect("does NOT stop on full page (100 === 100)", simulateShouldStop(100, 100), false);
expect("does NOT stop on full page (5 === 5)",    simulateShouldStop(5, 5),   false);

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n${"─".repeat(50)}`);
console.log(`${GREEN}Passed: ${passed}${RESET}   ${failed > 0 ? RED : ""}Failed: ${failed}${RESET}`);
console.log(`Total:  ${passed + failed}`);

if (failed > 0) process.exit(1);
