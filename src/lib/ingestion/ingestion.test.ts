import { describe, it, expect } from "vitest";
import { buildSeedDatabase } from "./seed";
import { previewOffersCsv, parseCsv, templateCsvString, previewProductsCsv } from "./csv";
import { validateOffer, validateProduct, hasBranchStockEvidence } from "./validation";
import { computeEffectiveFreshness } from "./freshness";
import { rankOffers, storeConfirmedAtMall, buildOfferContext } from "./ranking";
import { buildTvUnderBudgetAnswer } from "./recommend";
import { trustMeta, availabilityMeta } from "./labels";
import { addOffer, decideOfferReview, commitOfferCsv, computeOverview } from "./store";
import type { ProductOffer } from "./model";

const NOW = Date.parse("2026-07-13T12:00:00.000Z");
const NOW_ISO = new Date(NOW).toISOString();
const db = () => buildSeedDatabase(NOW);

const offer = (over: Partial<ProductOffer>): ProductOffer => ({
  id: "o_test", productId: "p_hisense43", retailerId: "ret_game", sellerName: null, channel: "in_store",
  currency: "ZAR", currentPrice: 3999, previousPrice: null, promotionLabel: null,
  sourceUrl: "https://www.game.co.za/x", sourceType: "retailer_product_page", sourceObservedAt: NOW_ISO,
  validFrom: null, validUntil: null, availabilityScope: "retailer_range_observed", priceTrustLabel: "recently_observed",
  reviewStatus: "approved", published: true, createdAt: NOW_ISO, updatedAt: NOW_ISO, demonstrationData: true, ...over,
});

// 1. CSV validation
describe("1. CSV validation", () => {
  it("accepts a well-formed offer row and flags a bad one", () => {
    const csv = templateCsvString("offers");
    const { rows } = parseCsv(csv + "BADMODEL,nope,,online,ZAR,-5,,,,not-a-url,retailer_product_page,,availability_unknown,recently_observed\n");
    const preview = previewOffersCsv(rows, db(), NOW_ISO);
    expect(preview.totalRows).toBe(2);
    const bad = preview.results.find((r) => r.raw.productModelNumber === "BADMODEL")!;
    expect(bad.status).toBe("rejected");
    expect(bad.issues.some((i) => i.code === "missing_product")).toBe(true);
  });
});

// 2 + 3. product normalisation + duplicate model detection
describe("2/3. product normalisation & duplicate model detection", () => {
  it("flags a duplicate model number", () => {
    const base = db();
    const preview = previewProductsCsv([{ canonicalName: "Hisense clone", brand: "Hisense", modelNumber: "43A4K", category: "television", descriptionSummary: "dup" }], base, NOW_ISO);
    expect(preview.results[0].issues.some((i) => i.code === "duplicate_model_number")).toBe(true);
    const issues = validateProduct({ id: "p_new", canonicalName: "x", brand: "b", modelNumber: "43A4K", category: "television", descriptionSummary: "", normalizationStatus: "pending" }, base);
    expect(issues.some((i) => i.code === "duplicate_model_number")).toBe(true);
  });
});

// 4. offer ingestion
describe("4. offer ingestion", () => {
  it("commits accepted CSV offers and records an ingestion run", () => {
    const base = db();
    const preview = previewOffersCsv(parseCsv(templateCsvString("offers")).rows, base, NOW_ISO);
    const accepted = preview.results.filter((r) => r.status !== "rejected").map((r) => r.entity!).filter(Boolean);
    const { db: next, run } = commitOfferCsv(base, accepted, [], { filename: "t.csv", initiatedBy: "admin", totalRows: preview.totalRows, rejectedRows: preview.rejectedRows }, NOW_ISO);
    expect(next.offers.length).toBe(base.offers.length + accepted.length);
    expect(run.sourceType).toBe("csv_import");
    expect(run.acceptedRows).toBe(accepted.length);
  });
});

// 5. stale-price calculation
describe("5. stale-price calculation", () => {
  it("marks a 30h-old recently_observed electronics offer as stale", () => {
    const f = computeEffectiveFreshness(offer({ sourceObservedAt: new Date(NOW - 30 * 3.6e6).toISOString() }), NOW);
    expect(f.state).toBe("stale");
    expect(f.effectiveTrustLabel).toBe("stale");
    expect(f.originalTrustLabel).toBe("recently_observed"); // original preserved
  });
});

// 6. catalogue expiry
describe("6. catalogue expiry", () => {
  it("expires a catalogue special past its valid-until date", () => {
    const f = computeEffectiveFreshness(offer({ priceTrustLabel: "catalogue_special", validUntil: new Date(NOW - 3.6e6).toISOString() }), NOW);
    expect(f.state).toBe("expired");
    expect(f.expired).toBe(true);
  });
});

// 7. branch-stock evidence rule
describe("7. branch-stock evidence rule", () => {
  it("rejects a branch_stock_confirmed claim without branch evidence, accepts it with evidence", () => {
    const base = db();
    const noEvidence = validateOffer(offer({ id: "o_noev", availabilityScope: "branch_stock_confirmed" }), base, NOW);
    expect(noEvidence.some((i) => i.code === "branch_stock_without_evidence")).toBe(true);
    // Seed's skyworth offer has a phone-confirmation observation.
    expect(hasBranchStockEvidence("offer_game_skyworth40", base)).toBe(true);
    const seeded = validateOffer(base.offers.find((o) => o.id === "offer_game_skyworth40")!, base, NOW);
    expect(seeded.some((i) => i.code === "branch_stock_without_evidence")).toBe(false);
  });
});

// 8. physical-store matching
describe("8. physical-store matching", () => {
  it("matches physically-present retailers and not online-only ones", () => {
    const base = db();
    expect(storeConfirmedAtMall("ret_game", "mall_reds", base)).toBe(true);
    expect(storeConfirmedAtMall("ret_takealot", "mall_reds", base)).toBe(false);
  });
});

// 9. online-only comparison separation
describe("9. online-only comparison separation", () => {
  it("separates marketplace/online offers from in-mall offers", () => {
    const ranked = rankOffers(db(), { mallId: "mall_reds", maxPrice: 4000, category: "television" }, NOW);
    const primaryIds = ranked.primary.map((c) => c.retailer.id);
    const onlineIds = ranked.onlineComparisons.map((c) => c.retailer.id);
    expect(onlineIds).toContain("ret_takealot");
    expect(primaryIds).not.toContain("ret_takealot");
    expect(primaryIds).toContain("ret_game");
  });
});

// 10. recommendation ranking
describe("10. recommendation ranking", () => {
  it("does not let a stale cheaper offer outrank fresh comparable offers", () => {
    const ranked = rankOffers(db(), { mallId: "mall_reds", maxPrice: 4000, category: "television" }, NOW);
    const ids = ranked.primary.map((c) => c.offer.id);
    const staleIdx = ids.indexOf("offer_pnp_hisense40"); // 3299 but 30h → stale
    const freshIdx = ids.indexOf("offer_pnp_tcl43");      // 3799 fresh
    expect(staleIdx).toBeGreaterThan(-1);
    expect(freshIdx).toBeGreaterThan(-1);
    expect(freshIdx).toBeLessThan(staleIdx); // fresh (more expensive) outranks stale (cheaper)
  });
  it("ranks branch-stock-confirmed above equal-trust non-confirmed", () => {
    const ranked = rankOffers(db(), { mallId: "mall_reds", maxPrice: 4000, category: "television" }, NOW);
    expect(ranked.primary[0].offer.id).toBe("offer_game_skyworth40"); // branch confirmed, fresh
  });
});

// 11. trust-label rendering
describe("11. trust-label rendering", () => {
  it("renders exact user-facing trust and availability labels", () => {
    expect(trustMeta("recently_observed").label).toBe("Recently observed");
    expect(trustMeta("stale").label).toBe("Stale — needs verification");
    expect(availabilityMeta("branch_stock_confirmed").label).toBe("Branch stock confirmed");
    expect(availabilityMeta("inferred_not_confirmed").label).toBe("Inferred — not confirmed");
  });
});

// 12. review approval and rejection
describe("12. review approval and rejection", () => {
  it("publishes on approval and unpublishes on rejection", () => {
    const base = db();
    const approved = decideOfferReview(base, "offer_user_hisense43", "approved", "admin", "ok", NOW_ISO);
    const a = approved.offers.find((o) => o.id === "offer_user_hisense43")!;
    expect(a.published).toBe(true);
    expect(a.reviewStatus).toBe("approved");
    const rejected = decideOfferReview(base, "offer_user_hisense43", "rejected", "admin", "no", NOW_ISO);
    const r = rejected.offers.find((o) => o.id === "offer_user_hisense43")!;
    expect(r.published).toBe(false);
    expect(r.reviewStatus).toBe("rejected");
  });
});

// 13. source-evidence linkage
describe("13. source-evidence linkage", () => {
  it("links a published offer to a stored source snapshot", () => {
    const base = db();
    const snap = base.snapshots.find((s) => (s.evidenceMetadata as { offerId?: string }).offerId === "offer_game_hisense43");
    expect(snap).toBeTruthy();
    expect(snap!.sourceUrl).toBe(base.offers.find((o) => o.id === "offer_game_hisense43")!.sourceUrl);
    expect(snap!.status).toBe("parsed");
  });
});

// 14. malformed record rejection
describe("14. malformed record rejection", () => {
  it("rejects a manual offer with a malformed URL and negative price", () => {
    const base = db();
    const { issues } = addOffer(base, {
      productId: "p_hisense43", retailerId: "ret_game", channel: "in_store", currency: "ZAR",
      currentPrice: -10, sourceUrl: "not a url", sourceType: "manual_admin", sourceObservedAt: NOW_ISO,
      availabilityScope: "availability_unknown", priceTrustLabel: "manual_admin", branchEvidencePresent: false,
    }, NOW_ISO);
    expect(issues.some((i) => i.code === "malformed_url")).toBe(true);
    expect(issues.some((i) => i.code === "negative_price")).toBe(true);
  });
});

// 15. assistant result for TV under R4000
describe("15. assistant — TV under R4000 at Mall@Reds", () => {
  const answer = buildTvUnderBudgetAnswer(db(), { mallId: "mall_reds", maxPrice: 4000, nowMs: NOW });

  it("returns in-mall recommendations under budget", () => {
    expect(answer.headline).toBe("Recommended at Mall@Reds");
    expect(answer.primary.length).toBeGreaterThan(0);
    expect(answer.primary.every((o) => o.price <= 4000)).toBe(true);
  });
  it("never claims branch stock without evidence", () => {
    for (const o of answer.primary) {
      if (o.branchStock === "confirmed") {
        expect(hasBranchStockEvidence(o.offerId, db())).toBe(true);
      }
    }
    // Only the evidence-backed Skyworth offer claims branch stock.
    const confirmed = answer.primary.filter((o) => o.branchStock === "confirmed").map((o) => o.offerId);
    expect(confirmed).toEqual(["offer_game_skyworth40"]);
  });
  it("shows online comparisons separately with seller context", () => {
    expect(answer.onlineComparisons.length).toBeGreaterThan(0);
    const takealot = answer.onlineComparisons.find((o) => o.retailerName === "Takealot")!;
    expect(takealot.channel).toBe("marketplace");
    expect(takealot.sellerName).toBe("TechDeals SA");
    expect(takealot.storeAtMall).toBe("not_a_store");
  });
  it("is generated from the model and honestly labelled", () => {
    expect(answer.generatedFromModel).toBe(true);
    expect(answer.disclosure).toMatch(/curated demonstration data|not live/i);
  });
});

// Overview sanity (dashboard)
describe("overview", () => {
  it("computes dashboard counters", () => {
    const o = computeOverview(db(), NOW);
    expect(o.totalMalls).toBe(1);
    expect(o.totalProducts).toBe(9);
    expect(o.totalActiveOffers).toBeGreaterThan(0);
    expect(o.offersNeedingReview).toBeGreaterThan(0);
    expect(o.staleOffers).toBeGreaterThan(0);
    expect(o.latestRun).toBeTruthy();
  });
});
