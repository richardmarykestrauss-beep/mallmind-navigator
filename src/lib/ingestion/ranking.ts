/**
 * Deterministic recommendation ranking.
 *
 * Produces a rich per-offer context (freshness, physical presence, branch-stock
 * confirmation, effective trust) and a stable ordering. Stale offers never
 * outrank fresh comparable offers just because they are cheaper: trust and
 * freshness are ordered ABOVE price.
 */

import type { IngestionDatabase, ProductOffer, Product, Retailer } from "./model";
import { trustPriority } from "./labels";
import { computeEffectiveFreshness, type FreshnessState } from "./freshness";
import { hasBranchStockEvidence } from "./validation";

/** A retailer is "present" at a mall when any store links them there. */
export function physicalRetailerPresentAtMall(retailerId: string, mallId: string, db: IngestionDatabase): boolean {
  return db.stores.some((s) => s.retailerId === retailerId && s.mallId === mallId);
}

/** Confirmed store presence = a verified store links retailer + mall. */
export function storeConfirmedAtMall(retailerId: string, mallId: string, db: IngestionDatabase): boolean {
  return db.stores.some((s) => s.retailerId === retailerId && s.mallId === mallId && s.verificationStatus === "verified");
}

export interface OfferContext {
  offer: ProductOffer;
  product: Product;
  retailer: Retailer;
  freshnessState: FreshnessState;
  effectiveTrust: ProductOffer["priceTrustLabel"];
  relativeObserved: string;
  storeAtMallConfirmed: boolean;
  /** True ONLY when availabilityScope is branch_stock_confirmed AND evidence exists. */
  branchStockConfirmed: boolean;
  isOnlineComparison: boolean;
}

const FRESHNESS_RANK: Record<FreshnessState, number> = {
  fresh: 0, aging: 1, stale: 2, expired: 3, unpublished: 4, unavailable: 5,
};

const EFFECTIVELY_GONE = new Set(["out_of_stock", "no_longer_listed"]);

export function buildOfferContext(offer: ProductOffer, mallId: string, db: IngestionDatabase, nowMs: number): OfferContext | null {
  const product = db.products.find((p) => p.id === offer.productId);
  const retailer = db.retailers.find((r) => r.id === offer.retailerId);
  if (!product || !retailer) return null;

  const fresh = computeEffectiveFreshness(offer, nowMs);
  const storeAtMallConfirmed = storeConfirmedAtMall(retailer.id, mallId, db);
  const branchStockConfirmed = offer.availabilityScope === "branch_stock_confirmed" && hasBranchStockEvidence(offer.id, db);
  const isOnlineComparison =
    !retailer.physicalRetailer || offer.channel === "online" || offer.channel === "marketplace" || !storeAtMallConfirmed;

  return {
    offer, product, retailer,
    freshnessState: fresh.state,
    effectiveTrust: fresh.effectiveTrustLabel,
    relativeObserved: fresh.reason,
    storeAtMallConfirmed,
    branchStockConfirmed,
    isOnlineComparison,
  };
}

function isRecommendable(ctx: OfferContext): boolean {
  if (!ctx.offer.published || ctx.offer.reviewStatus !== "approved") return false;   // published + approved
  if (ctx.effectiveTrust === "unavailable") return false;                             // not unavailable
  if (EFFECTIVELY_GONE.has(ctx.offer.availabilityScope)) return false;
  if (ctx.freshnessState === "unpublished") return false;
  return true;
}

export interface RankQuery {
  mallId: string;
  maxPrice: number;
  category: string; // e.g. "television"
}

const matchesCategory = (p: Product, category: string) =>
  p.category.trim().toLowerCase() === category.trim().toLowerCase() ||
  (category.trim().toLowerCase() === "television" && /\btv\b|television/i.test(p.category));

/** Deterministic comparator (trust → freshness → branch stock → price). */
export function compareOffers(a: OfferContext, b: OfferContext): number {
  const t = trustPriority(a.effectiveTrust) - trustPriority(b.effectiveTrust);
  if (t !== 0) return t;
  const f = FRESHNESS_RANK[a.freshnessState] - FRESHNESS_RANK[b.freshnessState];
  if (f !== 0) return f;
  const bs = (b.branchStockConfirmed ? 1 : 0) - (a.branchStockConfirmed ? 1 : 0);
  if (bs !== 0) return bs;
  return a.offer.currentPrice - b.offer.currentPrice; // lowest qualifying last
}

export interface RankedResult {
  primary: OfferContext[];       // physical mall retailers, ranked
  onlineComparisons: OfferContext[]; // online-only / marketplace, ranked
}

export function rankOffers(db: IngestionDatabase, query: RankQuery, nowMs: number): RankedResult {
  const contexts = db.offers
    .map((o) => buildOfferContext(o, query.mallId, db, nowMs))
    .filter((c): c is OfferContext => c != null)
    .filter((c) => matchesCategory(c.product, query.category))
    .filter((c) => c.offer.currentPrice <= query.maxPrice)  // within budget
    .filter(isRecommendable);

  const primary = contexts.filter((c) => !c.isOnlineComparison).sort(compareOffers);
  const onlineComparisons = contexts.filter((c) => c.isOnlineComparison).sort(compareOffers);
  return { primary, onlineComparisons };
}

/** Generate the "why recommended" explanation from the ranking factors. */
export function explainRecommendation(ctx: OfferContext, rank: number): string {
  const bits: string[] = [];
  if (rank === 0) bits.push("Lowest qualifying observed offer");
  else bits.push("Qualifying observed offer");
  if (ctx.storeAtMallConfirmed) bits.push("from a retailer physically present at this mall");
  else bits.push("from a retailer's range");
  if (ctx.branchStockConfirmed) bits.push("with branch stock confirmed");
  return `${bits.join(" ")}.`;
}
