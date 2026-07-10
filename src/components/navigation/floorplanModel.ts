/**
 * floorplanModel.ts — MallMind indoor-positioning coordinate model.
 *
 * This is the foundation of the MallMind indoor map engine: every mall floor is
 * treated as a 2D coordinate plane (floor-unit space, 0..FLOOR_WIDTH ×
 * 0..FLOOR_HEIGHT). Nodes, edges, store anchors, entrances and landmarks all
 * carry x/y positions in that plane, and a route is a polyline of {floor,x,y}
 * points that the simulated marker travels along.
 *
 * PRODUCT TRUTH: this is a *simulated route preview* over a floorplan coordinate
 * model — NOT live GPS or real indoor positioning. Future positioning may use QR
 * check-ins, kiosk start points, BLE/Wi-Fi anchors or partner APIs; for now the
 * coordinate + rendering system is entirely our own.
 *
 * The normalizer converts the existing backend indoor-map model (mall_nodes /
 * mall_edges, whose coordinates are 0..100 percentages) into this floor-unit
 * model, so the renderer and the marker simulation share one coordinate space.
 * Pure and side-effect free → deterministically testable.
 */

// ── Coordinate plane ────────────────────────────────────────────────────────
export const FLOOR_WIDTH = 1000;
export const FLOOR_HEIGHT = 620;

// ── Model types (public shape) ──────────────────────────────────────────────
export interface FloorplanCoordinate {
  x: number;
  y: number;
}

export type FloorplanNodeType =
  | "entrance" | "corridor" | "shop" | "lift" | "escalator" | "stairs" | "landmark";

export interface FloorplanNode {
  id: string;
  name: string;
  floor: string;
  position: FloorplanCoordinate;
  type?: FloorplanNodeType;
}

export type FloorplanEdgeType = "corridor" | "vertical" | "entrance" | "shop-entry";

export interface FloorplanEdge {
  from: string;
  to: string;
  distanceMeters?: number;
  type?: FloorplanEdgeType;
}

export interface FloorplanStoreAnchor {
  shopId: string;
  name: string;
  unitCode?: string;
  floor: string;
  position: FloorplanCoordinate;
  bounds?: { x: number; y: number; width: number; height: number };
}

export interface FloorplanFloor {
  id: string;
  label: string;
  imageUrl?: string;
  width: number;
  height: number;
  nodes: FloorplanNode[];
  edges: FloorplanEdge[];
  stores: FloorplanStoreAnchor[];
}

export interface FloorplanModel {
  mallId: string;
  mallName: string;
  floors: FloorplanFloor[];
}

/** A single point of the derived route geometry, in floor-unit space. */
export interface RoutePolylinePoint {
  floor: string;
  x: number;
  y: number;
  nodeId?: string;
  stepIndex: number;
}

// ── Floor-label normalization (shared with the canvas) ──────────────────────
export function normalizeFloorLabel(value: string | null | undefined): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "Ground Floor";
  if (/^g$/i.test(raw) || /^ground(\s+floor)?$/i.test(raw)) return "Ground Floor";
  if (/^b(\d+)$/i.test(raw)) return raw.toUpperCase();
  const level = raw.match(/^l(?:evel)?\s*(\d+)$/i);
  if (level) return `Level ${level[1]}`;
  return raw;
}

/** Short floor chip: "Ground Floor" → "G", "Level 2" → "L2". */
export function floorChip(label: string): string {
  return normalizeFloorLabel(label).replace("Ground Floor", "G").replace("Level ", "L");
}

function num(v: number | null | undefined, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

/** Map a 0..100 percentage coordinate into floor-unit space (clamped). */
export function percentToUnits(pct: number | null | undefined, span: number): number {
  const p = Math.max(0, Math.min(100, num(pct, 50)));
  return Math.round((p / 100) * span * 10) / 10;
}

function sanitizeSvg(raw: string): string {
  return raw
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, "")
    .replace(/\son\w+\s*=\s*'[^']*'/gi, "");
}

function mapNodeType(raw: string | null | undefined): FloorplanNodeType {
  const t = String(raw ?? "").toLowerCase();
  if (t.includes("entrance")) return "entrance";
  if (t.includes("shop") || t.includes("store")) return "shop";
  if (t.includes("lift") || t.includes("elevator")) return "lift";
  if (t.includes("escalator")) return "escalator";
  if (t.includes("stair")) return "stairs";
  if (t.includes("landmark") || t.includes("anchor")) return "landmark";
  return "corridor";
}

function isInfraName(name: string): boolean {
  return /spine\s*node|corridor\s*node|junction\s*node|route\s*node|\bnode\s+\d+\b/i.test(name);
}

// ── Backend model shape (decoupled input for the normalizer) ────────────────
export interface BackendNodeLike {
  id: string;
  name: string;
  type: string;
  floor: string | null;
  x_coordinate: number | null;
  y_coordinate: number | null;
  linked_shop_id?: string | null;
}
export interface BackendEdgeLike {
  id: string;
  from_node_id: string;
  to_node_id: string;
  floor_change?: boolean | null;
  distance_meters?: number | null;
}
export interface BackendFloorplanLike {
  floor_label: string | null;
  svg_output: string | null;
}
export interface BackendIndoorModelLike {
  nodes: BackendNodeLike[];
  edges: BackendEdgeLike[];
  floorplan?: BackendFloorplanLike | null;
}

/**
 * Convert the backend indoor-map model (mall_nodes / mall_edges, 0..100 coords)
 * into a floor-unit FloorplanModel. Groups nodes by floor, maps percentages into
 * the coordinate plane, derives store anchors from shop nodes, and attaches the
 * generated floorplan SVG as the floor image when it matches.
 */
export function toFloorplanModel(
  model: BackendIndoorModelLike,
  meta: { mallId: string; mallName: string },
): FloorplanModel {
  const nodes = model.nodes ?? [];
  const edges = model.edges ?? [];

  const floorLabels = [...new Set(nodes.map((n) => normalizeFloorLabel(n.floor)))];
  if (floorLabels.length === 0) floorLabels.push("Ground Floor");

  const floorplanUri = (label: string): string | undefined => {
    const fp = model.floorplan;
    if (!fp?.svg_output) return undefined;
    if (fp.floor_label != null && normalizeFloorLabel(fp.floor_label) !== label) return undefined;
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(sanitizeSvg(fp.svg_output))}`;
  };

  const floors: FloorplanFloor[] = floorLabels.map((label) => {
    const floorNodes = nodes.filter((n) => normalizeFloorLabel(n.floor) === label);
    const floorNodeIds = new Set(floorNodes.map((n) => n.id));

    const fpNodes: FloorplanNode[] = floorNodes.map((n) => ({
      id: n.id,
      name: n.name,
      floor: label,
      type: mapNodeType(n.type),
      position: { x: percentToUnits(n.x_coordinate, FLOOR_WIDTH), y: percentToUnits(n.y_coordinate, FLOOR_HEIGHT) },
    }));

    const fpEdges: FloorplanEdge[] = edges
      .filter((e) => !e.floor_change && floorNodeIds.has(e.from_node_id) && floorNodeIds.has(e.to_node_id))
      .map((e) => ({ from: e.from_node_id, to: e.to_node_id, distanceMeters: e.distance_meters ?? undefined, type: "corridor" }));

    const stores: FloorplanStoreAnchor[] = floorNodes
      .filter((n) => mapNodeType(n.type) === "shop" && !isInfraName(n.name))
      .map((n) => ({
        shopId: n.linked_shop_id ?? n.id,
        name: n.name,
        floor: label,
        position: { x: percentToUnits(n.x_coordinate, FLOOR_WIDTH), y: percentToUnits(n.y_coordinate, FLOOR_HEIGHT) },
      }));

    return { id: label, label, imageUrl: floorplanUri(label), width: FLOOR_WIDTH, height: FLOOR_HEIGHT, nodes: fpNodes, edges: fpEdges, stores };
  });

  return { mallId: meta.mallId, mallName: meta.mallName, floors };
}

// ── Route geometry ──────────────────────────────────────────────────────────
export interface RouteStepLike {
  node_id: string;
  floor: string | null;
  x_coordinate?: number | null;
  y_coordinate?: number | null;
  node_name?: string | null;
}

// ── Layout resilience ───────────────────────────────────────────────────────
// The backend seed derives coordinates from unit numbers (X) and FLOOR ORDER (Y),
// so on a single floor every node shares the same Y and clusters by unit number —
// which collapses into a thin strip and renders as an empty box. When we detect
// that, we synthesize a clean, spread-out layout so the engine always produces a
// readable indoor map (still an honest schematic — our own generated geometry).

const LAYOUT_MARGIN = 110;

/** Deterministic serpentine spread of `n` points across the floor plane. */
export function serpentinePositions(n: number, w = FLOOR_WIDTH, h = FLOOR_HEIGHT): FloorplanCoordinate[] {
  if (n <= 0) return [];
  if (n === 1) return [{ x: Math.round(w * 0.5), y: Math.round(h * 0.5) }];
  const usableW = w - 2 * LAYOUT_MARGIN;
  const midY = h / 2;
  const amp = Math.min(h * 0.22, 150);
  return Array.from({ length: n }, (_, i) => {
    const t = i / (n - 1);
    return { x: Math.round(LAYOUT_MARGIN + t * usableW), y: Math.round(midY + Math.sin(t * Math.PI * 1.5) * amp) };
  });
}

/** True when points are too clustered/flat in either axis to render a real map. */
export function isDegenerateSpread(points: { x: number; y: number }[], w = FLOOR_WIDTH, h = FLOOR_HEIGHT): boolean {
  if (points.length < 2) return true;
  const b = pointsBounds(points);
  if (!b) return true;
  return (b.maxX - b.minX) < w * 0.12 || (b.maxY - b.minY) < h * 0.1;
}

/**
 * Route polyline with SYNTHESIZED spread geometry — each floor's steps are laid
 * out along a serpentine across the plane (original stepIndex preserved for
 * progress sync). Used when the backend coordinates are degenerate.
 */
export function buildSchematicRoutePolyline(steps: RouteStepLike[]): RoutePolylinePoint[] {
  const byFloor = new Map<string, number[]>();
  steps.forEach((s, i) => {
    const f = normalizeFloorLabel(s.floor);
    if (!byFloor.has(f)) byFloor.set(f, []);
    byFloor.get(f)!.push(i);
  });
  const out: RoutePolylinePoint[] = new Array(steps.length);
  for (const [floor, idxs] of byFloor) {
    const pos = serpentinePositions(idxs.length);
    idxs.forEach((stepIdx, k) => {
      out[stepIdx] = { floor, x: pos[k].x, y: pos[k].y, nodeId: steps[stepIdx].node_id, stepIndex: stepIdx };
    });
  }
  return out;
}

/**
 * Derive the route polyline (floor-unit geometry) from ordered route steps. The
 * simulated marker travels along THIS polyline, so its motion follows the real
 * floorplan geometry rather than arbitrary progress.
 */
export function buildRoutePolyline(steps: RouteStepLike[]): RoutePolylinePoint[] {
  return steps.map((s, i) => ({
    floor: normalizeFloorLabel(s.floor),
    x: percentToUnits(s.x_coordinate, FLOOR_WIDTH),
    y: percentToUnits(s.y_coordinate, FLOOR_HEIGHT),
    nodeId: s.node_id,
    stepIndex: i,
  }));
}

/** Points of a polyline that belong to a given floor (label-normalized). */
export function pointsForFloor(points: RoutePolylinePoint[], floor: string): RoutePolylinePoint[] {
  const target = normalizeFloorLabel(floor);
  return points.filter((p) => normalizeFloorLabel(p.floor) === target);
}

/** Distinct floors a route visits, in first-seen order. */
export function routeFloors(points: RoutePolylinePoint[]): string[] {
  const seen: string[] = [];
  for (const p of points) {
    const f = normalizeFloorLabel(p.floor);
    if (!seen.includes(f)) seen.push(f);
  }
  return seen;
}

/** Shape the polyline for the marker simulation (computeRouteWalk input). */
export function polylineToWalkNodes(points: RoutePolylinePoint[]): { x: number; y: number; floor: string }[] {
  return points.map((p) => ({ x: p.x, y: p.y, floor: p.floor }));
}

/** A store to scatter into the schematic for context (name + id only). */
export interface ScatterStore {
  shopId: string;
  name: string;
}

/** Place context stores in top/bottom rows, clear of the central route band. */
function scatterStores(stores: ScatterStore[], floor: string, w = FLOOR_WIDTH, h = FLOOR_HEIGHT): FloorplanStoreAnchor[] {
  const capped = stores.slice(0, 6);
  const rows = [Math.round(h * 0.12), Math.round(h * 0.88)];
  const perRow = Math.max(1, Math.ceil(capped.length / 2));
  const usableW = w - 2 * LAYOUT_MARGIN;
  return capped.map((st, i) => {
    const row = Math.floor(i / perRow);
    const col = i % perRow;
    const x = LAYOUT_MARGIN + (perRow <= 1 ? 0.5 : col / (perRow - 1)) * usableW;
    return { shopId: st.shopId, name: st.name, floor, position: { x: Math.round(x), y: rows[row] ?? rows[0] } };
  });
}

/**
 * Build a schematic FloorplanModel from route steps with SYNTHESIZED spread
 * geometry (serpentine layout), used when there is no backend model OR the
 * backend coordinates are degenerate (all clustered/flat). The route becomes a
 * readable corridor across the plane with a named destination; optional context
 * stores are scattered around it. Honestly labelled "Schematic floorplan
 * generated from MallMind route graph".
 */
export function schematicModelFromRoute(
  steps: RouteStepLike[],
  meta: { mallId: string; mallName: string },
  extraStores: ScatterStore[] = [],
): FloorplanModel {
  const labels: string[] = [];
  for (const s of steps) {
    const f = normalizeFloorLabel(s.floor);
    if (!labels.includes(f)) labels.push(f);
  }
  if (labels.length === 0) labels.push("Ground Floor");

  const routeNodeIds = new Set(steps.map((s) => s.node_id));

  const floors: FloorplanFloor[] = labels.map((label, floorIdx) => {
    const onFloor = steps.filter((s) => normalizeFloorLabel(s.floor) === label);
    const pos = serpentinePositions(onFloor.length);

    const nodes: FloorplanNode[] = onFloor.map((s, k) => ({
      id: s.node_id,
      name: s.node_name ?? s.node_id,
      floor: label,
      type: k === 0 ? "entrance" : k === onFloor.length - 1 ? "shop" : "corridor",
      position: pos[k],
    }));

    const edges: FloorplanEdge[] = [];
    for (let k = 0; k < onFloor.length - 1; k++) {
      edges.push({ from: onFloor[k].node_id, to: onFloor[k + 1].node_id, type: "corridor" });
    }

    // Destination store anchor (the final step on the primary floor).
    const stores: FloorplanStoreAnchor[] = [];
    const last = onFloor[onFloor.length - 1];
    if (last && pos.length > 0) {
      stores.push({ shopId: last.node_id, name: last.node_name ?? "Destination", floor: label, position: pos[pos.length - 1] });
    }
    // Scatter context stores (that aren't route nodes) on the primary floor only.
    if (floorIdx === 0) {
      const contextual = extraStores.filter((st) => !routeNodeIds.has(st.shopId) && st.shopId !== last?.node_id);
      stores.push(...scatterStores(contextual, label));
    }

    return { id: label, label, width: FLOOR_WIDTH, height: FLOOR_HEIGHT, nodes, edges, stores };
  });

  return { mallId: meta.mallId, mallName: meta.mallName, floors };
}

/** Bounding box of a set of points (for the GPS-style camera). */
export function pointsBounds(points: { x: number; y: number }[]): { minX: number; minY: number; maxX: number; maxY: number } | null {
  if (points.length === 0) return null;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}
