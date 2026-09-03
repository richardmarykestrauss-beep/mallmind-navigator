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
    expect(malls.map((m) => m.id)).toEqual(["mallreds-pilot", "menlyn-park"]);
    expect(DEFAULT_WAYFINDING_MALL_ID).toBe("mallreds-pilot");
    const reds = malls.find((m) => m.id === "mallreds-pilot")!;
    const menlyn = malls.find((m) => m.id === "menlyn-park")!;
    expect(reds).toMatchObject({ datasetStatus: "schematic", metric: true, fieldVerified: false });
    expect(menlyn).toMatchObject({ datasetStatus: "source-backed", metric: false, fieldVerified: false });
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
