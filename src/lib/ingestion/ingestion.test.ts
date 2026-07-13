import { describe, it, expect } from "vitest";
import { buildSeedDatabase } from "./seed";
import { previewOffersCsv, parseCsv, templateCsvString, previewProductsCsv } from "./csv";
import { validateOffer, validateProduct, hasBranchStockEvidence } from "./validation";
import { computeEffectiveFreshness } from "./freshness";
import { rankOffers, storeConfirmedAtMall, buildOfferContext } from "./ranking";
import { buildTvUnderBudgetAnswer } from "./recommend";
import { trustMeta, availabilityMeta } from "./labels";
import { addOffer, decideOfferReview, commitOfferCsv, computeOverview, addSource, decideSourceStatus } from "./store";
import { detectConflicts, detectStaleOffers, sourceCategory } from "./conflicts";
import { deriveAvailabilityStatus } from "./availability";
import type { ProductOffer } from "./model";

const NOW = Date.parse("2026-07-13T12:00:00.000Z");
const NOW_ISO = new Date(NOW).toISOString();
const db = () => buildSeedDatabase(NOW);

const offer = (over: Partial<ProductOffer>): ProductOffer => ({
  id: "o_test", productId: "p_hisense43", retailerId: "ret_game", sellerName: null, channel: "in_store",
  currency: "ZAR", currentPrice: 3999, previousPrice: null, promotionLabel: null,
  sourceUrl: "https://www.game.co.za/x", sourceType: "retailer_product_page", sourceObservedAt: NOW_ISO,
  expiresAt: null, validFrom: null, validUntil: null, availabilityStatus: "inferred",
  availabilityScope: "retailer_range_observed", priceTrustLabel: "recently_observed", snapshotId: null,
  reviewStatus: "approved", published: true, createdAt: NOW_ISO, updatedAt: NOW_ISO, demonstrationData: true, ...over,
});

// 1. CSV validation (RC1 columns)
describe("1. CSV validation", () => {
  it("parses RC1 offer columns and rejects a malformed row", () => {
    const bad = '"Nope Retailer",Mall@Reds,,"Ghost TV",,television,-5,,not-a-url,retailer_product_page,,,recently_observed,unknown\n';
    const { rows } = parseCsv(templateCsvString("offers") + bad);
    const preview = previewOffersCsv(rows, db(), NOW_ISO);
    expect(preview.totalRows).toBe(3);
    const badRow = preview.results.find((r) => r.raw.retailer === "Nope Retailer")!;
    expect(badRow.status).toBe("rejected");
    expect(badRow.issues.some((i) => i.code === "missing_retailer")).toBe(true);
    // A known retailer + new product title stages a new product (warning, not rejection).
    const newProdRow = previewOffersCsv(parseCsv('retailer,mall,store,product_title,brand,category,price,original_price,source_url,source_type,observed_at,expires_at,trust_label,availability_status\nGame,Mall@Reds,,"Brand New TV 55",Hisense,television,4999,,https://www.game.co.za/new55,retailer_product_page,2026-07-13T08:00:00.000Z,,recently_observed,inferred').rows, db(), NOW_ISO).results[0];
    expect(newProdRow.newProduct).toBeTruthy();
    expect(newProdRow.issues.some((i) => i.code === "new_product")).toBe(true);
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

// ── RC1 additions ────────────────────────────────────────────────────────────

describe("RC1. conflict detection", () => {
  it("flags conflicting prices for the same product from the same source category", () => {
    // Seed: Game (R3,999) and Checkers (R4,499) both retailer_product_page for Hisense 43.
    const alerts = detectConflicts(db());
    const hisense = alerts.find((a) => a.productId === "p_hisense43");
    expect(hisense).toBeTruthy();
    expect(hisense!.sourceCategory).toBe("retailer_page");
    expect(hisense!.offerIds).toEqual(expect.arrayContaining(["offer_game_hisense43", "offer_checkers_hisense43"]));
    expect(hisense!.spread).toBe(500);
  });
  it("does not flag offers from different source categories as conflicts", () => {
    expect(sourceCategory("partner_feed")).toBe("partner_feed");
    expect(sourceCategory("user_submission")).toBe("user");
    // partner_feed (R3,949) is a different category, so it is not a retailer_page conflict.
    const alerts = detectConflicts(db());
    const conflictIds = alerts.flatMap((a) => a.offerIds);
    expect(conflictIds).not.toContain("offer_partner_hisense43");
  });
  it("detects stale offers for the alerts panel", () => {
    const stale = detectStaleOffers(db(), NOW);
    expect(stale.some((s) => s.offerId === "offer_pnp_hisense40")).toBe(true);
  });
});

describe("RC1. trust + availability labels", () => {
  it("renders the new partner_feed and conflict_detected trust labels", () => {
    expect(trustMeta("partner_feed").label).toBe("Partner feed");
    expect(trustMeta("conflict_detected").label).toBe("Conflict detected");
  });
  it("derives coarse availability_status from scope conservatively", () => {
    expect(deriveAvailabilityStatus("branch_stock_confirmed")).toBe("known_available");
    expect(deriveAvailabilityStatus("retailer_range_observed")).toBe("inferred");
    expect(deriveAvailabilityStatus("availability_unknown")).toBe("unknown");
    expect(deriveAvailabilityStatus("out_of_stock")).toBe("unavailable");
  });
});

describe("RC1. source registry", () => {
  it("seeds sources with lifecycle + legal notes and preserves URL/timestamp", () => {
    const base = db();
    expect(base.sources.length).toBeGreaterThanOrEqual(4);
    const blocked = base.sources.find((s) => s.status === "blocked")!;
    expect(blocked.legalRiskNote).toMatch(/login wall/i);
    const game = base.sources.find((s) => s.id === "src_game")!;
    expect(game.sourceUrl).toBe("https://www.game.co.za/");
    expect(game.lastCheckedAt).toBeTruthy();
  });
  it("registers a new source and records a source_snapshot run (no fetching)", () => {
    const { db: next, source } = addSource(db(), { name: "New source", sourceUrl: "https://example.com/x", sourceType: "retailer_product_page" }, NOW_ISO);
    expect(next.sources.some((s) => s.id === source.id)).toBe(true);
    expect(source.status).toBe("candidate");
    const run = next.runs.find((r) => r.evidenceUrl === "https://example.com/x")!;
    expect(run.runType).toBe("source_snapshot");
    const approved = decideSourceStatus(next, source.id, "approved", NOW_ISO);
    expect(approved.sources.find((s) => s.id === source.id)!.status).toBe("approved");
  });
});

describe("RC1. staged vs approved filtering", () => {
  it("keeps staged offers out of published/approved recommendations until approved", () => {
    const base = db();
    // Seed user-submitted offer is staged + unpublished.
    const staged = base.offers.find((o) => o.id === "offer_user_hisense43")!;
    expect(staged.reviewStatus).toBe("staged");
    expect(staged.published).toBe(false);
    const answer = buildTvUnderBudgetAnswer(base, { mallId: "mall_reds", maxPrice: 4000, nowMs: NOW });
    expect(answer.primary.every((o) => o.offerId !== "offer_user_hisense43")).toBe(true);
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
