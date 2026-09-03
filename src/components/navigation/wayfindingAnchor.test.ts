import { describe, it, expect } from "vitest";
import { parseWayfindingAnchor, wayfindingLinkFor, knownWayfindingMalls } from "./wayfindingAnchor";
import { pilotBuildRoute } from "./pilotRoute";
import {
  MALL_REDS_PILOT_NODES as NODES, MALL_REDS_PILOT_EDGES as EDGES, MALL_REDS_PILOT_MALL_ID,
  anchorFromStart, pilotStartOptions,
} from "./mallRedsPilotGraph";

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

  it("unknown mall fails safely (no anchor, human reason)", () => {
    const r = parseWayfindingAnchor("?mall=sandton-city&start=entrance-main");
    expect(r.status).toBe("invalid");
    expect(r.anchor).toBeNull();
    expect(r.reason).toMatch(/does not have a map/i);
  });

  it("unknown or non-start node fails safely — a URL can never invent a position", () => {
    for (const start of ["c3", "clicks", "toilets", "does-not-exist", "", "../../etc", "<script>"]) {
      const r = parseWayfindingAnchor(`?mall=${MALL_REDS_PILOT_MALL_ID}&start=${encodeURIComponent(start)}`);
      expect(r.status, start).toBe("invalid");
      expect(r.anchor).toBeNull();
    }
  });

  it("missing half of the pair fails safely", () => {
    expect(parseWayfindingAnchor("?start=entrance-main").status).toBe("invalid");
    expect(parseWayfindingAnchor(`?mall=${MALL_REDS_PILOT_MALL_ID}`).status).toBe("invalid");
  });

  it("known malls are exactly those with a bundled spatial dataset", () => {
    expect(knownWayfindingMalls().map((m) => m.id)).toEqual([MALL_REDS_PILOT_MALL_ID]);
  });

  it("wayfindingLinkFor produces the canonical /navigate link", () => {
    expect(wayfindingLinkFor(MALL_REDS_PILOT_MALL_ID, "entrance-2")).toBe(`/navigate?mall=${MALL_REDS_PILOT_MALL_ID}&start=entrance-2`);
  });
});
