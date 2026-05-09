/**
 * smokeTests.ts
 *
 * Runs smoke tests against the live Cloud Run dev backend.
 * Read-only — no data is written except ephemeral test sessions
 * created via Supabase REST API (cleaned up after each run).
 *
 * Each endpoint is classified as one of:
 *   REAL       — working correctly with production-grade responses
 *   PARTIAL    — endpoint responds but returns incomplete or empty data
 *   DEMO_DATA  — works correctly but operating on manually seeded test data
 *   BROKEN     — HTTP error, timeout, or unexpected response format
 *   BLOCKED    — not tested due to missing credentials or safety rules
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export type EndpointStatus = "REAL" | "PARTIAL" | "DEMO_DATA" | "BROKEN" | "BLOCKED";

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
  partialCount: number;
  demoDataCount: number;
  brokenCount: number;
  blockedCount: number;
}

// ── Known seeded ID patterns ──────────────────────────────────────────────────
// These UUIDs were manually seeded for development. Detecting them in responses
// means the endpoint works but is operating on demo/test data, not real retailer data.

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
  const lat = parseFloat(process.env.TEST_MALL_LAT ?? "-25.8586");
  const lng = parseFloat(process.env.TEST_MALL_LNG ?? "27.9891");
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
    const detected = obj?.mall_id || obj?.id;

    if (!detected) {
      return {
        testName: "Detect Active Mall",
        endpoint, method,
        status: "PARTIAL",
        httpStatus: response.status,
        responseTimeMs,
        summary: `Endpoint responded but no mall detected for coords (${lat}, ${lng}). ` +
          `Likely cause: malls table missing lat/lng values. ` +
          `Fix: run UPDATE malls SET latitude=..., longitude=... for each mall.`,
        responsePreview: preview,
        rawResponse: body,
      };
    }

    const mallName = String(obj?.name ?? "");
    const isExpectedMall = mallName.toLowerCase().includes(expectedMallName.toLowerCase());
    const isSeeded = containsSeededData(body);

    return {
      testName: "Detect Active Mall",
      endpoint, method,
      status: isSeeded ? "DEMO_DATA" : "REAL",
      httpStatus: response.status,
      responseTimeMs,
      summary: isExpectedMall
        ? `Detected "${mallName}" as expected from coords (${lat}, ${lng})`
        : `Detected a mall ("${mallName}") but not the expected "${expectedMallName}" — check coordinates`,
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

    const isSeeded = containsSeededData(body);
    const cheapest = products[0] as Record<string, unknown>;
    const productSummary = `${products.length} product(s) returned — cheapest: "${cheapest?.name}" ` +
      `at R${cheapest?.price} from ${cheapest?.shop_name} (Floor ${cheapest?.floor})`;

    return {
      testName: "Recommend Products",
      endpoint, method,
      status: isSeeded ? "DEMO_DATA" : "REAL",
      httpStatus: response.status,
      responseTimeMs,
      summary: productSummary + (isSeeded ? " [seeded data]" : ""),
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

  // Create a fresh test session — requires Supabase credentials
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

    // Clean up test session regardless of result
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

    const isSeeded = containsSeededData(body);
    const productCount = products.length;

    return {
      testName: "AI Assistant",
      endpoint, method,
      status: isSeeded ? "DEMO_DATA" : "REAL",
      httpStatus: response.status,
      responseTimeMs,
      summary: `Gemini responded in ${responseTimeMs}ms. ` +
        `${productCount} product(s) returned. ` +
        `Message preview: "${message.slice(0, 120)}"` +
        (isSeeded ? " [seeded product data]" : ""),
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
  ];

  const results: SmokeTestResult[] = [];
  for (const test of tests) {
    const result = await test();
    const icon =
      result.status === "REAL" ? "✅" :
      result.status === "DEMO_DATA" ? "🟡" :
      result.status === "PARTIAL" ? "⚠️" :
      result.status === "BLOCKED" ? "⛔" : "❌";
    console.log(`  ${icon} [${result.status.padEnd(9)}] ${result.testName} — ${result.summary.slice(0, 80)}`);
    results.push(result);
  }

  const completedAt = new Date().toISOString();

  const passCount = results.filter((r) => r.status === "REAL").length;
  const demoDataCount = results.filter((r) => r.status === "DEMO_DATA").length;
  const partialCount = results.filter((r) => r.status === "PARTIAL").length;
  const brokenCount = results.filter((r) => r.status === "BROKEN").length;
  const blockedCount = results.filter((r) => r.status === "BLOCKED").length;

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
    partialCount,
    demoDataCount,
    brokenCount,
    blockedCount,
  };
}
