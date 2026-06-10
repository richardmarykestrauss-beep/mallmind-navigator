/**
 * retailPublishPlanner.ts — Retail Intelligence Core v1
 *
 * Single source of truth for turning approved retail observations into a
 * publish plan. Used by:
 *   - the admin publish-preview route (strictly read-only), and
 *   - scripts/retail/publish-staged-observations.mjs (writes only on --apply).
 *
 * The planner itself NEVER writes: it has no Supabase client, reads no env,
 * and mutates nothing. It also never selects rows — callers are responsible
 * for fetching only review_status='approved' observations; that gate lives
 * with the callers and must not be weakened.
 *
 * Ambiguous matches (multiple live products sharing shop_id + normalized
 * name) are marked action="skip_ambiguous" and must never be published
 * automatically.
 */

import {
  ObservationLike,
  ProductLike,
  ProductPublishPayload,
  PublishPlanItem,
  PublishPlanOptions,
} from "./retailTypes";
import { buildProductIndex, matchObservationToProduct } from "./retailNameMatcher";
import {
  isVerifiedQuality,
  mapTrustStateToProductQuality,
  mapVerificationMethod,
} from "./retailTrustMapper";
import { buildPublishWarnings } from "./retailWarnings";

/**
 * Build the products-row payload for one observation. price_verified_at and
 * verified_by come from options so the core stays deterministic; the preview
 * route omits them (null) because it never writes.
 */
export function buildProductPayload(
  obs: ObservationLike,
  options: PublishPlanOptions = {}
): ProductPublishPayload {
  const source = obs.retail_data_sources ?? null;
  const snapshot = obs.retail_source_snapshots ?? null;

  const productQuality = mapTrustStateToProductQuality(
    obs.trust_state,
    obs.verification_method
  );
  const mappedMethod = mapVerificationMethod(obs.verification_method);

  const dataSourceParts = [
    "retail_observation",
    source?.source_type ? `source:${source.source_type}` : null,
    obs.trust_state ? `trust:${obs.trust_state}` : null,
    obs.verification_method ? `method:${obs.verification_method}` : null,
    source?.id ? `source_id:${source.id}` : null,
    snapshot?.id ? `snapshot_id:${snapshot.id}` : null,
  ].filter(Boolean);

  return {
    shop_id: obs.shop_id ?? null,
    mall_id: obs.mall_id ?? null,
    name: obs.product_name ?? null,
    category: obs.category ?? null,
    brand: obs.brand ?? null,
    model: obs.model ?? null,
    price: obs.price ?? null,
    original_price: obs.original_price ?? null,
    is_on_special: obs.is_on_special ?? null,
    special_description: obs.special_description ?? null,
    image_url: null,
    in_stock: obs.in_stock ?? null,
    verified: isVerifiedQuality(productQuality),
    price_verified_at: options.nowIso ?? null,
    data_quality_status: productQuality,
    price_verification_method: mappedMethod,
    data_source: dataSourceParts.join("|"),
    verified_by: options.verifiedBy ?? null,
    deleted_at: null,
  };
}

/**
 * Build the full publish plan for a set of observations against the live
 * product catalogue. Order of observations is preserved.
 */
export function buildPublishPlan(
  observations: ObservationLike[] | null | undefined,
  products: ProductLike[] | null | undefined,
  options: PublishPlanOptions = {}
): PublishPlanItem[] {
  const index = buildProductIndex(products ?? []);

  return (observations ?? []).map((obs) => {
    const match = matchObservationToProduct(obs, index);
    const payload = buildProductPayload(obs, options);

    const action =
      match.strategy === "ambiguous"
        ? "skip_ambiguous"
        : match.product
          ? "update"
          : "insert";

    const warnings = buildPublishWarnings(obs, payload.data_quality_status);
    if (match.strategy === "ambiguous") {
      warnings.push(
        `Ambiguous product match (${match.candidates.length} candidates share shop_id + normalized name); the publisher will skip this row.`
      );
    }

    return {
      observation_id: obs.id,
      action,
      match_strategy: match.strategy,
      match_reason: match.reason,
      existing_product_id: match.product?.id ?? null,
      existing_product: match.product,
      ambiguous_candidate_ids:
        match.strategy === "ambiguous" ? match.candidates.map((c) => c.id) : [],
      product_name: obs.product_name ?? null,
      shop_id: obs.shop_id ?? null,
      category: obs.category ?? null,
      price: obs.price ?? null,
      original_price: obs.original_price ?? null,
      trust_state: obs.trust_state ?? null,
      verification_method: obs.verification_method ?? null,
      confidence: obs.confidence ?? null,
      review_note: obs.review_note ?? null,
      projected_product_quality: payload.data_quality_status,
      projected_verified: payload.verified,
      projected_verification_method: payload.price_verification_method,
      warnings,
      payload,
    };
  });
}
