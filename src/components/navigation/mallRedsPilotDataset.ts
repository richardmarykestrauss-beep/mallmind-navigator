/**
 * mallRedsPilotDataset.ts — spatial DATASET contract + ADAPTER for MallMind wayfinding pilots.
 *
 * (The file keeps its historical name; it now serves every bundled mall dataset — see
 * `mallDatasets.ts` for the registry keyed by mall id.)
 *
 *   dataset JSON  →  adapter (this file)  →  BackendNodeLike/BackendEdgeLike  →  pilotBuildRoute /
 *   toFloorplanModel  →  IndoorMapCanvas
 *
 * EVIDENCE lives in the DATA, not in the UI. Every entity carries an `evidence` level
 * (schematic | source-backed | on-site-verified); the dataset carries `dataset_status` /
 * `evidence_status`. A tenant's factual identity (`tenant.shop_number`) is recorded SEPARATELY
 * from the spatial evidence of its coordinate — a source-backed identity must never silently
 * upgrade a schematic position to "verified".
 *
 * DISTANCE TRUTH. A dataset declares `distance_unit`:
 *   • "m"  (default) — every edge carries measured `distance_meters` > 0; routes show metres/minutes.
 *   • "px"           — the source (e.g. a published floor plan with no scale bar) is UNSCALED:
 *                      every edge carries `length_px` > 0 and MUST NOT carry `distance_meters`.
 *                      Pixel length is used only as the shortest-path weight; the adapter never
 *                      converts pixels to metres, and routes over such data report
 *                      `total_distance_meters: null` / `estimated_minutes: null` so the UI has
 *                      nothing metric to display.
 */

import { FLOOR_WIDTH, FLOOR_HEIGHT, type BackendNodeLike, type BackendEdgeLike, type FloorImageMap } from "./floorplanModel";
import rawDataset from "./data/mall-reds-pilot.dataset.json";

// ── Evidence vocabulary (belongs to the DATA) ────────────────────────────────
export type SpatialEvidence = "schematic" | "source-backed" | "on-site-verified";
export type DatasetStatus = "schematic" | "source-backed" | "on-site-verified";
export type EvidenceStatus = "unverified" | "source-backed" | "on-site-verified";
/** "m" = measured metres on every edge; "px" = unscaled source, pixel lengths only. */
export type DistanceUnit = "m" | "px";

// ── Dataset shape (the JSON contract) ────────────────────────────────────────
export interface PilotTenantIdentity {
  shop_number: string | null;
  identity_evidence: "unverified" | "source-backed" | "on-site-verified";
  identity_source: string | null;
}
export interface PilotDatasetNode {
  node_id: string;
  name: string;
  type: string;
  floor: string;
  x_percent: number;
  y_percent: number;
  linked_shop_id?: string;
  evidence: SpatialEvidence;
  tenant?: PilotTenantIdentity;
  /** Free-text provenance (source URL / method); informational. */
  source?: string;
  notes?: string;
}
export interface PilotDatasetEdge {
  edge_id: string;
  from: string;
  to: string;
  /** Required (> 0) when distance_unit is "m"; must be absent/null when "px". */
  distance_meters?: number | null;
  /** Required (> 0) when distance_unit is "px"; pixels on the traced source image. */
  length_px?: number | null;
  floor_change: boolean;
  evidence: SpatialEvidence;
  /** Optional topological instruction shown verbatim for this leg (no distance words). */
  instruction?: string | null;
  source?: string;
  notes?: string;
}
/**
 * The ONE addition a real traced route needs that the schematic pilot did not:
 * a reference to the floor plan the coordinates were measured on. Every node's
 * x_percent / y_percent is then a position ON THIS IMAGE. The image must be
 * prepared at the MallMind plane aspect (1000:620, e.g. 2000×1240 px) so the
 * existing renderer draws it 1:1 under the graph with no code change; the
 * validator enforces the aspect within PLAN_IMAGE_ASPECT_TOLERANCE.
 */
export interface PilotDatasetPlanImage {
  /** Absolute or app-relative URL (or data: URI) of the prepared plan raster/SVG. */
  url: string;
  width_px: number;
  height_px: number;
  /** How trustworthy the plan is as geometry (same vocabulary as nodes/edges). */
  evidence: SpatialEvidence;
  /** Where it came from (e.g. "Mall management leasing plan, 2026-09"). */
  source: string | null;
  /** Written permission / licence reference for displaying it. null = not yet confirmed. */
  licence: string | null;
}
export interface PilotDatasetFloor {
  id: string;
  label: string;
  plan_image?: PilotDatasetPlanImage | null;
}
export interface PilotSpatialDataset {
  asset_id: string;
  dataset_version: string;
  dataset_status: DatasetStatus;
  evidence_status: EvidenceStatus;
  reality_label: string;
  source_policy: string;
  mall_id: string;
  mall_name: string;
  coordinate_system: string;
  viewBox: string;
  evidence_levels: SpatialEvidence[];
  /** Defaults to "m". See DISTANCE TRUTH above. */
  distance_unit?: DistanceUnit;
  /** Has anyone walked this on site? Kept explicit so "source-backed" never reads as "verified". */
  field_verified?: boolean;
  notes?: string;
  floors: PilotDatasetFloor[];
  nodes: PilotDatasetNode[];
  edges: PilotDatasetEdge[];
}

/** The loaded, validated result: the raw dataset plus the derived graph the pilot consumes. */
export interface LoadedPilotDataset {
  dataset: PilotSpatialDataset;
  mallId: string;
  mallName: string;
  datasetStatus: DatasetStatus;
  evidenceStatus: EvidenceStatus;
  distanceUnit: DistanceUnit;
  /** true only when every edge carries measured metres — the sole gate for showing metres/minutes. */
  metric: boolean;
  fieldVerified: boolean;
  nodes: BackendNodeLike[];
  edges: BackendEdgeLike[];
  /** Floor label → plan image URL, for floors that declare a `plan_image`. */
  floorImages: FloorImageMap;
}

/** Allowed deviation of a plan image's aspect ratio from the MallMind plane (1000:620). */
export const PLAN_IMAGE_ASPECT_TOLERANCE = 0.02;

export function datasetDistanceUnit(dataset: Pick<PilotSpatialDataset, "distance_unit">): DistanceUnit {
  return dataset.distance_unit ?? "m";
}

function validatePlanImage(floor: PilotDatasetFloor, levels: SpatialEvidence[]): void {
  const img = floor.plan_image;
  if (img == null) return;
  const where = `pilot dataset: floor "${floor.id}" plan_image`;
  if (typeof img.url !== "string" || !img.url.trim()) throw new Error(`${where} url must be a non-empty string`);
  for (const [k, v] of [["width_px", img.width_px], ["height_px", img.height_px]] as const) {
    if (!Number.isInteger(v) || (v as number) <= 0) throw new Error(`${where} ${k} must be a positive integer (got ${v})`);
  }
  const expected = FLOOR_WIDTH / FLOOR_HEIGHT;
  const actual = img.width_px / img.height_px;
  if (Math.abs(actual - expected) / expected > PLAN_IMAGE_ASPECT_TOLERANCE) {
    throw new Error(
      `${where} must be prepared at the ${FLOOR_WIDTH}:${FLOOR_HEIGHT} plane aspect (${expected.toFixed(3)}); ` +
      `got ${img.width_px}×${img.height_px} (${actual.toFixed(3)}). Crop/pad the plan before tracing.`,
    );
  }
  if (!levels.includes(img.evidence)) throw new Error(`${where} has unknown evidence "${img.evidence}"`);
}

function isPositiveNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v > 0;
}

/**
 * Validate a spatial dataset (any dataset in this shape, not just the bundled one) and throw an
 * explicit error on the first structural problem. Deterministic and side-effect free.
 */
export function validatePilotDataset(dataset: PilotSpatialDataset): void {
  if (!dataset || !Array.isArray(dataset.nodes) || !Array.isArray(dataset.edges)) {
    throw new Error("pilot dataset: missing nodes/edges arrays");
  }
  if (!Array.isArray(dataset.floors) || dataset.floors.length === 0) {
    throw new Error("pilot dataset: floors must be a non-empty array");
  }
  const unit = dataset.distance_unit ?? "m";
  if (unit !== "m" && unit !== "px") {
    throw new Error(`pilot dataset: distance_unit must be "m" or "px" (got ${JSON.stringify(unit)})`);
  }
  const floorIds = new Set<string>();
  for (const f of dataset.floors) {
    if (!f.id || !f.label) throw new Error(`pilot dataset: floor missing id/label (${JSON.stringify(f)})`);
    if (floorIds.has(f.id)) throw new Error(`pilot dataset: duplicate floor id "${f.id}"`);
    floorIds.add(f.id);
    validatePlanImage(f, dataset.evidence_levels);
  }
  const ids = new Set<string>();
  for (const n of dataset.nodes) {
    if (!n.node_id) throw new Error(`pilot dataset: node missing node_id (${JSON.stringify(n)})`);
    if (ids.has(n.node_id)) throw new Error(`pilot dataset: duplicate node_id "${n.node_id}"`);
    ids.add(n.node_id);
    for (const [axis, v] of [["x_percent", n.x_percent], ["y_percent", n.y_percent]] as const) {
      if (typeof v !== "number" || Number.isNaN(v) || v < 0 || v > 100) {
        throw new Error(`pilot dataset: node "${n.node_id}" ${axis} must be 0..100 (got ${v})`);
      }
    }
    if (!dataset.evidence_levels.includes(n.evidence)) {
      throw new Error(`pilot dataset: node "${n.node_id}" has unknown evidence "${n.evidence}"`);
    }
    if (!floorIds.has(n.floor)) {
      throw new Error(`pilot dataset: node "${n.node_id}" references unknown floor "${n.floor}"`);
    }
  }
  for (const e of dataset.edges) {
    if (!ids.has(e.from)) throw new Error(`pilot dataset: edge "${e.edge_id}" references unknown from-node "${e.from}"`);
    if (!ids.has(e.to)) throw new Error(`pilot dataset: edge "${e.edge_id}" references unknown to-node "${e.to}"`);
    if (!dataset.evidence_levels.includes(e.evidence)) {
      throw new Error(`pilot dataset: edge "${e.edge_id}" has unknown evidence "${e.evidence}"`);
    }
    if (unit === "m") {
      if (!isPositiveNumber(e.distance_meters)) {
        throw new Error(`pilot dataset: edge "${e.edge_id}" distance_meters must be > 0 (got ${e.distance_meters})`);
      }
    } else {
      if (!isPositiveNumber(e.length_px)) {
        throw new Error(`pilot dataset: edge "${e.edge_id}" length_px must be > 0 for a "px" dataset (got ${e.length_px})`);
      }
      if (e.distance_meters != null) {
        throw new Error(
          `pilot dataset: edge "${e.edge_id}" carries distance_meters in a "px" dataset — an unscaled source cannot claim metres`,
        );
      }
    }
    if (e.instruction != null && (typeof e.instruction !== "string" || !e.instruction.trim())) {
      throw new Error(`pilot dataset: edge "${e.edge_id}" instruction must be a non-empty string when present`);
    }
  }
}

/** Map a dataset node onto the backend graph node shape the routing/rendering already consume. */
function toBackendNode(n: PilotDatasetNode): BackendNodeLike {
  return {
    id: n.node_id,
    name: n.name,
    type: n.type,
    floor: n.floor,
    x_coordinate: n.x_percent,
    y_coordinate: n.y_percent,
    linked_shop_id: n.linked_shop_id ?? null,
  };
}

/**
 * Map a dataset edge onto the backend graph edge shape (undirected). `weight` is the shortest-path
 * weight in the dataset's own unit; `distance_meters` is set ONLY for metric datasets. Pixels are
 * never turned into metres here or anywhere else.
 */
function toBackendEdge(e: PilotDatasetEdge, unit: DistanceUnit): BackendEdgeLike {
  const metres = unit === "m" ? (e.distance_meters as number) : null;
  return {
    id: e.edge_id,
    from_node_id: e.from,
    to_node_id: e.to,
    distance_meters: metres,
    weight: unit === "m" ? metres : (e.length_px as number),
    floor_change: e.floor_change,
    instruction: e.instruction ?? null,
  };
}

/**
 * Load + validate a spatial dataset and derive the graph. This is the single seam between
 * "spatial data" and "the pilot": swap the JSON (or point this at another dataset in the same
 * shape) and the rest of the pilot is unchanged. Defaults to the bundled Mall@Reds pilot.
 */
export function loadPilotSpatialDataset(source: PilotSpatialDataset = rawDataset as PilotSpatialDataset): LoadedPilotDataset {
  validatePilotDataset(source);
  const unit = datasetDistanceUnit(source);
  const floorImages: FloorImageMap = {};
  for (const f of source.floors) {
    if (f.plan_image?.url) floorImages[f.id] = f.plan_image.url;
  }
  return {
    dataset: source,
    mallId: source.mall_id,
    mallName: source.mall_name,
    datasetStatus: source.dataset_status,
    evidenceStatus: source.evidence_status,
    distanceUnit: unit,
    metric: unit === "m",
    fieldVerified: source.field_verified === true,
    nodes: source.nodes.map(toBackendNode),
    edges: source.edges.map((e) => toBackendEdge(e, unit)),
    floorImages,
  };
}
