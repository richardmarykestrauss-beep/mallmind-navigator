import { describe, it, expect } from "vitest";
import { parseWayfindingAnchor, wayfindingLinkFor, knownWayfindingMalls } from "./wayfindingAnchor";
import { pilotBuildRoute } from "./pilotRoute";
import {
  MALL_REDS_PILOT_NODES as NODES, MALL_REDS_PILOT_EDGES as EDGES, MALL_REDS_PILOT_MALL_ID,
  anchorFromStart, pilotStartOptions,
} from "./mallRedsPilotGraph";
import { getWayfindingMall } from "./mallDatasets";

describe("wayfinding URL anchor (QR-ready seam)", () => {
  it("no params → none (manual flow, no anchor)", () => {
    expect(parseWayfindingAnchor("")).toEqual({ status: "none", mallId: null, anchor: null, reason: null });
    expect(parseWayfindingAnchor("?foo=bar").status).toBe("none");
  });

  it("known mall + allowed start → ok, url-sourced anchor in the SAME model as manual selection", () => {
    const r = parseWayfindingAnchor(`?mall=${MALL_REDS_PILOT_MALL_ID}&start=entrance-main`);
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.mallId).toBe(MALL_REDS_PILOT_MALL_ID);
    expect(r.anchor.nodeId).toBe("entrance-main");
    expect(r.anchor.label).toBe("Main Entrance");
    expect(r.anchor.source).toBe("url");
    // identical nodeId/label to the manual anchor — only the source differs
    const manual = anchorFromStart("entrance-main");
    expect({ nodeId: r.anchor.nodeId, label: r.anchor.label }).toEqual({ nodeId: manual.nodeId, label: manual.label });
    // and it routes exactly like a manual anchor would
    const route = pilotBuildRoute(NODES, EDGES, r.anchor.nodeId, "clicks");
    expect(route.found && !route.fallback).toBe(true);
  });

  it("every allowed start point round-trips through its own link", () => {
    for (const s of pilotStartOptions()) {
      const r = parseWayfindingAnchor(wayfindingLinkFor(MALL_REDS_PILOT_MALL_ID, s.id).split("?")[1]);
      expect(r.status).toBe("ok");
      if (r.status === "ok") expect(r.anchor.nodeId).toBe(s.id);
    }
  });

  it("known mall without a start → mall (that mall, manual default start)", () => {
    const r = parseWayfindingAnchor("?mall=menlyn-park");
    expect(r).toEqual({ status: "mall", mallId: "menlyn-park", anchor: null, reason: null });
  });

  it("Menlyn link with Entrance 13 → ok, and the anchor belongs to the Menlyn graph", () => {
    const r = parseWayfindingAnchor("?mall=menlyn-park&start=menlyn-lf-entrance-13");
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.anchor).toEqual({ nodeId: "menlyn-lf-entrance-13", label: "Entrance 13", source: "url" });
    const g = getWayfindingMall("menlyn-park")!;
    const route = pilotBuildRoute(g.nodes, g.edges, r.anchor.nodeId, "menlyn-clicks-lf72");
    expect(route.found && !route.fallback).toBe(true);
    expect(route.metric).toBe(false);
  });

  it("Garden Route link with Entrance 4 → ok; a Menlyn start is rejected there", () => {
    const r = parseWayfindingAnchor("?mall=garden-route-mall&start=grm-entrance-4");
    expect(r.status).toBe("ok");
    if (r.status === "ok") expect(r.anchor).toEqual({ nodeId: "grm-entrance-4", label: "Entrance 4", source: "url" });
    expect(parseWayfindingAnchor("?mall=garden-route-mall&start=menlyn-lf-entrance-13").status).toBe("invalid");
  });

  it("a start node from another mall is rejected for this mall", () => {
    const r = parseWayfindingAnchor("?mall=menlyn-park&start=entrance-main");
    expect(r.status).toBe("invalid");
    expect(r.mallId).toBe("menlyn-park");
    expect(r.anchor).toBeNull();
  });

  it("unknown mall fails safely (no anchor, human reason)", () => {
    const r = parseWayfindingAnchor("?mall=sandton-city&start=entrance-main");
    expect(r.status).toBe("invalid");
    expect(r.anchor).toBeNull();
    expect(r.reason).toMatch(/does not have a map/i);
  });

  it("unknown or non-start node fails safely — a URL can never invent a position", () => {
    for (const start of ["c3", "clicks", "toilets", "does-not-exist", "../../etc", "<script>"]) {
      const r = parseWayfindingAnchor(`?mall=${MALL_REDS_PILOT_MALL_ID}&start=${encodeURIComponent(start)}`);
      expect(r.status, start).toBe("invalid");
      expect(r.anchor).toBeNull();
    }
  });

  it("start without a mall fails safely", () => {
    expect(parseWayfindingAnchor("?start=entrance-main").status).toBe("invalid");
  });

  it("known malls are exactly those with a bundled spatial dataset", () => {
    expect(knownWayfindingMalls().map((m) => m.id)).toEqual([MALL_REDS_PILOT_MALL_ID, "menlyn-park", "garden-route-mall"]);
  });

  it("wayfindingLinkFor produces the canonical /navigate link", () => {
    expect(wayfindingLinkFor(MALL_REDS_PILOT_MALL_ID, "entrance-2")).toBe(`/navigate?mall=${MALL_REDS_PILOT_MALL_ID}&start=entrance-2`);
    expect(wayfindingLinkFor("menlyn-park", "menlyn-lf-entrance-13")).toBe("/navigate?mall=menlyn-park&start=menlyn-lf-entrance-13");
  });
});
