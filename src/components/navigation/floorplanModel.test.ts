import { describe, it, expect } from "vitest";
import {
  FLOOR_WIDTH, FLOOR_HEIGHT,
  buildRoutePolyline, pointsForFloor, routeFloors, polylineToWalkNodes,
  toFloorplanModel, floorKey, floorChip, nodeTypeFor, attachFloorImages, percentToUnits, pointsBounds,
  UNRECORDED_FLOOR, UNRECORDED_FLOOR_LABEL,
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

  it("REGRESSION (no floor inference): floor keys are the declared ids verbatim; blank is 'not recorded', never a ground floor", () => {
    expect(floorKey("G")).toBe("G");                 // NOT "Ground Floor"
    expect(floorKey("l2")).toBe("l2");               // NOT "Level 2"
    expect(floorKey(" LF ")).toBe("LF");
    expect(floorKey("Upper Mall")).toBe("Upper Mall");
    expect(floorKey("")).toBe(UNRECORDED_FLOOR);
    expect(floorKey(null)).toBe(UNRECORDED_FLOOR);
    expect(floorKey(undefined)).toBe(UNRECORDED_FLOOR);
    expect(floorChip("G")).toBe("G");
    expect(floorChip("Upper Mall")).toBe("Upper Mall");
    expect(floorChip("")).toBe("?");
    expect(UNRECORDED_FLOOR_LABEL).not.toMatch(/ground/i);
  });

  it("REGRESSION (no name inference): node types come only from explicit kinds", () => {
    expect(nodeTypeFor("entrance")).toBe("entrance");
    expect(nodeTypeFor("junction")).toBe("corridor");
    expect(nodeTypeFor("arrival")).toBe("shop");
    expect(nodeTypeFor("vertical")).toBe("vertical");
    expect(nodeTypeFor(null, "shop")).toBe("shop");
    expect(nodeTypeFor(undefined, "Escalator lobby")).toBeUndefined(); // substring is not a kind
    expect(nodeTypeFor("main entrance")).toBeUndefined();
    expect(nodeTypeFor("")).toBeUndefined();
  });
});

describe("buildRoutePolyline — route nodes → floorplan geometry", () => {
  it("converts route steps into floor-unit polyline points", () => {
    const poly = buildRoutePolyline(STEPS);
    expect(poly).toHaveLength(3);
    expect(poly[0]).toMatchObject({ floor: "G", x: 100, y: FLOOR_HEIGHT / 2, nodeId: "n1", stepIndex: 0 });
    expect(poly[2]).toMatchObject({ floor: "L1", x: 800, stepIndex: 2 });
  });

  it("filters polyline points by floor", () => {
    const poly = buildRoutePolyline(STEPS);
    expect(pointsForFloor(poly, "G").map((p) => p.nodeId)).toEqual(["n1", "n2"]);
    expect(pointsForFloor(poly, "L1").map((p) => p.nodeId)).toEqual(["n3"]);
    expect(pointsForFloor(poly, "Level 1")).toEqual([]);   // no alias inference
    expect(routeFloors(poly)).toEqual(["G", "L1"]);
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

describe("toFloorplanModel — pack graph → floor-unit model", () => {
  const graph: BackendIndoorModelLike = {
    nodes: [
      { id: "e1", name: "Main Entrance", type: "entrance", floor: "G", x_coordinate: 5, y_coordinate: 50 },
      { id: "s1", name: "Game", type: "shop", floor: "G", x_coordinate: 80, y_coordinate: 30, linked_shop_id: "shop-game" },
      { id: "j1", name: "Junction Node 3", type: "junction", floor: "G", x_coordinate: 40, y_coordinate: 50 },
    ],
    edges: [{ id: "ed1", from_node_id: "e1", to_node_id: "s1", floor_change: false, distance_meters: 40 }],
    floorplan: null,
  };

  it("keys the floor by its declared id, labels it from the declared floors, maps nodes/edges/stores", () => {
    const bare = toFloorplanModel(graph, { mallId: "m", mallName: "Mall@Reds" });
    expect(bare.floors).toHaveLength(1);
    expect(bare.floors[0]).toMatchObject({ id: "G", label: "G" });          // no declared floors → the key itself, never "Ground Floor"
    const model = toFloorplanModel(graph, { mallId: "m", mallName: "Mall@Reds" }, { floors: [{ id: "G", label: "Ground Floor" }] });
    const g = model.floors[0];
    expect(g).toMatchObject({ id: "G", label: "Ground Floor" });
    expect(g.width).toBe(FLOOR_WIDTH);
    expect(g.nodes.find((n) => n.id === "e1")?.type).toBe("entrance");
    expect(g.nodes.find((n) => n.id === "j1")?.type).toBe("corridor");     // explicit junction type
    expect(g.nodes.find((n) => n.id === "e1")?.position).toEqual({ x: 50, y: FLOOR_HEIGHT / 2 });
    expect(g.edges).toHaveLength(1);
    expect(g.stores.map((s) => s.shopId)).toEqual(["shop-game"]);          // explicit shop link only
    expect(g.imageUrl).toBeUndefined();
  });

  it("declared floors set the order and keep empty floors; undeclared node floors are appended verbatim", () => {
    const model = toFloorplanModel(graph, { mallId: "m", mallName: "M" }, { floors: [{ id: "L1", label: "Level 1" }, { id: "G", label: "Ground" }] });
    expect(model.floors.map((f) => f.id)).toEqual(["L1", "G"]);
    expect(model.floors[0].nodes).toEqual([]);
  });

  it("REGRESSION (no name inference): names never decide type or store-ness", () => {
    const tricky: BackendIndoorModelLike = {
      nodes: [
        { id: "a", name: "Main Entrance", type: "corridor", floor: "G", x_coordinate: 1, y_coordinate: 1 },           // named entrance, typed corridor
        { id: "b", name: "Woolworths", type: "shop", floor: "G", x_coordinate: 2, y_coordinate: 2 },                  // shop without a shop link
        { id: "c", name: "Junction Node 3", type: "shop", floor: "G", x_coordinate: 3, y_coordinate: 3, linked_shop_id: "shop-3" }, // infra-looking name WITH a link
        { id: "d", name: "Lift lobby", type: "Lift Lobby", floor: "G", x_coordinate: 4, y_coordinate: 4 },           // substring of a kind
        { id: "e", name: "Arrival", kind: "arrival", type: "junction", floor: "G", x_coordinate: 5, y_coordinate: 5 }, // pack kind wins over legacy type
      ],
      edges: [],
    };
    const g = toFloorplanModel(tricky, { mallId: "m", mallName: "M" }).floors[0];
    const type = (id: string) => g.nodes.find((n) => n.id === id)?.type;
    expect(type("a")).toBe("corridor");
    expect(type("d")).toBeUndefined();
    expect(type("e")).toBe("shop");
    expect(g.stores.map((s) => s.shopId)).toEqual(["shop-3"]);
  });

  it("REGRESSION (no invented floor): a blank floor buckets as 'not recorded', never 'Ground Floor'", () => {
    const model = toFloorplanModel({ nodes: [{ id: "x", name: "X", type: "corridor", floor: null, x_coordinate: 1, y_coordinate: 1 }], edges: [] }, { mallId: "m", mallName: "M" });
    expect(model.floors[0]).toMatchObject({ id: UNRECORDED_FLOOR, label: UNRECORDED_FLOOR_LABEL });
    expect(model.floors[0].label).not.toMatch(/ground/i);
  });

  it("attaches a floorplan svg only to the floor whose id it names exactly", () => {
    const meta = { mallId: "m", mallName: "Mall@Reds" };
    expect(toFloorplanModel({ ...graph, floorplan: { floor_label: "G", svg_output: "<svg><rect/></svg>" } }, meta).floors[0].imageUrl).toMatch(/^data:image\/svg\+xml/);
    expect(toFloorplanModel({ ...graph, floorplan: { floor_label: "Ground Floor", svg_output: "<svg><rect/></svg>" } }, meta).floors[0].imageUrl).toBeUndefined();
    expect(toFloorplanModel({ ...graph, floorplan: { floor_label: null, svg_output: "<svg><rect/></svg>" } }, meta).floors[0].imageUrl).toBeUndefined();
  });

  it("attachFloorImages keys plan images by declared floor id", () => {
    const model = toFloorplanModel(graph, { mallId: "m", mallName: "M" }, { floors: [{ id: "G", label: "Ground Floor" }] });
    expect(attachFloorImages(model, { G: "/plans/g.png" }).floors[0].imageUrl).toBe("/plans/g.png");
    expect(attachFloorImages(model, { "Ground Floor": "/plans/g.png" }).floors[0].imageUrl).toBeUndefined();
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
