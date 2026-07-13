/**
 * Curated demonstration seed — Mall@Reds + television offers.
 *
 * CURATED DEMONSTRATION DATA. Nothing here is "verified live". Timestamps are
 * relative to `now` so freshness behaves realistically (and deterministically in
 * tests). Includes every required case: under/over budget, stale, catalogue
 * special, online-only comparison, marketplace seller, branch-stock-unknown,
 * a positive branch-stock-confirmed (with evidence), and an unavailable offer.
 */

import type {
  IngestionDatabase, Mall, Retailer, Store, Product, ProductOffer,
  StoreOfferObservation, SourceSnapshot, IngestionRun, ReviewQueueItem, SourcePolicy, Source,
} from "./model";
import { deriveAvailabilityStatus } from "./availability";

const HOUR = 3_600_000, DAY = 24 * HOUR;

export function buildSeedDatabase(now: number = Date.now()): IngestionDatabase {
  const iso = (offsetMs: number) => new Date(now + offsetMs).toISOString();
  const ago = (ms: number) => iso(-ms);
  const nowIso = iso(0);

  const mall: Mall = {
    id: "mall_reds", name: "Mall@Reds", slug: "mall-at-reds",
    address: "Cnr Rooihuiskraal & Hendrik Verwoerd Dr, Rooihuiskraal, Centurion",
    latitude: -25.8646, longitude: 28.1481,
    officialWebsiteUrl: "https://www.mallatreds.co.za/", sourceUrl: "https://www.mallatreds.co.za/stores",
    lastVerifiedAt: ago(10 * DAY), status: "active",
  };

  const R = (id: string, name: string, slug: string, url: string, type: Retailer["retailerType"], physical: boolean, marketplace = false): Retailer =>
    ({ id, name, slug, websiteUrl: url, retailerType: type, marketplaceEnabled: marketplace, physicalRetailer: physical, status: "active" });

  const retailers: Retailer[] = [
    R("ret_game", "Game", "game", "https://www.game.co.za/", "physical", true),
    R("ret_checkers", "Checkers", "checkers", "https://www.checkers.co.za/", "physical", true),
    R("ret_pnp", "Pick n Pay", "pick-n-pay", "https://www.pnp.co.za/", "physical", true),
    R("ret_clicks", "Clicks", "clicks", "https://clicks.co.za/", "physical", true),
    R("ret_dischem", "Dis-Chem", "dis-chem", "https://www.dischem.co.za/", "physical", true),
    R("ret_woolworths", "Woolworths", "woolworths", "https://www.woolworths.co.za/", "physical", true),
    R("ret_mrprice", "Mr Price", "mr-price", "https://www.mrp.com/", "physical", true),
    R("ret_pep", "PEP", "pep", "https://www.pepstores.com/", "physical", true),
    R("ret_edgars", "Edgars", "edgars", "https://www.edgars.co.za/", "physical", true),
    R("ret_takealot", "Takealot", "takealot", "https://www.takealot.com/", "marketplace", false, true),
  ];

  const S = (id: string, retailerId: string, trading: string, shop: string, floor: string): Store =>
    ({ id, retailerId, mallId: mall.id, tradingName: trading, shopNumber: shop, floorLabel: floor, telephone: "012 000 0000", storeUrl: null, verificationStatus: "verified", lastVerifiedAt: ago(12 * DAY) });

  // Only physically-present retailers are linked to Mall@Reds (curated fixture).
  const stores: Store[] = [
    S("store_game", "ret_game", "Game Mall@Reds", "G12", "Ground Floor"),
    S("store_checkers", "ret_checkers", "Checkers Mall@Reds", "L05", "Lower Level"),
    S("store_pnp", "ret_pnp", "Pick n Pay Mall@Reds", "G20", "Ground Floor"),
    S("store_clicks", "ret_clicks", "Clicks Mall@Reds", "G31", "Ground Floor"),
    S("store_dischem", "ret_dischem", "Dis-Chem Mall@Reds", "U14", "Upper Level"),
    S("store_woolworths", "ret_woolworths", "Woolworths Mall@Reds", "G02", "Ground Floor"),
    S("store_edgars", "ret_edgars", "Edgars Mall@Reds", "U08", "Upper Level"),
  ];

  const P = (id: string, name: string, brand: string, model: string, desc: string): Product =>
    ({ id, canonicalName: name, brand, modelNumber: model, category: "television", descriptionSummary: desc, gtin: null, manufacturerSku: model, normalizationStatus: "normalized" });

  const products: Product[] = [
    P("p_hisense43", 'Hisense 43" A4 FHD Smart TV', "Hisense", "43A4K", "43-inch Full HD smart TV with VIDAA"),
    P("p_hisense32", 'Hisense 32" A4 HD Smart TV', "Hisense", "32A4K", "32-inch HD smart TV"),
    P("p_hisense40", 'Hisense 40" A4 FHD Smart TV', "Hisense", "40A4K", "40-inch Full HD smart TV"),
    P("p_hisense50", 'Hisense 50" A6K 4K Smart TV', "Hisense", "50A6K", "50-inch 4K UHD smart TV"),
    P("p_tcl43", 'TCL 43" P635 4K Google TV', "TCL", "43P635", "43-inch 4K UHD Google TV"),
    P("p_tcl32", 'TCL 32" S5400 HD Android TV', "TCL", "32S5400", "32-inch HD Android TV"),
    P("p_samsung43", 'Samsung 43" UHD Smart TV', "Samsung", "UA43CU7000", "43-inch 4K UHD smart TV"),
    P("p_samsung50", 'Samsung 50" UHD Smart TV', "Samsung", "UA50CU7000", "50-inch 4K UHD smart TV"),
    P("p_skyworth40", 'Skyworth 40" FHD Smart TV', "Skyworth", "40STD6600", "40-inch Full HD smart TV"),
  ];

  const base = (id: string, productId: string, retailerId: string): Pick<ProductOffer, "id" | "productId" | "retailerId" | "currency" | "createdAt" | "updatedAt" | "demonstrationData"> =>
    ({ id, productId, retailerId, currency: "ZAR", createdAt: ago(2 * DAY), updatedAt: nowIso, demonstrationData: true });

  const offersRaw: Omit<ProductOffer, "availabilityStatus">[] = [
    // Primary in-mall, fresh, under budget — the canonical example.
    { ...base("offer_game_hisense43", "p_hisense43", "ret_game"), sellerName: null, channel: "in_store", currentPrice: 3999, previousPrice: 4499, promotionLabel: "Weekend special", sourceUrl: "https://www.game.co.za/hisense-43a4k", sourceType: "retailer_product_page", sourceObservedAt: ago(3 * HOUR), validFrom: null, validUntil: null, availabilityScope: "retailer_range_observed", priceTrustLabel: "recently_observed", reviewStatus: "approved", published: true },
    // Catalogue special, in-mall, cheapest.
    { ...base("offer_checkers_hisense32", "p_hisense32", "ret_checkers"), sellerName: null, channel: "catalogue", currentPrice: 2999, previousPrice: 3499, promotionLabel: "Hyper catalogue", sourceUrl: "https://www.checkers.co.za/catalogue/hisense-32", sourceType: "retailer_catalogue", sourceObservedAt: ago(20 * HOUR), validFrom: ago(2 * DAY), validUntil: iso(3 * DAY), availabilityScope: "retailer_range_observed", priceTrustLabel: "catalogue_special", reviewStatus: "approved", published: true },
    // In-mall, fresh, under budget.
    { ...base("offer_pnp_tcl43", "p_tcl43", "ret_pnp"), sellerName: null, channel: "in_store", currentPrice: 3799, previousPrice: null, promotionLabel: null, sourceUrl: "https://www.pnp.co.za/tcl-43p635", sourceType: "retailer_product_page", sourceObservedAt: ago(5 * HOUR), validFrom: null, validUntil: null, availabilityScope: "retailer_range_observed", priceTrustLabel: "recently_observed", reviewStatus: "approved", published: true },
    // In-mall, manual admin, availability unknown (branch-stock-unknown case).
    { ...base("offer_wool_samsung43", "p_samsung43", "ret_woolworths"), sellerName: null, channel: "in_store", currentPrice: 3950, previousPrice: null, promotionLabel: null, sourceUrl: "https://www.woolworths.co.za/samsung-43", sourceType: "manual_admin", sourceObservedAt: ago(2 * DAY), validFrom: null, validUntil: null, availabilityScope: "availability_unknown", priceTrustLabel: "manual_admin", reviewStatus: "approved", published: true },
    // In-mall, BRANCH STOCK CONFIRMED (backed by evidence below).
    { ...base("offer_game_skyworth40", "p_skyworth40", "ret_game"), sellerName: null, channel: "in_store", currentPrice: 3499, previousPrice: null, promotionLabel: null, sourceUrl: "https://www.game.co.za/skyworth-40std", sourceType: "phone_confirmation", sourceObservedAt: ago(1 * HOUR), validFrom: null, validUntil: null, availabilityScope: "branch_stock_confirmed", priceTrustLabel: "recently_observed", reviewStatus: "approved", published: true },
    // In-mall but STALE (30h old) — cheaper, must NOT outrank fresh offers.
    { ...base("offer_pnp_hisense40", "p_hisense40", "ret_pnp"), sellerName: null, channel: "in_store", currentPrice: 3299, previousPrice: null, promotionLabel: null, sourceUrl: "https://www.pnp.co.za/hisense-40a4k", sourceType: "retailer_product_page", sourceObservedAt: ago(30 * HOUR), validFrom: null, validUntil: null, availabilityScope: "retailer_range_observed", priceTrustLabel: "recently_observed", reviewStatus: "approved", published: true },
    // ONLINE marketplace comparison (Takealot, seller context) — under budget.
    { ...base("offer_takealot_tcl43", "p_tcl43", "ret_takealot"), sellerName: "TechDeals SA", channel: "marketplace", currentPrice: 3799, previousPrice: null, promotionLabel: null, sourceUrl: "https://www.takealot.com/tcl-43p635", sourceType: "marketplace_listing", sourceObservedAt: ago(4 * HOUR), validFrom: null, validUntil: null, availabilityScope: "online_stock_only", priceTrustLabel: "recently_observed", reviewStatus: "approved", published: true },
    // Over budget (online) — excluded by budget filter.
    { ...base("offer_takealot_hisense50", "p_hisense50", "ret_takealot"), sellerName: "Takealot", channel: "online", currentPrice: 5499, previousPrice: null, promotionLabel: null, sourceUrl: "https://www.takealot.com/hisense-50a6k", sourceType: "retailer_product_page", sourceObservedAt: ago(6 * HOUR), validFrom: null, validUntil: null, availabilityScope: "online_stock_only", priceTrustLabel: "recently_observed", reviewStatus: "approved", published: true },
    // Over budget (in-mall) — excluded by budget filter.
    { ...base("offer_game_samsung50", "p_samsung50", "ret_game"), sellerName: null, channel: "in_store", currentPrice: 6999, previousPrice: null, promotionLabel: null, sourceUrl: "https://www.game.co.za/samsung-50", sourceType: "retailer_product_page", sourceObservedAt: ago(8 * HOUR), validFrom: null, validUntil: null, availabilityScope: "retailer_range_observed", priceTrustLabel: "recently_observed", reviewStatus: "approved", published: true },
    // Explicitly UNAVAILABLE (out of stock) — excluded from recommendations.
    { ...base("offer_edgars_tcl32", "p_tcl32", "ret_edgars"), sellerName: null, channel: "in_store", currentPrice: 2799, previousPrice: null, promotionLabel: null, sourceUrl: "https://www.edgars.co.za/tcl-32", sourceType: "manual_admin", sourceObservedAt: ago(3 * DAY), validFrom: null, validUntil: null, availabilityScope: "out_of_stock", priceTrustLabel: "unavailable", reviewStatus: "approved", published: true },
    // STAGED review (user submitted) — appears in the review queue, not published.
    { ...base("offer_user_hisense43", "p_hisense43", "ret_pnp"), sellerName: null, channel: "in_store", currentPrice: 3699, previousPrice: null, promotionLabel: null, sourceUrl: "https://www.pnp.co.za/hisense-43a4k", sourceType: "user_submission", sourceObservedAt: ago(2 * HOUR), validFrom: null, validUntil: null, availabilityScope: "availability_unknown", priceTrustLabel: "user_submitted", reviewStatus: "staged", published: false },
    // PARTNER FEED offer (not live-verified by MallMind).
    { ...base("offer_partner_hisense43", "p_hisense43", "ret_game"), sellerName: null, channel: "online", currentPrice: 3949, previousPrice: null, promotionLabel: null, sourceUrl: "https://partner.example.com/feed/hisense-43a4k", sourceType: "partner_feed", sourceObservedAt: ago(10 * HOUR), validFrom: null, validUntil: null, availabilityScope: "online_stock_only", priceTrustLabel: "partner_feed", reviewStatus: "approved", published: true },
    // CONFLICT: a second retailer_product_page price for the same product (Hisense 43) that
    // materially disagrees with Game's R3,999 → surfaced as a conflict alert.
    { ...base("offer_checkers_hisense43", "p_hisense43", "ret_checkers"), sellerName: null, channel: "in_store", currentPrice: 4499, previousPrice: null, promotionLabel: null, sourceUrl: "https://www.checkers.co.za/hisense-43a4k", sourceType: "retailer_product_page", sourceObservedAt: ago(6 * HOUR), validFrom: null, validUntil: null, availabilityScope: "retailer_range_observed", priceTrustLabel: "recently_observed", reviewStatus: "approved", published: true },
  ];
  const offers: ProductOffer[] = offersRaw.map((o) => ({ ...o, availabilityStatus: deriveAvailabilityStatus(o.availabilityScope) }));

  // Branch-specific evidence for the branch_stock_confirmed offer.
  const observations: StoreOfferObservation[] = [
    { id: "obs_skyworth_game", productOfferId: "offer_game_skyworth40", storeId: "store_game", availabilityStatus: "in_stock", evidenceType: "phone_confirmation", observedAt: ago(1 * HOUR), expiresAt: iso(2 * DAY), sourceUrl: null, confidenceScore: 0.9, reviewStatus: "approved" },
  ];

  const snap = (id: string, offerId: ProductOffer, excerpt: string): SourceSnapshot =>
    ({ id, sourceUrl: offerId.sourceUrl, sourceType: offerId.sourceType, retrievedAt: offerId.sourceObservedAt, contentHash: `sha256:demo-${id}`, evidenceExcerpt: excerpt, evidenceMetadata: { note: "Curated demonstration evidence — no live capture stored.", offerId: offerId.id }, parserVersion: "ingest-sprint-1", ingestionRunId: "run_seed", status: "parsed" });

  const snapshots: SourceSnapshot[] = [
    snap("snap_game_hisense43", offers[0], 'Hisense 43" A4 FHD Smart TV — R3,999 (was R4,499). Weekend special.'),
    snap("snap_checkers_hisense32", offers[1], 'Hisense 32" HD — R2,999 catalogue special.'),
    snap("snap_game_skyworth40", offers[4], 'Skyworth 40" — R3,499. Branch confirmed in stock via phone.'),
    snap("snap_takealot_tcl43", offers[6], 'TCL 43" P635 — R3,799. Sold by TechDeals SA (marketplace).'),
  ];

  const runs: IngestionRun[] = [
    { id: "run_seed", runType: "manual_entry", sourceType: "manual_admin", filename: null, evidenceUrl: null, startedAt: ago(2 * DAY), completedAt: ago(2 * DAY - HOUR), status: "completed", totalRows: offers.length, acceptedRows: offers.filter((o) => o.published).length, rejectedRows: 0, warningRows: 1, conflictsDetected: 1, initiatedBy: "seed", notes: "Curated demonstration seed for Data Ingestion RC1." },
    { id: "run_csv_demo", runType: "manual_csv", sourceType: "csv_import", filename: "checkers-specials-2026-07.csv", evidenceUrl: null, startedAt: ago(20 * HOUR), completedAt: ago(20 * HOUR - 5 * 60000), status: "completed", totalRows: 6, acceptedRows: 4, rejectedRows: 1, warningRows: 1, conflictsDetected: 0, initiatedBy: "admin", notes: "Demo CSV import (prototype — local persisted data)." },
    { id: "run_snapshot_game", runType: "source_snapshot", sourceType: "retailer_product_page", filename: null, evidenceUrl: "https://www.game.co.za/hisense-43a4k", startedAt: ago(3 * HOUR), completedAt: ago(3 * HOUR), status: "completed", totalRows: 1, acceptedRows: 1, rejectedRows: 0, warningRows: 0, conflictsDetected: 0, initiatedBy: "admin", notes: "Manual source snapshot registration." },
  ];

  // Source registry — public sources MallMind is tracking. RC1 does NO auto-fetching.
  const sources: Source[] = ([
    { id: "src_game", name: "Game — product pages", sourceUrl: "https://www.game.co.za/", sourceType: "retailer_product_page", retailerId: "ret_game", mallId: "mall_reds", status: "approved", legalRiskNote: "Public product pages; observe robots.txt & rate limits. No automated fetching in RC1.", lastCheckedAt: ago(3 * HOUR), ownerNotes: "Primary electronics source for Mall@Reds." },
    { id: "src_checkers_specials", name: "Checkers — weekly specials", sourceUrl: "https://www.checkers.co.za/catalogue", sourceType: "retailer_specials_page", retailerId: "ret_checkers", mallId: "mall_reds", status: "candidate", legalRiskNote: "Catalogue is time-boxed; verify validUntil. Manual review only.", lastCheckedAt: ago(20 * HOUR), ownerNotes: "Good for catalogue specials." },
    { id: "src_takealot", name: "Takealot — marketplace listings", sourceUrl: "https://www.takealot.com/", sourceType: "marketplace_listing", retailerId: "ret_takealot", mallId: null, status: "needs_review", legalRiskNote: "Marketplace ToS restrict automated access. Online-only — not a Mall@Reds store.", lastCheckedAt: ago(4 * HOUR), ownerNotes: "Use for online comparison only." },
    { id: "src_login_walled", name: "Example login-walled retailer", sourceUrl: "https://members.example-retailer.co.za/", sourceType: "retailer_product_page", retailerId: null, mallId: null, status: "blocked", legalRiskNote: "Behind a login wall — DO NOT ingest. Blocked per policy.", lastCheckedAt: ago(30 * DAY), ownerNotes: "Blocked: login wall / anti-bot." },
    { id: "src_mallreds_dir", name: "Mall@Reds store directory", sourceUrl: "https://www.mallatreds.co.za/stores", sourceType: "mall_directory", retailerId: null, mallId: "mall_reds", status: "approved", legalRiskNote: "Public mall directory; used for store presence only.", lastCheckedAt: ago(10 * DAY), ownerNotes: "Source of physical store mappings." },
  ] as Omit<Source, "createdAt">[]).map((s) => ({ ...s, createdAt: ago(15 * DAY) }));

  const reviewQueue: ReviewQueueItem[] = [
    { id: "rq_user_hisense43", entityType: "product_offer", entityId: "offer_user_hisense43", reason: "User-submitted price — verify against a retailer source before publishing.", severity: "warning", status: "staged", createdAt: ago(2 * HOUR), reviewedAt: null, reviewedBy: null, decisionNotes: null },
    { id: "rq_wool_samsung43", entityType: "product_offer", entityId: "offer_wool_samsung43", reason: "Manual entry older than the freshness window — re-verify.", severity: "info", status: "staged", createdAt: ago(2 * DAY), reviewedAt: null, reviewedBy: null, decisionNotes: null },
  ];

  const policies: SourcePolicy[] = retailers.map((r) => ({
    id: `pol_${r.id}`, retailerId: r.id, termsReviewed: false, robotsReviewed: false, automationApproved: false,
    ingestionFrequency: "manual", permittedFields: ["price", "product_name", "availability"], imageUsagePermission: false,
    legalReviewStatus: "not_reviewed", updatedAt: nowIso,
  }));

  return {
    meta: { isPrototype: true, dataOrigin: "curated_demonstration", label: "Curated demonstration data", createdAt: nowIso, version: 2 },
    malls: [mall], retailers, stores, products, offers, observations, snapshots, sources, runs, reviewQueue, policies,
  };
}
