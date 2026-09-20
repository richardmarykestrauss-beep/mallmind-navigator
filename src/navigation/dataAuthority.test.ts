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

  it("the navigation runtime resolves destinations from the Venue Pack vocabulary only", () => {
    const intent = read("src/navigation/navigationIntent.ts");
    expect(intent).toMatch(/searchableDestinations|searchDestinations/);
    expect(intent).not.toMatch(/fetch\(|supabase|axios/);
  });
});
