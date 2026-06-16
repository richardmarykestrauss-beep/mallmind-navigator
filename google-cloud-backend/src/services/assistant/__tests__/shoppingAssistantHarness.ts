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

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { extractProductTarget, normalizeAssistantSearchQuery } =
  require("../productTargetExtractor") as typeof import("../productTargetExtractor");

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
console.log("\nSA16 — verified product outranks cheaper demo for normal/budget search");
{
  const pool = () => [
    candidate({ productId: "demo-cheap", productName: "Samsung 32\" HD Smart TV", price: 2999, trustState: null, dataQualityStatus: "demo", routeAvailable: false }),
    candidate({ productId: "verified", productName: "Hisense 43\" FHD LED TV", price: 3499, trustState: "verified", isOnSpecial: true, discountPct: 13, routeAvailable: false }),
  ];

  const budgetAnswer = buildShoppingAnswer({ query: "I need a TV under R4000", candidates: pool() });
  assertEqual(budgetAnswer.bestOption?.productId, "verified", "verified beats cheaper demo for budget search");
  assertEqual(budgetAnswer.bestOption?.trustLabel, "Verified option", "best option is labelled 'Verified option'");
  assertEqual(budgetAnswer.backupOption?.productId, "demo-cheap", "cheaper demo appears as backup");
  assert(budgetAnswer.backupOption?.confidenceBand !== "high", "backup demo is not high-confidence");
  assert(!containsInternalStatus([budgetAnswer.shopperMessage, ...budgetAnswer.warnings].join(" ")), "budget answer leaks no internal tokens");

  const productAnswer = buildShoppingAnswer({ query: "show me a TV", candidates: pool() });
  assertEqual(productAnswer.bestOption?.productId, "verified", "verified beats cheaper demo for product search");
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("\nSA17 — cheapest intent: cheapest wins, with trust warning + verified alternative");
{
  const answer = buildShoppingAnswer({
    query: "What is the cheapest TV under R4000?",
    candidates: [
      candidate({ productId: "demo-cheap", productName: "Samsung 32\" HD Smart TV", price: 2999, trustState: null, dataQualityStatus: "demo", routeAvailable: false }),
      candidate({ productId: "verified", productName: "Hisense 43\" FHD LED TV", price: 3499, trustState: "verified", routeAvailable: false }),
    ],
  });
  assertEqual(answer.intent, "cheapest_option", "intent is cheapest_option");
  assertEqual(answer.bestOption?.productId, "demo-cheap", "cheapest wins for an explicit cheapest request");
  assert(answer.bestOption?.trustLabel !== "Verified option", "cheapest winner is not mislabelled as Verified");
  assert(answer.bestOption?.confidenceBand !== "high", "cheapest winner is clearly lower-confidence");
  assertEqual(answer.backupOption?.productId, "verified", "verified option surfaced as the trade-off alternative");
  assert(/verified price/i.test(answer.shopperMessage), "message communicates the verified alternative");
  assert(answer.warnings.some((w) => /isn't confirmed|not confirmed/i.test(w)), "trust trade-off warning present");
  assert(!containsInternalStatus([answer.shopperMessage, ...answer.warnings].join(" ")), "cheapest answer leaks no internal tokens");
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("\nSA18 — affordability guard: over-budget verified is not shown as best for a budget query");
{
  const answer = buildShoppingAnswer({
    query: "I need a TV under R4000",
    candidates: [
      candidate({ productId: "over", productName: "Sony 65\" OLED", price: 8000, trustState: "verified", routeAvailable: false }),
      candidate({ productId: "afford", productName: "Hisense 43\" FHD LED TV", price: 3499, trustState: null, dataQualityStatus: "demo", routeAvailable: false }),
    ],
  });
  assertEqual(answer.bestOption?.productId, "afford", "an affordable option outranks an over-budget verified one for a budget query");
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("\nSA19 — product-target extraction separates intent words from the product");
{
  assertEqual(extractProductTarget("What is the cheapest TV under R4000?"), "tv", "cheapest TV question → 'tv'");
  assertEqual(extractProductTarget("Show me the cheapest TV"), "tv", "'show me the cheapest TV' → 'tv'");
  assertEqual(extractProductTarget("Which TV is cheapest?"), "tv", "'which TV is cheapest' → 'tv'");
  assertEqual(extractProductTarget("Best TV under R4000"), "tv", "'best TV under R4000' → 'tv'");
  assertEqual(extractProductTarget("Lowest price TV"), "tv", "'lowest price TV' → 'tv'");
  assertEqual(extractProductTarget("TV under R4000"), "tv", "'TV under R4000' → 'tv'");
  assertEqual(extractProductTarget("I need a TV under R4000"), "tv", "'I need a TV under R4000' → 'tv'");
  assertEqual(extractProductTarget("cheapest Samsung TV"), "samsung tv", "brand is preserved as part of the target");
  assertEqual(extractProductTarget("cheapest"), "", "intent-only phrase → empty target");
  assertEqual(extractProductTarget("show me the lowest price"), "", "no product noun → empty target");
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("\nSA20 — search-query normalization recovers the product when the model drops it");
{
  // Model passed an intent-only query; the user message still has the noun.
  assertEqual(
    normalizeAssistantSearchQuery("cheapest", "What is the cheapest TV under R4000?"),
    "tv",
    "model query 'cheapest' falls back to 'tv' from the user message",
  );
  // Model passed a clean query.
  assertEqual(normalizeAssistantSearchQuery("TV", "What is the cheapest TV under R4000?"), "tv", "clean model query 'TV' → 'tv'");
  assertEqual(normalizeAssistantSearchQuery("cheapest TV under R4000", "x"), "tv", "polluted model query → 'tv'");
  // Neither has a product noun → never empty (no worse than before).
  assertEqual(normalizeAssistantSearchQuery("cheapest", "cheapest"), "cheapest", "no product noun anywhere → returns the model query unchanged");
  assertEqual(normalizeAssistantSearchQuery("", "I need a TV under R4000"), "tv", "empty model query → 'tv' from user message");
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
