/**
 * shoppingAssistantHarness.ts — Shopping Assistant Intelligence Engine v1
 *
 * Manual test harness for the pure assistant engine:
 *   shoppingIntentClassifier, shopperTrustLabels,
 *   productRecommendationRanker, shoppingAnswerBuilder
 *
 * Run with:
 *   npm run test:shopping-assistant
 * or:
 *   npx ts-node --transpile-only src/services/assistant/__tests__/shoppingAssistantHarness.ts
 *
 * No DB access, no HTTP calls. Exits non-zero on any failure.
 */

export {};

// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require("fs") as typeof import("fs");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require("path") as typeof import("path");

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { classifyShoppingIntent, parseBudget } =
  require("../shoppingIntentClassifier") as typeof import("../shoppingIntentClassifier");

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { getShopperTrustInfo, containsInternalStatus, INTERNAL_STATUS_TOKENS } =
  require("../shopperTrustLabels") as typeof import("../shopperTrustLabels");

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { rankCandidates } =
  require("../productRecommendationRanker") as typeof import("../productRecommendationRanker");

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { buildShoppingAnswer } =
  require("../shoppingAnswerBuilder") as typeof import("../shoppingAnswerBuilder");

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

function candidate(extra: Record<string, unknown> = {}) {
  return {
    productId: "prod-1",
    productName: "Hisense 43\" FHD LED TV",
    shopName: "Game",
    floor: "G",
    price: 3499,
    trustState: "verified",
    routeAvailable: true,
    ...extra,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("\nSA1 — intent: budget/product search with parsed budget");
{
  const r = classifyShoppingIntent("I need a TV under R4000");
  assert(
    r.intent === "budget_search" || r.intent === "product_search",
    `intent is budget/product search (got ${r.intent})`,
  );
  assertEqual(r.budget, 4000, "budget parsed as 4000");
  assertEqual(parseBudget("below R 3,500 please"), 3500, "parses 'below R 3,500'");
  assertEqual(parseBudget("any nice TVs?"), null, "no budget phrase → null (never invented)");
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("\nSA2 — intent: navigation request");
{
  assertEqual(classifyShoppingIntent("Where is Game?").intent, "navigation_request", "'Where is Game?' → navigation_request");
  assertEqual(classifyShoppingIntent("take me to Clicks").intent, "navigation_request", "'take me to Clicks' → navigation_request");
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("\nSA3 — intent: cheapest option");
{
  assertEqual(classifyShoppingIntent("What's the cheapest 43 inch TV?").intent, "cheapest_option", "cheapest TV → cheapest_option");
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("\nSA4 — intent: mission shopping with budget");
{
  const r = classifyShoppingIntent("I need a gift under R300");
  assertEqual(r.intent, "mission_shopping", "gift query → mission_shopping");
  assertEqual(r.budget, 300, "budget parsed as 300");
  assert(r.secondary.includes("budget_search"), "budget_search captured as secondary intent");
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("\nSA5 — trust: manually_verified → shopper-safe verified label");
{
  const info = getShopperTrustInfo({ dataQualityStatus: "manually_verified" });
  assertEqual(info.label, "Verified option", "manually_verified → 'Verified option'");
  assertEqual(info.confidenceBand, "high", "band is high");
  const viaState = getShopperTrustInfo({ trustState: "verified" });
  assertEqual(viaState.label, "Verified option", "trustState 'verified' → 'Verified option'");
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("\nSA6 — trust: needs_review never says verified");
{
  const info = getShopperTrustInfo({ dataQualityStatus: "needs_review" });
  assert(!/verified/i.test(info.label), `label '${info.label}' does not say verified`);
  assertEqual(info.label, "Price may need confirmation", "needs_review → confirmation language");

  const answer = buildShoppingAnswer({
    query: "43 inch TV",
    candidates: [candidate({ trustState: "needs_review" })],
  });
  assert(!/verified/i.test(answer.shopperMessage), "message for needs_review row never says 'verified'");
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("\nSA7 — no internal status tokens in shopper messages");
{
  // Build answers across every internal state and scan messages + warnings.
  const internalStates = [
    "manual_fact_entry", "csv_manual", "needs_review", "manually_verified",
    "live_feed", "demo", "pending", "approved", "published", "retail_observation",
  ];
  for (const state of internalStates) {
    const answer = buildShoppingAnswer({
      query: "tv",
      candidates: [
        candidate({ trustState: null, dataQualityStatus: state }),
        candidate({ productId: "p2", productName: "LG 40\" TV", trustState: null, dataQualityStatus: state, price: 2999 }),
      ],
    });
    const allText = [answer.shopperMessage, ...answer.warnings, answer.bestOption?.trustLabel ?? "", answer.bestOption?.reason ?? ""].join(" | ");
    assert(!containsInternalStatus(allText), `no internal tokens for input status '${state}'`);
  }
  assert(INTERNAL_STATUS_TOKENS.includes("data_quality_status"), "token list covers data_quality_status");
  assert(containsInternalStatus("this row is manual_fact_entry"), "checker detects internal tokens");
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("\nSA8 — verified closer product beats weak cheaper product");
{
  const verifiedClose = candidate({
    productId: "ver-close", price: 3499, trustState: "verified", walkingMinutes: 2,
  });
  const weakCheapFar = candidate({
    productId: "weak-far", productName: "No-name 43\" TV", shopName: "Pawn Plaza",
    price: 2799, trustState: null, dataQualityStatus: "demo", walkingMinutes: 14,
  });
  const ranked = rankCandidates([weakCheapFar, verifiedClose], {});
  assertEqual(ranked[0].productId, "ver-close", "verified + closer ranks first despite higher price");
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("\nSA9 — cheapest verified wins when distance/trust similar");
{
  const a = candidate({ productId: "a", price: 3499, trustState: "verified", walkingMinutes: 5 });
  const b = candidate({ productId: "b", productName: "LG 43\" TV", shopName: "HiFi Corp", price: 2999, trustState: "verified", walkingMinutes: 5 });
  const ranked = rankCandidates([a, b], {});
  assertEqual(ranked[0].productId, "b", "cheaper of two equally-trusted, equally-near options wins");
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("\nSA10 — empty candidates → honest uncertainty + search_again");
{
  const answer = buildShoppingAnswer({ query: "purple unicorn lamp", candidates: [] });
  assertEqual(answer.bestOption, null, "no best option invented");
  assertEqual(answer.backupOption, null, "no backup invented");
  assertEqual(answer.nextAction.type, "search_again", "next action is search_again");
  assert(/couldn't find|could not find/i.test(answer.shopperMessage), "message admits nothing was found");
  assert(!/R\d/.test(answer.shopperMessage), "no price appears in a no-result answer");
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("\nSA11 — missing price never fabricates a rand amount");
{
  const answer = buildShoppingAnswer({
    query: "tv",
    candidates: [candidate({ price: null })],
  });
  assertEqual(answer.bestOption?.price ?? null, null, "option price stays null");
  assert(!/R\s?\d/.test(answer.shopperMessage), "no rand amount in message");
  assert(/don't have a confirmed price/i.test(answer.shopperMessage), "message says price is not confirmed");
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("\nSA12 — missing stock never claims stock");
{
  const answer = buildShoppingAnswer({
    query: "tv",
    candidates: [candidate({ inStock: null })],
  });
  assert(!/in stock|available/i.test(answer.shopperMessage), "no availability claim when stock unknown");

  const confirmed = buildShoppingAnswer({
    query: "tv",
    candidates: [candidate({ inStock: true })],
  });
  assert(/listed as available/i.test(confirmed.shopperMessage), "stock mentioned only when data confirms it");
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("\nSA13 — navigate action only when route/shop available");
{
  const withRoute = buildShoppingAnswer({ query: "tv", candidates: [candidate({ routeAvailable: true })] });
  assertEqual(withRoute.nextAction.type, "navigate", "route available → navigate");
  assertEqual(withRoute.nextAction.label, "Take me there", "navigate label is action-oriented");

  const noRoute = buildShoppingAnswer({ query: "tv", candidates: [candidate({ routeAvailable: false })] });
  assert(noRoute.nextAction.type !== "navigate", "no route → never navigate");
  assert(!/I can take you there/.test(noRoute.shopperMessage), "message never offers to take shopper without a route");

  const noShop = buildShoppingAnswer({ query: "tv", candidates: [candidate({ shopName: null, routeAvailable: true })] });
  assert(noShop.nextAction.type !== "navigate", "no shop name → never navigate");
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("\nSA14 — backup option included when 2+ candidates");
{
  const answer = buildShoppingAnswer({
    query: "tv under R4000",
    candidates: [
      candidate({ productId: "best", price: 3499, trustState: "verified" }),
      candidate({ productId: "backup", productName: "Samsung 32\" Smart TV", shopName: "Incredible", price: 2999, trustState: null, dataQualityStatus: "needs_review" }),
    ],
  });
  assert(answer.backupOption != null, "backup option present");
  assertEqual(answer.backupOption?.productId, "backup", "backup is the second-ranked candidate");
  assert(/Backup:/.test(answer.shopperMessage), "message mentions the backup");

  const single = buildShoppingAnswer({ query: "tv", candidates: [candidate()] });
  assertEqual(single.backupOption, null, "single candidate → no backup invented");
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("\nSA15 — engine purity: no Supabase/env/network/fs in core modules");
{
  const coreDir = path.resolve(__dirname, "..");
  const coreFiles = fs.readdirSync(coreDir).filter((f: string) => f.endsWith(".ts"));

  const forbidden = ["@supabase", "createClient", "process.env", "fetch(", "require(\"http", "from \"fs\"", "require(\"fs", "XMLHttpRequest", "axios"];

  for (const file of coreFiles) {
    const content = fs.readFileSync(path.join(coreDir, file), "utf8");
    for (const token of forbidden) {
      assert(!content.includes(token), `${file} contains no '${token}'`);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────

console.log(`\n===== SHOPPING ASSISTANT HARNESS RESULT: ${passed} passed, ${failed} failed =====`);
if (failed > 0) process.exit(1);
