import { describe, it, expect } from "vitest";
import { routeMetrics } from "./routeMetrics";

const step = (distance_meters: number | null, cumulative_meters: number | null) => ({ distance_meters, cumulative_meters });

describe("routeMetrics — no fabricated distance or time, ever", () => {
  it("an assistant stop list with no spatial steps has NO metres and NO minutes (the old 50 m + 80 m/stop estimate is gone)", () => {
    expect(routeMetrics([])).toEqual({ meters: null, minutes: null });
  });

  it("an unscaled route (null distances) has NO metres and NO minutes", () => {
    expect(routeMetrics([step(null, null), step(null, null), step(null, null)])).toEqual({ meters: null, minutes: null });
  });

  it("a partially measured route is NOT metric (one unmeasured leg poisons the total)", () => {
    expect(routeMetrics([step(12, 12), step(null, null), step(0, 12)])).toEqual({ meters: null, minutes: null });
  });

  it("a fully measured route keeps its measured metres and derives minutes only from them", () => {
    expect(routeMetrics([step(30, 30), step(36, 66), step(0, 66)])).toEqual({ meters: 66, minutes: 1 });
    expect(routeMetrics([step(150, 150), step(90, 240), step(0, 240)])).toEqual({ meters: 240, minutes: 3 });
  });

  it("a zero or negative total is not a measurement", () => {
    expect(routeMetrics([step(0, 0)])).toEqual({ meters: null, minutes: null });
  });
});
