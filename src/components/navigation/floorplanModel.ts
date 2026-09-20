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
 * The normalizer converts a Venue Pack graph (0..100 percent coordinates) into
 * this floor-unit model, so the renderer and the route geometry share one
 * coordinate space. Pure and side-effect free → deterministically testable.
 *
 * NO SPATIAL INFERENCE: floors are keyed by the id the data declares (a blank
 * floor is bucketed as "not recorded", never as a ground floor), node types come
 * only from explicit kinds, and store anchors only from explicit shop links.
 * Nothing about a node's NAME ever becomes physical truth.
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
  | "entrance" | "corridor" | "shop" | "lift" | "escalator" | "stairs" | "landmark" | "amenity" | "vertical";

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

// ── Floor keys (shared with the canvas) ─────────────────────────────────────
/**
 * Bucketing key for a floor: the floor id EXACTLY as the data declares it (trimmed). There is no
 * inference — "G" is not turned into "Ground Floor", "L1" is not "Level 1", and a blank floor is
 * bucketed under UNRECORDED_FLOOR (label "Floor not recorded"), never under a ground floor the
 * data did not declare. Display labels come from the pack's floors (see `toFloorplanModel`).
 */
export const UNRECORDED_FLOOR = "floor-not-recorded";
export const UNRECORDED_FLOOR_LABEL = "Floor not recorded";
export function floorKey(value: string | null | undefined): string {
  const raw = String(value ?? "").trim();
  return raw || UNRECORDED_FLOOR;
}

/** Short floor chip: the declared floor label/id verbatim (no mapping); the unrecorded bucket reads "?". */
export function floorChip(label: string): string {
  const k = floorKey(label);
  return k === UNRECORDED_FLOOR ? "?" : k;
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

/**
 * Node type from an EXPLICIT kind/type value only (Venue Pack `kind`, or the exact legacy `type`
 * words). No substring matching, no name heuristics: an unknown value yields no type.
 */
const NODE_TYPE_BY_KIND: Readonly<Record<string, FloorplanNodeType>> = {
  entrance: "entrance",
  corridor: "corridor",
  junction: "corridor",
  arrival: "shop",
  shop: "shop",
  store: "shop",
  amenity: "amenity",
  landmark: "landmark",
  lift: "lift",
  escalator: "escalator",
  stairs: "stairs",
  vertical: "vertical",
};
export function nodeTypeFor(kind: string | null | undefined, type?: string | null): FloorplanNodeType | undefined {
  const k = String(kind ?? "").trim().toLowerCase();
  if (k && NODE_TYPE_BY_KIND[k]) return NODE_TYPE_BY_KIND[k];
  const t = String(type ?? "").trim().toLowerCase();
  return t ? NODE_TYPE_BY_KIND[t] : undefined;
}

// ── Graph input shape (decoupled input for the normalizer; Venue Pack loader output) ──
export interface BackendNodeLike {
  id: string;
  name: string;
  type: string;
  floor: string | null;
  x_coordinate: number | null;
  y_coordinate: number | null;
  linked_shop_id?: string | null;
  /**
   * Spatial evidence for this node's position ("schematic" | "source-backed" | "field-verified").
   * Absent for hosted backend nodes → treated as NOT verified (never overstated).
   */
  evidence?: string | null;
  /** Venue Pack node kind (entrance | corridor | junction | arrival | amenity | landmark | vertical). The ONLY typing input besides an exact legacy `type`. */
  kind?: string | null;
  /** Arrival evidence of the destination this node serves (Venue Packs): "corridor_arrival" | "verified_public_door" | "unknown". */
  arrival_evidence?: string | null;
}
export interface BackendEdgeLike {
  id: string;
  from_node_id: string;
  to_node_id: string;
  floor_change?: boolean | null;
  /** Measured metres. null/absent = NOT measured (unscaled source) — never derive it from pixels. */
  distance_meters?: number | null;
  /** Unit-agnostic graph weight for shortest-path only (metres for metric data, pixels for unscaled). */
  weight?: number | null;
  /** Directional wording for from→to ("Continue straight; Clicks is on your right."). Never reused for to→from. */
  instruction?: string | null;
  /** Directional wording for to→from. Absent = no source-backed text for that direction. */
  instruction_reverse?: string | null;
  /** false = one-way link (from→to only). Default true. */
  bidirectional?: boolean | null;
  /** lift | escalator | stairs | ramp for floor-change edges. */
  vertical_kind?: "lift" | "escalator" | "stairs" | "ramp" | null;
  /** The declared connector this vertical edge belongs to (loader-expanded or hand-written). */
  connector_id?: string | null;
  /** Measured ride/climb time of a connector edge (seconds); null = not measured. Never fabricated. */
  traversal_seconds?: number | null;
  /** Connector accessibility EVIDENCE for step-free routing (never inferred from kind). */
  step_free?: "unknown" | "field_verified_yes" | "field_verified_no" | null;
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

/** A declared floor (Venue Pack `floors[]`): the id nodes reference and the label to display. */
export interface DeclaredFloor { id: string; label: string; order?: number }

/**
 * Convert a graph (Venue Pack loader output; 0..100 coords) into a floor-unit FloorplanModel.
 * Floors are keyed by the declared floor id: when `opts.floors` is given (the pack's floors) their
 * order and labels are used; otherwise floors appear in first-seen order labelled by their key.
 * Store anchors come ONLY from nodes with an explicit `linked_shop_id`; node types ONLY from
 * explicit kinds. An optional floorplan SVG attaches only to the floor whose id it names.
 */
export function toFloorplanModel(
  model: BackendIndoorModelLike,
  meta: { mallId: string; mallName: string },
  opts: { floors?: DeclaredFloor[] } = {},
): FloorplanModel {
  const nodes = model.nodes ?? [];
  const edges = model.edges ?? [];

  const declared = new Map<string, DeclaredFloor>();
  for (const f of opts.floors ?? []) declared.set(floorKey(f.id), f);
  const keys: string[] = [...declared.keys()];
  for (const n of nodes) { const k = floorKey(n.floor); if (!keys.includes(k)) keys.push(k); }
  const labelFor = (k: string) => declared.get(k)?.label ?? (k === UNRECORDED_FLOOR ? UNRECORDED_FLOOR_LABEL : k);

  const floorplanUri = (key: string): string | undefined => {
    const fp = model.floorplan;
    if (!fp?.svg_output) return undefined;
    if (fp.floor_label == null || floorKey(fp.floor_label) !== key) return undefined;
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(sanitizeSvg(fp.svg_output))}`;
  };

  const floors: FloorplanFloor[] = keys.map((key) => {
    const floorNodes = nodes.filter((n) => floorKey(n.floor) === key);
    const floorNodeIds = new Set(floorNodes.map((n) => n.id));

    const fpNodes: FloorplanNode[] = floorNodes.map((n) => ({
      id: n.id,
      name: n.name,
      floor: key,
      type: nodeTypeFor(n.kind, n.type),
      position: { x: percentToUnits(n.x_coordinate, FLOOR_WIDTH), y: percentToUnits(n.y_coordinate, FLOOR_HEIGHT) },
    }));

    const fpEdges: FloorplanEdge[] = edges
      .filter((e) => !e.floor_change && floorNodeIds.has(e.from_node_id) && floorNodeIds.has(e.to_node_id))
      .map((e) => ({ from: e.from_node_id, to: e.to_node_id, distanceMeters: e.distance_meters ?? undefined, type: "corridor" }));

    const stores: FloorplanStoreAnchor[] = floorNodes
      .filter((n) => typeof n.linked_shop_id === "string" && n.linked_shop_id.length > 0)
      .map((n) => ({
        shopId: n.linked_shop_id as string,
        name: n.name,
        floor: key,
        position: { x: percentToUnits(n.x_coordinate, FLOOR_WIDTH), y: percentToUnits(n.y_coordinate, FLOOR_HEIGHT) },
      }));

    return { id: key, label: labelFor(key), imageUrl: floorplanUri(key), width: FLOOR_WIDTH, height: FLOOR_HEIGHT, nodes: fpNodes, edges: fpEdges, stores };
  });

  return { mallId: meta.mallId, mallName: meta.mallName, floors };
}

// ── Route geometry ──────────────────────────────────────────────────────────
export interface RouteStepLike {
  node_id: string;
  floor: string | null;
  x_coordinate?: number | null;
  y_coordinate?: number | null;
}

/**
 * Derive the route polyline (floor-unit geometry) from ordered route steps. The
 * simulated marker travels along THIS polyline, so its motion follows the real
 * floorplan geometry rather than arbitrary progress.
 */
export function buildRoutePolyline(steps: RouteStepLike[]): RoutePolylinePoint[] {
  return steps.map((s, i) => ({
    floor: floorKey(s.floor),
    x: percentToUnits(s.x_coordinate, FLOOR_WIDTH),
    y: percentToUnits(s.y_coordinate, FLOOR_HEIGHT),
    nodeId: s.node_id,
    stepIndex: i,
  }));
}

/** Per-floor plan images keyed by the declared floor id (`plan_image` in the Venue Pack). */
export type FloorImageMap = Record<string, string>;

/**
 * Attach real floor-plan raster/vector images to a FloorplanModel as the base
 * layer the canvas draws under the graph. The dataset contract requires each
 * plan image to be prepared at the MallMind plane aspect (FLOOR_WIDTH:FLOOR_HEIGHT)
 * so 0..100 percent node coordinates measured on that image land exactly on
 * it. Pure: returns a new model; floors without an image are untouched.
 */
export function attachFloorImages(model: FloorplanModel, images: FloorImageMap | null | undefined): FloorplanModel {
  if (!images || Object.keys(images).length === 0) return model;
  const byId = new Map<string, string>();
  for (const [id, url] of Object.entries(images)) {
    if (url) byId.set(floorKey(id), url);
  }
  if (byId.size === 0) return model;
  return {
    ...model,
    floors: model.floors.map((f) => {
      const url = byId.get(floorKey(f.id));
      return url ? { ...f, imageUrl: url } : f;
    }),
  };
}

/** Points of a polyline that belong to a given floor key. */
export function pointsForFloor(points: RoutePolylinePoint[], floor: string): RoutePolylinePoint[] {
  const target = floorKey(floor);
  return points.filter((p) => floorKey(p.floor) === target);
}

/** Distinct floors a route visits, in first-seen order. */
export function routeFloors(points: RoutePolylinePoint[]): string[] {
  const seen: string[] = [];
  for (const p of points) {
    const f = floorKey(p.floor);
    if (!seen.includes(f)) seen.push(f);
  }
  return seen;
}

/** Shape the polyline for the marker simulation (computeRouteWalk input). */
export function polylineToWalkNodes(points: RoutePolylinePoint[]): { x: number; y: number; floor: string }[] {
  return points.map((p) => ({ x: p.x, y: p.y, floor: p.floor }));
}

/** Bounding box of a set of points (for the GPS-style camera). */
export function pointsBounds(points: { x: number; y: number }[]): { minX: number; minY: number; maxX: number; maxY: number } | null {
  if (points.length === 0) return null;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}
