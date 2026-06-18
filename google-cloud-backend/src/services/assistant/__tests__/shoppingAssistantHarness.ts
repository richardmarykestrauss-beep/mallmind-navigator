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
const { buildShoppingAnswer, alignAssistantMessage } =
  require("../shoppingAnswerBuilder") as typeof import("../shoppingAnswerBuilder");

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { extractProductTarget, normalizeAssistantSearchQuery } =
  require("../productTargetExtractor") as typeof import("../productTargetExtractor");

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { extractDirectRouteDestination } =
  require("../routeIntentExtractor") as typeof import("../routeIntentExtractor");

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { extractDeterministicShoppingIntent } =
  require("../deterministicShoppingIntent") as typeof import("../deterministicShoppingIntent");

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { filterDeterministicCandidates } =
  require("../deterministicProductFilter") as typeof import("../deterministicProductFilter");

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { assembleDeterministicShoppingAnswer } =
  require("../deterministicShoppingAnswer") as typeof import("../deterministicShoppingAnswer");

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
console.log("\nSA21 — free-text message aligns with shopping_answer (no bubble/card contradiction)");
{
  const answer = buildShoppingAnswer({
    query: "What is the cheapest TV under R4000?",
    candidates: [
      candidate({ productId: "samsung", productName: "Samsung 32\" HD Smart TV", price: 2999, trustState: null, dataQualityStatus: "demo", routeAvailable: false }),
      candidate({ productId: "hisense", productName: "Hisense 43\" FHD LED TV", price: 3499, trustState: "verified", routeAvailable: false }),
    ],
  });
  // A contradicting legacy/model message (Gemini "best bet is Hisense...").
  const legacy = "Okay, the best bet for a TV under R4000 is the Hisense 43\" FHD LED TV at Game.";

  const aligned = alignAssistantMessage(legacy, answer, false);
  assertEqual(aligned, answer.shopperMessage, "with a shopping_answer and no route, message becomes the shopperMessage");
  assert(aligned !== legacy, "contradicting legacy message is not used");
  assert(/cheapest/i.test(aligned), "aligned message reflects the cheapest framing");
  assert(/verified/i.test(aligned), "aligned message still surfaces the verified alternative");
  assert(!containsInternalStatus(aligned), "aligned message leaks no internal tokens");

  // A built route keeps its own confirmation message — never overwritten.
  const routeMsg = "Route to Game is ready. Follow the steps on screen.";
  assertEqual(alignAssistantMessage(routeMsg, answer, true), routeMsg, "a built route keeps its route message");

  // No structured answer → legacy message is used as fallback.
  assertEqual(alignAssistantMessage(legacy, null, false), legacy, "no shopping_answer → legacy message is the fallback");
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("\nSA22 — direct route intent: explicit navigation commands extract a shop destination");
{
  // Direct navigation commands → destination candidate (these must bypass Gemini).
  assertEqual(extractDirectRouteDestination("Take me to Game"), "Game", "'Take me to Game' → 'Game'");
  assertEqual(extractDirectRouteDestination("Where is Game?"), "Game", "'Where is Game?' → 'Game'");
  assertEqual(extractDirectRouteDestination("where's Clicks"), "Clicks", "\"where's Clicks\" → 'Clicks'");
  assertEqual(extractDirectRouteDestination("Directions to Clicks"), "Clicks", "'Directions to Clicks' → 'Clicks'");
  assertEqual(extractDirectRouteDestination("Navigate to Dis-Chem"), "Dis-Chem", "'Navigate to Dis-Chem' → 'Dis-Chem' (hyphen kept)");
  assertEqual(extractDirectRouteDestination("Show me the way to Woolworths"), "Woolworths", "'Show me the way to Woolworths' → 'Woolworths'");
  assertEqual(extractDirectRouteDestination("Route to Game"), "Game", "'Route to Game' → 'Game'");
  assertEqual(extractDirectRouteDestination("How do I get to Clicks?"), "Clicks", "'How do I get to Clicks?' → 'Clicks'");
  assertEqual(extractDirectRouteDestination("Take me to Imaginary Shop"), "Imaginary Shop", "non-existent shop still extracts a candidate (caller's lookup decides)");

  // Vague / product-dependent → null (these must stay on the AI/product flow).
  assertEqual(extractDirectRouteDestination("Take me to the cheapest TV"), null, "'Take me to the cheapest TV' → null");
  assertEqual(extractDirectRouteDestination("Take me to the shop with TVs"), null, "'Take me to the shop with TVs' → null");
  assertEqual(extractDirectRouteDestination("Where can I buy a TV?"), null, "'Where can I buy a TV?' → null");
  assertEqual(extractDirectRouteDestination("Find me the cheapest phone"), null, "'Find me the cheapest phone' → null");
  assertEqual(extractDirectRouteDestination("Find me something for my dad"), null, "'Find me something for my dad' → null");
  assertEqual(extractDirectRouteDestination("I need a TV under R4000"), null, "'I need a TV under R4000' → null (product query)");
  assertEqual(extractDirectRouteDestination("What is the cheapest TV under R4000?"), null, "cheapest TV question → null (product query)");
  assertEqual(extractDirectRouteDestination("I need shoes under R500"), null, "'I need shoes under R500' → null");
  assertEqual(extractDirectRouteDestination(""), null, "empty → null");
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("\nSA23 — deterministic shopping intent extraction for clear product requests");
{
  const di = (s: string) => extractDeterministicShoppingIntent(s);

  // Clear product / budget / cheapest queries → deterministic intent.
  assertEqual(JSON.stringify(di("I need a TV under R4000")),
    JSON.stringify({ productTarget: "tv", budget: 4000, intent: "budget_search", trustPreference: null }),
    "'I need a TV under R4000' → tv/4000/budget_search/null");
  assertEqual(JSON.stringify(di("TV under R4000")),
    JSON.stringify({ productTarget: "tv", budget: 4000, intent: "budget_search", trustPreference: null }),
    "'TV under R4000' → tv/4000/budget_search/null");
  assertEqual(JSON.stringify(di("Show me TVs under R4000")),
    JSON.stringify({ productTarget: "tv", budget: 4000, intent: "budget_search", trustPreference: null }),
    "'Show me TVs under R4000' → tv/4000/budget_search/null (singularised)");
  assertEqual(JSON.stringify(di("What is the cheapest TV under R4000?")),
    JSON.stringify({ productTarget: "tv", budget: 4000, intent: "cheapest_option", trustPreference: null }),
    "'What is the cheapest TV under R4000?' → tv/4000/cheapest_option/null");
  assertEqual(JSON.stringify(di("Show me verified TVs only")),
    JSON.stringify({ productTarget: "tv", budget: null, intent: "product_search", trustPreference: "verified_only" }),
    "'Show me verified TVs only' → tv/null/product_search/verified_only");
  assertEqual(JSON.stringify(di("Where can I buy a TV?")),
    JSON.stringify({ productTarget: "tv", budget: null, intent: "product_search", trustPreference: null }),
    "'Where can I buy a TV?' → tv/null/product_search/null");

  // Vague / mission / no-product requests → null (caller falls back to Gemini).
  assertEqual(di("Find me a gift for my dad"), null, "'Find me a gift for my dad' → null");
  assertEqual(di("I need something nice for my apartment"), null, "'I need something nice for my apartment' → null");
  assertEqual(di("What should I buy?"), null, "'What should I buy?' → null");
  assertEqual(di("Something for my girlfriend"), null, "'Something for my girlfriend' → null");
  assertEqual(di("A present for a child"), null, "'A present for a child' → null");
  assertEqual(di(""), null, "empty string → null");

  // Navigation commands are not shopping intents (handled by the route bypass).
  assertEqual(di("Take me to Game"), null, "'Take me to Game' → null (route, not shopping)");

  // ── Polish (20A.6A): cheapest-no-budget, best, plural, budget phrasings ──
  assertEqual(JSON.stringify(di("cheapest TV")),
    JSON.stringify({ productTarget: "tv", budget: null, intent: "cheapest_option", trustPreference: null }),
    "'cheapest TV' → tv/null/cheapest_option/null (cheapest without a budget)");
  assertEqual(JSON.stringify(di("Best TV under R4000")),
    JSON.stringify({ productTarget: "tv", budget: 4000, intent: "budget_search", trustPreference: null }),
    "'Best TV under R4000' → tv/4000/budget_search ('best TV' is not 'best value/deal/option')");
  assertEqual(JSON.stringify(di("shoes under R500")),
    JSON.stringify({ productTarget: "shoe", budget: 500, intent: "budget_search", trustPreference: null }),
    "'shoes under R500' → shoe/500/budget_search (current convention: trailing-s singularised)");
  assertEqual(JSON.stringify(di("Show me TVs")),
    JSON.stringify({ productTarget: "tv", budget: null, intent: "product_search", trustPreference: null }),
    "'Show me TVs' → tv/null/product_search/null");

  // Budget-phrasing variants (keyword-anchored; spaced amounts tolerated).
  assertEqual(di("TV below R4000")?.budget, 4000, "'TV below R4000' → budget 4000");
  assertEqual(di("TV less than R4000")?.budget, 4000, "'TV less than R4000' → budget 4000");
  assertEqual(di("TV under R 4 000")?.budget, 4000, "'TV under R 4 000' → budget 4000 (spaced amount)");

  // Spatial and generic-noun phrasings → null (not deterministic product search).
  assertEqual(di("nearest TV"), null, "'nearest TV' → null (spatial → Gemini)");
  assertEqual(di("Get me a thing"), null, "'Get me a thing' → null (generic non-product)");
  assertEqual(di("Find me stuff"), null, "'Find me stuff' → null (generic non-product)");
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("\nSA24 — deterministic product candidate filtering (20A.6B, pure)");
{
  // Mock fetched rows (ScoredProduct-shaped subset). No DB: the pure filter is
  // what proves the retrieval contract; the Supabase wrapper just feeds it.
  const rows = [
    { name: 'Hisense 43" FHD LED TV',  price: 3499, trust_state: "verified", data_quality_status: "manually_verified" },
    { name: 'LG 40" FHD Smart TV',     price: 3799, trust_state: "sample",   data_quality_status: "demo" },
    { name: 'Samsung 32" HD Smart TV', price: 2999, trust_state: "sample",   data_quality_status: "demo" },
    { name: 'Sony 65" 4K OLED TV',     price: 8000, trust_state: "sample",   data_quality_status: "demo" },
    { name: "Jacobs Krönung Coffee 200g", price: 129, trust_state: "sample", data_quality_status: "demo" },
    { name: "PEP Canvas Shoes",        price: 159,  trust_state: "sample",   data_quality_status: "demo" },
    { name: 'Defy 50" TV (price TBC)', price: null, trust_state: "sample",   data_quality_status: "demo" },
  ];
  const names = (rs: Array<{ name: string }>) => rs.map((r) => r.name);

  // budget_search: TVs at/under R4000 — excludes over-budget Sony, the unpriced
  // Defy (never assumed affordable), and the non-TV coffee/shoes.
  assertEqual(
    JSON.stringify(names(filterDeterministicCandidates(rows, {
      productTarget: "tv", budget: 4000, trustPreference: null,
    }))),
    JSON.stringify(['Hisense 43" FHD LED TV', 'LG 40" FHD Smart TV', 'Samsung 32" HD Smart TV']),
    "tv/4000/budget_search → 3 affordable TVs (over-budget + unpriced + non-TV excluded)",
  );

  // cheapest_option: same eligible candidate set (incl. the cheapest); the
  // ranker — not retrieval — picks the cheapest later.
  assertEqual(
    filterDeterministicCandidates(rows, { productTarget: "tv", budget: 4000, trustPreference: null }).length,
    3,
    "tv/4000/cheapest_option → cheapest eligible option (Samsung 2999) is among the 3 candidates",
  );

  // verified_only: only the high-confidence Hisense survives.
  assertEqual(
    JSON.stringify(names(filterDeterministicCandidates(rows, {
      productTarget: "tv", budget: null, trustPreference: "verified_only",
    }))),
    JSON.stringify(['Hisense 43" FHD LED TV']),
    "tv/verified_only → only the verified Hisense (demo/sample dropped)",
  );

  // Non-TV product target retrieves its own matches safely.
  assertEqual(
    JSON.stringify(names(filterDeterministicCandidates(rows, {
      productTarget: "shoe", budget: 500, trustPreference: null,
    }))),
    JSON.stringify(["PEP Canvas Shoes"]),
    "shoe/500 → matching shoe candidate ('shoes' name contains 'shoe')",
  );

  // No matches → [] (never fabricate a candidate).
  assertEqual(
    filterDeterministicCandidates(rows, { productTarget: "laptop", budget: null, trustPreference: null }).length,
    0,
    "laptop (none present) → [] (empty, not fabricated)",
  );

  // Unpriced row is excluded under a budget but allowed when no budget is set.
  assertEqual(
    filterDeterministicCandidates(rows, { productTarget: "defy", budget: 4000, trustPreference: null }).length,
    0,
    "unpriced row under a budget → excluded (no fabricated price)",
  );
  assertEqual(
    filterDeterministicCandidates(rows, { productTarget: "defy", budget: null, trustPreference: null }).length,
    1,
    "unpriced row with no budget → retained (price shown via safe trust label later)",
  );

  // Multi-word target needs every token in the name.
  assertEqual(
    JSON.stringify(names(filterDeterministicCandidates(rows, {
      productTarget: "samsung tv", budget: null, trustPreference: null,
    }))),
    JSON.stringify(['Samsung 32" HD Smart TV']),
    "'samsung tv' → only the Samsung TV (all target tokens must match)",
  );

  // Empty / unclear target → [] (conservative).
  assertEqual(
    filterDeterministicCandidates(rows, { productTarget: "", budget: null, trustPreference: null }).length,
    0,
    "empty product target → [] (unclear → retrieve nothing)",
  );
  assertEqual(
    filterDeterministicCandidates(null, { productTarget: "tv", budget: null, trustPreference: null }).length,
    0,
    "null rows → [] (no candidates)",
  );
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("\nSA25 — deterministic shopping answer builder integration (20A.6C, pure)");
{
  // Minimal ScoredProduct-shaped mock rows (only mapper-read fields matter).
  const sp = (over: Record<string, unknown> = {}): any => ({
    product_id: "p", shop_id: "s1", name: 'Generic 40" TV', brand: null,
    shop_name: "Game", floor: "1", unit_number: "L1-10",
    price: 3499, original_price: null, is_on_special: false, discount_pct: null,
    is_open_now: true, is_cheapest: false, score: 10, reason: "",
    price_verified_at: null, data_quality_status: "demo",
    price_verification_method: null, data_source: null, verified_by: null,
    trust_state: null, ...over,
  });
  // Deterministic intent factory (`any` so the harness needn't import the type).
  const di = (intent: string, over: Record<string, unknown> = {}): any =>
    ({ productTarget: "tv", budget: 4000, intent, trustPreference: null, ...over });

  const hisense = sp({ product_id: "hisense", name: 'Hisense 43" FHD LED TV', price: 3499, trust_state: "verified", data_quality_status: "manually_verified" });
  const samsung = sp({ product_id: "samsung", name: 'Samsung 32" HD Smart TV', shop_name: "Incredible", price: 2999, trust_state: "sample", data_quality_status: "demo" });

  // budget_search → verified Hisense best (trust-first), cheaper demo backup.
  {
    const r = assembleDeterministicShoppingAnswer([hisense, samsung], di("budget_search"));
    assertEqual(r.shopping_answer?.bestOption?.productId, "hisense", "budget_search → verified Hisense is best (trust-first)");
    assertEqual(r.shopping_answer?.backupOption?.productId, "samsung", "budget_search → cheaper Samsung is the backup");
    assertEqual(r.message, r.shopping_answer?.shopperMessage ?? null, "message reuses shopperMessage");
    assert(!containsInternalStatus(r.shopping_answer?.shopperMessage ?? ""), "budget_search message has no internal status tokens");
  }

  // cheapest_option → cheapest Samsung best (price-first), verified surfaced as backup/warning.
  {
    const r = assembleDeterministicShoppingAnswer([hisense, samsung], di("cheapest_option"));
    assertEqual(r.shopping_answer?.bestOption?.productId, "samsung", "cheapest_option → cheapest Samsung is best (price-first)");
    const verifiedSurfaced =
      r.shopping_answer?.backupOption?.productId === "hisense" ||
      (r.shopping_answer?.warnings ?? []).length > 0;
    assert(verifiedSurfaced, "cheapest_option → verified Hisense surfaced as backup or a warning is shown");
    assert(!containsInternalStatus(r.shopping_answer?.shopperMessage ?? ""), "cheapest_option message has no internal status tokens");
  }

  // verified_only → only the verified row is considered (retrieval pre-filters upstream; SA24).
  {
    const r = assembleDeterministicShoppingAnswer([hisense], di("product_search", { trustPreference: "verified_only", budget: null }));
    assertEqual(r.products.length, 1, "verified_only → single verified candidate considered");
    assertEqual(r.shopping_answer?.bestOption?.productId, "hisense", "verified_only → verified Hisense is best");
    assertEqual(r.shopping_answer?.bestOption?.confidenceBand, "high", "verified_only → best option is high-confidence");
  }

  // No candidates → null answer + null message (NOT the "I couldn't find…" path).
  {
    const r = assembleDeterministicShoppingAnswer([], di("budget_search"));
    assertEqual(r.shopping_answer, null, "no candidates → shopping_answer null");
    assertEqual(r.message, null, "no candidates → message null (no fabricated 'couldn't find')");
    assertEqual(r.products.length, 0, "no candidates → empty products");
  }

  // Missing price → never fabricate a rand amount.
  {
    const r = assembleDeterministicShoppingAnswer(
      [sp({ product_id: "noprice", name: 'Defy 50" TV', price: null, trust_state: "sample", data_quality_status: "demo" })],
      di("product_search", { budget: null }),
    );
    assertEqual(r.shopping_answer?.bestOption?.price ?? null, null, "missing price → option price stays null");
    assert(!/R\s?\d/.test(r.shopping_answer?.shopperMessage ?? ""), "missing price → no rand amount fabricated in message");
  }

  // Internal statuses never leak into the shopper-facing message.
  {
    const r = assembleDeterministicShoppingAnswer(
      [sp({ product_id: "nr", name: 'LG 40" TV', price: 2999, trust_state: "needs_review", data_quality_status: "needs_review" })],
      di("product_search", { budget: null }),
    );
    assert(!containsInternalStatus(r.shopping_answer?.shopperMessage ?? ""), "needs_review candidate → no internal status leak in shopperMessage");
  }
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("\nSA26 — deterministic shopping bypass wiring contract (20A.6D, pure)");
{
  const sp = (over: Record<string, unknown> = {}): any => ({
    product_id: "p", shop_id: "s1", name: 'Generic 40" TV', brand: null,
    shop_name: "Game", floor: "1", unit_number: "L1-10",
    price: 3499, original_price: null, is_on_special: false, discount_pct: null,
    is_open_now: true, is_cheapest: false, score: 10, reason: "",
    price_verified_at: null, data_quality_status: "demo",
    price_verification_method: null, data_source: null, verified_by: null,
    trust_state: null, ...over,
  });
  const hisense = sp({ product_id: "hisense", name: 'Hisense 43" FHD LED TV', price: 3499, trust_state: "verified", data_quality_status: "manually_verified" });
  const samsung = sp({ product_id: "samsung", name: 'Samsung 32" HD Smart TV', shop_name: "Incredible", price: 2999, trust_state: "sample", data_quality_status: "demo" });

  // Mirrors the geminiService preflight EXACTLY: extract deterministic intent →
  // (if present) assemble from candidates → bypass Gemini ONLY when a non-null
  // shopping_answer results. Live buildDeterministicShoppingAnswer = DB fetch +
  // this assemble; here the fetch is stubbed by mock candidates (the real fetch
  // is covered by 20A.6F live smoke).
  const simulateBypass = (text: string, candidates: any[]): any => {
    const intent = extractDeterministicShoppingIntent(text);
    if (!intent) return { bypass: false, reason: "no-intent", result: null };
    const a = assembleDeterministicShoppingAnswer(candidates, intent);
    if (!a.shopping_answer) return { bypass: false, reason: "no-candidates", result: a };
    return {
      bypass: true,
      reason: "answered",
      result: {
        message: a.message ?? a.shopping_answer.shopperMessage,
        products: a.products,
        build_route: false,
        route_steps: [],
        route_id: null,
        route_shop_ids: [],
        route_summary: "",
        shopping_answer: a.shopping_answer,
      },
    };
  };

  // Clear product query with candidates → bypass Gemini, return shopping_answer.
  {
    const b = simulateBypass("I need a TV under R4000", [hisense, samsung]);
    assertEqual(b.bypass, true, "'I need a TV under R4000' + candidates → bypass Gemini");
    assert(b.result?.shopping_answer != null, "bypass returns a non-null shopping_answer");
    assertEqual(b.result?.build_route, false, "deterministic shopping response keeps build_route false");
    assertEqual(b.result?.message, b.result?.shopping_answer?.shopperMessage, "message equals shopperMessage");
    assertEqual(b.result?.shopping_answer?.bestOption?.productId, "hisense", "budget_search stays trust-first (verified Hisense)");
    assert(!containsInternalStatus(b.result?.shopping_answer?.shopperMessage ?? ""), "no internal status tokens leak in bypass message");
  }

  // Cheapest intent → price-first best + verified backup/warning, still bypass.
  {
    const b = simulateBypass("What is the cheapest TV under R4000?", [hisense, samsung]);
    assertEqual(b.bypass, true, "'cheapest TV under R4000' + candidates → bypass");
    assertEqual(b.result?.shopping_answer?.bestOption?.productId, "samsung", "cheapest stays price-first (Samsung)");
    const verifiedSurfaced =
      b.result?.shopping_answer?.backupOption?.productId === "hisense" ||
      (b.result?.shopping_answer?.warnings ?? []).length > 0;
    assert(verifiedSurfaced, "cheapest surfaces verified Hisense as backup or a warning");
  }

  // Clear intent but NO candidates → null answer → fall through to Gemini.
  {
    const b = simulateBypass("I need a TV under R4000", []);
    assertEqual(b.bypass, false, "clear intent + no candidates → no bypass (fall through)");
    assertEqual(b.reason, "no-candidates", "fall-through reason is no-candidates");
    assertEqual(b.result?.shopping_answer ?? null, null, "no fabricated answer when no candidates");
  }

  // Route phrases are NOT shopping intents → fall through (route bypass / Gemini).
  for (const phrase of ["Take me to Game", "Where is Game?", "Directions to Game", "Navigate to Game", "Take me to the cheapest TV", "nearest TV"]) {
    const b = simulateBypass(phrase, [hisense, samsung]);
    assertEqual(b.bypass, false, `'${phrase}' → not a deterministic shopping bypass`);
    assertEqual(b.reason, "no-intent", `'${phrase}' → excluded from deterministic shopping intent`);
  }

  // Mission / vague queries → fall through to Gemini.
  for (const phrase of ["Find me a gift for my dad", "I need something nice for my apartment", "What should I buy?", "Something for my girlfriend"]) {
    const b = simulateBypass(phrase, [hisense, samsung]);
    assertEqual(b.bypass, false, `'${phrase}' → not a deterministic shopping bypass (→ Gemini)`);
    assertEqual(b.reason, "no-intent", `'${phrase}' → vague/mission excluded`);
  }
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
