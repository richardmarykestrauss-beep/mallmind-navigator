/**
 * retailCsvIntakeHarness.ts — Sprint 20A.9
 *
 * Pure test harness for the CSV intake module. No DB, no network, no Express.
 * Run: npm run test:retail-csv-intake
 */

export {};

// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require("fs") as typeof import("fs");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require("path") as typeof import("path");

// eslint-disable-next-line @typescript-eslint/no-require-imports
const intake = require("../retailCsvIntake") as typeof import("../retailCsvIntake");
const { intakeRetailCsv, computeObservationHash, sha256Hex, parseCsv } = intake;

let passed = 0, failed = 0;
function assert(cond: boolean, label: string): void {
  if (cond) { console.log(`  ✓ ${label}`); passed++; }
  else      { console.error(`  ✗ ${label}`); failed++; }
}

const MALL = "f4a2c1b3-8d7e-4f6a-9b0c-1d2e3f4a5b6c";
const SHOP = "a1b2c3d4-0001-4000-8000-100000000001";
const HEADER = "mall_id,shop_id,product_name,brand,model,category,price,original_price,is_on_special,special_description,in_stock,trust_state,verification_method,valid_to,source_note";

// Build a CSV body row with overrides keyed by header name.
function row(over: Record<string, string> = {}): string {
  const base: Record<string, string> = {
    mall_id: MALL, shop_id: SHOP, product_name: "Hisense 43in TV", brand: "Hisense",
    model: "43A4", category: "televisions", price: "3499", original_price: "3999",
    is_on_special: "true", special_description: "Winter sale", in_stock: "true",
    trust_state: "needs_review", verification_method: "csv_manual",
    valid_to: "2026-07-31", source_note: "seed",
  };
  const m = { ...base, ...over };
  return intake.REQUIRED_HEADERS.map((h) => m[h] ?? "").join(",");
}
const csv = (...lines: string[]) => [HEADER, ...lines].join("\n");

console.log("\nCI — retail CSV intake (20A.9)");

// 1. Valid basic row.
{
  const r = intakeRetailCsv(csv(row()));
  assert(r.ok && r.total_rows === 1 && r.valid_rows === 1 && r.blocked_rows === 0, "valid basic row → ok, 1 valid");
  assert(r.candidates.length === 1 && !!r.candidates[0].observation_hash, "candidate produced with a hash");
  assert(r.candidates[0].price === 3499 && r.candidates[0].is_on_special === true, "numeric + boolean normalised");
}

// 2. Quoted commas.
{
  const r = intakeRetailCsv(csv(row({ product_name: '"Big, Wide TV"', special_description: '"a, b, c"' })));
  assert(r.valid_rows === 1 && r.candidates[0].product_name === "Big, Wide TV", "quoted commas preserved");
}

// 3. Escaped quotes.
{
  const r = intakeRetailCsv(csv(row({ product_name: '"He said ""hi"""' })));
  assert(r.candidates[0]?.product_name === 'He said "hi"', "escaped quotes unescaped");
}

// 4. CRLF vs LF parity.
{
  const lf = csv(row(), row({ product_name: "LG 40in" }));
  const crlf = lf.replace(/\n/g, "\r\n");
  const a = intakeRetailCsv(lf), b = intakeRetailCsv(crlf);
  assert(a.valid_rows === 2 && b.valid_rows === 2, "CRLF and LF both parse 2 rows");
  assert(a.candidates[0].observation_hash === b.candidates[0].observation_hash, "CRLF/LF produce identical hashes");
}

// 5. Blank lines ignored.
{
  const r = intakeRetailCsv([HEADER, row(), "", "   ", row({ product_name: "Samsung 32in" })].join("\n"));
  assert(r.ok && r.valid_rows === 2, "blank lines ignored");
}

// 6. Missing required header → structural error.
{
  const r = intakeRetailCsv("mall_id,shop_id,product_name\n" + `${MALL},${SHOP},TV`);
  assert(!r.ok && /missing required headers/i.test(r.structural_error ?? ""), "missing headers → structural error");
}

// 7. Duplicate header → structural error.
{
  const r = intakeRetailCsv((HEADER + ",price") + "\n" + row() + ",1");
  assert(!r.ok && /duplicate header/i.test(r.structural_error ?? ""), "duplicate header → structural error");
}

// 8. Malformed quoting does not crash.
{
  let threw = false; let r: any;
  try { r = intakeRetailCsv(csv(row({ product_name: '"unterminated' }))); } catch { threw = true; }
  assert(!threw && r && typeof r.ok === "boolean", "malformed quoting handled without throwing");
}

// 9. Formula injection sanitised.
{
  const r = intakeRetailCsv(csv(row({ product_name: "=cmd()|calc", brand: "@SUM(A1)" })));
  assert(r.candidates[0].product_name.startsWith("'="), "formula in product_name neutralised");
  assert((r.candidates[0].brand ?? "").startsWith("'@"), "formula in brand neutralised");
}

// 10. Booleans.
{
  assert(intakeRetailCsv(csv(row({ is_on_special: "false", in_stock: "false" }))).valid_rows === 1, "valid booleans accepted");
  const bad = intakeRetailCsv(csv(row({ is_on_special: "yes" })));
  assert(bad.blocked_rows === 1 && bad.rows[0].blockers.some((b) => /is_on_special/.test(b)), "invalid boolean blocked");
}

// 11/12/13. Price.
{
  assert(intakeRetailCsv(csv(row({ price: "-5" }))).rows[0].blockers.some((b) => /price/.test(b)), "negative price blocked");
  assert(intakeRetailCsv(csv(row({ price: "abc" }))).rows[0].blockers.some((b) => /price/.test(b)), "non-numeric price blocked");
  const zero = intakeRetailCsv(csv(row({ price: "0" })));
  assert(zero.valid_rows === 1 && zero.rows[0].warnings.some((w) => /price is 0/i.test(w)), "zero price valid with warning");
  const missing = intakeRetailCsv(csv(row({ price: "" })));
  assert(missing.rows[0].blockers.some((b) => /price is required/i.test(b)), "missing price blocked");
}

// 14. Invalid confidence (optional column).
{
  const r = intakeRetailCsv((HEADER + ",confidence") + "\n" + row() + ",1.7");
  assert(r.rows[0].blockers.some((b) => /confidence/.test(b)), "confidence >1 blocked");
  const ok = intakeRetailCsv((HEADER + ",confidence") + "\n" + row() + ",0.42");
  assert(ok.valid_rows === 1 && ok.candidates[0].confidence === 0.42, "valid confidence accepted");
}

// 15. Invalid timestamp.
{
  assert(intakeRetailCsv(csv(row({ valid_to: "not-a-date" }))).rows[0].blockers.some((b) => /valid_to/.test(b)), "invalid valid_to blocked");
}

// 16/17. Trust state + method validation.
{
  assert(intakeRetailCsv(csv(row({ trust_state: "supertrust" }))).rows[0].blockers.some((b) => /trust_state/.test(b)), "invalid trust_state blocked");
  assert(intakeRetailCsv(csv(row({ verification_method: "magic" }))).rows[0].blockers.some((b) => /verification_method/.test(b)), "invalid verification_method blocked");
}

// 18. Missing mall/shop/product + UUID validation.
{
  assert(intakeRetailCsv(csv(row({ mall_id: "" }))).rows[0].blockers.some((b) => /mall_id is required/.test(b)), "missing mall_id blocked");
  assert(intakeRetailCsv(csv(row({ shop_id: "" }))).rows[0].blockers.some((b) => /shop_id is required/.test(b)), "missing shop_id blocked");
  assert(intakeRetailCsv(csv(row({ product_name: "" }))).rows[0].blockers.some((b) => /product_name is required/.test(b)), "missing product_name blocked");
  assert(intakeRetailCsv(csv(row({ mall_id: "not-a-uuid" }))).rows[0].blockers.some((b) => /mall_id is not a valid UUID/.test(b)), "non-UUID mall_id blocked");
}

// 19. Deterministic hash stability.
{
  const a = intakeRetailCsv(csv(row())).candidates[0].observation_hash;
  const b = intakeRetailCsv(csv(row())).candidates[0].observation_hash;
  assert(a === b && a.length === 64, "hash deterministic + 64 hex");
}

// 20. Hash changes on meaningful change; stable on non-hashed change.
{
  const base = intakeRetailCsv(csv(row())).candidates[0].observation_hash;
  const priceChanged = intakeRetailCsv(csv(row({ price: "2999" }))).candidates[0].observation_hash;
  const noteChanged = intakeRetailCsv(csv(row({ source_note: "different note" }))).candidates[0].observation_hash;
  assert(base !== priceChanged, "hash changes when price changes");
  assert(base === noteChanged, "hash stable when only non-hashed field (source_note) changes");
}

// 21. Duplicate rows inside one file.
{
  const r = intakeRetailCsv(csv(row(), row()));
  assert(r.total_rows === 2 && r.valid_rows === 2 && r.duplicate_rows_in_file === 1, "in-file duplicate counted");
  assert(r.candidates.length === 1, "duplicate not staged twice");
  assert(r.rows[1].duplicate_in_file === true, "second occurrence flagged duplicate");
}

// 22. Mixed valid + invalid rows.
{
  const r = intakeRetailCsv(csv(row(), row({ price: "-1", product_name: "Bad TV" }), row({ product_name: "Good 2" })));
  assert(r.ok && r.total_rows === 3 && r.valid_rows === 2 && r.blocked_rows === 1, "mixed file keeps valid rows, reports blocked");
  assert(r.rows[1].row_number === 3, "blocked row reports its CSV line number");
}

// 23/24. Trust downgrade — CSV cannot self-declare verification.
{
  const r = intakeRetailCsv(csv(row({ trust_state: "verified", verification_method: "csv_manual" })));
  assert(r.valid_rows === 1, "verified+csv_manual still stages (valid)");
  assert(r.candidates[0].trust_state === "needs_review", "verified+csv_manual downgraded to needs_review");
  assert(r.candidates[0].declared_trust_state === "verified", "original declared trust_state preserved");
  assert(r.rows[0].warnings.some((w) => /overstates a CSV's evidence/i.test(w)), "downgrade is documented in a warning");
}

// 25. Valid retailer-supplied staging (kept, not downgraded).
{
  const r = intakeRetailCsv(csv(row({ trust_state: "retailer_submitted", verification_method: "retailer_confirmation" })));
  assert(r.valid_rows === 1 && r.candidates[0].trust_state === "retailer_submitted", "retailer_submitted + evidence method kept");
}

// 26. Summary counts + file sha + category counts.
{
  const text = csv(row({ category: "televisions" }), row({ product_name: "TV2", category: "televisions" }), row({ price: "-1", product_name: "x" }));
  const r = intakeRetailCsv(text);
  assert(r.category_counts["televisions"] === 2, "category_counts correct (valid rows only)");
  assert(sha256Hex(text) === sha256Hex(text) && sha256Hex(text).length === 64, "sha256Hex deterministic");
  assert(sha256Hex("a") !== sha256Hex("b"), "sha256Hex differs on different input");
}

// 27. computeObservationHash matches the legacy importer formula (regression lock).
{
  const h = computeObservationHash({
    mall_id: MALL, shop_id: SHOP, product_name: "Hisense 43in TV", brand: "Hisense",
    model: "43A4", category: "televisions", price: 3499, original_price: 3999, valid_to: "2026-07-31",
  });
  // The same fields routed through the full intake must yield the same hash.
  assert(intakeRetailCsv(csv(row())).candidates[0].observation_hash === h, "intake hash matches direct computeObservationHash");
}

// 28. parseCsv low-level smoke.
{
  const rows = parseCsv('a,b\n1,"x,y"\n');
  assert(rows.length === 2 && rows[1][1] === "x,y", "parseCsv handles quoted field");
}

// ── Purity scan of the intake module ────────────────────────────────────────
console.log("\nCI-PURITY — intake module has no Supabase/env/fs/network/Express");
{
  const src = fs.readFileSync(path.resolve(__dirname, "..", "retailCsvIntake.ts"), "utf8");
  const forbidden = ["@supabase", "createClient", "process.env", "fetch(", "require(\"http", "from \"fs\"", "require(\"fs", "from \"express\"", "require(\"express", "XMLHttpRequest", "axios"];
  for (const token of forbidden) {
    assert(!src.includes(token), `intake module contains no '${token}'`);
  }
}

console.log(`\n===== RETAIL CSV INTAKE HARNESS RESULT: ${passed} passed, ${failed} failed =====`);
if (failed > 0) process.exit(1);
