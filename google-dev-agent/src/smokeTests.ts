/**
 * smokeTests.ts
 *
 * Runs smoke tests against the live Cloud Run dev backend.
 * Read-only — no data is written except ephemeral test sessions
 * created via Supabase REST API (cleaned up after each run).
 *
 * Each endpoint is classified as one of:
 *   REAL           — working correctly with production-grade responses
 *   VERIFIED_DATA  — seeded IDs but prices manually confirmed against real store
 *   PARTIAL        — endpoint responds but returns incomplete or empty data
 *   DEMO_DATA      — works correctly but on unverified manually seeded test data
 *   BROKEN         — HTTP error, timeout, or unexpected response format
 *   BLOCKED        — not tested due to missing credentials or safety rules
 *
 * Status promotion path:
 *   BROKEN → PARTIAL → DEMO_DATA → VERIFIED_DATA → REAL
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export type EndpointStatus =
  | "REAL"
  | "VERIFIED_DATA"
  | "PARTIAL"
  | "DEMO_DATA"
  | "BROKEN"
  | "BLOCKED";

export interface SmokeTestResult {
  testName: string;
  endpoint: string;
  method: "GET" | "POST";
  status: EndpointStatus;
  httpStatus: number | null;
  responseTimeMs: number;
  summary: string;
  responsePreview: string;
  error?: string;
  rawResponse?: unknown;
}

export interface SmokeTestSuite {
  runId: string;
  startedAt: string;
  completedAt: string;
  baseUrl: string;
  results: SmokeTestResult[];
  overallStatus: "ALL_PASSED" | "SOME_FAILED" | "ALL_FAILED";
  passCount: number;
  verifiedDataCount: number;
  partialCount: number;
  demoDataCount: number;
  brokenCount: number;
  blockedCount: number;
}

// ── Data quality constants ────────────────────────────────────────────────────

// Must match MALL_RADIUS_KM in google-cloud-backend/src/services/mallService.ts
const MALL_DETECTION_RADIUS_KM = 1.0;

// Known seeded ID prefixes — fallback detection for responses that pre-date
// migration 008 (no data_quality_status field yet).
const SEEDED_ID_PREFIXES = [
  "f4a2c1b3", // Mall@Reds mall ID
  "a1b2c3d4", // seeded shop IDs
  "b1b2c3d4", // seeded product IDs
  "c1b2c3d4", // seeded node IDs
];

function containsSeededData(obj: unknown): boolean {
  const str = JSON.stringify(obj ?? "");
  return SEEDED_ID_PREFIXES.some((prefix) => str.includes(prefix));
}

// ── Product quality classification ───────────────────────────────────────────
//
// Reads data_quality_status from each product in the response and maps the
// aggregate to an EndpointStatus.
//
// Classification rules (in priority order):
//
//   1. No products                          → PARTIAL  (nothing to evaluate)
//   2. All "live_feed"                      → REAL     (production-grade)
//   3. All "manually_verified" + verified_at→ VERIFIED_DATA (demo-safe)
//   4. Mixed statuses                       → PARTIAL  (needs attention)
//   5. All "demo" / "stale" / etc.          → DEMO_DATA
//   6. No data_quality_status field at all  → seeded-ID fallback (DEMO_DATA)
//
// VERIFIED_DATA requires BOTH:
//   a) data_quality_status = "manually_verified"
//   b) price_verified_at is not null
// If either is missing the price has not been properly confirmed — stay DEMO_DATA.

type DataQualityStatus =
  | "demo"
  | "manually_verified"
  | "live_feed"
  | "stale"
  | "user_submitted"
  | "needs_review";

function extractProducts(obj: unknown): unknown[] {
  if (Array.isArray(obj)) return obj;
  if (obj && typeof obj === "object") {
    const rec = obj as Record<string, unknown>;
    const inner = rec.recommendations ?? rec.products ?? rec.items;
    if (Array.isArray(inner)) return inner;
  }
  return [];
}

function classifyProductList(products: unknown[]): EndpointStatus {
  if (products.length === 0) return "PARTIAL";

  // If products lack data_quality_status (migration 008 not yet applied),
  // fall back to seeded-ID heuristic.
  const firstItem = products[0] as Record<string, unknown>;
  const hasDQS = "data_quality_status" in firstItem;
  if (!hasDQS) {
    // Pre-migration fallback: any seeded ID → DEMO_DATA, otherwise REAL
    const isSeeded = containsSeededData(products);
    return isSeeded ? "DEMO_DATA" : "REAL";
  }

  const statuses = products.map(
    (p) => ((p as Record<string, unknown>).data_quality_status as DataQualityStatus) ?? "demo"
  );
  const unique = new Set(statuses);

  // All live_feed → REAL
  if (unique.size === 1 && unique.has("live_feed")) return "REAL";

  // All manually_verified AND all have price_verified_at → VERIFIED_DATA
  if (unique.size === 1 && unique.has("manually_verified")) {
    const allTimestamped = products.every(
      (p) => (p as Record<string, unknown>).price_verified_at != null
    );
    // If manually_verified but no timestamp something went wrong — stay DEMO_DATA
    return allTimestamped ? "VERIFIED_DATA" : "DEMO_DATA";
  }

  // Mixed statuses → PARTIAL (inconsistent data quality, needs attention)
  if (unique.size > 1) return "PARTIAL";

  // Everything else (demo, stale, user_submitted, needs_review) → DEMO_DATA
  return "DEMO_DATA";
}

/**
 * Build a human-readable quality note for use in summary strings.
 */
function qualityNote(status: EndpointStatus, firstProduct?: Record<string, unknown>): string {
  switch (status) {
    case "REAL":          return "";
    case "VERIFIED_DATA": {
      const method = firstProduct?.price_verification_method ?? "unknown method";
      const who    = firstProduct?.verified_by ? ` by ${firstProduct.verified_by}` : "";
      return ` [prices verified via ${method}${who}]`;
    }
    case "PARTIAL":       return " [mixed data quality — see details]";
    case "DEMO_DATA":     {
      const src = firstProduct?.data_source ? ` (source: ${firstProduct.data_source})` : "";
      return ` [unverified seed data${src}]`;
    }
    default:              return "";
  }
}

function truncate(str: string, maxLen = 400): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen) + `… [truncated, ${str.length} chars total]`;
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────

async function timedFetch(
  url: string,
  options: RequestInit,
  timeoutMs = 15000
): Promise<{ response: Response; responseTimeMs: number }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const start = Date.now();
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    return { response, responseTimeMs: Date.now() - start };
  } finally {
    clearTimeout(timer);
  }
}

// ── Supabase session helper ───────────────────────────────────────────────────

async function createTestSession(mallId: string): Promise<string | null> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key || key === "REPLACE_WITH_SERVICE_ROLE_KEY") return null;

  try {
    const res = await fetch(`${url}/rest/v1/shopping_sessions`, {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify({ mall_id: mallId }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Array<{ id: string }>;
    return data?.[0]?.id ?? null;
  } catch {
    return null;
  }
}

async function deleteTestSession(sessionId: string): Promise<void> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return;
  try {
    await fetch(`${url}/rest/v1/shopping_sessions?id=eq.${sessionId}`, {
      method: "DELETE",
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
  } catch {
    // Best-effort cleanup — don't throw
  }
}

// ── Individual smoke tests ────────────────────────────────────────────────────

async function testHealth(baseUrl: string): Promise<SmokeTestResult> {
  const endpoint = "/health";
  const method = "GET" as const;
  try {
    const { response, responseTimeMs } = await timedFetch(`${baseUrl}${endpoint}`, {
      method,
      headers: { "Content-Type": "application/json" },
    });

    const body = await response.json().catch(() => null);
    const preview = truncate(JSON.stringify(body));

    if (!response.ok) {
      return {
        testName: "Health Check",
        endpoint, method,
        status: "BROKEN",
        httpStatus: response.status,
        responseTimeMs,
        summary: `HTTP ${response.status} — server returned an error`,
        responsePreview: preview,
      };
    }

    const isHealthy =
      body &&
      typeof body === "object" &&
      (body as Record<string, unknown>).status === "ok";

    return {
      testName: "Health Check",
      endpoint, method,
      status: isHealthy ? "REAL" : "PARTIAL",
      httpStatus: response.status,
      responseTimeMs,
      summary: isHealthy
        ? `Server is healthy (status: ok)`
        : `Server responded HTTP 200 but body is not { status: "ok" }`,
      responsePreview: preview,
      rawResponse: body,
    };
  } catch (err) {
    return {
      testName: "Health Check",
      endpoint, method,
      status: "BROKEN",
      httpStatus: null,
      responseTimeMs: 0,
      summary: `Request failed: ${String(err)}`,
      responsePreview: "",
      error: String(err),
    };
  }
}

async function testDetectActiveMall(baseUrl: string): Promise<SmokeTestResult> {
  const endpoint = "/detect-active-mall";
  const method = "POST" as const;
  // Default coordinates match Mall@Reds in the malls table (lat: -25.8537, lng: 28.1878).
  // Override via TEST_MALL_LAT / TEST_MALL_LNG in .env if your test mall differs.
  const lat = parseFloat(process.env.TEST_MALL_LAT ?? "-25.8537");
  const lng = parseFloat(process.env.TEST_MALL_LNG ?? "28.1878");
  const expectedMallName = process.env.TEST_MALL_NAME ?? "Mall@Reds";

  try {
    const { response, responseTimeMs } = await timedFetch(`${baseUrl}${endpoint}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lat, lng }),
    });

    const body = await response.json().catch(() => null);
    const preview = truncate(JSON.stringify(body));

    if (!response.ok) {
      return {
        testName: "Detect Active Mall",
        endpoint, method,
        status: "BROKEN",
        httpStatus: response.status,
        responseTimeMs,
        summary: `HTTP ${response.status} — ${preview}`,
        responsePreview: preview,
      };
    }

    const obj = body as Record<string, unknown> | null;

    // Response shape: { mall: { id, name, city, lat, lng }, distance_km, within_radius, session_id }
    const mallObj = obj?.mall as Record<string, unknown> | null;
    const detectedId = mallObj?.id ?? obj?.mall_id ?? obj?.id ?? null;

    if (!detectedId) {
      return {
        testName: "Detect Active Mall",
        endpoint, method,
        status: "PARTIAL",
        httpStatus: response.status,
        responseTimeMs,
        summary: `Endpoint responded but returned no mall for coords (${lat}, ${lng}). ` +
          `distance_km=${obj?.distance_km ?? "?"}, within_radius=${obj?.within_radius ?? "?"}. ` +
          `Check that malls table has lat/lng and there is a mall within ${MALL_DETECTION_RADIUS_KM}km.`,
        responsePreview: preview,
        rawResponse: body,
      };
    }

    const mallName = String(mallObj?.name ?? obj?.name ?? "");
    const distanceKm = typeof obj?.distance_km === "number" ? obj.distance_km : null;
    const withinRadius = obj?.within_radius === true;
    const isExpectedMall = mallName.toLowerCase().includes(expectedMallName.toLowerCase());
    const isSeeded = containsSeededData(body);

    if (!withinRadius) {
      return {
        testName: "Detect Active Mall",
        endpoint, method,
        status: "PARTIAL",
        httpStatus: response.status,
        responseTimeMs,
        summary: `Nearest mall is "${mallName}" at ${distanceKm}km from test coords (${lat}, ${lng}). ` +
          `Outside ${MALL_DETECTION_RADIUS_KM}km radius. ` +
          (isExpectedMall
            ? `Correct mall found but test coordinates are too far — update TEST_MALL_LAT/LNG to match DB values.`
            : `Wrong mall detected — update TEST_MALL_LAT/LNG to be inside ${expectedMallName}.`),
        responsePreview: preview,
        rawResponse: body,
      };
    }

    return {
      testName: "Detect Active Mall",
      endpoint, method,
      // Mall detection returns no products, so data_quality_status doesn't apply.
      // Use seeded-ID detection: DEMO_DATA for known seeded mall IDs, REAL otherwise.
      status: isSeeded ? "DEMO_DATA" : "REAL",
      httpStatus: response.status,
      responseTimeMs,
      summary: isExpectedMall
        ? `Detected "${mallName}" ✓ — ${distanceKm}km from test coords, within_radius=true`
        : `Detected "${mallName}" (${distanceKm}km) — expected "${expectedMallName}". ` +
          `Update TEST_MALL_LAT/LNG or TEST_MALL_NAME in .env.`,
      responsePreview: preview,
      rawResponse: body,
    };
  } catch (err) {
    return {
      testName: "Detect Active Mall",
      endpoint, method,
      status: "BROKEN",
      httpStatus: null,
      responseTimeMs: 0,
      summary: `Request failed: ${String(err)}`,
      responsePreview: "",
      error: String(err),
    };
  }
}

async function testRecommendProducts(baseUrl: string): Promise<SmokeTestResult> {
  const endpoint = "/recommend-products";
  const method = "POST" as const;
  const mallId = process.env.TEST_MALL_ID ?? "f4a2c1b3-8d7e-4f6a-9b0c-1d2e3f4a5b6c";

  try {
    const { response, responseTimeMs } = await timedFetch(`${baseUrl}${endpoint}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mall_id: mallId, query: "TV", budget: 5000 }),
    });

    const body = await response.json().catch(() => null);
    const preview = truncate(JSON.stringify(body));

    if (!response.ok) {
      return {
        testName: "Recommend Products",
        endpoint, method,
        status: "BROKEN",
        httpStatus: response.status,
        responseTimeMs,
        summary: `HTTP ${response.status} — ${preview}`,
        responsePreview: preview,
      };
    }

    // Endpoint returns { recommendations: [...] } — also accept plain array or .products
    const obj = body as Record<string, unknown> | null;
    const arr = Array.isArray(body)
      ? body
      : (obj?.recommendations ?? obj?.products ?? null);
    const products = Array.isArray(arr) ? arr : [];

    if (products.length === 0) {
      return {
        testName: "Recommend Products",
        endpoint, method,
        status: "PARTIAL",
        httpStatus: response.status,
        responseTimeMs,
        summary: `Endpoint responded but returned 0 products for query "TV" at mall ${mallId}. ` +
          `Check that the mall has seeded products.`,
        responsePreview: preview,
        rawResponse: body,
      };
    }

    const dataStatus = classifyProductList(products);
    const cheapest = products[0] as Record<string, unknown>;

    return {
      testName: "Recommend Products",
      endpoint, method,
      status: dataStatus,
      httpStatus: response.status,
      responseTimeMs,
      summary: `${products.length} product(s) returned — cheapest: "${cheapest?.name}" ` +
        `at R${cheapest?.price} from ${cheapest?.shop_name} (Floor ${cheapest?.floor})` +
        qualityNote(dataStatus, cheapest),
      responsePreview: preview,
      rawResponse: body,
    };
  } catch (err) {
    return {
      testName: "Recommend Products",
      endpoint, method,
      status: "BROKEN",
      httpStatus: null,
      responseTimeMs: 0,
      summary: `Request failed: ${String(err)}`,
      responsePreview: "",
      error: String(err),
    };
  }
}

async function testBuildRoute(baseUrl: string): Promise<SmokeTestResult> {
  const endpoint = "/build-route";
  const method = "POST" as const;
  const mallId = process.env.TEST_MALL_ID ?? "f4a2c1b3-8d7e-4f6a-9b0c-1d2e3f4a5b6c";
  const shopId = process.env.TEST_SHOP_ID ?? "a1b2c3d4-0001-4000-8000-100000000001";

  const sessionId = await createTestSession(mallId);

  if (!sessionId) {
    return {
      testName: "Build Route",
      endpoint, method,
      status: "BLOCKED",
      httpStatus: null,
      responseTimeMs: 0,
      summary: "BLOCKED — SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required to create a " +
        "test session for this endpoint. Set them in .env and re-run.",
      responsePreview: "",
    };
  }

  try {
    const { response, responseTimeMs } = await timedFetch(`${baseUrl}${endpoint}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_id: sessionId,
        destination_shop_ids: [shopId],
      }),
    });

    const body = await response.json().catch(() => null);
    const preview = truncate(JSON.stringify(body));

    await deleteTestSession(sessionId);

    if (!response.ok) {
      return {
        testName: "Build Route",
        endpoint, method,
        status: "BROKEN",
        httpStatus: response.status,
        responseTimeMs,
        summary: `HTTP ${response.status} — ${preview}`,
        responsePreview: preview,
      };
    }

    const obj = body as Record<string, unknown>;
    const steps = Array.isArray(obj?.steps) ? obj.steps : [];
    const isFallback = obj?.fallback === true;

    if (steps.length === 0) {
      return {
        testName: "Build Route",
        endpoint, method,
        status: "PARTIAL",
        httpStatus: response.status,
        responseTimeMs,
        summary: isFallback
          ? `Route returned 0 steps (fallback mode). ` +
            `Shop ID "${shopId}" has no matching node in mall_nodes. ` +
            `Check that mall_nodes.linked_shop_id is populated for this shop.`
          : `Route returned 0 steps. Check mall_nodes/mall_edges for mall ${mallId}.`,
        responsePreview: preview,
        rawResponse: body,
      };
    }

    const isSeeded = containsSeededData(body);
    const first = steps[0] as Record<string, unknown>;

    return {
      testName: "Build Route",
      endpoint, method,
      // Route graph data uses seeded node IDs — classified by whether graph itself is verified.
      // Graph data doesn't carry price_verified_at, so DEMO_DATA stays until real graph data
      // is loaded from a venue mapping survey.
      status: isSeeded ? "DEMO_DATA" : "REAL",
      httpStatus: response.status,
      responseTimeMs,
      summary: `${steps.length} route step(s) returned. ` +
        `~${obj?.estimated_minutes ?? "?"} min walk. ` +
        `First step: "${first?.instruction}"` +
        (isSeeded ? " [seeded graph data]" : ""),
      responsePreview: preview,
      rawResponse: body,
    };
  } catch (err) {
    await deleteTestSession(sessionId).catch(() => {});
    return {
      testName: "Build Route",
      endpoint, method,
      status: "BROKEN",
      httpStatus: null,
      responseTimeMs: 0,
      summary: `Request failed: ${String(err)}`,
      responsePreview: "",
      error: String(err),
    };
  }
}

async function testAssistant(baseUrl: string): Promise<SmokeTestResult> {
  const endpoint = "/assistant";
  const method = "POST" as const;
  const mallId = process.env.TEST_MALL_ID ?? "f4a2c1b3-8d7e-4f6a-9b0c-1d2e3f4a5b6c";
  const mallName = process.env.TEST_MALL_NAME ?? "Mall@Reds";

  try {
    const { response, responseTimeMs } = await timedFetch(
      `${baseUrl}${endpoint}`,
      {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "user", content: "What TVs do you have under R5000?" }],
          mall_id: mallId,
          mall_name: mallName,
        }),
      },
      30000 // longer timeout — Gemini may take up to 25s
    );

    const body = await response.json().catch(() => null);
    const preview = truncate(JSON.stringify(body));

    if (!response.ok) {
      return {
        testName: "AI Assistant",
        endpoint, method,
        status: "BROKEN",
        httpStatus: response.status,
        responseTimeMs,
        summary: `HTTP ${response.status} — ${preview}`,
        responsePreview: preview,
      };
    }

    const obj = body as Record<string, unknown>;
    const message = String(obj?.message ?? "");
    const products = Array.isArray(obj?.products) ? obj.products : [];

    const isFallback =
      message.includes("Sorry, I couldn") ||
      message.includes("I ran into an issue") ||
      message.trim().length === 0;

    if (isFallback) {
      return {
        testName: "AI Assistant",
        endpoint, method,
        status: "PARTIAL",
        httpStatus: response.status,
        responseTimeMs,
        summary: `Endpoint responded but Gemini returned a fallback/empty message. ` +
          `Check Cloud Run logs for Vertex AI errors. ` +
          `Message: "${message.slice(0, 100)}"`,
        responsePreview: preview,
        rawResponse: body,
      };
    }

    // Classify based on data quality of returned products
    const dataStatus = classifyProductList(products);
    const firstProduct = products[0] as Record<string, unknown> | undefined;

    return {
      testName: "AI Assistant",
      endpoint, method,
      status: dataStatus,
      httpStatus: response.status,
      responseTimeMs,
      summary: `Gemini responded in ${responseTimeMs}ms. ` +
        `${products.length} product(s) returned. ` +
        `Message preview: "${message.slice(0, 120)}"` +
        qualityNote(dataStatus, firstProduct),
      responsePreview: preview,
      rawResponse: body,
    };
  } catch (err) {
    return {
      testName: "AI Assistant",
      endpoint, method,
      status: "BROKEN",
      httpStatus: null,
      responseTimeMs: 0,
      summary: `Request failed: ${String(err)}`,
      responsePreview: "",
      error: String(err),
    };
  }
}

// ── Full Journey test ─────────────────────────────────────────────────────────
// Chains the real user flow end-to-end:
//   1. Detect mall from GPS coords
//   2. Search products at that mall
//   3. Build a route to the first result's shop (needs Supabase creds)
// Verifies that the output of each step correctly feeds the next.

async function testFullJourney(baseUrl: string): Promise<SmokeTestResult> {
  const testName = "Full Journey";
  const endpoint = "/detect-active-mall → /recommend-products → /build-route";
  const method = "POST" as const;

  const lat = parseFloat(process.env.TEST_MALL_LAT ?? "-25.8537");
  const lng = parseFloat(process.env.TEST_MALL_LNG ?? "28.1878");
  const journeyStart = Date.now();

  // ── Step 1: Detect mall ───────────────────────────────────────────────────
  let step1Body: Record<string, unknown> | null = null;
  try {
    const { response } = await timedFetch(`${baseUrl}/detect-active-mall`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lat, lng }),
    });
    step1Body = response.ok ? await response.json().catch(() => null) : null;
  } catch {
    step1Body = null;
  }

  const mallObj = step1Body?.mall as Record<string, unknown> | null;
  const detectedMallId = String(mallObj?.id ?? step1Body?.mall_id ?? "");
  const detectedMallName = String(mallObj?.name ?? "unknown");

  if (!detectedMallId) {
    return {
      testName, endpoint, method,
      status: "BROKEN",
      httpStatus: null,
      responseTimeMs: Date.now() - journeyStart,
      summary: "Journey step 1 failed: /detect-active-mall returned no mall. " +
        "Check TEST_MALL_LAT/LNG and malls table lat/lng columns.",
      responsePreview: truncate(JSON.stringify(step1Body)),
    };
  }

  // ── Step 2: Recommend products ────────────────────────────────────────────
  let step2Body: Record<string, unknown> | null = null;
  try {
    const { response } = await timedFetch(`${baseUrl}/recommend-products`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mall_id: detectedMallId, query: "TV", budget: 5000 }),
    });
    step2Body = response.ok ? await response.json().catch(() => null) : null;
  } catch {
    step2Body = null;
  }

  const recArr = Array.isArray(step2Body)
    ? step2Body
    : Array.isArray(step2Body?.recommendations)
    ? step2Body!.recommendations
    : [];
  const firstProduct = recArr[0] as Record<string, unknown> | undefined;
  const firstShopId = String(firstProduct?.shop_id ?? "");

  if (recArr.length === 0 || !firstShopId) {
    return {
      testName, endpoint, method,
      status: "PARTIAL",
      httpStatus: null,
      responseTimeMs: Date.now() - journeyStart,
      summary: `Journey reached step 2: detected "${detectedMallName}" ✓ → ` +
        `/recommend-products returned 0 results for "TV". ` +
        "Check that products are seeded for this mall.",
      responsePreview: truncate(JSON.stringify(step2Body)),
    };
  }

  // ── Step 3: Build route ───────────────────────────────────────────────────
  const sessionId = await createTestSession(detectedMallId);

  if (!sessionId) {
    // Supabase creds missing — journey is partially verified (steps 1–2 only)
    const dataStatus = classifyProductList(recArr);
    return {
      testName, endpoint, method,
      status: dataStatus,
      httpStatus: null,
      responseTimeMs: Date.now() - journeyStart,
      summary: `Journey steps 1–2 passed ✓: detected "${detectedMallName}" → ` +
        `${recArr.length} product(s) for "TV" (first: "${firstProduct?.name}" at R${firstProduct?.price}). ` +
        `Step 3 (/build-route) skipped — set SUPABASE_SERVICE_ROLE_KEY to test routing.` +
        qualityNote(dataStatus, firstProduct as Record<string, unknown>),
      responsePreview: truncate(JSON.stringify({ step1: step1Body, step2_count: recArr.length })),
    };
  }

  let step3Body: Record<string, unknown> | null = null;
  try {
    const { response } = await timedFetch(`${baseUrl}/build-route`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_id: sessionId,
        destination_shop_ids: [firstShopId],
      }),
    });
    step3Body = response.ok ? await response.json().catch(() => null) : null;
  } catch {
    step3Body = null;
  } finally {
    await deleteTestSession(sessionId).catch(() => {});
  }

  const routeSteps = Array.isArray(step3Body?.steps) ? step3Body!.steps : [];

  if (routeSteps.length === 0) {
    return {
      testName, endpoint, method,
      status: "PARTIAL",
      httpStatus: null,
      responseTimeMs: Date.now() - journeyStart,
      summary: `Journey steps 1–2 passed ✓ but step 3 returned 0 route steps. ` +
        `Detected "${detectedMallName}" → "${firstProduct?.name}" at R${firstProduct?.price} ` +
        `→ route to shop ${firstShopId} failed. Check mall_nodes.linked_shop_id.`,
      responsePreview: truncate(JSON.stringify(step3Body)),
    };
  }

  // ── All 3 steps passed ────────────────────────────────────────────────────
  // Product quality drives the overall journey classification.
  // Route graph data doesn't carry data_quality_status (it's a topology, not a price),
  // so only product quality determines whether this journey is demo/verified/live.
  const dataStatus = classifyProductList(recArr);
  const firstStep = routeSteps[0] as Record<string, unknown>;

  return {
    testName, endpoint, method,
    status: dataStatus,
    httpStatus: 200,
    responseTimeMs: Date.now() - journeyStart,
    summary: `Full journey ✓: detected "${detectedMallName}" → ` +
      `${recArr.length} product(s) for "TV" → ` +
      `${routeSteps.length} route step(s) to "${firstProduct?.shop_name}". ` +
      `First step: "${String(firstStep?.instruction ?? "").slice(0, 60)}"` +
      qualityNote(dataStatus, firstProduct as Record<string, unknown>),
    responsePreview: truncate(JSON.stringify({
      mall: detectedMallName,
      products_found: recArr.length,
      route_steps: routeSteps.length,
      first_route_step: firstStep?.instruction,
    })),
    rawResponse: { step1: step1Body, step2: step2Body, step3: step3Body },
  };
}

// ── Main suite runner ─────────────────────────────────────────────────────────

export async function runSmokeTests(baseUrl: string): Promise<SmokeTestSuite> {
  const runId = `run-${Date.now()}`;
  const startedAt = new Date().toISOString();

  console.log(`\n🔍 Running smoke tests against: ${baseUrl}`);
  console.log(`   Run ID: ${runId}\n`);

  const tests: Array<() => Promise<SmokeTestResult>> = [
    () => testHealth(baseUrl),
    () => testDetectActiveMall(baseUrl),
    () => testRecommendProducts(baseUrl),
    () => testBuildRoute(baseUrl),
    () => testAssistant(baseUrl),
    () => testFullJourney(baseUrl),
  ];

  const results: SmokeTestResult[] = [];
  for (const test of tests) {
    const result = await test();
    const icon =
      result.status === "REAL"          ? "✅" :
      result.status === "VERIFIED_DATA" ? "🟢" :
      result.status === "DEMO_DATA"     ? "🟡" :
      result.status === "PARTIAL"       ? "⚠️" :
      result.status === "BLOCKED"       ? "⛔" : "❌";
    console.log(`  ${icon} [${result.status.padEnd(13)}] ${result.testName} — ${result.summary.slice(0, 80)}`);
    results.push(result);
  }

  const completedAt = new Date().toISOString();

  const passCount          = results.filter((r) => r.status === "REAL").length;
  const verifiedDataCount  = results.filter((r) => r.status === "VERIFIED_DATA").length;
  const demoDataCount      = results.filter((r) => r.status === "DEMO_DATA").length;
  const partialCount       = results.filter((r) => r.status === "PARTIAL").length;
  const brokenCount        = results.filter((r) => r.status === "BROKEN").length;
  const blockedCount       = results.filter((r) => r.status === "BLOCKED").length;

  const overallStatus =
    brokenCount === results.length
      ? "ALL_FAILED"
      : brokenCount > 0 || partialCount > 0
      ? "SOME_FAILED"
      : "ALL_PASSED";

  return {
    runId,
    startedAt,
    completedAt,
    baseUrl,
    results,
    overallStatus,
    passCount,
    verifiedDataCount,
    partialCount,
    demoDataCount,
    brokenCount,
    blockedCount,
  };
}
