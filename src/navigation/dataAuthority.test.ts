/**
 * DATA AUTHORITY GUARD (Sprint 7): the customer-facing navigation code has exactly ONE spatial
 * truth — the bundled Venue Packs, routed on the device. This test fails if any customer-facing
 * navigation source grows a hidden fallback to the legacy backend graph (mall_nodes / mall_edges),
 * the retired /build-route endpoint, or a second router.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

/** Every file a visitor's navigation flows through. */
const CUSTOMER_NAVIGATION_SOURCES = [
  "src/pages/NavigateScreen.tsx",
  "src/pages/AssistantPage.tsx",
  "src/pages/WayfindingPilotPage.tsx",
  "src/components/navigation/WayfindingPilot.tsx",
  "src/components/navigation/IndoorMapCanvas.tsx",
  "src/components/navigation/mallDatasets.ts",
  "src/components/navigation/wayfindingAnchor.ts",
  "src/navigation/navigationIntent.ts",
  "src/venue/route.ts",
  "src/components/navigation/navigationSession.ts",
  "src/components/navigation/navigationSessionStore.ts",
  "src/venue/load.ts",
  "src/venue/registry.ts",
  "src/lib/googleBackendClient.ts",
  "src/context/ShoppingSessionContext.tsx",
  // Sprint 8 additions: overlay, search vocabulary, pilot telemetry and the app shell.
  "src/venue/overlay.ts",
  "src/venue/overlayStore.ts",
  "src/venue/operationalLog.ts",
  "src/venue/search.ts",
  "src/venue/vocabulary.ts",
  "src/navigation/demoOverlays.ts",
  "src/navigation/pilotEvents.ts",
  "src/App.tsx",
  "src/main.tsx",
];

const FORBIDDEN: Array<{ pattern: RegExp; why: string }> = [
  { pattern: /\/build-route|BuildRouteResponse|fallback_steps/, why: "the retired backend route builder" },
  { pattern: /mall_nodes|mall_edges|getIndoorMapModel|indoor-map/, why: "the legacy backend indoor graph" },
  { pattern: /shopping_routes|active_route_id|activeRouteSteps|setActiveRoute|loadRoute\(/, why: "the legacy stored-route state" },
  { pattern: /schematicModelFromRoute|routeMetrics\(/, why: "a map or metrics derived from route steps instead of the Venue Pack" },
  { pattern: /route_steps|routeSteps/, why: "assistant-supplied route steps (the assistant returns intent only)" },
];

describe("one spatial truth", () => {
  for (const file of CUSTOMER_NAVIGATION_SOURCES) {
    it(`${file} has no hidden fallback to a second spatial truth`, () => {
      const src = read(file).split("\n").filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line)).join("\n"); // comments may name the past
      for (const { pattern, why } of FORBIDDEN) expect(src, `${file} references ${why} (${pattern})`).not.toMatch(pattern);
    });
  }

  it("the backend no longer mounts /build-route and the assistant returns a navigation_request, not steps", () => {
    expect(read("google-cloud-backend/src/server.ts")).not.toMatch(/build-route|buildRoute/);
    const gemini = read("google-cloud-backend/src/services/geminiService.ts");
    expect(gemini).toMatch(/navigation_request/);
    expect(gemini).not.toMatch(/routingService|buildFallbackRouteSteps/);
  });

  it("the operational overlay never writes into a Venue Pack and never reaches the legacy backend", () => {
    const overlay = read("src/venue/overlay.ts");
    expect(overlay).not.toMatch(/fetch\(|supabase|registerVenuePack|writeFile|pack\.graph\.edges\s*=/);
    const store = read("src/venue/overlayStore.ts");
    expect(store).not.toMatch(/fetch\(|supabase|localStorage/);
    // Overlay authority is an actor role, never the global admin flag.
    expect(overlay).not.toMatch(/is_admin/);
    expect(read("src/venue/operationalLog.ts")).not.toMatch(/is_admin|evidence_class|EvidenceLedger/);
  });

  it("the bucket for legacy map assets is not referenced by any customer navigation source or the factory", () => {
    for (const file of [...CUSTOMER_NAVIGATION_SOURCES, "src/venue/factory/jobStore.ts", "src/venue/factory/cli.ts"]) expect(read(file), file).not.toMatch(/mall-map-assets/);
  });

  it("the legacy indoor-map endpoint is no longer anonymous", () => {
    const route = read("google-cloud-backend/src/routes/indoorMapModel.ts");
    expect(route).toMatch(/requireAdmin\(req, res\)/);
    expect(read("google-cloud-backend/src/server.ts")).toMatch(/\/indoor-map-model",\s+publicWrites\.middleware/);
  });

  it("the navigation runtime resolves destinations from the Venue Pack vocabulary only", () => {
    const intent = read("src/navigation/navigationIntent.ts");
    expect(intent).toMatch(/searchableDestinations|searchDestinations/);
    expect(intent).not.toMatch(/fetch\(|supabase|axios/);
  });
});
