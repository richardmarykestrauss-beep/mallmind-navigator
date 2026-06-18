/**
 * shopperCandidateMapper.ts — Shopping Assistant Intelligence Engine v1 (20A.6C)
 *
 * Centralised, pure mapping from a fetched product row into the engine's plain
 * ShopperCandidate shape. Mirrors the inline mapping in
 * geminiService.buildShoppingAnswerForResult so the deterministic path
 * (20A.6C/D) maps products identically — without touching or refactoring
 * geminiService.
 *
 * Input is a STRUCTURAL row type (MappableProductRow), which productService's
 * ScoredProduct satisfies. The engine therefore stays decoupled from the DB
 * layer (no lib/types import).
 *
 * Pure: no Supabase, no env, no network, no fs, no Gemini, no side effects.
 */

import type { ShopperCandidate } from "./assistantTypes";

/**
 * The subset of a fetched product row this mapper reads. ScoredProduct
 * (productService) satisfies it structurally, so fetched rows pass straight in.
 * Every nullable field means "unknown" — the mapper never invents a value.
 */
export interface MappableProductRow {
  product_id: string;
  name: string;
  shop_id?: string | null;
  shop_name?: string | null;
  floor?: string | null;
  unit_number?: string | null;
  price?: number | null;
  is_on_special?: boolean | null;
  discount_pct?: number | null;
  trust_state?: string | null;
  data_quality_status?: string | null;
  is_open_now?: boolean | null;
  score?: number | null;
}

/**
 * Map one product row into a ShopperCandidate. `routeAvailable` reflects whether
 * a real indoor route exists for this response (false on the deterministic
 * product path until a route is actually built — the engine only offers
 * "Take me there" when it is true).
 */
export function mapProductRowToCandidate(
  p: MappableProductRow,
  routeAvailable = false
): ShopperCandidate {
  return {
    productId: p.product_id,
    productName: p.name,
    shopId: p.shop_id ?? null,
    shopName: p.shop_name ?? null,
    floor: p.floor ?? null,
    unitNumber: p.unit_number ?? null,
    price: p.price ?? null,
    isOnSpecial: p.is_on_special ?? null,
    discountPct: p.discount_pct ?? null,
    trustState: p.trust_state ?? null,
    dataQualityStatus: p.data_quality_status ?? null,
    isOpenNow: p.is_open_now ?? null,
    routeAvailable,
    relevanceScore: typeof p.score === "number" ? Math.min(p.score / 5, 20) : null,
  };
}

/** Map a list of product rows into ShopperCandidates (order preserved). */
export function mapProductRowsToCandidates(
  products: readonly MappableProductRow[],
  routeAvailable = false
): ShopperCandidate[] {
  return products.map((p) => mapProductRowToCandidate(p, routeAvailable));
}
