/**
 * deterministicProductFilter.ts — Shopping Assistant Intelligence Engine v1 (20A.6B)
 *
 * Pure, deterministic candidate filtering for the Gemini-free shopping path.
 * Given product rows already fetched from MallMind's own data (mall-scoped by
 * the caller) plus a deterministic shopping intent, keep only the rows that
 * genuinely match the product target, fall within budget, and satisfy a
 * verified-only trust preference.
 *
 * Doctrine: retrieval finds candidates; the ranker/trust engine decides what to
 * show; the answer builder writes shopper-safe language. This module does NOT
 * rank, sort, score, build messages, call a route, or fabricate any
 * price/stock/shop — it only narrows a candidate set. Unmatched / unclear → [].
 *
 * Pure: no Supabase, no env, no network, no fs, no Gemini, no side effects.
 */

import type { DeterministicShoppingIntent } from "./deterministicShoppingIntent";
import { getConfidenceBand } from "./shopperTrustLabels";

/**
 * Minimal shape this filter reads. ScoredProduct (productService) satisfies it
 * structurally, so fetched rows can be passed straight through and returned
 * unchanged (ready for the ranker / shoppingAnswerBuilder downstream).
 */
export interface DeterministicCandidate {
  name: string;
  price?: number | null;
  /** Computed trust state (priceTrust). Preferred for verified_only. */
  trust_state?: string | null;
  /** Raw products.data_quality_status — fallback when trust_state is absent. */
  data_quality_status?: string | null;
}

/** The subset of a deterministic shopping intent that drives retrieval. */
export type DeterministicProductQuery = Pick<
  DeterministicShoppingIntent,
  "productTarget" | "budget" | "trustPreference"
>;

/**
 * Deterministically narrow candidate rows for a clear shopping intent.
 *
 * - product target: every whitespace token of `productTarget` must appear in the
 *   product name ("samsung tv" needs both words; "tv" needs "tv").
 * - budget: when present, keep only rows with a KNOWN numeric price at/under it.
 *   A row without a price is never assumed affordable (no fabricated prices).
 * - verified_only: keep only rows the existing trust map rates high-confidence.
 *
 * Note: `intent` (cheapest_option vs budget_search vs product_search) does NOT
 * change which candidates are retrieved — cheapest/best selection is the
 * ranker's job. Order is preserved here.
 *
 * Conservative: an empty/unclear product target, or no matches, returns [].
 */
export function filterDeterministicCandidates<T extends DeterministicCandidate>(
  rows: readonly T[] | null | undefined,
  query: DeterministicProductQuery
): T[] {
  const tokens = String(query?.productTarget ?? "")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);

  // No concrete product target → nothing to retrieve (stay conservative).
  if (!tokens.length) return [];

  const budget = query.budget ?? null;
  const verifiedOnly = query.trustPreference === "verified_only";

  return (rows ?? []).filter((row) => {
    // 1. Product-target match: every target token present in the name.
    const name = String(row?.name ?? "").toLowerCase();
    if (!tokens.every((t) => name.includes(t))) return false;

    // 2. Budget: require a KNOWN numeric price at/under budget. Never guess an
    //    unpriced row to be affordable (no fabricated prices).
    if (budget != null) {
      if (typeof row.price !== "number" || Number.isNaN(row.price)) return false;
      if (row.price > budget) return false;
    }

    // 3. verified_only: keep only high-confidence per the existing trust system.
    //    (Downstream shopper-facing logic still uses the safe trust labels.)
    if (verifiedOnly) {
      const band = getConfidenceBand({
        trustState: row.trust_state ?? null,
        dataQualityStatus: row.data_quality_status ?? null,
      });
      if (band !== "high") return false;
    }

    return true;
  });
}
