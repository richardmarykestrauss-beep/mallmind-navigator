/**
 * assistantTypes.ts — Shopping Assistant Intelligence Engine v1
 *
 * Shared types for converting MallMind product/shop/route data into safe,
 * shopper-facing recommendations, per the Shopping Assistant Intelligence
 * Doctrine (docs/assistant/shopping-assistant-intelligence-doctrine.md).
 *
 * The engine is pure and deterministic: no Supabase client, no env reads,
 * no network calls, no filesystem access, no database writes. Callers fetch
 * rows and pass plain objects in.
 */

export type ShoppingIntent =
  | "product_search"
  | "budget_search"
  | "cheapest_option"
  | "closest_option"
  | "best_value"
  | "navigation_request"
  | "mission_shopping"
  | "unknown";

export interface IntentResult {
  intent: ShoppingIntent;
  /** Additional intents detected alongside the primary one. */
  secondary: ShoppingIntent[];
  /** Budget in rand parsed from phrases like "under R4000", or null. */
  budget: number | null;
}

export type ConfidenceBand = "high" | "medium" | "low";

/** Shopper-safe trust translation of internal quality/trust statuses. */
export interface ShopperTrustInfo {
  /** e.g. "Verified option" — never a raw internal status. */
  label: string;
  confidenceBand: ConfidenceBand;
  /** Optional shopper-safe caution, e.g. "please confirm with the store". */
  cautionNote: string | null;
}

/**
 * Plain-object product candidate. Callers map DB/service rows (e.g.
 * ScoredProduct) into this shape. Every nullable field means "unknown" —
 * the engine never invents a value for it.
 */
export interface ShopperCandidate {
  productId: string;
  productName: string;
  shopId?: string | null;
  shopName?: string | null;
  floor?: string | null;
  unitNumber?: string | null;
  /** Rand price; null = unknown (the engine never fabricates an amount). */
  price?: number | null;
  isOnSpecial?: boolean | null;
  discountPct?: number | null;
  /**
   * Computed trust state from priceTrust.calculatePriceTrust
   * (verified | live | expired | disputed | needs_review | sample | unknown).
   * Preferred over dataQualityStatus because it includes expiry + disputes.
   */
  trustState?: string | null;
  /** Raw products.data_quality_status — fallback when trustState is absent. */
  dataQualityStatus?: string | null;
  /** null = stock unknown; the engine never claims stock without true. */
  inStock?: boolean | null;
  isOpenNow?: boolean | null;
  /** Estimated walking time in minutes; null = unknown (neutral in ranking). */
  walkingMinutes?: number | null;
  /** True only when an indoor route to this shop can actually be built. */
  routeAvailable?: boolean | null;
  /** Caller-supplied relevance signal (e.g. existing search score), any scale. */
  relevanceScore?: number | null;
}

export interface RankedCandidate extends ShopperCandidate {
  rankScore: number;
  /** Shopper-safe scoring reasons, e.g. "fits your budget". */
  reasons: string[];
  trustLabel: string;
  confidenceBand: ConfidenceBand;
}

export interface RankContext {
  budget?: number | null;
  intent?: ShoppingIntent;
}

export type NextActionType = "navigate" | "compare" | "confirm_price" | "search_again";

export interface NextAction {
  type: NextActionType;
  /** Button-ready label, e.g. "Take me there". */
  label: string;
}

export interface AnswerOption {
  productId: string;
  productName: string;
  shopName: string | null;
  /** Null when no confirmed price exists — callers must not render a rand amount. */
  price: number | null;
  trustLabel: string;
  confidenceBand: ConfidenceBand;
  /** Shopper-safe one-line reason this option was picked. */
  reason: string;
  routeAvailable: boolean;
}

export interface ShoppingAnswer {
  intent: ShoppingIntent;
  bestOption: AnswerOption | null;
  backupOption: AnswerOption | null;
  /** Shopper-safe warnings (uncertainty, budget misses, closed shops). */
  warnings: string[];
  nextAction: NextAction;
  /** Short, decisive, action-oriented message. Guaranteed free of internal statuses. */
  shopperMessage: string;
}

export interface BuildAnswerInput {
  /** Raw shopper query; used to classify intent when `intent` is not given. */
  query?: string | null;
  /** Pre-classified intent (overrides query classification). */
  intent?: IntentResult | null;
  candidates: ShopperCandidate[];
  /** Explicit budget; falls back to the budget parsed from the query. */
  budget?: number | null;
}
