import { describe, it, expect } from "vitest";
import { buildSeedDatabase } from "@/lib/ingestion/seed";
import { buildSeedFabric } from "./store";
import {
  getShopperEligibleOffers, buildShopperAnswer, rankEligible, buildShopperOption,
  toGeminiCandidate, buildGeminiCandidates, isVerifiedGrade,
  type ShopperQuery, type RecommendationMode,
} from "./recommendationSpine";
import { buildOfferContext } from "@/lib/ingestion/ranking";
import type { IngestionDatabase, ProductOffer } from "@/lib/ingestion/model";
import type { FabricDatabase } from "./types";

const NOW = Date.parse("2026-07-13T12:00:00.000Z");
const HOUR = 3_600_000, DAY = 24 * HOUR;
const iso = (off: number) => new Date(NOW + off).toISOString();

// A baseline ELIGIBLE offer: approved, published, evidence-backed, fresh, available, no conflict.
function offer(over: Partial<ProductOffer>): ProductOffer {
  return {
    id: "o_elig", productId: "p_hisense43", retailerId: "ret_game", sellerName: null, channel: "in_store",
    currency: "ZAR", currentPrice: 3999, previousPrice: 4499, promotionLabel: null,
    sourceUrl: "https://www.game.co.za/hisense-43a4k", sourceType: "retailer_product_page", sourceObservedAt: iso(-3 * HOUR),
    expiresAt: null, validFrom: null, validUntil: null, availabilityStatus: "inferred", availabilityScope: "retailer_range_observed",
    priceTrustLabel: "recently_observed", snapshotId: null, evidenceText: null, evidenceHash: null, conflictGroupId: null,
    reviewStatus: "approved", published: true, createdAt: iso(-DAY), updatedAt: iso(-HOUR), demonstrationData: true,
    geographicScope: "national", sourceId: "src_game", evidenceIds: ["ev_seed_jsonld_game43"],
    ...over,
  };
}

// A fabric with a non-blocked policy for src_game and the referenced evidence present.
function fabric(): FabricDatabase { return buildSeedFabric(NOW); }
// An ingestion db with only our crafted offers (products/stores/retailers preserved).
function ingestionWith(offers: ProductOffer[]): IngestionDatabase {
  const db = buildSeedDatabase(NOW);
  db.offers = offers;
  return db;
}
const q: ShopperQuery = { mallId: "mall_reds", category: "television", budget: 100000 };

// ── 1. Eligibility gates ─────────────────────────────────────────────────────
describe("shopper eligibility gates", () => {
  const f = fabric();
  const eligIds = (offers: ProductOffer[], query = q, mode: RecommendationMode = "normal") =>
    getShopperEligibleOffers(ingestionWith(offers), f, query, NOW, mode).offers.map((o) => o.id);

  it("includes an approved + published + evidence-backed offer", () => {
    expect(eligIds([offer({})])).toEqual(["o_elig"]);
  });
  it("excludes staged / needs_review / rejected / unpublished offers", () => {
    expect(eligIds([offer({ id: "o", reviewStatus: "staged" })])).toEqual([]);
    expect(eligIds([offer({ id: "o", reviewStatus: "needs_review" })])).toEqual([]);
    expect(eligIds([offer({ id: "o", reviewStatus: "rejected" })])).toEqual([]);
    expect(eligIds([offer({ id: "o", published: false })])).toEqual([]);
  });
  it("excludes evidence-less, expired, unavailable and conflicted offers", () => {
    expect(eligIds([offer({ id: "o", evidenceIds: [] })])).toEqual([]);
    expect(eligIds([offer({ id: "o", validUntil: iso(-DAY) })])).toEqual([]);              // expired
    expect(eligIds([offer({ id: "o", sourceObservedAt: iso(-40 * DAY) })])).toEqual([]);   // stale beyond policy
    expect(eligIds([offer({ id: "o", availabilityStatus: "unavailable" })])).toEqual([]);
    expect(eligIds([offer({ id: "o", conflictGroupId: "grp1" })])).toEqual([]);
  });
  it("excludes a blocked source policy and a missing source reference", () => {
    expect(eligIds([offer({ id: "o", sourceId: "src_login_walled" })])).toEqual([]);       // blocked policy
    expect(eligIds([offer({ id: "o", sourceUrl: "" })])).toEqual([]);                       // missing source
  });
  it("excludes a mall-scoped offer from a retailer not present at the mall (mall mismatch)", () => {
    expect(eligIds([offer({ id: "o", geographicScope: "mall", retailerId: "ret_takealot" })])).toEqual([]);
  });
  it("excludes a branch-scoped offer when the requested store is not that retailer's", () => {
    const branchQuery: ShopperQuery = { ...q, storeId: "store_checkers" };
    expect(eligIds([offer({ id: "o", geographicScope: "branch", retailerId: "ret_game" })], branchQuery)).toEqual([]);
  });
  it("does not mutate evidence or review records", () => {
    const before = JSON.stringify({ e: f.evidence, d: f.decisions });
    getShopperEligibleOffers(ingestionWith([offer({})]), f, q, NOW, "normal");
    expect(JSON.stringify({ e: f.evidence, d: f.decisions })).toBe(before);
  });
});

// ── 2. Diagnostics accuracy ──────────────────────────────────────────────────
describe("exclusion diagnostics", () => {
  it("counts exclusions by category accurately", () => {
    const offers = [
      offer({ id: "ok" }),
      offer({ id: "staged", reviewStatus: "staged" }),
      offer({ id: "noev", evidenceIds: [] }),
      offer({ id: "gone", availabilityStatus: "unavailable" }),
      offer({ id: "conf", conflictGroupId: "g" }),
    ];
    const { diagnostics: d } = getShopperEligibleOffers(ingestionWith(offers), fabric(), q, NOW, "normal");
    expect(d.totalConsidered).toBe(5);
    expect(d.eligible).toBe(1);
    expect(d.excludedByReview).toBeGreaterThanOrEqual(1);
    expect(d.excludedMissingEvidence).toBeGreaterThanOrEqual(1);
    expect(d.excludedUnavailable).toBeGreaterThanOrEqual(1);
    expect(d.excludedConflict).toBeGreaterThanOrEqual(1);
    expect(d.exclusions).toHaveLength(4);
  });
});

// ── 3. Ranking ───────────────────────────────────────────────────────────────
describe("ranking over eligible offers", () => {
  it("cheapest intent picks the cheapest eligible offer, ignoring cheaper ineligible ones", () => {
    const offers = [
      offer({ id: "cheap_ineligible", currentPrice: 999, availabilityStatus: "unavailable" }), // ineligible
      offer({ id: "mid", currentPrice: 3999, productId: "p_hisense43" }),
      offer({ id: "cheapest_eligible", currentPrice: 2999, productId: "p_hisense32", retailerId: "ret_checkers" }),
    ];
    const answer = buildShopperAnswer(ingestionWith(offers), fabric(), { ...q, intent: "cheapest" }, NOW, "normal");
    expect(answer.options[0].offerId).toBe("cheapest_eligible");
    expect(answer.options.map((o) => o.offerId)).not.toContain("cheap_ineligible");
  });
  it("verified-only never widens to unverified data", () => {
    const offers = [offer({ id: "recent", priceTrustLabel: "recently_observed" })]; // eligible but NOT verified_live
    const answer = buildShopperAnswer(ingestionWith(offers), fabric(), { ...q, trustPreference: "verified_only" }, NOW, "normal");
    expect(answer.options).toHaveLength(0);
    expect(answer.headline).toMatch(/No verified/i);
    expect(isVerifiedGrade(offers[0])).toBe(false);
  });
});

// ── 4. Modes ─────────────────────────────────────────────────────────────────
describe("recommendation modes", () => {
  it("normal mode cannot use demo (evidence-less) offers, but curated_demo can, labelled", () => {
    const ingestion = buildSeedDatabase(NOW); // full curated seed, mostly evidence-less
    const f = fabric();
    const normal = buildShopperAnswer(ingestion, f, q, NOW, "normal");
    const demo = buildShopperAnswer(ingestion, f, q, NOW, "curated_demo");
    // A purely-seed evidence-less offer is excluded in normal, present in demo.
    expect(normal.options.some((o) => o.offerId === "offer_pnp_tcl43")).toBe(false);
    expect(demo.options.some((o) => o.offerId === "offer_pnp_tcl43")).toBe(true);
    expect(demo.disclosure).toMatch(/Curated demonstration data/);
    expect(normal.disclosure).toMatch(/governed/);
  });
});

// ── 5. Scope, route + shopper contract ───────────────────────────────────────
describe("mall/store scope + shopper contract", () => {
  const ingestion = ingestionWith([]);
  it("labels online-only offers and never claims branch stock from retailer presence", () => {
    const o = offer({ id: "o", geographicScope: "online_only", retailerId: "ret_game" });
    const ctx = buildOfferContext(o, "mall_reds", ingestionWith([o]), NOW)!;
    const opt = buildShopperOption(ctx, ingestionWith([o]), NOW);
    expect(opt.scopeStatement).toMatch(/Online-only/);
    expect(opt.branchStock).toBe("not_confirmed"); // presence != branch stock
  });
  it("offers a route action only when a store exists at the mall", () => {
    const present = offer({ id: "p", geographicScope: "national", retailerId: "ret_game" }); // Game has a store at mall_reds
    const online = offer({ id: "o", geographicScope: "online_only", retailerId: "ret_takealot" }); // no store at mall
    const optPresent = buildShopperOption(buildOfferContext(present, "mall_reds", ingestion, NOW)!, ingestion, NOW);
    const optOnline = buildShopperOption(buildOfferContext(online, "mall_reds", ingestion, NOW)!, ingestion, NOW);
    expect(optPresent.routeAction).not.toBeNull();
    expect(optOnline.routeAction).toBeNull();
  });
  it("shopper-facing text contains no internal enum/status tokens", () => {
    const o = offer({ id: "o" });
    const opt = buildShopperOption(buildOfferContext(o, "mall_reds", ingestionWith([o]), NOW)!, ingestionWith([o]), NOW);
    const text = [opt.trustLabel, opt.freshnessStatement, opt.scopeStatement, opt.availabilityStatement, opt.explanation, opt.sourceType].join(" | ");
    expect(text).not.toMatch(/recently_observed|known_available|conflict_detected|needs_review|retailer_product_page|online_only/);
  });
});

// ── 6. Gemini / tool candidate sanitization ──────────────────────────────────
describe("Gemini candidate sanitization", () => {
  it("exposes only safe fields and no internal tokens/blockers/notes", () => {
    const answer = buildShopperAnswer(ingestionWith([offer({})]), fabric(), q, NOW, "normal");
    const cands = buildGeminiCandidates(answer);
    expect(cands).toHaveLength(1);
    const keys = Object.keys(cands[0]).sort();
    expect(keys).toEqual(["availability", "branchStock", "currency", "expiry", "freshness", "observed", "originalPrice", "price", "productTitle", "retailer", "routeStoreId", "scope", "store", "trust"].sort());
    const blob = JSON.stringify(cands[0]);
    expect(blob).not.toMatch(/blocker|reason|reviewerNotes|legalRisk|evidenceId|conflict_detected|not_approved|_blocked/);
  });
  it("deterministic fallback uses exactly the same eligible candidate set", () => {
    const ingestion = ingestionWith([offer({ id: "a" }), offer({ id: "b", productId: "p_hisense32", currentPrice: 2999, retailerId: "ret_checkers" })]);
    const f = fabric();
    const eligible = getShopperEligibleOffers(ingestion, f, q, NOW, "normal").offers.map((o) => o.id).sort();
    const answerIds = buildShopperAnswer(ingestion, f, q, NOW, "normal").options.map((o) => o.offerId).sort();
    // The (Gemini-failure) deterministic answer draws ONLY from the eligible set.
    expect(answerIds.every((id) => eligible.includes(id))).toBe(true);
    expect(toGeminiCandidate(buildShopperAnswer(ingestion, f, q, NOW, "normal").options[0]).currency).toBe("ZAR");
  });
});

// ── 7. Full governed flow over the seed (with a bridge-approved offer) ────────
describe("governed flow over the seed", () => {
  it("normal mode returns only evidence-backed eligible seed offers (excludes conflict/unavailable)", () => {
    const ingestion = buildSeedDatabase(NOW);
    const f = fabric();
    const { offers } = getShopperEligibleOffers(ingestion, f, q, NOW, "normal");
    const ids = offers.map((o) => o.id);
    expect(ids).toContain("offer_checkers_hisense32"); // provenance-linked evidence, not conflicted
    expect(ids).not.toContain("offer_game_hisense43");  // conflictGroupId set
    expect(ids).not.toContain("offer_edgars_tcl32");    // unavailable + no evidence
  });
});
