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

// ── Price correction types ────────────────────────────────────────────────────

export interface PriceCorrectionReport {
  id: string;
  created_at: string;
  updated_at: string;
  user_id: string | null;
  mall_id: string | null;
  product_id: string;
  shop_id: string | null;
  current_price: number | null;
  reported_price: number | null;
  user_note: string | null;
  source_type: string | null;
  status: "pending" | "needs_verification" | "approved" | "rejected";
  admin_note: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  confidence_score: number | null;
  metadata: Record<string, unknown>;
  // Flattened join fields
  product_name: string | null;
  product_current_price: number | null;
  shop_name: string | null;
}

export interface PriceCorrectionsAdminResponse {
  pending: PriceCorrectionReport[];
  recent: PriceCorrectionReport[];
}

export interface ReportPriceCorrectionRequest {
  product_id: string;
  shop_id?: string | null;
  mall_id?: string | null;
  current_price?: number | null;
  reported_price?: number | null;
  user_note?: string | null;
  source_type?: string | null;
  metadata?: Record<string, unknown>;
}

export interface ReviewPriceCorrectionRequest {
  action: "approve" | "reject" | "needs_verification";
  approved_price?: number;
  admin_note?: string;
  verification_method?: string;
  data_source?: string;
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

// ── Mall Data Compiler types ──────────────────────────────────────────────────

export type MallDataSourceType =
  | "official_website"
  | "retail_directory"
  | "public_flyer"
  | "manual_survey"
  | "press_release"
  | "social_media"
  | "other";

export type MallDataFindingType =
  | "shop"
  | "product"
  | "mall_hours"
  | "shop_hours"
  | "floor_layout"
  | "promotion"
  | "other";

export type MallDataFindingStatus = "pending" | "approved" | "rejected" | "needs_more_info";

export interface MallDataSource {
  id: string;
  created_at: string;
  updated_at: string;
  mall_id: string;
  label: string;
  source_type: MallDataSourceType;
  source_url: string | null;
  notes: string | null;
  created_by: string | null;
  is_active: boolean;
  /** Joined mall name */
  malls?: { id: string; name: string } | null;
}

export interface MallDataFinding {
  id: string;
  created_at: string;
  updated_at: string;
  source_id: string;
  mall_id: string;
  finding_type: MallDataFindingType;
  shop_id: string | null;
  product_id: string | null;
  data: Record<string, unknown>;
  raw_snippet: string | null;
  status: MallDataFindingStatus;
  admin_note: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_by: string | null;
  confidence: number | null;
  /** Joined source fields */
  mall_research_sources?: {
    label: string;
    source_type: string;
    source_url: string | null;
  } | null;
}

export interface CreateMallDataSourceRequest {
  mall_id: string;
  label: string;
  source_type?: MallDataSourceType;
  source_url?: string | null;
  notes?: string | null;
}

export interface CreateMallDataFindingRequest {
  source_id: string;
  mall_id: string;
  finding_type?: MallDataFindingType;
  shop_id?: string | null;
  product_id?: string | null;
  data?: Record<string, unknown>;
  raw_snippet?: string | null;
  confidence?: number | null;
}

export interface ReviewMallDataFindingRequest {
  action: "approve" | "reject" | "needs_more_info";
  admin_note?: string | null;
  confidence?: number | null;
}

// ── Data Guardian types ───────────────────────────────────────────────────────

export interface DataGuardianInput {
  mall_id?: string;
  source_type?: string;
  finding_type?: string;
  submitted_by_type?: "user" | "admin" | "retailer" | "mall" | "system";
  raw_text?: string;
  source_url?: string;
  evidence_types?: string[];
  structured_data?: Record<string, unknown>;
  observed_at?: string;
  has_photo?: boolean;
  has_receipt?: boolean;
  has_official_source?: boolean;
  has_retailer_confirmation?: boolean;
  has_mall_confirmation?: boolean;
  has_physical_verification?: boolean;
}

export type DataGuardianRecommendedAction =
  | "create_finding"
  | "needs_more_info"
  | "reject"
  | "approve_for_admin_review"
  | "apply_to_existing_record";

export type DataGuardianTrustLevel =
  | "demo"
  | "user_submitted"
  | "evidence_submitted"
  | "source_matched"
  | "admin_verified"
  | "physically_verified"
  | "retailer_verified"
  | "mall_verified";

export type DataGuardianFindingType =
  | "shop"
  | "product"
  | "price"
  | "trading_hours"
  | "floor_layout"
  | "route_hint"
  | "promotion"
  | "other";

export interface DataGuardianResult {
  recommended_action: DataGuardianRecommendedAction;
  finding_type: DataGuardianFindingType;
  trust_level: DataGuardianTrustLevel;
  confidence_score: number;
  safe_badge: string;
  reasoning_summary: string;
  missing_evidence: string[];
  structured_data: Record<string, unknown>;
  admin_note: string;
  must_not_update_live_data: boolean;
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

async function postAuthWithResponse<T>(
  path: string,
  body: unknown,
  accessToken: string
): Promise<T> {
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
    } catch { /* ignore */ }
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

async function getAuthenticated<T>(path: string, accessToken: string): Promise<T> {
  const url = `${BASE_URL}${path}`;
  const res = await fetch(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    let message = `Google backend error ${res.status} on ${path}`;
    try {
      const err = (await res.json()) as { error?: string };
      if (err.error) message = err.error;
    } catch { /* ignore */ }
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

async function patchAuthWithResponse<T>(
  path: string,
  body: unknown,
  accessToken: string
): Promise<T> {
  const url = `${BASE_URL}${path}`;
  const res = await fetch(url, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let message = `Google backend error ${res.status} on PATCH ${path}`;
    try {
      const err = (await res.json()) as { error?: string };
      if (err.error) message = err.error;
    } catch { /* ignore */ }
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

// ── Price correction public API ───────────────────────────────────────────────

/**
 * POST /price-corrections/report
 *
 * Submit a user price correction report.
 * Does NOT require auth — token attached if available.
 * Never updates product prices directly.
 */
export async function reportPriceCorrection(
  payload: ReportPriceCorrectionRequest
): Promise<{ ok: boolean; report_id: string }> {
  return post<{ ok: boolean; report_id: string }>("/price-corrections/report", payload);
}

/**
 * GET /price-corrections/admin
 *
 * Fetch pending + recently reviewed price correction reports.
 * Requires admin bearer token.
 */
export async function getAdminPriceCorrections(
  accessToken: string
): Promise<PriceCorrectionsAdminResponse> {
  if (!BASE_URL) throw new Error("VITE_GOOGLE_BACKEND_URL is not configured");
  const res = await fetch(`${BASE_URL}/price-corrections/admin`, {
    method: "GET",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    let message = `Price corrections error ${res.status}`;
    try {
      const err = (await res.json()) as { error?: string };
      if (err.error) message = err.error;
    } catch { /* ignore */ }
    throw new Error(message);
  }
  return res.json() as Promise<PriceCorrectionsAdminResponse>;
}

/**
 * POST /price-corrections/admin/:id/review
 *
 * Admin approve / reject / needs_verification action.
 * Only approve can update product prices — reject and needs_verification do not.
 * Requires admin bearer token. All actions are written to admin_audit_log.
 */
export async function reviewPriceCorrection(
  reportId: string,
  payload: ReviewPriceCorrectionRequest,
  accessToken: string
): Promise<{ ok: boolean; action: string }> {
  if (!BASE_URL) throw new Error("VITE_GOOGLE_BACKEND_URL is not configured");
  const res = await fetch(`${BASE_URL}/price-corrections/admin/${reportId}/review`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    let message = `Review error ${res.status}`;
    try {
      const err = (await res.json()) as { error?: string };
      if (err.error) message = err.error;
    } catch { /* ignore */ }
    throw new Error(message);
  }
  return res.json() as Promise<{ ok: boolean; action: string }>;
}

// ── Mall Data Compiler public API ─────────────────────────────────────────────

/**
 * GET /admin/mall-data/sources
 *
 * List research sources, optionally filtered by mall_id.
 * Requires admin bearer token.
 */
export async function getMallDataSources(
  accessToken: string,
  filters?: { mall_id?: string; active?: boolean }
): Promise<{ sources: MallDataSource[] }> {
  if (!BASE_URL) throw new Error("VITE_GOOGLE_BACKEND_URL is not configured");
  const params = new URLSearchParams();
  if (filters?.mall_id) params.set("mall_id", filters.mall_id);
  if (filters?.active === false) params.set("active", "false");
  const qs = params.toString() ? `?${params.toString()}` : "";
  return getAuthenticated<{ sources: MallDataSource[] }>(
    `/admin/mall-data/sources${qs}`,
    accessToken
  );
}

/**
 * POST /admin/mall-data/sources
 *
 * Create a new research source.
 * Requires admin bearer token.
 */
export async function createMallDataSource(
  payload: CreateMallDataSourceRequest,
  accessToken: string
): Promise<{ ok: boolean; source_id: string }> {
  if (!BASE_URL) throw new Error("VITE_GOOGLE_BACKEND_URL is not configured");
  const res = await fetch(`${BASE_URL}/admin/mall-data/sources`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    let message = `Create source error ${res.status}`;
    try {
      const err = (await res.json()) as { error?: string };
      if (err.error) message = err.error;
    } catch { /* ignore */ }
    throw new Error(message);
  }
  return res.json() as Promise<{ ok: boolean; source_id: string }>;
}

/**
 * GET /admin/mall-data/findings
 *
 * List findings, optionally filtered by source_id, mall_id, status, finding_type.
 * Requires admin bearer token.
 */
export async function getMallDataFindings(
  accessToken: string,
  filters?: {
    source_id?:    string;
    mall_id?:      string;
    status?:       MallDataFindingStatus;
    finding_type?: MallDataFindingType;
  }
): Promise<{ findings: MallDataFinding[] }> {
  if (!BASE_URL) throw new Error("VITE_GOOGLE_BACKEND_URL is not configured");
  const params = new URLSearchParams();
  if (filters?.source_id)    params.set("source_id",    filters.source_id);
  if (filters?.mall_id)      params.set("mall_id",      filters.mall_id);
  if (filters?.status)       params.set("status",       filters.status);
  if (filters?.finding_type) params.set("finding_type", filters.finding_type);
  const qs = params.toString() ? `?${params.toString()}` : "";
  return getAuthenticated<{ findings: MallDataFinding[] }>(
    `/admin/mall-data/findings${qs}`,
    accessToken
  );
}

/**
 * POST /admin/mall-data/findings
 *
 * Log a new finding against a research source.
 * Requires admin bearer token.
 */
export async function createMallDataFinding(
  payload: CreateMallDataFindingRequest,
  accessToken: string
): Promise<{ ok: boolean; finding_id: string }> {
  if (!BASE_URL) throw new Error("VITE_GOOGLE_BACKEND_URL is not configured");
  const res = await fetch(`${BASE_URL}/admin/mall-data/findings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    let message = `Create finding error ${res.status}`;
    try {
      const err = (await res.json()) as { error?: string };
      if (err.error) message = err.error;
    } catch { /* ignore */ }
    throw new Error(message);
  }
  return res.json() as Promise<{ ok: boolean; finding_id: string }>;
}

/**
 * POST /admin/mall-data/findings/:id/review
 *
 * Approve, reject, or flag a finding for more information.
 * Requires admin bearer token.
 */
export async function reviewMallDataFinding(
  findingId: string,
  payload: ReviewMallDataFindingRequest,
  accessToken: string
): Promise<{ ok: boolean; action: string; new_status: string }> {
  if (!BASE_URL) throw new Error("VITE_GOOGLE_BACKEND_URL is not configured");
  const res = await fetch(`${BASE_URL}/admin/mall-data/findings/${findingId}/review`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    let message = `Review finding error ${res.status}`;
    try {
      const err = (await res.json()) as { error?: string };
      if (err.error) message = err.error;
    } catch { /* ignore */ }
    throw new Error(message);
  }
  return res.json() as Promise<{ ok: boolean; action: string; new_status: string }>;
}

// ── Data Guardian public API ──────────────────────────────────────────────────

/**
 * POST /admin/data-guardian/review
 *
 * Deterministic trust scoring for a mall data submission.
 * Returns a structured review result with trust level, confidence score,
 * safe badge wording, missing evidence list, and recommended action.
 *
 * Does NOT write to shops, products, or mall_nodes.
 * Requires admin bearer token.
 */
export async function reviewDataSubmission(
  payload: DataGuardianInput,
  accessToken: string
): Promise<DataGuardianResult> {
  if (!BASE_URL) throw new Error("VITE_GOOGLE_BACKEND_URL is not configured");
  return postAuthWithResponse<DataGuardianResult>(
    "/admin/data-guardian/review",
    payload,
    accessToken
  );
}

// ── Data Intelligence Bots types ──────────────────────────────────────────────

export type BotRiskLevel      = "low" | "medium" | "high" | "critical";
export type BotRecommendation = "proceed" | "proceed_with_caution" | "needs_admin_review" | "reject" | "escalate";
export type LiveDataActionSafety =
  | "safe_to_plan"
  | "requires_review"
  | "do_not_apply"
  | "blocked_by_policy";

export interface BotOutputBase {
  bot_name:                  string;
  processed_at:              string;
  risk_level:                BotRiskLevel;
  recommendation:            BotRecommendation;
  live_data_action_safety:   LiveDataActionSafety;
  reasoning:                 string[];
  must_not_update_live_data: boolean;
}

// Source Research Bot
export interface SourceResearchInput {
  source_url?:         string;
  source_name?:        string;
  source_description?: string;
  submitted_by_type?:  "user" | "admin" | "retailer" | "mall" | "system";
}

export interface SourceResearchResult extends BotOutputBase {
  source_category:      string;
  is_restricted:        boolean;
  restriction_reason?:  string;
  trust_ceiling:        string;
  sa_relevance_signals: string[];
  quality_flags:        string[];
}

// Finding Extractor Bot
export interface FindingExtractorInput {
  raw_text:           string;
  hint_finding_type?: string;
}

export interface ExtractedField {
  field:           string;
  value:           string;
  confidence:      number;
  pattern_matched: string;
}

export interface ExtractedFinding {
  finding_type: string;
  fields:       ExtractedField[];
  raw_snippet:  string;
}

export interface FindingExtractorResult extends BotOutputBase {
  extracted_findings:     ExtractedFinding[];
  extraction_summary:     string;
  total_signals_found:    number;
  finding_types_detected: string[];
}

// Duplicate Detection Bot
export interface DuplicateDetectionInput {
  finding_type:  "shop" | "product" | "price" | "other";
  name?:         string;
  mall_id?:      string;
  floor?:        string;
  unit_number?:  string;
  brand?:        string;
}

export interface DuplicateCandidate {
  match_strength:   string;
  match_score:      number;
  matched_table:    "shops" | "products";
  matched_id:       string;
  matched_name:     string;
  matched_mall_id?: string;
  matched_floor?:   string;
  matched_unit?:    string;
  overlap_reason:   string;
}

export interface DuplicateDetectionResult extends BotOutputBase {
  duplicates_found:     number;
  top_candidate?:       DuplicateCandidate;
  all_candidates:       DuplicateCandidate[];
  dedup_recommendation: "create_new" | "link_to_existing" | "needs_human_review";
}

// Admin Review Assistant Bot
export interface AdminReviewAssistantInput {
  guardian_result?:  DataGuardianResult;
  source_result?:    SourceResearchResult;
  duplicate_result?: DuplicateDetectionResult;
  extractor_result?: FindingExtractorResult;
}

export interface AdminReviewAction {
  priority:     "critical" | "high" | "medium" | "low";
  action_label: string;
  description:  string;
}

export interface AdminReviewAssistantResult extends BotOutputBase {
  overall_risk:        BotRiskLevel;
  recommended_actions: AdminReviewAction[];
  summary_for_admin:   string;
  confidence_score:    number;
  trust_level?:        string;
  safe_to_proceed:     boolean;
  blocker_reasons:     string[];
}

// Live Data Apply Planner Bot
export interface LiveDataApplyPlannerInput {
  finding_type:     "shop" | "product" | "price" | "trading_hours" | "floor_layout" | "promotion" | "other";
  trust_level:      string;
  confidence_score: number;
  structured_data:  Record<string, unknown>;
  target_record_id?: string;
  mall_id?:         string;
}

export interface FieldPatch {
  field:          string;
  proposed_value: unknown;
  current_value?: unknown;
  confidence:     number;
  notes?:         string;
}

export interface LiveDataApplyPlannerResult extends BotOutputBase {
  target_table:     string;
  target_record_id?: string;
  proposed_patches: FieldPatch[];
  fields_skipped:   string[];
  plan_summary:     string;
  plan_blocked:     boolean;
  block_reason?:    string;
}

// ── Data Intelligence Bots public API ────────────────────────────────────────

/**
 * POST /admin/data-bots/source-research
 *
 * Classify a source URL/name/description for safety and SA relevance.
 * Deterministic — no DB reads. Blocks Google Maps / Places sources.
 * Requires admin bearer token.
 */
export async function runSourceResearch(
  payload: SourceResearchInput,
  accessToken: string
): Promise<SourceResearchResult> {
  if (!BASE_URL) throw new Error("VITE_GOOGLE_BACKEND_URL is not configured");
  return postAuthWithResponse<SourceResearchResult>(
    "/admin/data-bots/source-research",
    payload,
    accessToken
  );
}

/**
 * POST /admin/data-bots/extract-finding
 *
 * Parse structured fields (prices, unit codes, shop names, hours) from raw text.
 * Deterministic regex extraction — no DB reads.
 * Requires admin bearer token.
 */
export async function runFindingExtractor(
  payload: FindingExtractorInput,
  accessToken: string
): Promise<FindingExtractorResult> {
  if (!BASE_URL) throw new Error("VITE_GOOGLE_BACKEND_URL is not configured");
  return postAuthWithResponse<FindingExtractorResult>(
    "/admin/data-bots/extract-finding",
    payload,
    accessToken
  );
}

/**
 * POST /admin/data-bots/detect-duplicates
 *
 * Search existing shops/products for potential duplicates of a submission.
 * Reads Supabase — async. Never writes.
 * Requires admin bearer token.
 */
export async function runDuplicateDetection(
  payload: DuplicateDetectionInput,
  accessToken: string
): Promise<DuplicateDetectionResult> {
  if (!BASE_URL) throw new Error("VITE_GOOGLE_BACKEND_URL is not configured");
  return postAuthWithResponse<DuplicateDetectionResult>(
    "/admin/data-bots/detect-duplicates",
    payload,
    accessToken
  );
}

/**
 * POST /admin/data-bots/review-assistant
 *
 * Synthesise Guardian + Source + Duplicate + Extractor results into a
 * prioritised action summary for an admin.
 * Pure function — accepts pre-run bot results as input.
 * Requires admin bearer token.
 */
export async function runAdminReviewAssistant(
  payload: AdminReviewAssistantInput,
  accessToken: string
): Promise<AdminReviewAssistantResult> {
  if (!BASE_URL) throw new Error("VITE_GOOGLE_BACKEND_URL is not configured");
  return postAuthWithResponse<AdminReviewAssistantResult>(
    "/admin/data-bots/review-assistant",
    payload,
    accessToken
  );
}

/**
 * POST /admin/data-bots/plan-apply
 *
 * Propose a field-level patch plan for applying a finding to live data.
 * Returns a proposal ONLY — never writes to shops/products/mall_nodes.
 * Minimum trust level: admin_verified (rank 4/7).
 * Requires admin bearer token.
 */
export async function runLiveDataApplyPlanner(
  payload: LiveDataApplyPlannerInput,
  accessToken: string
): Promise<LiveDataApplyPlannerResult> {
  if (!BASE_URL) throw new Error("VITE_GOOGLE_BACKEND_URL is not configured");
  return postAuthWithResponse<LiveDataApplyPlannerResult>(
    "/admin/data-bots/plan-apply",
    payload,
    accessToken
  );
}

// ── Mall Research Batch Workflow types ────────────────────────────────────────
// Sprint 9E

export type MallResearchBatchStatus = "open" | "in_progress" | "complete" | "archived";
export type MallResearchItemStatus  = "pending" | "reviewed" | "accepted" | "rejected" | "flagged";
export type MallResearchFindingType =
  | "shop"
  | "product"
  | "trading_hours"
  | "floor_layout"
  | "promotion"
  | "other";

export interface MallResearchBatch {
  id:             string;
  mall_id:        string | null;
  mall_name:      string | null;
  title:          string;
  description:    string | null;
  status:         MallResearchBatchStatus;
  notes:          string | null;
  item_count:     number;
  reviewed_count: number;
  created_by:     string | null;
  created_at:     string;
  updated_at:     string;
}

export interface MallResearchBatchItem {
  id:              string;
  batch_id:        string;
  sequence_number: number | null;
  finding_type:    MallResearchFindingType;
  raw_text:        string | null;
  source_url:      string | null;
  source_name:     string | null;
  status:          MallResearchItemStatus;
  admin_notes:     string | null;
  bot_hints_used:  Record<string, unknown>;
  extracted_data:  Record<string, unknown>;
  reviewed_by:     string | null;
  reviewed_at:     string | null;
  created_at:      string;
  updated_at:      string;
}

export interface MallResearchBatchWithItems extends MallResearchBatch {
  items: MallResearchBatchItem[];
}

export interface CreateMallResearchBatchInput {
  mall_id?:     string;
  title:        string;
  description?: string;
  notes?:       string;
}

export interface CreateMallResearchBatchItemInput {
  finding_type?:    MallResearchFindingType;
  raw_text?:        string;
  source_url?:      string;
  source_name?:     string;
  sequence_number?: number;
}

export interface ReviewMallResearchBatchItemInput {
  status?:         MallResearchItemStatus;
  admin_notes?:    string;
  extracted_data?: Record<string, unknown>;
  bot_hints_used?: Record<string, unknown>;
}

// ── Mall Research Batch Workflow public API ───────────────────────────────────

/**
 * GET /admin/mall-research/batches
 *
 * List all research batches, newest first.
 * Optional filters: mall_id, status.
 * Requires admin bearer token.
 */
export async function getMallResearchBatches(
  accessToken: string,
  filters?: { mall_id?: string; status?: MallResearchBatchStatus }
): Promise<{ batches: MallResearchBatch[]; total: number }> {
  if (!BASE_URL) throw new Error("VITE_GOOGLE_BACKEND_URL is not configured");
  const params = new URLSearchParams();
  if (filters?.mall_id) params.set("mall_id", filters.mall_id);
  if (filters?.status)  params.set("status",  filters.status);
  const qs   = params.toString();
  const path = `/admin/mall-research/batches${qs ? `?${qs}` : ""}`;
  return getAuthenticated<{ batches: MallResearchBatch[]; total: number }>(path, accessToken);
}

/**
 * POST /admin/mall-research/batches
 *
 * Create a new research batch for a mall.
 * Requires admin bearer token.
 */
export async function createMallResearchBatch(
  payload: CreateMallResearchBatchInput,
  accessToken: string
): Promise<MallResearchBatch> {
  if (!BASE_URL) throw new Error("VITE_GOOGLE_BACKEND_URL is not configured");
  return postAuthWithResponse<MallResearchBatch>(
    "/admin/mall-research/batches",
    payload,
    accessToken
  );
}

/**
 * GET /admin/mall-research/batches/:id
 *
 * Fetch a single batch with all its items.
 * Requires admin bearer token.
 */
export async function getMallResearchBatch(
  batchId: string,
  accessToken: string
): Promise<MallResearchBatchWithItems> {
  if (!BASE_URL) throw new Error("VITE_GOOGLE_BACKEND_URL is not configured");
  return getAuthenticated<MallResearchBatchWithItems>(
    `/admin/mall-research/batches/${batchId}`,
    accessToken
  );
}

/**
 * POST /admin/mall-research/batches/:id/items
 *
 * Add a new finding item to a batch.
 * Requires admin bearer token.
 */
export async function createMallResearchBatchItem(
  batchId: string,
  payload: CreateMallResearchBatchItemInput,
  accessToken: string
): Promise<MallResearchBatchItem> {
  if (!BASE_URL) throw new Error("VITE_GOOGLE_BACKEND_URL is not configured");
  return postAuthWithResponse<MallResearchBatchItem>(
    `/admin/mall-research/batches/${batchId}/items`,
    payload,
    accessToken
  );
}

/**
 * PATCH /admin/mall-research/batches/:id/items/:itemId
 *
 * Update an item's review status, notes, extracted data, or bot hints.
 * Requires admin bearer token.
 */
export async function reviewMallResearchBatchItem(
  batchId: string,
  itemId: string,
  payload: ReviewMallResearchBatchItemInput,
  accessToken: string
): Promise<MallResearchBatchItem> {
  if (!BASE_URL) throw new Error("VITE_GOOGLE_BACKEND_URL is not configured");
  return patchAuthWithResponse<MallResearchBatchItem>(
    `/admin/mall-research/batches/${batchId}/items/${itemId}`,
    payload,
    accessToken
  );
}

/**
 * PATCH /admin/mall-research/batches/:id/status
 *
 * Transition a batch to a new status (open → in_progress → complete / archived).
 * Requires admin bearer token.
 */
export async function updateMallResearchBatchStatus(
  batchId: string,
  status: MallResearchBatchStatus,
  accessToken: string
): Promise<MallResearchBatch> {
  if (!BASE_URL) throw new Error("VITE_GOOGLE_BACKEND_URL is not configured");
  return patchAuthWithResponse<MallResearchBatch>(
    `/admin/mall-research/batches/${batchId}/status`,
    { status },
    accessToken
  );
}

// ── One-Click Bot Pipeline types (Sprint 9F) ──────────────────────────────────

export interface PipelineBotResult {
  item_id:         string;
  bot_hints_used:  Record<string, unknown>;
  steps_completed?: string[];
  warnings?:        string[];
  halted_at?:       string;
  // Populated when Finding Extractor ran — carry back to sync local item state
  extracted_data?:  Record<string, unknown>;
  finding_type?:    string;
  // Individual bot outputs — whichever were run
  source_research?:     Record<string, unknown>;
  finding_extractor?:   Record<string, unknown>;
  data_guardian?:       Record<string, unknown>;
  duplicate_detection?: Record<string, unknown>;
  admin_review?:        Record<string, unknown>;
}

// ── One-Click Bot Pipeline public API ─────────────────────────────────────────

/**
 * POST /admin/mall-research/items/:itemId/run-source-research
 *
 * Run Source Research Bot on a batch item's source URL/name.
 * Saves result to item.bot_hints_used.source_research.
 * Requires admin bearer token.
 */
export async function runResearchItemSourceResearch(
  itemId: string,
  accessToken: string
): Promise<PipelineBotResult> {
  if (!BASE_URL) throw new Error("VITE_GOOGLE_BACKEND_URL is not configured");
  return postAuthWithResponse<PipelineBotResult>(
    `/admin/mall-research/items/${itemId}/run-source-research`,
    {},
    accessToken
  );
}

/**
 * POST /admin/mall-research/items/:itemId/run-finding-extractor
 *
 * Run Finding Extractor Bot on a batch item's raw text.
 * Saves result to item.bot_hints_used.finding_extractor.
 * Also merges extracted fields into item.extracted_data (staging only).
 * Requires admin bearer token.
 */
export async function runResearchItemFindingExtractor(
  itemId: string,
  accessToken: string
): Promise<PipelineBotResult> {
  if (!BASE_URL) throw new Error("VITE_GOOGLE_BACKEND_URL is not configured");
  return postAuthWithResponse<PipelineBotResult>(
    `/admin/mall-research/items/${itemId}/run-finding-extractor`,
    {},
    accessToken
  );
}

/**
 * POST /admin/mall-research/items/:itemId/run-data-guardian
 *
 * Run Data Guardian on a batch item.
 * Saves result to item.bot_hints_used.data_guardian.
 * Requires admin bearer token.
 */
export async function runResearchItemDataGuardian(
  itemId: string,
  accessToken: string
): Promise<PipelineBotResult> {
  if (!BASE_URL) throw new Error("VITE_GOOGLE_BACKEND_URL is not configured");
  return postAuthWithResponse<PipelineBotResult>(
    `/admin/mall-research/items/${itemId}/run-data-guardian`,
    {},
    accessToken
  );
}

/**
 * POST /admin/mall-research/items/:itemId/run-duplicate-check
 *
 * Run Duplicate Detection Bot on a batch item.
 * Saves result to item.bot_hints_used.duplicate_detection.
 * Requires admin bearer token.
 */
export async function runResearchItemDuplicateCheck(
  itemId: string,
  accessToken: string
): Promise<PipelineBotResult> {
  if (!BASE_URL) throw new Error("VITE_GOOGLE_BACKEND_URL is not configured");
  return postAuthWithResponse<PipelineBotResult>(
    `/admin/mall-research/items/${itemId}/run-duplicate-check`,
    {},
    accessToken
  );
}

/**
 * POST /admin/mall-research/items/:itemId/run-admin-review
 *
 * Run Admin Review Assistant on a batch item, synthesising all previously
 * run bot outputs in bot_hints_used.
 * Saves result to item.bot_hints_used.admin_review.
 * Requires admin bearer token.
 */
export async function runResearchItemAdminReview(
  itemId: string,
  accessToken: string
): Promise<PipelineBotResult> {
  if (!BASE_URL) throw new Error("VITE_GOOGLE_BACKEND_URL is not configured");
  return postAuthWithResponse<PipelineBotResult>(
    `/admin/mall-research/items/${itemId}/run-admin-review`,
    {},
    accessToken
  );
}

/**
 * POST /admin/mall-research/items/:itemId/run-full-pipeline
 *
 * Run all 5 bots in sequence: Source Research → Finding Extractor →
 * Data Guardian → Duplicate Detection → Admin Review Assistant.
 * Saves each output to bot_hints_used. Steps that fail are saved as errors;
 * pipeline continues where safe.
 * Item status is NEVER changed automatically.
 * Requires admin bearer token.
 */
export async function runResearchItemFullPipeline(
  itemId: string,
  accessToken: string
): Promise<PipelineBotResult> {
  if (!BASE_URL) throw new Error("VITE_GOOGLE_BACKEND_URL is not configured");
  return postAuthWithResponse<PipelineBotResult>(
    `/admin/mall-research/items/${itemId}/run-full-pipeline`,
    {},
    accessToken
  );
}

// ── Source Ingestion Agent types (Sprint 9H) ──────────────────────────────────

export interface IngestionSummary {
  source_url:          string;
  source_name?:        string;
  allowed_to_ingest:   boolean;
  blocked_reason?:     string;
  fetched:             boolean;
  text_length:         number;
  candidate_count:     number;
  created_item_count:  number;
  skipped_item_count:  number;
  pipeline_run_count:  number;
  warnings:            string[];
}

export interface SkippedCandidate {
  reason:   string;
  raw_text: string;
}

export interface IngestSourceResult {
  ok:                     boolean;
  source_research_result: Record<string, unknown> | null;
  ingestion_summary:      IngestionSummary;
  created_items:          MallResearchBatchItem[];
  skipped_candidates:     SkippedCandidate[];
}

export interface IngestSourceInput {
  source_url:    string;
  source_name?:  string;
  source_type?:  string;
  max_items?:    number;
  run_pipeline?: boolean;
}

/**
 * POST /admin/mall-research/batches/:batchId/ingest-source
 *
 * Ingests a single public source URL for a research batch.
 * Source Research Bot → fetch → HTML extraction → candidate chunks →
 * Finding Extractor → batch items created (status: pending).
 * Optionally runs the full bot pipeline on each created item.
 *
 * NEVER writes to shops, products, or mall_nodes.
 * Restricted sources (Google Maps, Yelp, Apple Maps, etc.) are blocked.
 * Requires admin bearer token.
 */
export async function ingestMallResearchSource(
  batchId: string,
  payload: IngestSourceInput,
  accessToken: string
): Promise<IngestSourceResult> {
  if (!BASE_URL) throw new Error("VITE_GOOGLE_BACKEND_URL is not configured");
  return postAuthWithResponse<IngestSourceResult>(
    `/admin/mall-research/batches/${batchId}/ingest-source`,
    payload,
    accessToken
  );
}

// ── Mall Intelligence types (Sprint 12C) ──────────────────────────────────────

export type MallSourceType =
  | "official_website"
  | "floor_map"
  | "store_directory"
  | "tenant_list"
  | "social_media"
  | "unknown";

export type MallStagedReviewStatus = "pending" | "accepted" | "rejected" | "flagged";

export interface MallSource {
  id:               string;
  mall_id?:         string;
  source_type:      MallSourceType;
  url:              string;
  page_title?:      string;
  discovered_at:    string;
  last_scanned_at?: string;
  is_active:        boolean;
  scan_status:      string;
  confidence:       number;
  notes?:           string;
  created_by?:      string;
  created_at:       string;
  /** Set by /detect-geodirectory — true when GeoDirectory API confirmed. */
  geodir_detected?: boolean;
  /** Base URL of the GeoDirectory API when detected. */
  geodir_api_url?:  string;
}

export interface MallMapAsset {
  id:             string;
  mall_source_id?: string;
  mall_id?:       string;
  asset_type:     "image" | "pdf" | "svg" | "html_embed";
  asset_url:      string;
  floor_label?:   string;
  link_text?:     string;
  page_width_px?:  number;
  page_height_px?: number;
  extracted_at:   string;
  review_status:  string;
  notes?:         string;
  created_at:     string;
}

export interface MallStagedStoreLocation {
  id:                       string;
  mall_id?:                 string;
  mall_source_id?:          string;
  mall_map_asset_id?:       string;
  shop_name?:               string;
  unit_number?:             string;
  floor_label?:             string;
  category?:                string;
  x_percent?:               number;
  y_percent?:               number;
  source_url?:              string;
  raw_evidence?:            string;
  confidence:               number;
  extraction_method:        string;
  google_places_verified:   boolean;
  google_places_place_id?:  string;
  review_status:            MallStagedReviewStatus;
  reviewed_by?:             string;
  reviewed_at?:             string;
  notes?:                   string;
  created_at:               string;
  // GeoDirectory enrichment columns (migration 014)
  geodir_store_id?:         number;
  phone?:                   string;
  website?:                 string;
  latitude?:                number;
  longitude?:               number;
  parking_hint?:            string;
  entrance_hint?:           string;
  road_name?:               string;
  source_modified_at?:      string;
  image_url?:               string;
}

export interface DiscoverSourcesResult {
  source:         MallSource;
  classification: {
    inferred_source_type: MallSourceType;
    confidence:           number;
    is_blocked:           boolean;
    block_reason?:        string;
  };
  warnings:       string[];
}

export interface ScanWebsiteResult {
  source_id:        string;
  scan_status:      string;
  page_title?:      string;
  assets_saved:     MallMapAsset[];
  assets_found:     number;
  scan_duration_ms: number;
  warnings:         string[];
  error?:           string;
  has_html:         boolean;
  raw_html?:        string;
}

export interface ExtractMapResult {
  source_id:        string;
  total_found:      number;
  stores_staged:    number;
  strategies_tried: string[];
  extraction_log:   string[];
  warnings:         string[];
  /** Per-row Supabase insert errors, if any stores failed to persist. */
  insert_errors?:   string[];
}

export interface VerifyStoreResult {
  shop_name:           string;
  staged_location_id?: string;
  verified:            boolean;
  place_id?:           string;
  place_name?:         string;
  place_address?:      string;
  confidence:          number;
  method:              "google_places_api" | "not_configured" | "failed";
  notes?:              string;
}

export interface AssetsResult {
  sources:       MallSource[];
  assets:        MallMapAsset[];
  total_sources: number;
  total_assets:  number;
}

export interface StagedLocationsResult {
  items: MallStagedStoreLocation[];
  total: number;
}

// ── Mall Intelligence public API ───────────────────────────────────────────────

export async function discoverMallSources(
  payload: {
    mall_id?:     string;
    seed_url:     string;
    mall_name?:   string;
    source_type?: MallSourceType;
    notes?:       string;
  },
  accessToken: string,
): Promise<DiscoverSourcesResult> {
  if (!BASE_URL) throw new Error("VITE_GOOGLE_BACKEND_URL is not configured");
  return postAuthWithResponse<DiscoverSourcesResult>(
    "/admin/mall-intelligence/discover-sources",
    payload,
    accessToken,
  );
}

export async function scanMallWebsiteSource(
  sourceId: string,
  accessToken: string,
): Promise<ScanWebsiteResult> {
  if (!BASE_URL) throw new Error("VITE_GOOGLE_BACKEND_URL is not configured");
  return postAuthWithResponse<ScanWebsiteResult>(
    "/admin/mall-intelligence/scan-website",
    { source_id: sourceId },
    accessToken,
  );
}

export async function extractMallMapStores(
  sourceId: string,
  accessToken: string,
  htmlContent?: string,
): Promise<ExtractMapResult> {
  if (!BASE_URL) throw new Error("VITE_GOOGLE_BACKEND_URL is not configured");
  return postAuthWithResponse<ExtractMapResult>(
    "/admin/mall-intelligence/extract-map",
    { source_id: sourceId, html_content: htmlContent },
    accessToken,
  );
}

export async function verifyMallStoreLocation(
  stagedLocationId: string,
  accessToken: string,
): Promise<VerifyStoreResult> {
  if (!BASE_URL) throw new Error("VITE_GOOGLE_BACKEND_URL is not configured");
  return postAuthWithResponse<VerifyStoreResult>(
    "/admin/mall-intelligence/verify-store-location",
    { staged_location_id: stagedLocationId },
    accessToken,
  );
}

export async function reviewStagedLocation(
  locationId:   string,
  reviewStatus: MallStagedReviewStatus,
  notes:        string | undefined,
  accessToken:  string,
): Promise<{ ok: boolean; item: MallStagedStoreLocation }> {
  if (!BASE_URL) throw new Error("VITE_GOOGLE_BACKEND_URL is not configured");
  return patchAuthWithResponse<{ ok: boolean; item: MallStagedStoreLocation }>(
    `/admin/mall-intelligence/staged-locations/${locationId}/review`,
    { review_status: reviewStatus, notes },
    accessToken,
  );
}

export async function stageMallRouteNodes(
  mallId:      string,
  accessToken: string,
): Promise<{ mall_id: string; nodes_staged: number; warnings: string[]; note: string }> {
  if (!BASE_URL) throw new Error("VITE_GOOGLE_BACKEND_URL is not configured");
  return postAuthWithResponse(
    "/admin/mall-intelligence/stage-route-nodes",
    { mall_id: mallId },
    accessToken,
  );
}

export async function getMallIntelligenceAssets(
  mallId:      string | undefined,
  accessToken: string,
): Promise<AssetsResult> {
  if (!BASE_URL) throw new Error("VITE_GOOGLE_BACKEND_URL is not configured");
  const qs = mallId ? `?mall_id=${encodeURIComponent(mallId)}` : "";
  return getAuthenticated<AssetsResult>(
    `/admin/mall-intelligence/assets${qs}`,
    accessToken,
  );
}

export async function getMallStagedLocations(
  mallId:      string | undefined,
  status:      string | undefined,
  accessToken: string,
): Promise<StagedLocationsResult> {
  if (!BASE_URL) throw new Error("VITE_GOOGLE_BACKEND_URL is not configured");
  const params = new URLSearchParams();
  if (mallId) params.set("mall_id", mallId);
  if (status) params.set("status",  status);
  const qs = params.toString() ? `?${params.toString()}` : "";
  return getAuthenticated<StagedLocationsResult>(
    `/admin/mall-intelligence/staged-locations${qs}`,
    accessToken,
  );
}

// ── Mall Health types (Sprint 12D.3) ─────────────────────────────────────────

export type MallReadinessStatus = "ready" | "partial" | "blocked";

export interface MallHealthReport {
  mall_id:                        string | null;
  generated_at:                   string;
  total_staged_stores:            number;
  stores_by_status:               Record<string, number>;
  stores_with_floor_label:        number;
  stores_missing_floor_label:     number;
  stores_with_coordinates:        number;
  accepted_stores:                number;
  accepted_stores_missing_coords: number;
  route_nodes_staged:             number;
  route_nodes_with_coordinates:   number;
  map_assets_total:               number;
  map_assets_image:               number;
  map_assets_image_missing_dims:  number;
  duplicate_asset_url_groups:     number;
  sources_linked:                 number;
  sources_missing_mall_id:        number;
  warnings:                       string[];
  readiness_status:               MallReadinessStatus;
  next_recommended_action:        string;
}

// ── Route Node Coordinate types (Sprint 12D.2) ───────────────────────────────

export interface MallRouteNode {
  id:                   string;
  mall_id:              string;
  staged_location_id?:  string | null;
  node_type:            string;
  label:                string;
  floor_label?:         string;
  x_percent?:           number | null;
  y_percent?:           number | null;
  review_status:        string;
  created_at:           string;
}

export interface RouteNodesResult {
  items: MallRouteNode[];
  total: number;
}

export interface RouteNodeCoordinateRequest {
  route_node_id: string;
  x_percent:     number;
  y_percent:     number;
}

export interface RouteNodeCoordinateResult {
  ok:               boolean;
  route_node_id:    string;
  x_percent:        number;
  y_percent:        number;
  location_updated: boolean;
}

// ── GeoDirectory Connector types (Sprint 12C.2 / 12C.2.1) ───────────────────

export interface GeoDirectoryDetectResult {
  source_id:       string;
  detected:        boolean;
  api_url:         string;
  stores_endpoint: string;
  route_names:     string[];
  warnings:        string[];
}

/** Minimal store shape returned in sample_stores[] of the import response. */
export interface GeoDirectorySampleStore {
  geodir_store_id: number;
  shop_name:       string;
  unit_number?:    string;
  floor_label?:    string;
  category?:       string;
  source_url:      string;
  confidence:      number;
  parking_hint?:   string;
  entrance_hint?:  string;
  road_name?:      string;
  phone?:          string;
  website?:        string;
  latitude?:       number;
  longitude?:      number;
  warnings:        string[];
}

export interface GeoDirectoryImportResult {
  source_id:       string;
  detected:        boolean;
  api_url:         string;
  stores_endpoint: string;
  pages_fetched:   number;
  records_found:   number;
  stores_staged:   number;
  stores_updated:  number;
  insert_errors:   string[];
  warnings:        string[];
  sample_stores:   GeoDirectorySampleStore[];
}

// ── Mall Health public API (Sprint 12D.3) ─────────────────────────────────────

/**
 * GET /admin/mall-intelligence/mall-health?mall_id=<uuid>
 *
 * Returns a structured readiness report: store counts by status, coordinate
 * coverage, asset dimensions, duplicate detection, and a traffic-light
 * readiness_status (blocked | partial | ready) with the single most
 * important next_recommended_action.
 *
 * Requires admin bearer token. Read-only — no staging writes.
 */
export async function getMallHealthReport(
  mallId:      string | undefined,
  accessToken: string,
): Promise<MallHealthReport> {
  if (!BASE_URL) throw new Error("VITE_GOOGLE_BACKEND_URL is not configured");
  const qs = mallId ? `?mall_id=${encodeURIComponent(mallId)}` : "";
  return getAuthenticated<MallHealthReport>(
    `/admin/mall-intelligence/mall-health${qs}`,
    accessToken,
  );
}

// ── Route Node Coordinate public API (Sprint 12D.2) ──────────────────────────

/**
 * GET /admin/mall-intelligence/route-nodes
 *
 * List staged route nodes for a mall.
 * Pass unplaced=true to return only nodes missing x_percent / y_percent.
 * Requires admin bearer token.
 */
export async function getMallRouteNodes(
  mallId:      string,
  accessToken: string,
  options?:    { unplaced?: boolean; limit?: number },
): Promise<RouteNodesResult> {
  if (!BASE_URL) throw new Error("VITE_GOOGLE_BACKEND_URL is not configured");
  const params = new URLSearchParams({ mall_id: mallId });
  if (options?.unplaced) params.set("unplaced", "true");
  if (options?.limit)    params.set("limit", String(options.limit));
  return getAuthenticated<RouteNodesResult>(
    `/admin/mall-intelligence/route-nodes?${params.toString()}`,
    accessToken,
  );
}

/**
 * POST /admin/mall-intelligence/route-node-coordinate
 *
 * Save manually-placed map coordinates (x_percent, y_percent) for a staged
 * route node.  Also propagates to the linked mall_store_locations_staged row
 * when staged_location_id is present.
 *
 * Coordinates are expressed as percentages of the displayed image dimensions:
 *   x_percent = clickX / imageWidth  * 100
 *   y_percent = clickY / imageHeight * 100
 *
 * Requires admin bearer token.
 */
export async function placeRouteNodeCoordinate(
  payload:     RouteNodeCoordinateRequest,
  accessToken: string,
): Promise<RouteNodeCoordinateResult> {
  if (!BASE_URL) throw new Error("VITE_GOOGLE_BACKEND_URL is not configured");
  return postAuthWithResponse<RouteNodeCoordinateResult>(
    "/admin/mall-intelligence/route-node-coordinate",
    payload,
    accessToken,
  );
}

// ── GeoDirectory import error (Sprint 12C.2.1) ───────────────────────────────

/**
 * Thrown by importGeoDirectoryStores when the backend returns a non-2xx response.
 * Carries structured error info (hint, warnings, HTTP status) so the UI can
 * display actionable guidance rather than just "TypeError: Failed to fetch".
 */
export class GeoDirectoryImportError extends Error {
  readonly httpStatus: number;
  readonly hint:       string;
  readonly warnings:   string[];

  constructor(status: number, errorMsg: string, hint: string, warnings: string[]) {
    super(errorMsg);
    this.name       = "GeoDirectoryImportError";
    this.httpStatus = status;
    this.hint       = hint;
    this.warnings   = warnings;
  }
}

// ── GeoDirectory Connector public API ─────────────────────────────────────────

/**
 * POST /admin/mall-intelligence/detect-geodirectory
 *
 * Probe a mall source for the WordPress GeoDirectory REST API.
 * Persists geodir_detected + geodir_api_url on the source if confirmed.
 * Requires admin bearer token.
 */
export async function detectGeoDirectoryForSource(
  sourceId:    string,
  accessToken: string,
): Promise<GeoDirectoryDetectResult> {
  if (!BASE_URL) throw new Error("VITE_GOOGLE_BACKEND_URL is not configured");
  return postAuthWithResponse<GeoDirectoryDetectResult>(
    "/admin/mall-intelligence/detect-geodirectory",
    { source_id: sourceId },
    accessToken,
  );
}

/**
 * POST /admin/mall-intelligence/import-geodirectory
 *
 * Fetch GeoDirectory store pages, normalise records, and batch-upsert into
 * mall_store_locations_staged.  Deduplicates by (mall_source_id, geodir_store_id).
 * Requires admin bearer token.
 *
 * Defaults: maxPages=1, perPage=25 (safe for Cloud Run 60-second timeout).
 * Throws GeoDirectoryImportError on non-2xx, carrying structured hint + warnings
 * so the UI can display actionable guidance instead of a generic network error.
 */
export async function importGeoDirectoryStores(
  sourceId:    string,
  accessToken: string,
  options?: { maxPages?: number; perPage?: number },
): Promise<GeoDirectoryImportResult> {
  if (!BASE_URL) throw new Error("VITE_GOOGLE_BACKEND_URL is not configured");

  const url = `${BASE_URL}/admin/mall-intelligence/import-geodirectory`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization:  `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      source_id:  sourceId,
      max_pages:  options?.maxPages,
      per_page:   options?.perPage,
    }),
  });

  if (!res.ok) {
    let errorMsg = `Import GeoDirectory error — HTTP ${res.status}`;
    let hint     = "Try max_pages=1 and per_page=25 first.";
    let warnings: string[] = [];
    try {
      const body = await res.json() as { error?: string; hint?: string; warnings?: string[] };
      if (body.error)    errorMsg = body.error;
      if (body.hint)     hint     = body.hint;
      if (body.warnings) warnings = body.warnings;
    } catch { /* ignore JSON parse failure — use defaults above */ }
    throw new GeoDirectoryImportError(res.status, errorMsg, hint, warnings);
  }

  return res.json() as Promise<GeoDirectoryImportResult>;
}
