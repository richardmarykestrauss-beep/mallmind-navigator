/**
 * retailTypes.ts — Retail Intelligence Core v1
 *
 * Shared types for the retail observation → product publish pipeline.
 * The core is pure and deterministic: no Supabase client, no env reads,
 * no database writes, no review_status mutation. Callers fetch rows and
 * perform writes; the core only decides.
 */

export type MatchStrategy = "product_id" | "shop_name" | "insert_new" | "ambiguous";

export type PlanAction = "update" | "insert" | "skip_ambiguous";

/** Allowed values of products.data_quality_status (migration 008). */
export type ProductQualityStatus =
  | "demo"
  | "manually_verified"
  | "live_feed"
  | "stale"
  | "user_submitted"
  | "needs_review";

/** Minimal product row shape required for matching/planning. */
export interface ProductLike {
  id: string;
  shop_id: string | null;
  name: string | null;
  price?: number | null;
  data_quality_status?: string | null;
  [key: string]: unknown;
}

/** Joined retail_data_sources row (as returned by Supabase nested select). */
export interface RetailSourceLike {
  id?: string | null;
  source_type?: string | null;
  name?: string | null;
  legal_status?: string | null;
  [key: string]: unknown;
}

/** Joined retail_source_snapshots row. */
export interface RetailSnapshotLike {
  id?: string | null;
  ref_label?: string | null;
  content_sha256?: string | null;
  [key: string]: unknown;
}

/** Minimal retail_price_observations row shape required for planning. */
export interface ObservationLike {
  id: string;
  mall_id?: string | null;
  shop_id: string | null;
  product_id?: string | null;
  product_name: string | null;
  brand?: string | null;
  model?: string | null;
  category?: string | null;
  price?: number | null;
  original_price?: number | null;
  is_on_special?: boolean | null;
  special_description?: string | null;
  in_stock?: boolean | null;
  trust_state?: string | null;
  verification_method?: string | null;
  confidence?: number | null;
  review_note?: string | null;
  retail_data_sources?: RetailSourceLike | null;
  retail_source_snapshots?: RetailSnapshotLike | null;
  [key: string]: unknown;
}

export interface ProductIndex {
  byId: Map<string, ProductLike>;
  /** Bucketed by `${shop_id}|${normalized name}`; arrays preserve ambiguity. */
  byShopAndName: Map<string, ProductLike[]>;
}

export interface MatchResult {
  strategy: MatchStrategy;
  /** The single safe match, or null for insert_new/ambiguous. */
  product: ProductLike | null;
  /** All shop/name candidates considered (length > 1 ⇒ ambiguous). */
  candidates: ProductLike[];
  reason: string;
}

/** Row written to public.products by the publisher (and only the publisher). */
export interface ProductPublishPayload {
  shop_id: string | null;
  mall_id: string | null;
  name: string | null;
  category: string | null;
  brand: string | null;
  model: string | null;
  price: number | null;
  original_price: number | null;
  is_on_special: boolean | null;
  special_description: string | null;
  image_url: null;
  in_stock: boolean | null;
  verified: boolean;
  price_verified_at: string | null;
  data_quality_status: ProductQualityStatus;
  price_verification_method: string | null;
  data_source: string;
  verified_by: string | null;
  deleted_at: null;
}

export interface PublishPlanItem {
  observation_id: string;
  action: PlanAction;
  match_strategy: MatchStrategy;
  match_reason: string;
  existing_product_id: string | null;
  existing_product: ProductLike | null;
  /** Populated only when match_strategy === "ambiguous". */
  ambiguous_candidate_ids: string[];
  product_name: string | null;
  shop_id: string | null;
  category: string | null;
  price: number | null;
  original_price: number | null;
  trust_state: string | null;
  verification_method: string | null;
  confidence: number | null;
  review_note: string | null;
  projected_product_quality: ProductQualityStatus;
  projected_verified: boolean;
  projected_verification_method: string | null;
  warnings: string[];
  payload: ProductPublishPayload;
}

export interface PublishPlanOptions {
  /**
   * Timestamp stamped into payload.price_verified_at. Passed in by the caller
   * so the core stays deterministic. Null (preview) leaves it null.
   */
  nowIso?: string | null;
  /** Identifier recorded in payload.verified_by (e.g. the publisher script path). */
  verifiedBy?: string | null;
}
