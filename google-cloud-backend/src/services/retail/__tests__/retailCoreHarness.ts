/**
 * retailCoreHarness.ts — Retail Intelligence Core v1
 *
 * Manual test harness for the pure retail core:
 *   retailNameMatcher, retailTrustMapper, retailWarnings, retailPublishPlanner
 *
 * Run with:
 *   npm run test:retail-core
 * or:
 *   npx ts-node --transpile-only src/services/retail/__tests__/retailCoreHarness.ts
 *
 * No DB access, no HTTP calls. Exits non-zero on any failure.
 */

export {};

// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require("fs") as typeof import("fs");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require("path") as typeof import("path");

// eslint-disable-next-line @typescript-eslint/no-require-imports
const {
  normalizeProductName,
  buildProductIndex,
  matchObservationToProduct,
} = require("../retailNameMatcher") as typeof import("../retailNameMatcher");

// eslint-disable-next-line @typescript-eslint/no-require-imports
const {
  mapTrustStateToProductQuality,
  mapVerificationMethod,
  isVerifiedQuality,
} = require("../retailTrustMapper") as typeof import("../retailTrustMapper");

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { buildPublishWarnings } =
  require("../retailWarnings") as typeof import("../retailWarnings");

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { buildPublishPlan, buildProductPayload } =
  require("../retailPublishPlanner") as typeof import("../retailPublishPlanner");

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

const SHOP_A = "shop-aaa";
const SHOP_B = "shop-bbb";

function product(id: string, shopId: string, name: string, extra: Record<string, unknown> = {}) {
  return { id, shop_id: shopId, name, price: 100, data_quality_status: "manually_verified", ...extra };
}

function observation(extra: Record<string, unknown> = {}) {
  return {
    id: "obs-1",
    mall_id: "mall-1",
    shop_id: SHOP_A,
    product_id: null,
    product_name: "Hisense 43\" FHD LED TV",
    category: "electronics",
    price: 4999,
    trust_state: "verified",
    verification_method: "website",
    confidence: 0.9,
    ...extra,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("\nRC1 — normalizeProductName");
{
  assertEqual(normalizeProductName("  Hisense   43\" FHD  LED TV  "), "hisense 43\" fhd led tv", "trims, lowercases, collapses whitespace");
  assertEqual(normalizeProductName(null), "", "null → empty string");
  assertEqual(normalizeProductName(undefined), "", "undefined → empty string");
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("\nRC2 — product_id match wins over shop/name match");
{
  // Observation is linked to product B, but its name exactly matches product A.
  const prodA = product("prod-a", SHOP_A, "Hisense 43\" FHD LED TV");
  const prodB = product("prod-b", SHOP_A, "Different Name Entirely");
  const index = buildProductIndex([prodA, prodB]);

  const match = matchObservationToProduct(observation({ product_id: "prod-b" }), index);
  assertEqual(match.strategy, "product_id", "strategy is product_id");
  assertEqual(match.product?.id, "prod-b", "linked product wins over name match");
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("\nRC3 — shop/name fallback when product_id is null");
{
  const prodA = product("prod-a", SHOP_A, "HISENSE 43\"  FHD LED TV");
  const index = buildProductIndex([prodA, product("prod-other-shop", SHOP_B, "Hisense 43\" FHD LED TV")]);

  const match = matchObservationToProduct(observation({ product_id: null }), index);
  assertEqual(match.strategy, "shop_name", "strategy is shop_name");
  assertEqual(match.product?.id, "prod-a", "matches normalized name within same shop only");
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("\nRC4 — shop/name fallback when product_id does not resolve");
{
  const prodA = product("prod-a", SHOP_A, "Hisense 43\" FHD LED TV");
  const index = buildProductIndex([prodA]);

  const match = matchObservationToProduct(observation({ product_id: "prod-deleted" }), index);
  assertEqual(match.strategy, "shop_name", "stale product_id falls back to shop/name");
  assertEqual(match.product?.id, "prod-a", "falls back to the name match");
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("\nRC5 — insert_new when no match exists");
{
  const index = buildProductIndex([product("prod-a", SHOP_A, "Some Other Product")]);
  const match = matchObservationToProduct(observation(), index);
  assertEqual(match.strategy, "insert_new", "strategy is insert_new");
  assertEqual(match.product, null, "no product returned");
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("\nRC6 — ambiguous match is detected and refused");
{
  const dupe1 = product("prod-dupe-1", SHOP_A, "Hisense 43\" FHD LED TV");
  const dupe2 = product("prod-dupe-2", SHOP_A, "hisense 43\" fhd led tv");
  const index = buildProductIndex([dupe1, dupe2]);

  const match = matchObservationToProduct(observation(), index);
  assertEqual(match.strategy, "ambiguous", "strategy is ambiguous");
  assertEqual(match.product, null, "no product silently chosen");
  assertEqual(match.candidates.length, 2, "both candidates reported");

  const plan = buildPublishPlan([observation()], [dupe1, dupe2]);
  assertEqual(plan[0].action, "skip_ambiguous", "planner marks ambiguous row skip_ambiguous");
  assertEqual(plan[0].existing_product_id, null, "no existing_product_id for ambiguous row");
  assert(plan[0].ambiguous_candidate_ids.length === 2, "candidate ids surfaced for admin");
  assert(
    plan[0].warnings.some((w: string) => w.includes("Ambiguous product match")),
    "ambiguity warning present",
  );
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("\nRC7 — trust mapping (19C.4 hardening)");
{
  assertEqual(mapTrustStateToProductQuality("manual_fact_entry", "csv_manual"), "needs_review", "manual_fact_entry + csv_manual → needs_review");
  assertEqual(mapTrustStateToProductQuality("manual_fact_entry", null), "needs_review", "manual_fact_entry + no method → needs_review");
  assertEqual(mapTrustStateToProductQuality("manual_fact_entry", "receipt"), "manually_verified", "manual_fact_entry + evidence method → manually_verified");
  assertEqual(mapTrustStateToProductQuality("verified", "phone"), "manually_verified", "verified + phone → manually_verified");
  assertEqual(mapTrustStateToProductQuality("verified", "website"), "manually_verified", "verified + website → manually_verified");
  assertEqual(mapTrustStateToProductQuality("live_feed", "retailer_api"), "live_feed", "live_feed passes through");
  assertEqual(mapTrustStateToProductQuality("user_submitted", "user_submission"), "user_submitted", "user_submitted passes through");
  assertEqual(mapTrustStateToProductQuality("disputed", "phone"), "needs_review", "disputed → needs_review");
  assertEqual(mapTrustStateToProductQuality("totally_unknown_state", "phone"), "needs_review", "unknown state → needs_review");

  // Weak manual CSV rows never become Verified prices end-to-end.
  const weakPlan = buildPublishPlan(
    [observation({ trust_state: "manual_fact_entry", verification_method: "csv_manual", confidence: 0.5 })],
    [],
  );
  assertEqual(weakPlan[0].projected_product_quality, "needs_review", "weak CSV row plans as needs_review");
  assertEqual(weakPlan[0].projected_verified, false, "weak CSV row is never projected_verified");
  assertEqual(weakPlan[0].payload.verified, false, "weak CSV payload.verified is false");
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("\nRC8 — verification method mapping to products column");
{
  assertEqual(mapVerificationMethod("phone"), "phone", "phone passes through");
  assertEqual(mapVerificationMethod("csv_manual"), null, "csv_manual → null (not allowed on products)");
  assertEqual(mapVerificationMethod("affiliate_feed"), "retailer_api", "affiliate_feed → retailer_api");
  assertEqual(mapVerificationMethod("partner_feed"), "retailer_api", "partner_feed → retailer_api");
  assertEqual(mapVerificationMethod(null), null, "null → null");
  assertEqual(mapVerificationMethod("made_up_method"), null, "unknown → null");
  assertEqual(isVerifiedQuality("manually_verified"), true, "manually_verified is verified quality");
  assertEqual(isVerifiedQuality("needs_review"), false, "needs_review is not verified quality");
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("\nRC9 — warnings for weak/manual/low-confidence rows");
{
  const weak = { trust_state: "manual_fact_entry", verification_method: "csv_manual", confidence: 0.5 };
  const warnings = buildPublishWarnings(weak, "needs_review");
  assert(warnings.some((w) => w.includes("needs_review, not Verified price")), "manual CSV warning present");
  assert(warnings.some((w) => w.includes("not external evidence-backed")), "non-evidence method warning present");
  assert(warnings.some((w) => w.includes("Confidence is 0.5")), "low confidence warning present");

  const strong = { trust_state: "verified", verification_method: "website", confidence: 0.95 };
  assertEqual(buildPublishWarnings(strong, "manually_verified").length, 0, "strong row has no warnings");
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("\nRC10 — zero approved rows produces an empty publish plan");
{
  const plan = buildPublishPlan([], [product("prod-a", SHOP_A, "Anything")]);
  assertEqual(plan.length, 0, "empty observations → empty plan");
  assertEqual(buildPublishPlan(null as never, null as never).length, 0, "null inputs → empty plan");
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("\nRC11 — payload determinism and write metadata gating");
{
  const obs = observation({
    retail_data_sources: { id: "src-1", source_type: "csv" },
    retail_source_snapshots: { id: "snap-1" },
  });

  const previewPayload = buildProductPayload(obs);
  assertEqual(previewPayload.price_verified_at, null, "no nowIso → price_verified_at stays null (preview path)");
  assertEqual(previewPayload.verified_by, null, "no verifiedBy → verified_by stays null (preview path)");

  const applyPayload = buildProductPayload(obs, { nowIso: "2026-06-10T00:00:00.000Z", verifiedBy: "harness" });
  assertEqual(applyPayload.price_verified_at, "2026-06-10T00:00:00.000Z", "nowIso passed through verbatim");
  assertEqual(applyPayload.verified_by, "harness", "verifiedBy passed through verbatim");
  assert(applyPayload.data_source.includes("source_id:src-1"), "data_source records source id");
  assert(applyPayload.data_source.includes("snapshot_id:snap-1"), "data_source records snapshot id");
  assert(applyPayload.data_source.includes("method:website"), "data_source preserves original method");
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("\nRC12 — core purity: no DB client, no env reads, no I/O in core modules");
{
  const coreDir = path.resolve(__dirname, "..");
  const coreFiles = fs
    .readdirSync(coreDir)
    .filter((f: string) => f.endsWith(".ts"));

  const forbidden = ["@supabase", "createClient", "process.env", "fetch(", "require(\"http", "from \"fs\"", "require(\"fs"];

  for (const file of coreFiles) {
    const content = fs.readFileSync(path.join(coreDir, file), "utf8");
    for (const token of forbidden) {
      assert(!content.includes(token), `${file} contains no '${token}'`);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────

console.log(`\n===== RETAIL CORE HARNESS RESULT: ${passed} passed, ${failed} failed =====`);
if (failed > 0) process.exit(1);
