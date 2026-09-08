import { describe, it, expect } from "vitest";
import { selectMapRenderMode, buildSchematicRoute } from "./mapRenderMode";

describe("selectMapRenderMode", () => {
  it("uses the full renderer when a backend map model exists", () => {
    expect(selectMapRenderMode({ hasMapModel: true, routeStepCount: 0 })).toBe("full");
    expect(selectMapRenderMode({ hasMapModel: true, routeStepCount: 5 })).toBe("full");
  });

  it("falls back to the schematic preview when the model is missing but a route exists", () => {
    expect(selectMapRenderMode({ hasMapModel: false, routeStepCount: 3 })).toBe("schematic");
  });

  it("is empty only when there is neither a model nor a route", () => {
    expect(selectMapRenderMode({ hasMapModel: false, routeStepCount: 0 })).toBe("empty");
  });
});

describe("buildSchematicRoute", () => {
  const layout = { width: 360, height: 176, marginX: 24 };

  it("returns no points for an empty route", () => {
    expect(buildSchematicRoute(0, layout)).toEqual([]);
  });

  it("spans the full walkable width across the first and last points", () => {
    const pts = buildSchematicRoute(4, layout);
    expect(pts).toHaveLength(4);
    expect(pts[0].x).toBe(24);
    expect(pts[3].x).toBe(360 - 24);
  });

  it("is deterministic (same input → identical layout) and stays within the canvas", () => {
    const a = buildSchematicRoute(5, layout);
    const b = buildSchematicRoute(5, layout);
    expect(a).toEqual(b);
    for (const p of a) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(layout.width);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(layout.height);
    }
  });

  it("curves off the flat centre line so it reads as a real path", () => {
    const pts = buildSchematicRoute(5, layout);
    const mid = layout.height / 2;
    expect(pts.some((p) => Math.abs(p.y - mid) > 1)).toBe(true);
  });
});
