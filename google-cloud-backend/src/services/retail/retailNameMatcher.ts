/**
 * retailNameMatcher.ts — Retail Intelligence Core v1
 *
 * Single source of truth for product-name normalization and
 * observation → product matching.
 *
 * Matching rules (trust-critical, do not weaken):
 *   1. Prefer retail_price_observations.product_id when it resolves to a
 *      live product.
 *   2. Fall back to shop_id + normalized product_name only when product_id
 *      is absent or does not resolve.
 *   3. Exactly one shop/name candidate → safe match.
 *      More than one → "ambiguous"; the core never silently picks one.
 *   4. No candidates → "insert_new".
 *
 * Pure functions only: no I/O, no Supabase, no env reads.
 */

import {
  MatchResult,
  ObservationLike,
  ProductIndex,
  ProductLike,
} from "./retailTypes";

/** Lowercase, trim, collapse internal whitespace. */
export function normalizeProductName(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/** Composite key used for shop/name fallback matching. */
export function buildShopNameKey(shopId: unknown, productName: unknown): string {
  return `${String(shopId ?? "")}|${normalizeProductName(productName)}`;
}

/**
 * Index live products for matching. Shop/name buckets are arrays so that
 * duplicate names within a shop surface as ambiguity instead of being
 * silently overwritten.
 */
export function buildProductIndex(
  products: Iterable<ProductLike> | null | undefined
): ProductIndex {
  const byId = new Map<string, ProductLike>();
  const byShopAndName = new Map<string, ProductLike[]>();

  for (const product of products ?? []) {
    if (!product?.id) continue;
    byId.set(product.id, product);

    const key = buildShopNameKey(product.shop_id, product.name);
    const bucket = byShopAndName.get(key) ?? [];
    bucket.push(product);
    byShopAndName.set(key, bucket);
  }

  return { byId, byShopAndName };
}

/** Apply the matching rules above to a single observation. */
export function matchObservationToProduct(
  obs: ObservationLike,
  index: ProductIndex
): MatchResult {
  if (obs.product_id) {
    const linked = index.byId.get(obs.product_id) ?? null;
    if (linked) {
      return {
        strategy: "product_id",
        product: linked,
        candidates: [linked],
        reason: "Observation product_id resolves to a live product.",
      };
    }
  }

  const key = buildShopNameKey(obs.shop_id, obs.product_name);
  const candidates = index.byShopAndName.get(key) ?? [];

  if (candidates.length === 1) {
    return {
      strategy: "shop_name",
      product: candidates[0],
      candidates,
      reason: obs.product_id
        ? "product_id did not resolve to a live product; exactly one product matched by shop_id + normalized name."
        : "Exactly one product matched by shop_id + normalized name.",
    };
  }

  if (candidates.length > 1) {
    return {
      strategy: "ambiguous",
      product: null,
      candidates,
      reason: `${candidates.length} live products share shop_id + normalized name; refusing to choose automatically.`,
    };
  }

  return {
    strategy: "insert_new",
    product: null,
    candidates: [],
    reason: "No product with same shop_id and normalized name.",
  };
}
