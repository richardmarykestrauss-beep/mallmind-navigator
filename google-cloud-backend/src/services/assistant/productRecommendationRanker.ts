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
  RankContext,
  RankedCandidate,
  ShopperCandidate,
} from "./assistantTypes";
import { getShopperTrustInfo } from "./shopperTrustLabels";

// Score weights. Trust dominates: a high-trust option outscores a low-trust
// cheapest option (40 vs 15) unless several other signals stack against it.
const TRUST_SCORE = { high: 40, medium: 15, low: 0 } as const;
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

  return ranked.sort((a, b) => b.rankScore - a.rankScore);
}
