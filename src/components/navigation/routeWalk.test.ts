import { describe, it, expect } from "vitest";
import { computeRouteWalk, type RouteWalkNode } from "./routeWalk";

const DUR = 1000;

// Three same-floor nodes; segment 0: (0,0)→(10,0), segment 1: (10,0)→(10,20).
const flat: RouteWalkNode[] = [
  { x: 0, y: 0, floor: "G" },
  { x: 10, y: 0, floor: "G" },
  { x: 10, y: 20, floor: "G" },
];

describe("computeRouteWalk", () => {
  it("returns the first coordinate at elapsed 0", () => {
    const s = computeRouteWalk(flat, 0, DUR);
    expect(s.point).toEqual({ x: 0, y: 0 });
    expect(s.segmentIndex).toBe(0);
    expect(s.t).toBe(0);
    expect(s.done).toBe(false);
  });

  it("returns the linear midpoint at the middle of a segment", () => {
    const s = computeRouteWalk(flat, DUR / 2, DUR);
    expect(s.point).toEqual({ x: 5, y: 0 });
    expect(s.t).toBeCloseTo(0.5);
  });

  it("returns the next coordinate at the end of a segment", () => {
    const s = computeRouteWalk(flat, DUR, DUR);
    expect(s.point).toEqual({ x: 10, y: 0 });
    expect(s.segmentIndex).toBe(1);
    expect(s.done).toBe(false);
  });

  it("clamps to the final coordinate when elapsed runs past the route", () => {
    const s = computeRouteWalk(flat, DUR * 99, DUR);
    expect(s.point).toEqual({ x: 10, y: 20 });
    expect(s.done).toBe(true);
    expect(s.t).toBe(1);
  });

  it("switches to the destination floor on a floor transition", () => {
    const stairs: RouteWalkNode[] = [
      { x: 0, y: 0, floor: "G" },
      { x: 50, y: 50, floor: "L1" },
    ];
    // First half stays on the source floor.
    const early = computeRouteWalk(stairs, DUR * 0.25, DUR);
    expect(early.floor).toBe("G");
    expect(early.point).toEqual({ x: 0, y: 0 });
    // Second half switches to the destination floor and coordinate.
    const late = computeRouteWalk(stairs, DUR * 0.75, DUR);
    expect(late.floor).toBe("L1");
    expect(late.point).toEqual({ x: 50, y: 50 });
  });

  it("handles an empty route safely", () => {
    const s = computeRouteWalk([], 0, DUR);
    expect(s.done).toBe(true);
    expect(s.point).toEqual({ x: 0, y: 0 });
    expect(s.floor).toBeNull();
  });

  it("handles a single-node route safely", () => {
    const s = computeRouteWalk([{ x: 7, y: 3, floor: "L2" }], 5000, DUR);
    expect(s.done).toBe(true);
    expect(s.point).toEqual({ x: 7, y: 3 });
    expect(s.floor).toBe("L2");
    expect(s.segmentIndex).toBe(0);
  });
});
