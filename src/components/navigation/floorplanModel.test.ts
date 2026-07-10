import { describe, it, expect } from "vitest";
import {
  FLOOR_WIDTH, FLOOR_HEIGHT,
  buildRoutePolyline, pointsForFloor, routeFloors, polylineToWalkNodes,
  toFloorplanModel, schematicModelFromRoute, normalizeFloorLabel, percentToUnits, pointsBounds,
  type BackendIndoorModelLike,
} from "./floorplanModel";
import { computeRouteWalk } from "./routeWalk";
import { buildDemoRoutePolyline, MALL_REDS_GAME_FLOORPLAN } from "./demoFloorplan";

const STEPS = [
  { node_id: "n1", floor: "G", x_coordinate: 10, y_coordinate: 50 },
  { node_id: "n2", floor: "G", x_coordinate: 60, y_coordinate: 50 },
  { node_id: "n3", floor: "L1", x_coordinate: 80, y_coordinate: 40 },
];

describe("coordinate mapping", () => {
  it("maps 0..100 percentages into the floor-unit plane", () => {
    expect(percentToUnits(0, FLOOR_WIDTH)).toBe(0);
    expect(percentToUnits(100, FLOOR_WIDTH)).toBe(FLOOR_WIDTH);
    expect(percentToUnits(50, FLOOR_HEIGHT)).toBe(FLOOR_HEIGHT / 2);
    expect(percentToUnits(null, FLOOR_WIDTH)).toBe(FLOOR_WIDTH / 2); // null → centre
  });

  it("normalizes floor labels consistently", () => {
    expect(normalizeFloorLabel("G")).toBe("Ground Floor");
    expect(normalizeFloorLabel("l2")).toBe("Level 2");
    expect(normalizeFloorLabel("Level 1")).toBe("Level 1");
  });
});

describe("buildRoutePolyline — route nodes → floorplan geometry", () => {
  it("converts route steps into floor-unit polyline points", () => {
    const poly = buildRoutePolyline(STEPS);
    expect(poly).toHaveLength(3);
    expect(poly[0]).toMatchObject({ floor: "Ground Floor", x: 100, y: FLOOR_HEIGHT / 2, nodeId: "n1", stepIndex: 0 });
    expect(poly[2]).toMatchObject({ floor: "Level 1", x: 800, stepIndex: 2 });
  });

  it("filters polyline points by floor", () => {
    const poly = buildRoutePolyline(STEPS);
    expect(pointsForFloor(poly, "G").map((p) => p.nodeId)).toEqual(["n1", "n2"]);
    expect(pointsForFloor(poly, "Level 1").map((p) => p.nodeId)).toEqual(["n3"]);
    expect(routeFloors(poly)).toEqual(["Ground Floor", "Level 1"]);
  });
});

describe("marker interpolates along the polyline geometry", () => {
  it("moves to the linear midpoint of a segment, in floor-unit space", () => {
    const poly = buildRoutePolyline(STEPS);
    const nodes = polylineToWalkNodes(poly); // {x,y,floor} in units
    const seg = 1000;
    const start = computeRouteWalk(nodes, 0, seg);
    expect(start.point).toEqual({ x: 100, y: FLOOR_HEIGHT / 2 });
    const mid = computeRouteWalk(nodes, seg / 2, seg); // halfway node0→node1 (both Ground)
    expect(mid.point.x).toBeCloseTo((100 + 600) / 2); // 350
    expect(mid.point.y).toBeCloseTo(FLOOR_HEIGHT / 2);
    const end = computeRouteWalk(nodes, seg * 99, seg);
    expect(end.done).toBe(true);
    expect(end.point).toEqual({ x: 800, y: percentToUnits(40, FLOOR_HEIGHT) });
  });
});

describe("toFloorplanModel — backend graph → floor-unit model", () => {
  const backend: BackendIndoorModelLike = {
    nodes: [
      { id: "e1", name: "Main Entrance", type: "entrance", floor: "G", x_coordinate: 5, y_coordinate: 50 },
      { id: "s1", name: "Game", type: "shop", floor: "G", x_coordinate: 80, y_coordinate: 30, linked_shop_id: "shop-game" },
      { id: "j1", name: "Junction Node 3", type: "junction", floor: "G", x_coordinate: 40, y_coordinate: 50 },
    ],
    edges: [{ id: "ed1", from_node_id: "e1", to_node_id: "s1", floor_change: false, distance_meters: 40 }],
    floorplan: null,
  };

  it("builds a Ground Floor with mapped nodes, edges and store anchors", () => {
    const model = toFloorplanModel(backend, { mallId: "m", mallName: "Mall@Reds" });
    expect(model.floors).toHaveLength(1);
    const g = model.floors[0];
    expect(g.label).toBe("Ground Floor");
    expect(g.width).toBe(FLOOR_WIDTH);
    expect(g.nodes.find((n) => n.id === "e1")?.type).toBe("entrance");
    expect(g.nodes.find((n) => n.id === "e1")?.position).toEqual({ x: 50, y: FLOOR_HEIGHT / 2 });
    expect(g.edges).toHaveLength(1);
    // Store anchor derived from the shop node; infra "Junction Node" is not a store.
    expect(g.stores.map((s) => s.shopId)).toEqual(["shop-game"]);
    expect(g.imageUrl).toBeUndefined(); // no floorplan svg → schematic
  });

  it("attaches the floorplan image only when the svg matches the floor", () => {
    const model = toFloorplanModel(
      { ...backend, floorplan: { floor_label: "G", svg_output: "<svg><rect/></svg>" } },
      { mallId: "m", mallName: "Mall@Reds" },
    );
    expect(model.floors[0].imageUrl).toMatch(/^data:image\/svg\+xml/);
  });
});

describe("schematicModelFromRoute — fallback when no backend model", () => {
  it("generates floors/nodes/edges from the route itself, with no floorplan image", () => {
    const model = schematicModelFromRoute(STEPS, { mallId: "m", mallName: "Mall" });
    expect(routeFloors(buildRoutePolyline(STEPS))).toEqual(model.floors.map((f) => f.label));
    const g = model.floors.find((f) => f.label === "Ground Floor")!;
    expect(g.imageUrl).toBeUndefined();          // → renders honest schematic
    expect(g.nodes.map((n) => n.id)).toEqual(["n1", "n2"]);
    expect(g.edges).toHaveLength(1);             // n1→n2 corridor
    expect(g.stores).toEqual([]);
  });
});

describe("demo floorplan model", () => {
  it("is a real single-floor model with an entrance, corridors and a Game anchor", () => {
    const g = MALL_REDS_GAME_FLOORPLAN.floors[0];
    expect(MALL_REDS_GAME_FLOORPLAN.mallName).toBe("Mall@Reds");
    expect(g.nodes.some((n) => n.type === "entrance")).toBe(true);
    expect(g.stores.some((s) => s.shopId === "game")).toBe(true);
    expect(g.imageUrl).toBeUndefined(); // demo is always schematic
    const poly = buildDemoRoutePolyline();
    expect(poly.length).toBeGreaterThanOrEqual(4);
    expect(poly[0].nodeId).toBe("entrance");
    expect(poly[poly.length - 1].nodeId).toBe("game");
    // Geometry stays inside the coordinate plane.
    const b = pointsBounds(poly)!;
    expect(b.minX).toBeGreaterThanOrEqual(0);
    expect(b.maxX).toBeLessThanOrEqual(FLOOR_WIDTH);
  });
});
