import { describe, it, expect } from "vitest";
import { describeShopFloor, describeEntrance, isFloorUnknown } from "@/lib/shopLocation";
import { selectMapRenderMode } from "@/components/navigation/mapRenderMode";

/**
 * Sprint 2G — honest representation of an UNKNOWN store floor.
 * A real directory (Mall@Reds) publishes no floors, so shops.floor is NULL.
 * The UI must show "not yet verified" — never "Ground Floor", never "null".
 */
describe("describeShopFloor — nullable floor, no invented Ground Floor", () => {
  it("shows an unknown floor as 'Floor not yet verified' (NULL)", () => {
    expect(describeShopFloor(null)).toBe("Floor not yet verified");
  });

  it("treats undefined / blank / '?' / 'unknown' as not-yet-verified", () => {
    expect(describeShopFloor(undefined)).toBe("Floor not yet verified");
    expect(describeShopFloor("")).toBe("Floor not yet verified");
    expect(describeShopFloor("   ")).toBe("Floor not yet verified");
    expect(describeShopFloor("?")).toBe("Floor not yet verified");
    expect(describeShopFloor("unknown")).toBe("Floor not yet verified");
  });

  it("NEVER silently becomes Ground Floor for an unknown floor", () => {
    expect(describeShopFloor(null)).not.toMatch(/ground/i);
    expect(describeShopFloor(undefined)).not.toMatch(/ground/i);
  });

  it("NEVER prints the literal string 'null' (the fixed defect)", () => {
    expect(describeShopFloor(null)).not.toContain("null");
    expect(describeShopFloor(undefined)).not.toContain("null");
  });

  it("preserves a VERIFIED floor value verbatim (incl. explicit 'G')", () => {
    expect(describeShopFloor("G")).toBe("Floor G");
    expect(describeShopFloor("1")).toBe("Floor 1");
    expect(describeShopFloor("L2")).toBe("Floor L2");
    expect(describeShopFloor("B1")).toBe("Floor B1");
  });
});

describe("isFloorUnknown", () => {
  it("is true only for empty/placeholder floors", () => {
    expect(isFloorUnknown(null)).toBe(true);
    expect(isFloorUnknown(undefined)).toBe(true);
    expect(isFloorUnknown("")).toBe(true);
    expect(isFloorUnknown("?")).toBe(true);
    expect(isFloorUnknown("unknown")).toBe(true);
    expect(isFloorUnknown("G")).toBe(false);
    expect(isFloorUnknown("1")).toBe(false);
  });
});

describe("describeEntrance — navigation copy never fabricates a floor", () => {
  it("uses a neutral entrance when the floor is unknown", () => {
    expect(describeEntrance(null)).toBe("the mall entrance");
    expect(describeEntrance("")).toBe("the mall entrance");
    expect(describeEntrance(null)).not.toContain("null");
    expect(describeEntrance(null)).not.toMatch(/ground/i);
  });

  it("maps an explicit 'G' to Ground Floor, other floors to their entrance", () => {
    expect(describeEntrance("G")).toBe("Ground Floor");
    expect(describeEntrance("1")).toBe("Floor 1 entrance");
  });
});

/**
 * Sprint 2G — routing must REFUSE / DEFER for a store with no verified graph
 * location. An unlocated store (no backend map model) must never render the
 * "full" indoor map; it degrades to a schematic (if a route exists) or empty.
 */
describe("routing safe-degradation for an unlocated store", () => {
  it("never renders a full indoor map without a map graph", () => {
    expect(selectMapRenderMode({ hasMapModel: false, routeStepCount: 0 })).toBe("empty");
    expect(selectMapRenderMode({ hasMapModel: false, routeStepCount: 5 })).toBe("schematic");
    // 'full' requires an actual backend map model — never fabricated.
    expect(selectMapRenderMode({ hasMapModel: false, routeStepCount: 99 })).not.toBe("full");
  });

  it("only renders the full map when a real map model exists", () => {
    expect(selectMapRenderMode({ hasMapModel: true, routeStepCount: 0 })).toBe("full");
  });
});
