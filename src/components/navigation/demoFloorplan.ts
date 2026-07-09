/**
 * demoFloorplan.ts — a small but real deterministic floorplan model.
 *
 * Mall@Reds, Ground floor: a main entrance, a run of corridor nodes along the
 * concourse, a Game store anchor (the canonical MallMind demo destination) plus
 * a few neighbouring stores, edges between them, and a visible route from the
 * entrance to Game. Coordinates are in floor-unit space (see floorplanModel.ts).
 *
 * This is DEMO / SCHEMATIC data (no floorplan image), used to illustrate the
 * engine and to drive deterministic tests. It is always rendered with the honest
 * "schematic" labelling — never presented as a surveyed plan or live positioning.
 */

import {
  FLOOR_WIDTH, FLOOR_HEIGHT,
  type FloorplanModel, type RoutePolylinePoint,
} from "./floorplanModel";

const GROUND = "Ground Floor";

export const MALL_REDS_GAME_FLOORPLAN: FloorplanModel = {
  mallId: "demo-mall-reds",
  mallName: "Mall@Reds",
  floors: [
    {
      id: GROUND,
      label: GROUND,
      // No imageUrl → renders as an honest generated schematic.
      width: FLOOR_WIDTH,
      height: FLOOR_HEIGHT,
      nodes: [
        { id: "entrance", name: "Main Entrance", floor: GROUND, type: "entrance", position: { x: 90, y: 320 } },
        { id: "c1", name: "Concourse", floor: GROUND, type: "corridor", position: { x: 260, y: 320 } },
        { id: "c2", name: "Concourse", floor: GROUND, type: "corridor", position: { x: 470, y: 300 } },
        { id: "c3", name: "Concourse", floor: GROUND, type: "corridor", position: { x: 680, y: 280 } },
        { id: "game", name: "Game", floor: GROUND, type: "shop", position: { x: 860, y: 250 } },
        { id: "lift", name: "Lifts", floor: GROUND, type: "lift", position: { x: 470, y: 470 } },
      ],
      edges: [
        { from: "entrance", to: "c1", type: "corridor", distanceMeters: 24 },
        { from: "c1", to: "c2", type: "corridor", distanceMeters: 26 },
        { from: "c2", to: "c3", type: "corridor", distanceMeters: 26 },
        { from: "c3", to: "game", type: "shop-entry", distanceMeters: 22 },
        { from: "c2", to: "lift", type: "vertical", distanceMeters: 20 },
        { from: "c1", to: "woolworths", type: "shop-entry", distanceMeters: 18 },
        { from: "c3", to: "istore", type: "shop-entry", distanceMeters: 18 },
      ],
      stores: [
        { shopId: "game", name: "Game", unitCode: "G12", floor: GROUND, position: { x: 860, y: 250 }, bounds: { x: 800, y: 190, width: 150, height: 96 } },
        { shopId: "woolworths", name: "Woolworths", unitCode: "G04", floor: GROUND, position: { x: 250, y: 150 }, bounds: { x: 180, y: 96, width: 150, height: 96 } },
        { shopId: "istore", name: "iStore", unitCode: "G18", floor: GROUND, position: { x: 690, y: 130 }, bounds: { x: 630, y: 80, width: 130, height: 88 } },
        { shopId: "clicks", name: "Clicks", unitCode: "G09", floor: GROUND, position: { x: 470, y: 500 }, bounds: { x: 400, y: 452, width: 150, height: 92 } },
      ],
    },
  ],
};

/** Ordered node ids of the demo route (entrance → Game). */
export const MALL_REDS_GAME_ROUTE_NODE_IDS = ["entrance", "c1", "c2", "c3", "game"] as const;

/** The demo route as floor-unit polyline geometry (entrance → Game). */
export function buildDemoRoutePolyline(): RoutePolylinePoint[] {
  const floor = MALL_REDS_GAME_FLOORPLAN.floors[0];
  const byId = new Map(floor.nodes.map((n) => [n.id, n]));
  return MALL_REDS_GAME_ROUTE_NODE_IDS.map((id, i) => {
    const n = byId.get(id)!;
    return { floor: n.floor, x: n.position.x, y: n.position.y, nodeId: n.id, stepIndex: i };
  });
}
