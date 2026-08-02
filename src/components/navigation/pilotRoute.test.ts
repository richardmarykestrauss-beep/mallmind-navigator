import { describe, it, expect } from "vitest";
import { pilotBuildRoute } from "./pilotRoute";
import {
  MALL_REDS_PILOT_NODES as NODES, MALL_REDS_PILOT_EDGES as EDGES,
  pilotStartOptions, pilotDestinations,
} from "./mallRedsPilotGraph";

describe("Mall@Reds navigation pilot", () => {
  it("1. start-point selector loads valid graph anchors (entrances + landmark, human labels)", () => {
    const starts = pilotStartOptions();
    const labels = starts.map((s) => s.label);
    expect(labels).toContain("Main Entrance");
    expect(labels).toContain("Entrance 2");
    expect(labels).toContain("Information Desk");
    expect(starts.every((s) => s.id && s.label && !/^node/i.test(s.label))).toBe(true);
  });

  it("2. changing the start point changes the route origin", () => {
    const fromMain = pilotBuildRoute(NODES, EDGES, "entrance-main", "clicks");
    const fromEnt2 = pilotBuildRoute(NODES, EDGES, "entrance-2", "clicks");
    expect(fromMain.found && fromEnt2.found).toBe(true);
    expect(fromMain.steps[0].instruction).toContain("Main Entrance");
    expect(fromEnt2.steps[0].instruction).toContain("Entrance 2");
    expect(fromMain.total_distance_meters).not.toBe(fromEnt2.total_distance_meters);
  });

  it("3. a known pilot tenant returns a real multi-segment route", () => {
    const r = pilotBuildRoute(NODES, EDGES, "entrance-main", "clicks");
    expect(r.found).toBe(true);
    expect(r.fallback).toBe(false);
    expect(r.steps.length).toBeGreaterThanOrEqual(3);
    expect(r.steps[r.steps.length - 1].instruction).toContain("arrived at Clicks");
    expect(r.total_distance_meters).toBeGreaterThan(0);
  });

  it("4. an unknown tenant fails honestly (no fabricated route)", () => {
    const r = pilotBuildRoute(NODES, EDGES, "entrance-main", "lacoste");
    expect(r.found).toBe(false);
    expect(r.steps).toHaveLength(0);
    expect(r.message).toMatch(/isn.t in the Mall@Reds pilot/i);
  });

  it("5. a tenant present but not connected fails honestly (no fabricated route)", () => {
    const nodes = [...NODES, { id: "orphan", name: "Orphan Store", type: "shop", floor: "G", x_coordinate: 50, y_coordinate: 5, linked_shop_id: "orphan" }];
    const r = pilotBuildRoute(nodes, EDGES, "entrance-main", "orphan");
    expect(r.found).toBe(true);
    expect(r.fallback).toBe(true);
    expect(r.steps).toHaveLength(0);
    expect(r.message).toMatch(/isn.t connected/i);
  });

  it("6 & 7. instructions and floor information render on every step", () => {
    const r = pilotBuildRoute(NODES, EDGES, "entrance-main", "game");
    expect(r.steps.every((s) => typeof s.instruction === "string" && s.instruction.length > 0)).toBe(true);
    expect(r.steps.every((s) => s.floor === "G")).toBe(true);
  });

  it("8. routing needs only the graph — no product/price input", () => {
    // pilotBuildRoute's entire input is nodes + edges + ids; there is no product/price argument.
    expect(pilotBuildRoute.length).toBe(4);
    const dests = pilotDestinations();
    expect(dests.map((d) => d.name)).toEqual(expect.arrayContaining(["Clicks", "Game", "Dis-Chem", "Pick n Pay", "Woolworths"]));
    // every curated destination is genuinely routable (honest list)
    for (const d of dests) {
      expect(pilotBuildRoute(NODES, EDGES, "entrance-main", d.shopId).fallback).toBe(false);
    }
  });
});
