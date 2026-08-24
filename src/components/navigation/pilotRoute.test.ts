import { describe, it, expect } from "vitest";
import { pilotBuildRoute } from "./pilotRoute";
import {
  MALL_REDS_PILOT_NODES as NODES, MALL_REDS_PILOT_EDGES as EDGES,
  pilotStartOptions, pilotDestinations, pilotPointsOfInterest, searchPilotPois,
  defaultPilotAnchor, anchorFromStart,
} from "./mallRedsPilotGraph";

describe("Mall@Reds navigation pilot — routing", () => {
  it("start options are valid anchors (entrances + landmark, human labels)", () => {
    const labels = pilotStartOptions().map((s) => s.label);
    expect(labels).toEqual(expect.arrayContaining(["Main Entrance", "Entrance 2", "Information Desk"]));
    expect(pilotStartOptions().every((s) => s.id && !/^node/i.test(s.label))).toBe(true);
  });

  it("changing the start point changes the route origin", () => {
    const a = pilotBuildRoute(NODES, EDGES, "entrance-main", "clicks");
    const b = pilotBuildRoute(NODES, EDGES, "entrance-2", "clicks");
    expect(a.found && b.found).toBe(true);
    expect(a.steps[0].instruction).toContain("Main Entrance");
    expect(b.steps[0].instruction).toContain("Entrance 2");
    expect(a.total_distance_meters).not.toBe(b.total_distance_meters);
  });

  it("known tenants return real multi-segment routes (Clicks/Game/Dis-Chem)", () => {
    for (const [start, dest, name] of [["entrance-main", "clicks", "Clicks"], ["entrance-2", "game", "Game"], ["info-desk", "dischem", "Dis-Chem"]] as const) {
      const r = pilotBuildRoute(NODES, EDGES, start, dest);
      expect(r.found && !r.fallback).toBe(true);
      expect(r.steps.length).toBeGreaterThanOrEqual(2);
      expect(r.steps[r.steps.length - 1].instruction).toContain(`arrived at ${name}`);
      expect(r.total_distance_meters).toBeGreaterThan(0);
    }
  });

  it("unknown destination fails honestly (no fabricated route)", () => {
    const r = pilotBuildRoute(NODES, EDGES, "entrance-main", "lacoste");
    expect(r.found).toBe(false);
    expect(r.steps).toHaveLength(0);
    expect(r.message).toMatch(/isn.t in the Mall@Reds pilot/i);
  });

  it("present-but-disconnected destination fails honestly", () => {
    const nodes = [...NODES, { id: "orphan", name: "Orphan", type: "shop", floor: "G", x_coordinate: 50, y_coordinate: 5, linked_shop_id: "orphan" }];
    const r = pilotBuildRoute(nodes, EDGES, "entrance-main", "orphan");
    expect(r.found && r.fallback).toBe(true);
    expect(r.steps).toHaveLength(0);
    expect(r.message).toMatch(/isn.t connected/i);
  });

  it("instructions and floor render on every step", () => {
    const r = pilotBuildRoute(NODES, EDGES, "entrance-main", "game");
    expect(r.steps.every((s) => typeof s.instruction === "string" && s.instruction.length > 0)).toBe(true);
    expect(r.steps.every((s) => s.floor === "G")).toBe(true);
  });

  it("routing needs only the graph — no product/price input", () => {
    expect(pilotBuildRoute.length).toBe(4);
    for (const d of pilotDestinations()) {
      expect(pilotBuildRoute(NODES, EDGES, "entrance-main", d.shopId).fallback).toBe(false);
    }
  });
});

describe("Mall@Reds navigation pilot — POI finder + amenities", () => {
  it("exposes real tenants AND honest amenities, all routable", () => {
    const pois = pilotPointsOfInterest();
    const names = pois.map((p) => p.name);
    expect(names).toEqual(expect.arrayContaining(["Clicks", "Game", "Dis-Chem", "Pick n Pay", "Woolworths"]));
    expect(names).toEqual(expect.arrayContaining(["Toilets", "Lifts", "Food Court", "Information Desk"]));
    expect(pois.some((p) => p.kind === "store")).toBe(true);
    expect(pois.some((p) => p.kind === "amenity")).toBe(true);
    for (const p of pois) {
      const r = pilotBuildRoute(NODES, EDGES, "entrance-main", p.id);
      expect(r.found && !r.fallback).toBe(true); // every listed POI is genuinely routable (honest)
    }
  });

  it("routes to an amenity (Toilets) like a tenant", () => {
    const r = pilotBuildRoute(NODES, EDGES, "entrance-main", "toilets");
    expect(r.found && !r.fallback).toBe(true);
    expect(r.steps[r.steps.length - 1].instruction).toContain("Toilets");
  });

  it("search-as-you-type filters POIs; empty query returns all", () => {
    expect(searchPilotPois("").length).toBe(pilotPointsOfInterest().length);
    expect(searchPilotPois("toil").map((p) => p.name)).toEqual(["Toilets"]);
    expect(searchPilotPois("cli").map((p) => p.name)).toEqual(["Clicks"]);
    expect(searchPilotPois("zzz")).toHaveLength(0);
  });
});

describe("Mall@Reds navigation pilot — anchor abstraction (positioning seam)", () => {
  it("defaultPilotAnchor is a manual anchor at a valid start node", () => {
    const a = defaultPilotAnchor();
    expect(a.source).toBe("manual");
    expect(pilotStartOptions().some((s) => s.id === a.nodeId)).toBe(true);
  });

  it("anchorFromStart carries the label and a decoupled source", () => {
    const a = anchorFromStart("info-desk", "qr");
    expect(a).toEqual({ nodeId: "info-desk", label: "Information Desk", source: "qr" });
    // the route consumes only nodeId — source never reaches the router
    const r = pilotBuildRoute(NODES, EDGES, a.nodeId, "clicks");
    expect(r.found && !r.fallback).toBe(true);
  });
});
