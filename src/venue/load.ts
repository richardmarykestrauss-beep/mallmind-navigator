/**
 * load.ts — turn a validated Venue Pack into the indexed runtime object Core consumes.
 *
 * `LoadedVenue` is computed ONCE per pack (the registry caches it) and holds every lookup the
 * router, session, search and screens need: nodes/edges in the legacy graph shape the renderer
 * already understands, adjacency for shortest-path, destination/anchor/amenity indexes, ordered
 * floors and the derived truth flags. Nothing here re-processes the pack per render.
 */

import type {
  VenueConnector,
  VenuePack, VenueFloor, VenueDestination, VenueAnchor, VenueAmenity, VenueNode, VenueEdge, VenueEvidence, VenuePolicies,
  DistanceUnit, GeometryEvidence,
} from "./contract";
import { validateVenuePack, formatVenueIssues } from "./validate";
import type { BackendNodeLike, BackendEdgeLike, FloorImageMap } from "../components/navigation/floorplanModel";

/** Legacy node `type` the renderer keys on (entrance / shop / toilet / lift / …). */
export function legacyNodeType(node: VenueNode, destinationByNode: Map<string, VenueDestination>, amenityByNode: Map<string, VenueAmenity>): string {
  if (destinationByNode.has(node.id)) return "shop";
  const amenity = amenityByNode.get(node.id);
  if (amenity) return amenity.kind === "accessible_toilet" ? "toilet" : amenity.kind;
  switch (node.kind) {
    case "entrance": return "entrance";
    case "landmark": return "landmark";
    case "vertical": return "lift";
    default: return "corridor";
  }
}

export interface AdjacencyEntry { edge: BackendEdgeLike; to: string; forward: boolean }

export interface LoadedVenue {
  pack: VenuePack;
  id: string;
  name: string;
  shortName: string;
  evidence: VenueEvidence;
  policies: VenuePolicies;
  floors: VenueFloor[];
  floorById: Map<string, VenueFloor>;
  distanceUnit: DistanceUnit;
  /** true only when EVERY edge carries measured metres — the sole gate for metres/minutes. */
  metric: boolean;
  /** Legacy-shaped graph consumed by the router/renderer. */
  nodes: BackendNodeLike[];
  edges: BackendEdgeLike[];
  nodeById: Map<string, BackendNodeLike>;
  adjacency: Map<string, AdjacencyEntry[]>;
  destinations: VenueDestination[];
  destinationById: Map<string, VenueDestination>;
  destinationByNode: Map<string, VenueDestination>;
  anchors: VenueAnchor[];
  anchorById: Map<string, VenueAnchor>;
  /** Declared vertical connectors (already expanded into `edges`). */
  connectors: VenueConnector[];
  connectorById: Map<string, VenueConnector>;
  /** Anchors a visitor may start from (start_permitted + allowed kinds policy). */
  startAnchors: VenueAnchor[];
  amenities: VenueAmenity[];
  amenityById: Map<string, VenueAmenity>;
  amenityByNode: Map<string, VenueAmenity>;
  floorImages: FloorImageMap;
  /** Strongest and weakest node geometry evidence present (for summaries). */
  geometryRange: { weakest: GeometryEvidence; strongest: GeometryEvidence };
}

const RANK: Record<GeometryEvidence, number> = { schematic: 0, "source-backed": 1, "field-verified": 2 };

function toEdge(e: VenueEdge, unit: DistanceUnit): BackendEdgeLike {
  const measured = e.evidence.measurement === "measured" && typeof e.distance_m === "number" && e.distance_m > 0;
  return {
    id: e.id,
    from_node_id: e.from,
    to_node_id: e.to,
    distance_meters: measured ? (e.distance_m as number) : null,
    // Vertical transitions carry no horizontal length: weight null → priced by policy in the router.
    weight: e.floor_change ? null : unit === "m" ? (e.distance_m as number) : (e.length_px as number),
    floor_change: e.floor_change === true,
    instruction: e.instructions?.forward ?? null,
    instruction_reverse: e.instructions?.reverse ?? null,
    bidirectional: e.bidirectional !== false,
    vertical_kind: e.vertical_kind ?? null,
    connector_id: e.connector_id ?? null,
    traversal_seconds: null,
    step_free: e.floor_change ? "unknown" : null,
  };
}

/**
 * Expand declared connectors into routable edges — ONCE, at load. Every pair of landings becomes an
 * edge (two-way for "both"; one-way from the lower to the higher floor for "up", the reverse for
 * "down"). Closed connectors expand to nothing. The edges carry no horizontal length: `weight` is
 * null and the router prices them from policy. Deterministic: landings are ordered by floor order.
 */
export function expandConnectors(pack: VenuePack): BackendEdgeLike[] {
  const order = new Map(pack.floors.map((f) => [f.id, f.order]));
  const out: BackendEdgeLike[] = [];
  for (const k of pack.connectors ?? []) {
    if (k.availability !== "open") continue;
    const landings = [...k.landings].sort((a, b) => (order.get(a.floor) ?? 0) - (order.get(b.floor) ?? 0) || (a.node < b.node ? -1 : 1));
    for (let i = 0; i < landings.length; i++) for (let j = i + 1; j < landings.length; j++) {
      const lower = landings[i], upper = landings[j];
      const from = k.direction === "down" ? upper : lower;
      const to = k.direction === "down" ? lower : upper;
      out.push({
        id: `${k.id}__${from.node}__${to.node}`,
        from_node_id: from.node,
        to_node_id: to.node,
        distance_meters: null,
        weight: null,
        floor_change: true,
        instruction: null,
        instruction_reverse: null,
        bidirectional: k.direction === "both",
        vertical_kind: k.kind,
        connector_id: k.id,
        traversal_seconds: k.evidence.measurement === "measured" && typeof k.traversal_seconds === "number" ? k.traversal_seconds : null,
        step_free: k.accessibility?.step_free ?? "unknown",
      });
    }
  }
  return out;
}

/** Load an already-validated pack. Throws with every issue listed if it is not valid. */
export function loadVenuePack(input: unknown): LoadedVenue {
  const v = validateVenuePack(input);
  if (v.status !== "ok") throw new Error(`Venue Pack is invalid:\n${formatVenueIssues(v.errors)}`);
  const pack = v.pack;
  const unit = pack.graph.distance_unit;

  const destinationByNode = new Map(pack.destinations.map((d) => [d.arrival_node, d]));
  const amenityByNode = new Map(pack.amenities.map((a) => [a.node, a]));

  const nodes: BackendNodeLike[] = pack.graph.nodes.map((n) => {
    const dest = destinationByNode.get(n.id);
    const amenity = amenityByNode.get(n.id);
    return {
      id: n.id,
      name: dest?.name ?? amenityByNode.get(n.id)?.name ?? n.name,
      type: legacyNodeType(n, destinationByNode, amenityByNode),
      floor: n.floor,
      x_coordinate: n.x_percent,
      y_coordinate: n.y_percent,
      // Routing target id: the destination id, or a routable amenity's id (the finder offers both).
      linked_shop_id: dest?.id ?? (amenity?.routable ? amenity.id : null),
      evidence: n.evidence.geometry,
      kind: n.kind,
      arrival_evidence: dest?.evidence.arrival ?? null,
    };
  });
  const edges = [...pack.graph.edges.map((e) => toEdge(e, unit)), ...expandConnectors(pack)];

  const adjacency = new Map<string, AdjacencyEntry[]>();
  for (const e of edges) {
    (adjacency.get(e.from_node_id) ?? adjacency.set(e.from_node_id, []).get(e.from_node_id)!).push({ edge: e, to: e.to_node_id, forward: true });
    if (e.bidirectional !== false) {
      (adjacency.get(e.to_node_id) ?? adjacency.set(e.to_node_id, []).get(e.to_node_id)!).push({ edge: e, to: e.from_node_id, forward: false });
    }
  }

  const floors = [...pack.floors].sort((a, b) => a.order - b.order);
  const floorImages: FloorImageMap = {};
  for (const f of floors) if (f.plan_image?.url) floorImages[f.id] = f.plan_image.url;

  const allowedKinds = pack.policies.start.allowed_anchor_kinds;
  const startAnchors = pack.anchors.filter((a) => a.start_permitted && (!allowedKinds || allowedKinds.includes(a.kind)));

  const ranks = pack.graph.nodes.map((n) => RANK[n.evidence.geometry]);
  const weakest = (Object.keys(RANK) as GeometryEvidence[]).find((k) => RANK[k] === Math.min(...ranks)) ?? "schematic";
  const strongest = (Object.keys(RANK) as GeometryEvidence[]).find((k) => RANK[k] === Math.max(...ranks)) ?? "schematic";

  return {
    pack,
    id: pack.venue.id,
    name: pack.venue.name,
    shortName: pack.venue.short_name ?? pack.venue.name,
    evidence: pack.venue.evidence,
    policies: pack.policies,
    floors,
    floorById: new Map(floors.map((f) => [f.id, f])),
    distanceUnit: unit,
    metric: pack.policies.metrics.show !== "never" && edges.length > 0 && edges.every((e) => typeof e.distance_meters === "number" && e.distance_meters > 0),
    nodes,
    edges,
    nodeById: new Map(nodes.map((n) => [n.id, n])),
    adjacency,
    destinations: pack.destinations,
    destinationById: new Map(pack.destinations.map((d) => [d.id, d])),
    destinationByNode,
    anchors: pack.anchors,
    anchorById: new Map(pack.anchors.map((a) => [a.id, a])),
    connectors: pack.connectors ?? [],
    connectorById: new Map((pack.connectors ?? []).map((k) => [k.id, k])),
    startAnchors,
    amenities: pack.amenities,
    amenityById: new Map(pack.amenities.map((a) => [a.id, a])),
    amenityByNode,
    floorImages,
    geometryRange: { weakest, strongest },
  };
}
