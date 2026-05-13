/**
 * googleBackendClient.ts
 *
 * Optional bridge to the Google Cloud Run backend (google-cloud-backend/).
 *
 * HOW THE SWITCH WORKS
 * ─────────────────────
 * Set VITE_GOOGLE_BACKEND_URL in your .env (or Vite/CI config) to the Cloud Run
 * service URL. When the variable is present, every function in this module routes
 * traffic to the Cloud Run backend instead of the Supabase Edge Functions.
 * When the variable is absent or empty, `isGoogleBackendConfigured()` returns
 * false and callers fall through to the existing Supabase path — unchanged.
 *
 * SECURITY
 * ─────────
 * No secrets live here. The Cloud Run backend holds SUPABASE_SERVICE_ROLE_KEY
 * and GEMINI_API_KEY in Google Secret Manager. The frontend only needs the public
 * Cloud Run URL, which is safe to expose (the service uses IAM or allows
 * unauthenticated calls — your choice per deploy).
 *
 * RESPONSE SHAPES
 * ────────────────
 * The Cloud Run routes mirror the Supabase Edge Function API surface exactly.
 * Callers need no changes to their downstream data-handling code.
 */

import type { Mall } from "@/lib/supabaseClient";
import type { RouteStep } from "@/context/ShoppingSessionContext";
import type { ProductResult } from "@/components/RecommendationCard";

// ── Runtime config ────────────────────────────────────────────────────────────

const RAW_URL = (import.meta.env.VITE_GOOGLE_BACKEND_URL as string | undefined) ?? "";

/** Strip trailing slash so callers can concatenate `/path` without double-slash. */
const BASE_URL = RAW_URL.replace(/\/+$/, "");

/**
 * Returns true when VITE_GOOGLE_BACKEND_URL is set to a non-empty string.
 *
 * Use this as a guard in every call site:
 * ```ts
 * if (isGoogleBackendConfigured()) {
 *   data = await detectActiveMall({ lat, lng });
 * } else {
 *   // existing Supabase Edge Function path
 * }
 * ```
 */
export function isGoogleBackendConfigured(): boolean {
  return BASE_URL.length > 0;
}

// ── Shared types ──────────────────────────────────────────────────────────────
// Exported so pages can import them instead of re-declaring the same shapes.

/** Web search result — returned by the Supabase ai-assistant function. */
export interface WebResult {
  answer: string;
  sources: string[];
}

// ── Response interfaces ───────────────────────────────────────────────────────
// These mirror the Cloud Run route response payloads exactly.
// The Supabase Edge Functions return the same field names, so callers can
// use either backend with identical downstream logic.

export interface DetectActiveMallRequest {
  lat: number;
  lng: number;
  user_id?: string | null;
}

export interface DetectActiveMallResponse {
  mall: Mall;
  session_id: string | null;
  distance_km: number;
  within_radius: boolean;
}

export interface RecommendProductsResponse {
  recommendations: ProductResult[];
  total_found: number;
}

export interface BuildRouteResponse {
  route_id: string | null;
  steps: RouteStep[];
  total_distance_meters: number;
  estimated_minutes: number;
  stop_count: number;
  /**
   * true when no navigation graph exists for this mall.
   * The NavigateScreen falls back to a basic stop-list when this is true.
   */
  fallback: boolean;
}

export interface AssistantRequest {
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  mall_id?: string | null;
  mall_name?: string | null;
  session_id?: string | null;
  user_id?: string | null;
  current_lat?: number | null;
  current_lng?: number | null;
  shopping_intent?: string | null;
  budget?: number | null;
}

export interface AssistantResponse {
  message: string;
  products?: ProductResult[];
  web_results?: WebResult[];
  route_steps?: RouteStep[];
  route_id?: string | null;
  build_route?: boolean;
  route_shop_ids?: string[];
  route_summary?: string;
}

// ── Health check ─────────────────────────────────────────────────────────────

export interface HealthCheckResult {
  ok: boolean;
  /** HTTP status code when the server responded but not with 2xx */
  status?: number;
  /** Human-readable outcome message */
  message: string;
}

/**
 * GET /health
 *
 * Lightweight connectivity probe — no auth required.
 * Returns a structured result rather than throwing so callers can display
 * a friendly status without try/catch boilerplate.
 */
export async function checkBackendHealth(): Promise<HealthCheckResult> {
  if (!BASE_URL) {
    return { ok: false, message: "VITE_GOOGLE_BACKEND_URL is not configured" };
  }
  try {
    const res = await fetch(`${BASE_URL}/health`, { method: "GET" });
    if (res.ok) {
      return { ok: true, message: "Connected — backend is healthy" };
    }
    return {
      ok: false,
      status: res.status,
      message: `HTTP ${res.status} — backend responded with an error`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Distinguish CORS/network errors from general fetch errors
    const isCors = msg.toLowerCase().includes("failed to fetch") ||
                   msg.toLowerCase().includes("networkerror");
    return {
      ok: false,
      message: isCors
        ? `Network error — possible CORS block or backend unreachable (${msg})`
        : `Fetch failed — ${msg}`,
    };
  }
}

// ── Admin types ───────────────────────────────────────────────────────────────

// ── Founder Analytics types ───────────────────────────────────────────────────

export interface AnalyticsRecentEvent {
  id: string;
  created_at: string;
  event_type: string;
  query_text: string | null;
  product_id: string | null;
  shop_id: string | null;
  metadata: Record<string, unknown>;
}

export interface AnalyticsSummary {
  total_events: number;
  events_last_24h: number;
  assistant_queries: number;
  route_requests: number;
  route_responses: number;
  product_views: number;
  unique_event_types: string[];
  top_searches: Array<{ query_text: string; count: number }>;
  top_products: Array<{
    product_id: string;
    product_name: string;
    shop_name: string;
    data_quality_status: string;
    count: number;
  }>;
  top_shops: Array<{ shop_id: string; shop_name: string; count: number }>;
  recent_events: AnalyticsRecentEvent[];
  feedback_summary: {
    recommendation_useful:     number;
    recommendation_not_useful: number;
    price_correct:             number;
    price_incorrect:           number;
    routes_found:              number;
    routes_not_found:          number;
    bought:                    number;
    not_today:                 number;
  };
}

export interface AdminStatsResponse {
  counts: {
    malls: number;
    shops: number;
    products: number;
    users: number;
    active_sessions: number;
    active_routes: number;
  };
  recent_searches: Array<{ query: string; mall_id: string | null; created_at: string }>;
  recent_events: Array<{ event_name: string; user_id: string | null; created_at: string }>;
  analytics: AnalyticsSummary;
  generated_at: string;
}

/**
 * GET /admin-stats
 *
 * Returns aggregated platform metrics + founder analytics from analytics_events.
 * DEV_ONLY: No auth enforcement yet — protect before going public.
 */
export async function getAdminStats(): Promise<AdminStatsResponse> {
  if (!BASE_URL) {
    throw new Error("VITE_GOOGLE_BACKEND_URL is not configured");
  }
  const res = await fetch(`${BASE_URL}/admin-stats`, { method: "GET" });
  if (!res.ok) {
    let message = `Admin stats error ${res.status}`;
    try {
      const err = (await res.json()) as { error?: string };
      if (err.error) message = err.error;
    } catch { /* ignore */ }
    throw new Error(message);
  }
  return res.json() as Promise<AdminStatsResponse>;
}

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

export interface VerifyProductPriceRequest {
  product_id: string;
  price_verification_method: PriceVerificationMethod;
  /** Free-text origin e.g. "Game website", "in-store shelf", "phone call" */
  data_source: string;
  /** Name / email of the person confirming the price */
  verified_by: string;
}

// ── Internal HTTP helpers ─────────────────────────────────────────────────────

async function post<T>(path: string, body: unknown): Promise<T> {
  const url = `${BASE_URL}${path}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // No Authorization header — the Cloud Run backend holds all credentials.
    // VITE_GOOGLE_BACKEND_URL is the only value that must reach the frontend.
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    let message = `Google backend error ${res.status} on ${path}`;
    try {
      const err = (await res.json()) as { error?: string };
      if (err.error) message = err.error;
    } catch {
      // ignore JSON parse failure — use the default message above
    }
    throw new Error(message);
  }

  return res.json() as Promise<T>;
}

async function postAuthenticated(
  path: string,
  body: unknown,
  accessToken: string
): Promise<void> {
  const url = `${BASE_URL}${path}`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    let message = `Google backend error ${res.status} on ${path}`;
    try {
      const err = (await res.json()) as { error?: string };
      if (err.error) message = err.error;
    } catch {
      // ignore JSON parse failure — use the default message above
    }
    throw new Error(message);
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * POST /detect-active-mall
 *
 * GPS → nearest mall within 1 km radius + create/resume shopping session.
 * Mirrors the Supabase `detect-active-mall` Edge Function.
 *
 * Call site: src/pages/Malls.tsx → detectLocation()
 */
export async function detectActiveMall(params: {
  lat: number;
  lng: number;
  user_id?: string | null;
}): Promise<DetectActiveMallResponse> {
  return post<DetectActiveMallResponse>("/detect-active-mall", params);
}

/**
 * POST /recommend-products
 *
 * Scored, ranked product search for a specific mall.
 * Mirrors the Supabase `recommend-products` Edge Function.
 *
 * NOTE: In the current frontend flows, products are fetched server-side by
 * the /assistant endpoint (which calls this internally). This function is
 * exposed for future direct use when the frontend calls it independently.
 */
export async function recommendProducts(params: {
  mall_id: string;
  query: string;
  budget?: number | null;
  category?: string | null;
}): Promise<RecommendProductsResponse> {
  return post<RecommendProductsResponse>("/recommend-products", params);
}

/**
 * POST /build-route
 *
 * Dijkstra indoor routing via mall_nodes / mall_edges.
 * Mirrors the Supabase `build-route` Edge Function.
 *
 * NOTE: In the current frontend flows, routes are built server-side by the
 * /assistant endpoint. This function is exposed for future direct use.
 * Check `response.fallback === true` and show a store-list if so.
 */
export async function buildRoute(params: {
  session_id: string;
  destination_shop_ids: string[];
  user_id?: string | null;
}): Promise<BuildRouteResponse> {
  return post<BuildRouteResponse>("/build-route", params);
}

/**
 * POST /assistant
 *
 * Gemini 2.0 Flash assistant with function calling.
 * Internally calls recommend_products, build_route, check_store_hours,
 * and save_shopping_intent on the server — no extra client calls needed.
 *
 * Mirrors the Supabase `ai-assistant` Edge Function.
 * Response shape is identical so AssistantPage needs no downstream changes.
 *
 * Call site: src/pages/AssistantPage.tsx → sendMessage()
 */
export async function sendAssistantMessage(
  params: AssistantRequest
): Promise<AssistantResponse> {
  return post<AssistantResponse>("/assistant", params);
}

/**
 * POST /admin/verify-product-price
 *
 * Marks a product's price as manually verified and updates
 * data_quality_status → "manually_verified" on the backend.
 *
 * Requires the Supabase session accessToken for the signed-in admin.
 * Uses a separate authenticated helper — never sends a Bearer token on
 * public endpoints.
 */
export async function verifyProductPrice(
  payload: VerifyProductPriceRequest,
  accessToken: string
): Promise<void> {
  return postAuthenticated("/admin/verify-product-price", payload, accessToken);
}
