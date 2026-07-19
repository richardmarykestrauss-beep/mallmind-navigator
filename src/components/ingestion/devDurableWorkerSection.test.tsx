/**
 * Sprint 2E — dev durable worker panel: import safety + proxy routing + safe errors.
 *
 * The regression this guards against: importing the panel used to pull in the
 * eager browser Supabase singleton, which throws "supabaseUrl is required" at
 * module evaluation when no Supabase env vars exist (as in CI). These tests run
 * with NO Supabase env and must never crash on import.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { render, screen, cleanup } from "@testing-library/react";

const HERE = path.dirname(fileURLToPath(import.meta.url));

afterEach(() => { cleanup(); vi.unstubAllEnvs(); vi.restoreAllMocks(); vi.resetModules(); });

describe("import safety (no Supabase env)", () => {
  it("imports and renders the panel with no Supabase env vars set", async () => {
    // No VITE_SUPABASE_* stubbed → if anything eagerly built the client, this throws.
    const { DevDurableWorkerPanel } = await import("./devDurableWorkerSection");
    expect(() => render(<DevDurableWorkerPanel />)).not.toThrow();
  });

  it("shows the honest 'Not configured' state when the proxy URL is absent", async () => {
    vi.stubEnv("VITE_GOOGLE_BACKEND_URL", "");
    vi.resetModules();
    const { DevDurableWorkerPanel } = await import("./devDurableWorkerSection");
    render(<DevDurableWorkerPanel />);
    expect(screen.getAllByText(/Not configured/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/not configured for this environment/i)).toBeTruthy();
  });
});

describe("source-level boundary guarantees", () => {
  const componentSrc = readFileSync(path.join(HERE, "devDurableWorkerSection.tsx"), "utf8");
  const apiSrc = readFileSync(path.join(HERE, "..", "..", "lib", "durableWorkerAdminApi.ts"), "utf8");

  it("the component does not statically import the browser Supabase client", () => {
    expect(componentSrc).not.toMatch(/^\s*import[^;]*['"]@\/lib\/supabaseClient['"]/m);
    expect(componentSrc).not.toMatch(/^\s*import[^;]*['"]@supabase\/supabase-js['"]/m);
  });

  it("the api module never STATICALLY imports supabase (dynamic import only, at request time)", () => {
    // A static top-level import would defeat the whole fix; a dynamic import() is allowed.
    expect(apiSrc).not.toMatch(/^\s*import\s+.*from\s+['"]@\/lib\/supabaseClient['"]/m);
    expect(apiSrc).not.toMatch(/from\s+['"]@supabase\/supabase-js['"]/);
    expect(apiSrc).toMatch(/await import\(\s*['"]@\/lib\/supabaseClient['"]\s*\)/);
  });

  it("no service-role secret or service-role client appears in either module", () => {
    for (const src of [componentSrc, apiSrc]) {
      expect(src).not.toMatch(/service_role/i);
      expect(src).not.toMatch(/SERVICE_ROLE_KEY/);
      expect(src).not.toMatch(/createClient\s*\(/);
    }
  });
});

describe("configured proxy routing", () => {
  const BASE = "https://api.example.run.app";

  beforeEach(() => {
    vi.stubEnv("VITE_GOOGLE_BACKEND_URL", BASE);
    vi.resetModules();
  });

  async function loadApiWithSession(token: string | null) {
    // Stub the lazily-imported Supabase module so no real client is constructed.
    vi.doMock("@/lib/supabaseClient", () => ({
      supabase: { auth: { getSession: async () => ({ data: { session: token ? { access_token: token } : null } }) } },
    }));
    return import("@/lib/durableWorkerAdminApi");
  }

  it("calls the backend admin proxy route with the bearer token", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ configured: true, mode: "dev-durable", reachable: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const { durableWorkerAdminApi } = await loadApiWithSession("admin-token-123");
    const status = await durableWorkerAdminApi.status();

    expect(status.mode).toBe("dev-durable");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${BASE}/admin/intake/status`);                     // proxy route, not Supabase
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer admin-token-123");
  });

  it("routes a control action to the proxy job path and never publishes", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ status: "needs_review" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const jobId = "11111111-2222-4333-8444-555555555555";

    const { durableWorkerAdminApi } = await loadApiWithSession("t");
    await durableWorkerAdminApi.control(jobId, "run");

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${BASE}/admin/intake/jobs/${jobId}/run`);
    expect(init.method).toBe("POST");
  });

  it("surfaces a safe message on an unauthorized backend response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "forbidden", message: "Admin access required" }), { status: 403 })));
    const { durableWorkerAdminApi, describeDurableError } = await loadApiWithSession("t");
    const msg = await durableWorkerAdminApi.status().catch((e) => describeDurableError(e, "fallback"));
    expect(msg).toBe("Admin access required");
  });

  it("surfaces a safe message (not a raw stack) when the backend is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ECONNREFUSED 10.0.0.1:443 internal detail"); }));
    const { durableWorkerAdminApi, describeDurableError } = await loadApiWithSession("t");
    const msg = await durableWorkerAdminApi.status().catch((e) => describeDurableError(e, "fallback"));
    expect(msg).toMatch(/reach the backend/i);
    expect(msg).not.toMatch(/ECONNREFUSED|10\.0\.0\.1/);                 // no internals leak to the UI
  });

  it("requires a signed-in admin session before calling the proxy", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { durableWorkerAdminApi, describeDurableError } = await loadApiWithSession(null);
    const msg = await durableWorkerAdminApi.status().catch((e) => describeDurableError(e, "fallback"));
    expect(msg).toMatch(/sign in/i);
    expect(fetchMock).not.toHaveBeenCalled();                            // no token → no request
  });
});
