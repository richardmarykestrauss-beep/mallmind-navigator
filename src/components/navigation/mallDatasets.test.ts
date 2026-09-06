import { describe, it, expect } from "vitest";
import {
  listWayfindingMalls, getWayfindingMall, pointsOfInterest, searchPois, startOptions, defaultAnchor, anchorFor,
  DEFAULT_WAYFINDING_MALL_ID,
} from "./mallDatasets";
import { pilotBuildRoute } from "./pilotRoute";
import { MALL_REDS_PILOT_MALL_ID, MALL_REDS_PILOT_NODES, pilotPointsOfInterest } from "./mallRedsPilotGraph";

describe("mall dataset registry (multi-mall, keyed by mall id)", () => {
  it("lists both bundled malls with their truth status; Mall@Reds stays the default", () => {
    const malls = listWayfindingMalls();
    expect(malls.map((m) => m.id)).toEqual(["mallreds-pilot", "menlyn-park", "garden-route-mall"]);
    expect(DEFAULT_WAYFINDING_MALL_ID).toBe("mallreds-pilot");
    const reds = malls.find((m) => m.id === "mallreds-pilot")!;
    const menlyn = malls.find((m) => m.id === "menlyn-park")!;
    expect(reds).toMatchObject({ datasetStatus: "schematic", metric: true, fieldVerified: false });
    expect(menlyn).toMatchObject({ datasetStatus: "source-backed", metric: false, fieldVerified: false });
    const grm = malls.find((m) => m.id === "garden-route-mall")!;
    expect(grm).toMatchObject({ name: "Garden Route Mall", datasetStatus: "source-backed", metric: false, fieldVerified: false });
  });

  it("unknown mall ids fail safely (null, no throw)", () => {
    expect(getWayfindingMall("sandton-city")).toBeNull();
    expect(getWayfindingMall("")).toBeNull();
    expect(getWayfindingMall("../etc")).toBeNull();
  });

  it("the Mall@Reds bindings are exactly the registry's default graph (unchanged behaviour)", () => {
    const g = getWayfindingMall(MALL_REDS_PILOT_MALL_ID)!;
    expect(g.nodes).toBe(MALL_REDS_PILOT_NODES);
    expect(pointsOfInterest(g)).toEqual(pilotPointsOfInterest());
    expect(g.metric).toBe(true);
    expect(g.distanceUnit).toBe("m");
  });
});

describe("Menlyn Park — source-backed, unscaled controlled pilot dataset", () => {
  const g = getWayfindingMall("menlyn-park")!;

  it("loads with the truth flags visible internally", () => {
    expect(g.mallName).toBe("Menlyn Park");
    expect(g.datasetStatus).toBe("source-backed");
    expect(g.evidenceStatus).toBe("source-backed");
    expect(g.distanceUnit).toBe("px");
    expect(g.metric).toBe(false);
    expect(g.fieldVerified).toBe(false);
    expect(g.dataset.reality_label).toMatch(/unscaled/);
    expect(g.dataset.reality_label).toMatch(/not-field-verified/);
    // no map artwork bundled (rights not confirmed)
    expect(g.floorImages).toEqual({});
    expect(g.dataset.floors[0].plan_image).toBeNull();
    // provenance retained on every entity
    expect(g.dataset.nodes.every((n) => n.source?.includes("menlynpark.co.za"))).toBe(true);
    expect(g.dataset.edges.every((e) => e.source?.includes("menlynpark.co.za"))).toBe(true);
    expect(g.dataset.nodes.every((n) => n.evidence === "source-backed")).toBe(true);
  });

  it("adapter never converts pixels to metres: distance_meters is null, weight is the pixel length", () => {
    expect(g.edges.map((e) => e.distance_meters)).toEqual([null, null]);
    expect(g.edges.map((e) => e.weight)).toEqual([159, 60]);
  });

  it("finder exposes Clicks as the only destination and Entrance 13 as the only start", () => {
    expect(pointsOfInterest(g)).toEqual([{ id: "menlyn-clicks-lf72", name: "Clicks", kind: "store", type: "shop" }]);
    expect(searchPois(g, "cli").map((p) => p.name)).toEqual(["Clicks"]);
    expect(searchPois(g, "toilet")).toEqual([]);
    expect(startOptions(g)).toEqual([{ id: "menlyn-lf-entrance-13", label: "Entrance 13" }]);
    expect(defaultAnchor(g)).toEqual({ nodeId: "menlyn-lf-entrance-13", label: "Entrance 13", source: "manual" });
    expect(anchorFor(g, "menlyn-lf-entrance-13", "url").source).toBe("url");
  });

  it("Entrance 13 → Clicks resolves: 2 legs + arrival, topological instructions, NO metres, NO minutes", () => {
    const r = pilotBuildRoute(g.nodes, g.edges, "menlyn-lf-entrance-13", "menlyn-clicks-lf72");
    expect(r.found && !r.fallback).toBe(true);
    expect(r.metric).toBe(false);
    expect(r.total_distance_meters).toBeNull();
    expect(r.estimated_minutes).toBeNull();
    expect(r.steps.map((s) => s.node_id)).toEqual(["menlyn-lf-spine-x-upper", "menlyn-lf-clicks-lf72-arrival", "menlyn-lf-clicks-lf72-arrival"]);
    expect(r.steps.every((s) => s.distance_meters === null && s.cumulative_meters === null)).toBe(true);
    expect(r.steps[0].instruction).toBe("Start at Entrance 13. Walk straight into the mall along the corridor until you reach the cross corridor.");
    expect(r.steps[1].instruction).toBe("Continue straight across the cross corridor. Clicks is on your right, just past the crossing.");
    expect(r.steps[2].instruction).toBe("You’ve arrived at Clicks.");
    // instructions carry topology, never a distance or time claim
    expect(r.steps.some((s) => /\d+\s?(m|metres|min)/i.test(s.instruction))).toBe(false);
    expect(r.steps.every((s) => s.floor === "LF")).toBe(true);
  });

  it("the Clicks tenant identity is source-backed while its position stays a corridor arrival point", () => {
    const clicks = g.dataset.nodes.find((n) => n.node_id === "menlyn-lf-clicks-lf72-arrival")!;
    expect(clicks.tenant).toMatchObject({ shop_number: "LF 72", identity_evidence: "source-backed" });
    expect(clicks.notes).toMatch(/not the storefront door/i);
  });
});

describe("Garden Route Mall — source-backed, unscaled, awaiting Sunday field verification", () => {
  const g = getWayfindingMall("garden-route-mall")!;
  const E4 = "grm-entrance-4";

  it("truth flags: source-backed, px, not metric, not field-verified, no artwork bundled", () => {
    expect(g.datasetStatus).toBe("source-backed");
    expect(g.distanceUnit).toBe("px");
    expect(g.metric).toBe(false);
    expect(g.fieldVerified).toBe(false);
    expect(g.dataset.reality_label).toMatch(/awaiting-field-verification/);
    expect(g.floorImages).toEqual({});
    expect(g.dataset.floors).toHaveLength(1);
    expect(g.nodes.every((n) => n.floor === "L1")).toBe(true);
  });

  it("every node and edge cites the official map; store arrivals are flagged for door verification", () => {
    expect(g.dataset.nodes.every((n) => n.evidence === "source-backed" && /gardenroutemall\.co\.za/.test(n.source ?? ""))).toBe(true);
    expect(g.dataset.edges.every((e) => e.evidence === "source-backed" && /gardenroutemall\.co\.za/.test(e.source ?? ""))).toBe(true);
    const shops = g.dataset.nodes.filter((n) => n.type === "shop") as Array<{ field_verification_required?: boolean; source_px_x?: number }>;
    expect(shops).toHaveLength(3);
    expect(shops.every((n) => n.field_verification_required === true)).toBe(true);
    expect(g.dataset.nodes.every((n) => typeof (n as { source_px_x?: number }).source_px_x === "number")).toBe(true);
  });

  it("adapter: pixel weights only, never metres", () => {
    expect(g.edges.every((e) => e.distance_meters === null && typeof e.weight === "number" && e.weight! > 0)).toBe(true);
  });

  it("finder: Entrance 4 is the only start; Woolworths, Clicks, Pick n Pay are the destinations", () => {
    expect(startOptions(g)).toEqual([{ id: E4, label: "Entrance 4" }]);
    expect(pointsOfInterest(g).map((p) => p.name)).toEqual(["Woolworths", "Clicks", "Pick n Pay"]);
    expect(searchPois(g, "pick").map((p) => p.id)).toEqual(["grm-picknpay-41"]);
  });

  it("ROUTE A: Entrance 4 → Woolworths = 2 legs + arrival, topology only", () => {
    const r = pilotBuildRoute(g.nodes, g.edges, E4, "grm-woolworths-9");
    expect(r.found && !r.fallback).toBe(true);
    expect(r.metric).toBe(false);
    expect(r.total_distance_meters).toBeNull();
    expect(r.estimated_minutes).toBeNull();
    expect(r.steps.map((s) => s.node_id)).toEqual(["grm-walkway-e4", "grm-woolworths-arrival", "grm-woolworths-arrival"]);
    expect(r.steps[0].instruction).toMatch(/^Start at Entrance 4\. Walk straight in/);
    expect(r.steps[1].instruction).toMatch(/Woolworths is directly ahead/);
    expect(r.steps.every((s) => s.distance_meters === null)).toBe(true);
  });

  it("ROUTE B: Entrance 4 → Pick n Pay follows the main walkway through every junction (8 legs + arrival)", () => {
    const r = pilotBuildRoute(g.nodes, g.edges, E4, "grm-picknpay-41");
    expect(r.found && !r.fallback).toBe(true);
    expect(r.steps.map((s) => s.node_id)).toEqual([
      "grm-walkway-e4", "grm-walkway-e5", "grm-walkway-e6", "grm-walkway-bend-edgars",
      "grm-walkway-e7", "grm-walkway-bend-toilets", "grm-clicks-arrival", "grm-picknpay-arrival", "grm-picknpay-arrival",
    ]);
    expect(r.steps[1].instruction).toMatch(/Turn left onto the main walkway/);
    expect(r.steps[7].instruction).toMatch(/Pick n Pay is straight ahead/);
    expect(r.metric).toBe(false);
    expect(r.steps.some((s) => /\d+\s?(m|metres|min)\b/i.test(s.instruction))).toBe(false);
  });

  it("Clicks is reachable on the way to Pick n Pay (7 legs + arrival)", () => {
    const r = pilotBuildRoute(g.nodes, g.edges, E4, "grm-clicks-37");
    expect(r.found && !r.fallback).toBe(true);
    expect(r.steps).toHaveLength(8);
    expect(r.steps[6].instruction).toMatch(/Clicks \(37\/38\) is on your right/);
  });

  it("pixel geometry sanity: every edge has a positive px length and the graph is one connected component", () => {
    const ids = new Set(g.nodes.map((n) => n.id));
    const seen = new Set<string>([E4]);
    let frontier = [E4];
    while (frontier.length) {
      const next: string[] = [];
      for (const id of frontier) for (const e of g.edges) {
        const other = e.from_node_id === id ? e.to_node_id : e.to_node_id === id ? e.from_node_id : null;
        if (other && !seen.has(other)) { seen.add(other); next.push(other); }
      }
      frontier = next;
    }
    expect(seen.size).toBe(ids.size);
  });

  it("Menlyn and Mall@Reds are untouched by the new dataset", () => {
    const menlyn = getWayfindingMall("menlyn-park")!;
    expect(pilotBuildRoute(menlyn.nodes, menlyn.edges, "menlyn-lf-entrance-13", "menlyn-clicks-lf72").steps).toHaveLength(3);
    const reds = getWayfindingMall("mallreds-pilot")!;
    const r = pilotBuildRoute(reds.nodes, reds.edges, "entrance-main", "clicks");
    expect(r.metric).toBe(true);
    expect(r.total_distance_meters).toBe(66);
  });
});
