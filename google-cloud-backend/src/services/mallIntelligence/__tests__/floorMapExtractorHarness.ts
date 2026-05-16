/**
 * Floor Map Extractor — Manual Test Harness
 *
 * Sprint 12C — MallMind Navigator
 *
 * Run with:
 *   npx ts-node --transpile-only src/services/mallIntelligence/__tests__/floorMapExtractorHarness.ts
 *
 * No external API calls. No database reads. Pure deterministic output.
 * Verifies: store name, unit number, floor label, source URL, extraction method.
 */

// Make this file a TypeScript module (avoids global-scope collisions with other harnesses).
export {};

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { extractStoreLocations } = require("../floorMapExtractorService") as
  typeof import("../floorMapExtractorService");

// ── ANSI helpers ──────────────────────────────────────────────────────────────

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

function expectGte(label: string, actual: number, min: number): void {
  if (actual >= min) { passed++; pass(`${label}: ${actual} ≥ ${min}`); }
  else               { failed++; fail(`${label}: expected ≥ ${min}, got ${actual}`); }
}

const SOURCE_URL = "https://www.sample-mall.co.za/store-directory/";

// ── Fixtures ──────────────────────────────────────────────────────────────────

/** TC1: Table-based store directory */
const FIXTURE_TABLE = `
<!DOCTYPE html><html><head><title>Store Directory — Sample Mall</title></head>
<body>
<h1>Store Directory</h1>
<table class="directory-table">
  <thead>
    <tr><th>Store Name</th><th>Unit</th><th>Floor</th><th>Category</th></tr>
  </thead>
  <tbody>
    <tr><td>Game Electronics</td><td>G01</td><td>Ground Floor</td><td>Electronics</td></tr>
    <tr><td>Woolworths</td><td>U12</td><td>Upper Level</td><td>Food &amp; Clothing</td></tr>
    <tr><td>Clicks</td><td>L05</td><td>Lower Ground</td><td>Pharmacy</td></tr>
    <tr><td>Dis-Chem Pharmacy</td><td>G15</td><td>Ground Floor</td><td>Health &amp; Beauty</td></tr>
  </tbody>
</table>
</body></html>
`;

/** TC2: Store card / div layout */
const FIXTURE_CARDS = `
<!DOCTYPE html><html><head><title>Mall Map</title></head>
<body>
<ul class="store-list">
  <li class="store-item">
    <h3 class="store-name">Pick n Pay</h3>
    <span class="unit">G03</span>
    <span class="floor">Ground Floor</span>
    <span class="category">Grocery</span>
  </li>
  <li class="store-item">
    <h3 class="store-name">Edgars</h3>
    <span class="unit">U08</span>
    <span class="floor">Upper Level</span>
  </li>
  <li class="store-item">
    <h3 class="store-name">Mr Price</h3>
    <span class="unit">L02</span>
    <span class="floor">Lower Ground</span>
    <span class="category">Fashion</span>
  </li>
</ul>
</body></html>
`;

/** TC3: Data attribute layout */
const FIXTURE_DATA_ATTRS = `
<!DOCTYPE html><html><head><title>Mall Finder</title></head>
<body>
<div class="mall-directory">
  <div class="store-wrapper" data-store="Checkers" data-unit="G07" data-floor="Ground Floor" data-category="Grocery">
    <h4>Checkers</h4>
  </div>
  <div class="store-wrapper" data-store="Sportscene" data-unit="U19" data-floor="Upper Level" data-category="Sport">
    <h4>Sportscene</h4>
  </div>
</div>
</body></html>
`;

/** TC4: JSON-LD schema.org */
const FIXTURE_JSON_LD = `
<!DOCTYPE html><html><head>
<script type="application/ld+json">
[
  {"@type":"Store","name":"Truworths","floor":"First Floor","identifier":"F04","description":"Fashion"},
  {"@type":"Store","name":"Steers","floor":"Ground Floor","identifier":"G22","description":"Fast Food"},
  {"@type":"LocalBusiness","name":"Vodacom","branchCode":"G11"}
]
</script>
</head><body></body></html>
`;

/** TC5: Source URL preserved on every record */
const FIXTURE_SOURCE_URL_CHECK = FIXTURE_TABLE;

/** TC6: Empty input → graceful no-result */
const FIXTURE_EMPTY = "";

// ── TC1: Table extraction ─────────────────────────────────────────────────────

title("TC1: Table-based store directory");
const tc1 = extractStoreLocations({ source_id: "test-1", source_url: SOURCE_URL, html_content: FIXTURE_TABLE });
info(`strategies_tried: ${tc1.strategies_tried.join(", ")}`);
info(`total_found: ${tc1.total_found}`);

expectGte("total stores found", tc1.total_found, 4);
expectTruthy("html_table strategy used", tc1.strategies_tried.includes("html_table"));

const tc1Game = tc1.stores_extracted.find((s) => s.shop_name.toLowerCase().includes("game"));
const tc1Clicks = tc1.stores_extracted.find((s) => s.shop_name.toLowerCase() === "clicks");
const tc1Dis  = tc1.stores_extracted.find((s) => s.shop_name.toLowerCase().includes("dis-chem"));

expectTruthy("Game found",             tc1Game);
expect("Game unit_number",             tc1Game?.unit_number, "G01");
expect("Game floor_label",             tc1Game?.floor_label, "Ground Floor");
expect("Game category",                tc1Game?.category, "Electronics");

expectTruthy("Clicks found",           tc1Clicks);
expect("Clicks unit_number",           tc1Clicks?.unit_number, "L05");
expect("Clicks floor_label",           tc1Clicks?.floor_label, "Lower Ground");

expectTruthy("Dis-Chem found",         tc1Dis);
expect("Dis-Chem unit_number",         tc1Dis?.unit_number, "G15");

// ── TC2: Card extraction ──────────────────────────────────────────────────────

title("TC2: Store card / div layout");
const tc2 = extractStoreLocations({ source_id: "test-2", source_url: SOURCE_URL, html_content: FIXTURE_CARDS });
info(`strategies_tried: ${tc2.strategies_tried.join(", ")}`);
info(`total_found: ${tc2.total_found}`);

expectGte("total stores found", tc2.total_found, 3);

const tc2Pnp    = tc2.stores_extracted.find((s) => /pick.?n.?pay/i.test(s.shop_name));
const tc2Edgars = tc2.stores_extracted.find((s) => s.shop_name.toLowerCase() === "edgars");

expectTruthy("Pick n Pay found",       tc2Pnp);
expect("Pick n Pay unit_number",       tc2Pnp?.unit_number, "G03");
expect("Pick n Pay floor_label",       tc2Pnp?.floor_label, "Ground Floor");

expectTruthy("Edgars found",           tc2Edgars);
expect("Edgars unit_number",           tc2Edgars?.unit_number, "U08");
expect("Edgars floor_label",           tc2Edgars?.floor_label, "Upper Level");

// ── TC3: Data attributes ──────────────────────────────────────────────────────

title("TC3: Data attribute layout");
const tc3 = extractStoreLocations({ source_id: "test-3", source_url: SOURCE_URL, html_content: FIXTURE_DATA_ATTRS });
info(`strategies_tried: ${tc3.strategies_tried.join(", ")}`);
info(`total_found: ${tc3.total_found}`);

const tc3Checkers = tc3.stores_extracted.find((s) => s.shop_name.toLowerCase() === "checkers");
expectTruthy("Checkers found",         tc3Checkers);
expect("Checkers unit_number",         tc3Checkers?.unit_number, "G07");
expect("Checkers floor_label",         tc3Checkers?.floor_label, "Ground Floor");

// ── TC4: JSON-LD ──────────────────────────────────────────────────────────────

title("TC4: JSON-LD schema.org");
const tc4 = extractStoreLocations({ source_id: "test-4", source_url: SOURCE_URL, html_content: FIXTURE_JSON_LD });
info(`strategies_tried: ${tc4.strategies_tried.join(", ")}`);
info(`total_found: ${tc4.total_found}`);

expectGte("total stores found", tc4.total_found, 3);
expectTruthy("json_ld strategy used", tc4.strategies_tried.includes("json_ld"));

const tc4Truworths = tc4.stores_extracted.find((s) => s.shop_name.toLowerCase() === "truworths");
const tc4Vodacom   = tc4.stores_extracted.find((s) => s.shop_name.toLowerCase() === "vodacom");

expectTruthy("Truworths found",        tc4Truworths);
expect("Truworths floor_label",        tc4Truworths?.floor_label, "First Floor");
expect("Truworths unit_number",        tc4Truworths?.unit_number, "F04");

expectTruthy("Vodacom found",          tc4Vodacom);
expect("Vodacom unit_number",          tc4Vodacom?.unit_number, "G11");

// ── TC5: source_url preserved on all records ──────────────────────────────────

title("TC5: source_url preserved on every extracted record");
const tc5 = extractStoreLocations({ source_id: "test-5", source_url: SOURCE_URL, html_content: FIXTURE_SOURCE_URL_CHECK });

const allHaveSourceUrl = tc5.stores_extracted.every((s) => s.source_url === SOURCE_URL);
expectTruthy("all records carry correct source_url", allHaveSourceUrl);

const allHaveRawEvidence = tc5.stores_extracted.every((s) => s.raw_evidence.length > 0);
expectTruthy("all records carry non-empty raw_evidence", allHaveRawEvidence);

const allHaveConfidence = tc5.stores_extracted.every((s) => s.confidence > 0 && s.confidence <= 1);
expectTruthy("all records carry confidence 0–1", allHaveConfidence);

// ── TC6: Empty input → graceful ───────────────────────────────────────────────

title("TC6: Empty HTML → no crash, 0 stores");
const tc6 = extractStoreLocations({ source_id: "test-6", source_url: SOURCE_URL, html_content: FIXTURE_EMPTY });
expect("total_found is 0",             tc6.total_found, 0);
expectTruthy("has warning",            tc6.warnings.length > 0);

// ── TC8: window.__INITIAL_STATE__ containing tenants array ───────────────────

title("TC8: window.__INITIAL_STATE__ embedded script data — tenants array");
const FIXTURE_INITIAL_STATE = `
<!DOCTYPE html><html><head><title>Mall</title></head>
<body>
<script>
window.__INITIAL_STATE__ = {
  "mall": { "name": "Sample Mall" },
  "tenants": [
    { "name": "H&M", "unit": "G10", "floor": "Ground Floor", "category": "Fashion" },
    { "name": "Woolworths Food", "unit": "U05", "floor": "Upper Level", "category": "Grocery" },
    { "name": "CNA", "unit": "L08", "floor": "Lower Ground", "category": "Books" }
  ]
};
</script>
</body></html>
`;
const tc8 = extractStoreLocations({ source_id: "test-8", source_url: SOURCE_URL, html_content: FIXTURE_INITIAL_STATE });
info(`strategies_tried: ${tc8.strategies_tried.join(", ")}`);
info(`total_found: ${tc8.total_found}`);

expectGte("total stores found", tc8.total_found, 3);
expectTruthy("embedded_script_data strategy used", tc8.strategies_tried.includes("embedded_script_data"));

const tc8HM       = tc8.stores_extracted.find((s) => s.shop_name === "H&M");
const tc8Woolies  = tc8.stores_extracted.find((s) => s.shop_name.toLowerCase().includes("woolworths"));

expectTruthy("H&M found",                 tc8HM);
expect("H&M unit_number",                 tc8HM?.unit_number,  "G10");
expect("H&M floor_label",                 tc8HM?.floor_label,  "Ground Floor");
expect("H&M category",                    tc8HM?.category,     "Fashion");
expectTruthy("Woolworths Food found",      tc8Woolies);
expect("Woolworths Food unit_number",      tc8Woolies?.unit_number, "U05");
expect("Woolworths Food floor_label",      tc8Woolies?.floor_label, "Upper Level");

// ── TC9: var stores = [...] pattern ──────────────────────────────────────────

title("TC9: var stores = [...] JS variable injection");
const FIXTURE_VAR_STORES = `
<!DOCTYPE html><html><head><title>Mall Stores</title></head>
<body>
<script type="text/javascript">
var stores = [
  { "name": "Sportscene", "unitNumber": "G22", "floor": "Ground Floor", "type": "Sport" },
  { "name": "Truworths",  "unitNumber": "U14", "floor": "Upper Level",  "type": "Fashion" }
];
</script>
</body></html>
`;
const tc9 = extractStoreLocations({ source_id: "test-9", source_url: SOURCE_URL, html_content: FIXTURE_VAR_STORES });
info(`strategies_tried: ${tc9.strategies_tried.join(", ")}`);
info(`total_found: ${tc9.total_found}`);

expectGte("total stores found", tc9.total_found, 2);
expectTruthy("embedded_script_data strategy used", tc9.strategies_tried.includes("embedded_script_data"));

const tc9Sport   = tc9.stores_extracted.find((s) => s.shop_name.toLowerCase() === "sportscene");
const tc9Truw    = tc9.stores_extracted.find((s) => s.shop_name.toLowerCase() === "truworths");

expectTruthy("Sportscene found",    tc9Sport);
expect("Sportscene unit_number",    tc9Sport?.unit_number, "G22");
expect("Sportscene floor_label",    tc9Sport?.floor_label, "Ground Floor");
expectTruthy("Truworths found",     tc9Truw);
expect("Truworths unit_number",     tc9Truw?.unit_number, "U14");

// ── TC10: __NEXT_DATA__ props.pageProps.stores ────────────────────────────────

title("TC10: window.__NEXT_DATA__ props.pageProps.stores");
const FIXTURE_NEXT_DATA = `
<!DOCTYPE html><html><head><title>NextJS Mall</title></head>
<body>
<script id="__NEXT_DATA__" type="application/json">
{
  "props": {
    "pageProps": {
      "mallName": "NextJS Mall",
      "stores": [
        { "storeName": "Nike", "shopNumber": "G04", "level": "Ground Floor", "storeType": "Sport" },
        { "storeName": "Cotton On", "shopNumber": "U11", "level": "Upper Level" }
      ]
    }
  },
  "page": "/mall-map"
}
</script>
</body></html>
`;
const tc10 = extractStoreLocations({ source_id: "test-10", source_url: SOURCE_URL, html_content: FIXTURE_NEXT_DATA });
info(`strategies_tried: ${tc10.strategies_tried.join(", ")}`);
info(`total_found: ${tc10.total_found}`);

expectGte("total stores found", tc10.total_found, 2);
expectTruthy("embedded_script_data strategy used", tc10.strategies_tried.includes("embedded_script_data"));

const tc10Nike     = tc10.stores_extracted.find((s) => s.shop_name.toLowerCase() === "nike");
const tc10Cotton   = tc10.stores_extracted.find((s) => s.shop_name.toLowerCase().includes("cotton"));

expectTruthy("Nike found",         tc10Nike);
expect("Nike unit_number",         tc10Nike?.unit_number, "G04");
expect("Nike floor_label",         tc10Nike?.floor_label, "Ground Floor");
expect("Nike category",            tc10Nike?.category,    "Sport");
expectTruthy("Cotton On found",    tc10Cotton);
expect("Cotton On unit_number",    tc10Cotton?.unit_number, "U11");

// ── TC11: <script type="application/json"> with shops array ──────────────────

title("TC11: <script type=application/json> shops array");
const FIXTURE_JSON_SCRIPT = `
<!DOCTYPE html><html><head><title>Mall JSON</title></head>
<body>
<script type="application/json" id="mall-data">
{
  "shops": [
    { "name": "Edgars", "unit": "G33", "floor": "Ground Floor", "category": "Fashion" },
    { "name": "Jet",    "unit": "U07", "floor": "Upper Level",  "category": "Fashion" }
  ]
}
</script>
</body></html>
`;
const tc11 = extractStoreLocations({ source_id: "test-11", source_url: SOURCE_URL, html_content: FIXTURE_JSON_SCRIPT });
info(`strategies_tried: ${tc11.strategies_tried.join(", ")}`);
info(`total_found: ${tc11.total_found}`);

expectGte("total stores found", tc11.total_found, 2);
expectTruthy("embedded_script_data strategy used", tc11.strategies_tried.includes("embedded_script_data"));

const tc11Edgars = tc11.stores_extracted.find((s) => s.shop_name.toLowerCase() === "edgars");
expectTruthy("Edgars found",      tc11Edgars);
expect("Edgars unit_number",      tc11Edgars?.unit_number, "G33");
expect("Edgars floor_label",      tc11Edgars?.floor_label, "Ground Floor");

// ── TC12: No scripts → warning path ──────────────────────────────────────────

title("TC12: No structured data → warning in extraction_log");
const FIXTURE_NO_SCRIPTS = `
<!DOCTYPE html><html><head><title>Visual Floor Map</title></head>
<body>
<div id="map"><img src="floormap.jpg" /></div>
<p>Please visit the information desk for store locations.</p>
</body></html>
`;
const tc12a = extractStoreLocations({ source_id: "test-12", source_url: SOURCE_URL, html_content: FIXTURE_NO_SCRIPTS });
expect("total_found is 0",    tc12a.total_found, 0);
expectTruthy("has warning",   tc12a.warnings.length > 0);
info(`warnings: ${tc12a.warnings.join("; ")}`);

// ── TC7: Floor normalisation check ────────────────────────────────────────────

title("TC7: Floor labels normalised correctly");
const tc7Woolworths = tc1.stores_extracted.find((s) => s.shop_name.toLowerCase() === "woolworths");
expect("Woolworths floor: Upper Level", tc7Woolworths?.floor_label, "Upper Level");

const tc7Clicks = tc1.stores_extracted.find((s) => s.shop_name.toLowerCase() === "clicks");
expect("Clicks floor: Lower Ground",    tc7Clicks?.floor_label, "Lower Ground");

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n${"─".repeat(50)}`);
console.log(`${GREEN}Passed: ${passed}${RESET}   ${failed > 0 ? RED : ""}Failed: ${failed}${RESET}`);
console.log(`Total:  ${passed + failed}`);

if (failed > 0) process.exit(1);
