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

// eslint-disable-next-line @typescript-eslint/no-require-imports
const {
  evaluateObservationVerification,
  computeProjectedValidUntil,
  buildUserCorrectionObservationDraft,
  assessSourceEligibility,
  METHOD_POLICY,
  methodMinConfidence,
  methodValidityDays,
  RECOGNISED_OBSERVATION_METHODS,
  SNAPSHOT_REQUIRED_METHODS,
  ONLINE_ONLY_METHODS,
  VERIFY_CAPABLE_METHODS,
} = require("../retailVerificationPolicy") as typeof import("../retailVerificationPolicy");

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { calculatePriceTrust } =
  require("../../priceTrust") as typeof import("../../priceTrust");

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
console.log("\nRC13 — verification policy: evidence-backed eligibility (20A.8A)");
{
  const NOW = "2026-06-21T00:00:00.000Z";
  // A fully eligible approved phone-verification observation (with snapshot).
  const obs = (over: Record<string, unknown> = {}): any => ({
    id: "obs-1", mall_id: "mall-1", shop_id: "shop-1", product_id: "prod-1",
    product_name: 'Hisense 43" FHD LED TV', price: 3499,
    observed_at: "2026-06-20T00:00:00.000Z", valid_to: "2026-07-01T00:00:00.000Z",
    trust_state: "verified", verification_method: "phone", confidence: 0.9,
    review_status: "approved", published_product_id: null, published_at: null,
    retail_data_sources: { id: "src-1", source_type: "manual", legal_status: "manual_fact_entry", is_active: true },
    retail_source_snapshots: { id: "snap-1" },
    ...over,
  });
  const ev = (over: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) =>
    evaluateObservationVerification({ observation: obs(over), nowIso: NOW, ...extra } as any);

  // 1. Approved phone-verification + snapshot → eligible.
  {
    const d = ev();
    assert(d.eligible === true, "1) approved phone-verification + snapshot → eligible");
    assertEqual(d.projectedQuality, "manually_verified", "1) projects manually_verified");
    assert(d.projectedVerifiedAt === NOW, "1) projectedVerifiedAt is now");
    assert(d.projectedValidUntil === "2026-07-01T00:00:00.000Z", "1) projectedValidUntil = observation valid_to");
  }

  // 2. Approved store-visit + snapshot → eligible.
  {
    const d = ev({ verification_method: "store_visit", confidence: 0.7 });
    assert(d.eligible === true, "2) approved store-visit + snapshot → eligible");
  }

  // 3. CSV/manual bootstrap without upgraded evidence → refused.
  {
    const d = ev({ trust_state: "manual_fact_entry", verification_method: "csv_manual", retail_source_snapshots: null });
    assert(d.eligible === false, "3) manual/csv bootstrap → refused");
    assertEqual(d.projectedQuality, "needs_review", "3) projects needs_review, not verified");
    assert(d.blockers.some((b: string) => /insufficient for a verified projection/i.test(b)), "3) blocker explains insufficient evidence");
  }

  // 4. User-memory correction cannot create verified trust.
  {
    const draft = buildUserCorrectionObservationDraft("user_memory");
    assertEqual(draft.trust_state, "user_submitted", "4) user-memory draft is user_submitted");
    assert(draft.confidence < 0.6, "4) user-memory draft confidence is low (non-verifying)");
    const d = ev({ trust_state: draft.trust_state, verification_method: draft.verification_method, confidence: draft.confidence, retail_source_snapshots: null });
    assert(d.eligible === false, "4) user-submitted observation → refused (never verified)");
  }

  // 5. Missing snapshot where the method requires it → refused.
  {
    const d = ev({ retail_source_snapshots: null });
    assert(d.eligible === false, "5) phone without snapshot → refused");
    assert(d.blockers.some((b: string) => /requires an evidence snapshot/i.test(b)), "5) blocker names missing snapshot");
  }

  // 6. Expired valid_to cannot produce fresh verified trust.
  {
    const d = ev({ valid_to: "2026-06-01T00:00:00.000Z" });
    assert(d.eligible === false, "6) expired valid_to → refused");
    assert(d.blockers.some((b: string) => /validity window has already expired/i.test(b)), "6) blocker names expiry");
  }

  // 7. Ambiguous product match → refused.
  {
    const d = ev({}, { match: { strategy: "ambiguous", product: null, candidates: [{}, {}], reason: "x" } });
    assert(d.eligible === false, "7) ambiguous match → refused");
    assert(d.blockers.some((b: string) => /ambiguous product match/i.test(b)), "7) blocker names ambiguity");
  }

  // 8. Unapproved observation → refused.
  {
    const d = ev({ review_status: "pending" });
    assert(d.eligible === false, "8) unapproved (pending) → refused");
    assert(d.blockers.some((b: string) => /not 'approved'/i.test(b)), "8) blocker names approval");
  }

  // 9. Already-published observation → refused (idempotent safety at policy layer).
  {
    const d = ev({ published_product_id: "prod-1" });
    assert(d.eligible === false, "9) already-published → refused");
    assert(d.blockers.some((b: string) => /already published/i.test(b)), "9) blocker names prior publication");
  }

  // 10. Product/observation mall mismatch → refused.
  {
    const d = ev({}, { product: { id: "prod-1", mall_id: "mall-2", shop_id: "shop-1" } });
    assert(d.eligible === false, "10) mall mismatch → refused");
    assert(d.blockers.some((b: string) => /mall_id does not match/i.test(b)), "10) blocker names mall mismatch");
  }

  // 11. On any failure, nothing is projected (publish/observation stay consistent).
  {
    const d = ev({ review_status: "pending" });
    assert(d.eligible === false && d.projectedVerifiedAt === null && d.projectedValidUntil === null,
      "11) ineligible decision projects nothing (no partial publish)");
  }

  // Validity priority: explicit valid_to wins; else method policy from observed_at.
  assertEqual(
    computeProjectedValidUntil("2026-07-01T00:00:00.000Z", "phone", "2026-06-20T00:00:00.000Z", NOW),
    "2026-07-01T00:00:00.000Z", "explicit valid_to wins");
  assertEqual(
    computeProjectedValidUntil(null, "website", "2026-06-20T00:00:00.000Z", NOW),
    "2026-06-27T00:00:00.000Z", "website → observed_at + 7d method policy");
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("\nRC14 — source-aware freshness: shopper trust degrades after expiry (20A.8D)");
{
  // 12a. Source-aware: expired price_valid_until → expired/medium, even if recently verified.
  const expired = calculatePriceTrust({
    data_quality_status: "manually_verified",
    price_verified_at: "2026-06-20T00:00:00.000Z",
    price_valid_until: "2026-06-20T12:00:00.000Z", // already past relative to test run
  });
  assert(expired.is_price_expired === true, "12a) past price_valid_until → expired");
  assertEqual(expired.trust_state, "expired", "12a) trust_state degrades to expired");
  assertEqual(expired.trust_level, "medium", "12a) trust_level degrades to medium (not high)");
  assert(expired.display_warning != null, "12a) expired shows an honest caution");

  // 12b. Source-aware: future price_valid_until → still verified/high.
  const fresh = calculatePriceTrust({
    data_quality_status: "manually_verified",
    price_verified_at: "2020-01-01T00:00:00.000Z", // old, but…
    price_valid_until: "2999-01-01T00:00:00.000Z", // …valid horizon overrides legacy age
  });
  assert(fresh.is_price_expired === false, "12b) future price_valid_until keeps it fresh");
  assertEqual(fresh.trust_state, "verified", "12b) trust_state stays verified");
  assertEqual(fresh.trust_level, "high", "12b) trust_level stays high");

  // 12c. Backwards compatibility: no price_valid_until → legacy 7-day fallback.
  const legacyOld = calculatePriceTrust({
    data_quality_status: "manually_verified",
    price_verified_at: "2000-01-01T00:00:00.000Z", // far older than 7 days
  });
  assert(legacyOld.is_price_expired === true, "12c) no valid_until + old verified_at → legacy expiry");

  const legacyFresh = calculatePriceTrust({
    data_quality_status: "manually_verified",
    price_verified_at: new Date(Date.now() - 86_400_000).toISOString(), // 1 day ago
  });
  assert(legacyFresh.is_price_expired === false, "12c) no valid_until + recent verified_at → still verified (compat)");
  assertEqual(legacyFresh.trust_state, "verified", "12c) recent verified stays verified");
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("\nRC15 — canonical verification-policy matrix parity (20A.8 hardening)");
{
  // The documented canonical values (must match METHOD_POLICY and the SQL RPC).
  // [snapshotRequired, minConfidence, validityDays, canVerify, online]
  const EXPECTED: Record<string, [boolean, number, number, boolean, boolean]> = {
    store_visit:           [true,  0.6,  14, true,  false],
    receipt:               [true,  0.6,  14, true,  false],
    retailer_confirmation: [true,  0.6,  14, true,  false],
    phone:                 [true,  0.65, 14, true,  false],
    flyer:                 [true,  0.65, 7,  true,  false],
    website:               [true,  0.7,  7,  true,  true ],
    affiliate_feed:        [false, 0.7,  2,  true,  true ],
    partner_feed:          [false, 0.7,  2,  true,  true ],
    csv_manual:            [false, 0.6,  7,  false, false],
    user_submission:       [false, 0.6,  7,  false, false],
  };
  const keys = Object.keys(EXPECTED);
  assertEqual(Object.keys(METHOD_POLICY).length, keys.length, "matrix has exactly the documented methods");
  for (const m of keys) {
    const p = (METHOD_POLICY as Record<string, any>)[m];
    const [sr, mc, vd, cv, on] = EXPECTED[m];
    assert(!!p && p.snapshotRequired === sr, `${m}: snapshotRequired = ${sr}`);
    assertEqual(p.minConfidence, mc, `${m}: minConfidence`);
    assertEqual(p.validityDays, vd, `${m}: validityDays`);
    assert(p.canVerify === cv, `${m}: canVerify = ${cv}`);
    assert(p.online === on, `${m}: online = ${on}`);
    assertEqual(methodMinConfidence(m), mc, `${m}: methodMinConfidence helper agrees`);
    assertEqual(methodValidityDays(m), vd, `${m}: methodValidityDays helper agrees`);
  }
  assert(SNAPSHOT_REQUIRED_METHODS.has("phone") && !SNAPSHOT_REQUIRED_METHODS.has("affiliate_feed"), "snapshot set derived from matrix");
  assert(ONLINE_ONLY_METHODS.has("website") && !ONLINE_ONLY_METHODS.has("phone"), "online set derived from matrix");
  assert(VERIFY_CAPABLE_METHODS.has("phone") && !VERIFY_CAPABLE_METHODS.has("csv_manual"), "verify-capable set derived from matrix");
  assert(RECOGNISED_OBSERVATION_METHODS.has("csv_manual") && RECOGNISED_OBSERVATION_METHODS.size === keys.length, "recognised set derived from matrix");
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("\nRC16 — source eligibility + verify-capability guard (20A.8 hardening)");
{
  assert(assessSourceEligibility(null).found === false, "null source → not found");
  assert(assessSourceEligibility({} as never).found === false, "id-less source → not found");
  const ok = assessSourceEligibility({ id: "s", is_active: true, legal_status: "manual_fact_entry" } as never);
  assert(ok.found && ok.active && ok.legallyClear && ok.blockers.length === 0, "active legal source → eligible");
  const inactive = assessSourceEligibility({ id: "s", is_active: false, legal_status: "manual_fact_entry" } as never);
  assert(inactive.found && !inactive.active && inactive.blockers.some((b: string) => /inactive/i.test(b)), "inactive source → blocked");
  const illegal = assessSourceEligibility({ id: "s", is_active: true, legal_status: "needs_legal_review" } as never);
  assert(illegal.found && !illegal.legallyClear && illegal.blockers.some((b: string) => /not eligible/i.test(b)), "needs_legal_review → blocked");

  // canVerify gate: csv_manual claiming trust_state 'verified' is STILL refused.
  const d = evaluateObservationVerification({
    observation: {
      id: "o", mall_id: "m", shop_id: "s", product_id: "p", product_name: "TV", price: 100,
      observed_at: "2026-06-20T00:00:00.000Z", valid_to: "2026-07-01T00:00:00.000Z",
      trust_state: "verified", verification_method: "csv_manual", confidence: 0.99,
      review_status: "approved",
      retail_data_sources: { id: "src", is_active: true, legal_status: "manual_fact_entry" },
    } as never,
    nowIso: "2026-06-21T00:00:00.000Z",
  });
  assert(d.eligible === false, "csv_manual + trust_state 'verified' → still refused (canVerify gate)");
  assert(d.blockers.some((b: string) => /never produce a verified price/i.test(b)), "canVerify blocker present");
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("\nRC17 — freshness edge cases, deterministic injectable time (20A.8D hardening)");
{
  const NOW = Date.parse("2026-06-21T00:00:00.000Z");
  const opt = { nowMs: NOW };
  const mv = (over: Record<string, unknown> = {}) =>
    ({ data_quality_status: "manually_verified", price_verified_at: "2026-06-20T00:00:00.000Z", ...over });

  assert(calculatePriceTrust(mv({ price_valid_until: "2026-06-20T00:00:00.000Z" }), false, false, opt).is_price_expired === true, "valid_until in the past → expired");
  assert(calculatePriceTrust(mv({ price_valid_until: "2026-06-21T00:00:00.000Z" }), false, false, opt).is_price_expired === false, "valid_until exactly at now → not expired (boundary valid)");
  assert(calculatePriceTrust(mv({ price_valid_until: "2026-07-01T00:00:00.000Z" }), false, false, opt).is_price_expired === false, "valid_until in the future → fresh");
  assert(calculatePriceTrust(mv({ price_valid_until: "not-a-date" }), false, false, opt).is_price_expired === false, "malformed valid_until → legacy fallback (recent verified → fresh)");
  assert(calculatePriceTrust(mv({ price_valid_until: "garbage", price_verified_at: "2026-06-01T00:00:00.000Z" }), false, false, opt).is_price_expired === true, "malformed valid_until + old verified_at → legacy expired");
  assert(calculatePriceTrust(mv({ price_verified_at: "2026-06-01T00:00:00.000Z" }), false, false, opt).is_price_expired === true, "no valid_until + old verified_at → legacy expired");
  assert(calculatePriceTrust(mv(), false, false, opt).is_price_expired === false, "no valid_until + recent verified_at → fresh");

  const noVerifiedAt = calculatePriceTrust({ data_quality_status: "manually_verified", price_valid_until: "2026-06-20T00:00:00.000Z" }, false, false, opt);
  assert(noVerifiedAt.is_price_expired === true, "valid_until past + no price_verified_at → expired");
  assert(noVerifiedAt.price_age_days === null, "no price_verified_at → price_age_days null");

  const live = calculatePriceTrust({ data_quality_status: "live_feed", price_verified_at: "2020-01-01T00:00:00.000Z" }, false, false, opt);
  assertEqual(live.trust_state, "live", "live_feed → live");
  assertEqual(live.trust_level, "high", "live_feed → high");
  assert(live.is_price_expired === false, "live_feed not subject to verification expiry window");

  assertEqual(calculatePriceTrust(mv({ price_valid_until: "2026-07-01T00:00:00.000Z" }), true, false, opt).trust_state, "disputed", "pending dispute overrides fresh verification");
  assertEqual(calculatePriceTrust(mv({ price_valid_until: "2026-07-01T00:00:00.000Z" }), false, true, opt).trust_state, "needs_review", "needs-verification flags otherwise-high verification");

  // Expiry degrades trust WITHOUT mutating the product (no DB write).
  const product = mv({ price_valid_until: "2026-06-20T00:00:00.000Z" });
  const before = JSON.stringify(product);
  const r = calculatePriceTrust(product, false, false, opt);
  assertEqual(r.trust_state, "expired", "expired valid_until degrades to expired");
  assert(r.display_warning != null, "expired shows an honest caution");
  assertEqual(JSON.stringify(product), before, "calculatePriceTrust never mutates the product (no DB write)");
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
