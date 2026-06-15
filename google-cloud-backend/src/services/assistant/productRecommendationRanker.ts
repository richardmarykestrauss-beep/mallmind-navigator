/**
 * productRecommendationRanker.ts — Shopping Assistant Intelligence Engine v1
 *
 * Ranks shopper candidates by trust + relevance + price/value + walking
 * effort + shop certainty + route availability + budget fit, per the
 * doctrine: "A cheaper product far away with weak confidence may rank below
 * a closer verified product." Never ranks by cheapest price alone.
 *
 * Unknown fields (null) are neutral — never assumed in the product's favour.
 */

import {
  ConfidenceBand,
  RankContext,
  RankedCandidate,
  ShopperCandidate,
} from "./assistantTypes";
import { getShopperTrustInfo } from "./shopperTrustLabels";

// Score weights used for the WITHIN-tier tiebreak (price, walking, special,
// open, etc.). The cross-tier ordering itself is decided by TIER_RANK below,
// not by these weights — see the sort at the end of rankCandidates.
const TRUST_SCORE = { high: 40, medium: 15, low: 0 } as const;

// Trust tier is the dominant ranking key for normal shopper queries: a
// verified/trusted option always outranks a demo/sample option, never the
// reverse. Only an explicit "cheapest" request overrides this (price-first).
const TIER_RANK: Record<ConfidenceBand, number> = { high: 2, medium: 1, low: 0 };

/** True when the option has no known price or its price is within budget. */
function isAffordable(price: number | null | undefined, budget: number | null): boolean {
  return budget == null || typeof price !== "number" || price <= budget;
}
const CHEAPEST_BONUS = 15;
const NEAR_CHEAPEST_BONUS = 7;
const WALKING_BONUS_CEILING = 12; // minutes; closer than this earns points
const RELEVANCE_CAP = 20;
const ROUTE_BONUS = 8;
const SHOP_NAME_BONUS = 5;
const SHOP_LOCATION_BONUS = 2;
const OPEN_NOW_BONUS = 4;
const CLOSED_PENALTY = -10;
const OVER_BUDGET_PENALTY = -60;
const BUDGET_FIT_BONUS = 10;
const BUDGET_HEADROOM_CAP = 10;
const SPECIAL_CAP = 10;

/** Rank candidates for a shopper context. Returns a new sorted array (desc). */
export function rankCandidates(
  candidates: ShopperCandidate[] | null | undefined,
  context: RankContext = {}
): RankedCandidate[] {
  const list = (candidates ?? []).filter((c) => c?.productId && c?.productName);
  if (!list.length) return [];

  const budget = context.budget ?? null;
  const intent = context.intent ?? "product_search";

  const knownPrices = list
    .map((c) => c.price)
    .filter((p): p is number => typeof p === "number" && Number.isFinite(p));
  const minPrice = knownPrices.length ? Math.min(...knownPrices) : null;

  const ranked = list.map((candidate): RankedCandidate => {
    const trust = getShopperTrustInfo(candidate);
    const reasons: string[] = [];
    let score = 0;

    // 1. Data trust/confidence
    score += TRUST_SCORE[trust.confidenceBand];
    if (trust.confidenceBand === "high") reasons.push(trust.label);

    // 2. Caller-supplied relevance
    if (typeof candidate.relevanceScore === "number" && candidate.relevanceScore > 0) {
      score += Math.min(candidate.relevanceScore, RELEVANCE_CAP);
    }

    // 3. Price/value relative to this candidate pool (known prices only)
    if (typeof candidate.price === "number" && minPrice != null) {
      const cheapestMultiplier = intent === "cheapest_option" ? 2 : 1;
      if (candidate.price === minPrice) {
        score += CHEAPEST_BONUS * cheapestMultiplier;
        reasons.push("Lowest price of these options");
      } else if (candidate.price <= minPrice * 1.1) {
        score += NEAR_CHEAPEST_BONUS * cheapestMultiplier;
      }
    }

    // 4. Budget fit
    if (budget != null && typeof candidate.price === "number") {
      if (candidate.price > budget) {
        score += OVER_BUDGET_PENALTY;
        reasons.push("Over your budget");
      } else {
        const headroomPct = ((budget - candidate.price) / budget) * 100;
        score += BUDGET_FIT_BONUS + Math.min(headroomPct / 10, BUDGET_HEADROOM_CAP);
        reasons.push("Fits your budget");
      }
    }

    // 5. Walking effort — only when actually known
    if (typeof candidate.walkingMinutes === "number" && candidate.walkingMinutes >= 0) {
      const closestMultiplier = intent === "closest_option" ? 2 : 1;
      const walkBonus = Math.max(0, WALKING_BONUS_CEILING - candidate.walkingMinutes);
      score += walkBonus * closestMultiplier;
      if (candidate.walkingMinutes <= 5) reasons.push("Short walk away");
    }

    // 6. Shop certainty + route availability
    if (candidate.shopName) score += SHOP_NAME_BONUS;
    if (candidate.floor || candidate.unitNumber) score += SHOP_LOCATION_BONUS;
    if (candidate.routeAvailable === true) {
      score += ROUTE_BONUS;
      reasons.push("Route ready");
    }

    // 7. Open now (only when known)
    if (candidate.isOpenNow === true) score += OPEN_NOW_BONUS;
    if (candidate.isOpenNow === false) {
      score += CLOSED_PENALTY;
      reasons.push("Shop may be closed right now");
    }

    // 8. Specials — only with a real discount percentage
    if (candidate.isOnSpecial === true && typeof candidate.discountPct === "number") {
      score += Math.min(candidate.discountPct / 2, SPECIAL_CAP);
      reasons.push("On special");
    }

    return {
      ...candidate,
      rankScore: score,
      reasons,
      trustLabel: trust.label,
      confidenceBand: trust.confidenceBand,
    };
  });

  const priceFirst = intent === "cheapest_option";

  return ranked.sort((a, b) => {
    // 1. Affordable options always beat over-budget ones (every intent).
    //    Keeps an over-budget verified TV from being shown as "best" for a
    //    budget query.
    const aAff = isAffordable(a.price, budget) ? 1 : 0;
    const bAff = isAffordable(b.price, budget) ? 1 : 0;
    if (aAff !== bAff) return bAff - aAff;

    if (priceFirst) {
      // Explicit "cheapest" request: the lowest known price wins outright.
      // Trust is only a tiebreaker here; the trust trade-off is surfaced as a
      // label + warning by the answer builder, never by hiding the cheapest.
      const ap = typeof a.price === "number" ? a.price : Infinity;
      const bp = typeof b.price === "number" ? b.price : Infinity;
      if (ap !== bp) return ap - bp;
      return b.rankScore - a.rankScore;
    }

    // 2. Trust tier dominates for normal queries (product/budget/value/etc.):
    //    any verified option outranks any demo/sample option. Within the same
    //    tier, the nuanced score (price, walking, special, open) decides.
    const at = TIER_RANK[a.confidenceBand];
    const bt = TIER_RANK[b.confidenceBand];
    if (at !== bt) return bt - at;
    return b.rankScore - a.rankScore;
  });
}
