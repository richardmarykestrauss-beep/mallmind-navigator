// ─────────────────────────────────────────────────────────────────────────────
// Shared TypeScript types — mirrors the Supabase database schema
// ─────────────────────────────────────────────────────────────────────────────

export interface Mall {
  id: string | number;
  name: string;
  city: string | null;
  province: string | null;
  lat: number | null;
  lng: number | null;
}

export interface Shop {
  id: string;
  mall_id: string;
  name: string;
  floor: string | null;
  unit_number: string | null;
  category: string | null;
  opening_time: string | null;   // "09:00:00"
  closing_time: string | null;   // "19:00:00"
}

/** Allowed values for products.data_quality_status */
export type DataQualityStatus =
  | "demo"
  | "manually_verified"
  | "live_feed"
  | "stale"
  | "user_submitted"
  | "needs_review";

/** Allowed values for products.price_verification_method */
export type PriceVerificationMethod =
  | "phone"
  | "website"
  | "flyer"
  | "receipt"
  | "store_visit"
  | "retailer_confirmation"
  | "scraper"
  | "retailer_api"
  | "user_submission";

export interface Product {
  id: string;
  shop_id: string;
  name: string;
  brand: string | null;
  category: string | null;
  price: number;
  original_price: number | null;
  is_on_special: boolean;
  /** ISO timestamp of last manual price verification. */
  price_verified_at: string | null;
  /** Trustworthiness classification for this price. Defaults to "demo". */
  data_quality_status: DataQualityStatus;
  /** How the price was confirmed (only meaningful for manually_verified / live_feed). */
  price_verification_method: PriceVerificationMethod | null;
  /** Free-text origin label, e.g. "manual_seed" or "takealot_scraper". */
  data_source: string | null;
  /** Optional identifier of who last verified this price. */
  verified_by: string | null;
}

export interface ShoppingSession {
  id: string;
  user_id: string | null;
  mall_id: string;
  started_at: string;
  last_seen_at: string;
  current_lat: number | null;
  current_lng: number | null;
  current_floor: string | null;
  current_anchor_node_id: string | null;
  active_route_id: string | null;
  shopping_intent: string | null;
  route_stop_ids: string[] | null;
  status: "active" | "completed" | "abandoned";
}

export interface MallNode {
  id: string;
  mall_id: string;
  name: string;
  type: "shop" | "entrance" | "escalator" | "lift" | "toilet" | "food_court" | "parking";
  floor: string | null;
  x_coordinate: number | null;
  y_coordinate: number | null;
  linked_shop_id: string | null;
}

export interface MallEdge {
  id: string;
  mall_id: string;
  from_node_id: string;
  to_node_id: string;
  distance_meters: number;
  floor_change: boolean;
  instruction: string | null;
}

export interface RouteStep {
  step: number;
  instruction: string;
  node_id: string;
  node_name: string;
  floor: string | null;
  distance_meters: number;
  floor_change: boolean;
  cumulative_meters: number;
}

export interface ScoredProduct {
  product_id: string;
  shop_id: string;
  name: string;
  brand: string | null;
  price: number;
  original_price: number | null;
  is_on_special: boolean;
  discount_pct: number | null;
  shop_name: string;
  floor: string | null;
  unit_number: string | null;
  is_open_now: boolean | null;
  is_cheapest: boolean;
  score: number;
  reason: string;
  /** ISO timestamp of last manual price verification. */
  price_verified_at: string | null;
  /** Trustworthiness classification for this price. */
  data_quality_status: DataQualityStatus;
  /** How the price was confirmed. */
  price_verification_method: PriceVerificationMethod | null;
  /** Free-text origin label. */
  data_source: string | null;
  /** Who last verified this price. */
  verified_by: string | null;
}

export interface ApiError {
  error: string;
  code?: string;
}
