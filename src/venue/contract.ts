/**
 * contract.ts — THE Venue Pack contract (schema_version 1).
 *
 * A Venue Pack is a validated DATA input that describes one venue completely enough for MallMind
 * Core to navigate it: floors, a spatial graph, destinations, anchors, amenities, evidence and a
 * compact declarative policy block. Core code (router, session, screens, anchor providers,
 * search) consumes packs generically; adding a venue means registering a pack, never editing code.
 *
 * TRUTH RULES that the shape enforces (and validate.ts checks):
 *   • evidence is provenance-aware and per concern (geometry / identity / arrival / measurement /
 *     accessibility / field verification) — never one boolean;
 *   • metres exist only where measured ("m" packs; or a measured edge inside a "px" pack after a
 *     field measurement) and a route is metric only when EVERY traversed edge is measured;
 *   • pixels are never converted to metres;
 *   • an edge's instruction is directional — A→B may differ from B→A and one never implies the other;
 *   • floors are whatever the pack declares (no implicit "G");
 *   • policies are enums/flags, never scripts or templates.
 */

export const VENUE_PACK_SCHEMA_VERSION = 1 as const;

// ── Evidence vocabulary ──────────────────────────────────────────────────────
export type GeometryEvidence = "schematic" | "source-backed" | "field-verified";
export type IdentityEvidence = "unverified" | "source-backed" | "field-verified";
export type ArrivalEvidence = "unknown" | "corridor_arrival" | "verified_public_door";
export type MeasurementEvidence = "unmeasured" | "measured";
export type AccessibilityEvidence = "unverified" | "verified";
export type FieldVerificationState = "not-started" | "pending" | "partial" | "verified";

export const GEOMETRY_EVIDENCE: readonly GeometryEvidence[] = ["schematic", "source-backed", "field-verified"];
export const IDENTITY_EVIDENCE: readonly IdentityEvidence[] = ["unverified", "source-backed", "field-verified"];
export const ARRIVAL_EVIDENCE: readonly ArrivalEvidence[] = ["unknown", "corridor_arrival", "verified_public_door"];
export const MEASUREMENT_EVIDENCE: readonly MeasurementEvidence[] = ["unmeasured", "measured"];
export const ACCESSIBILITY_EVIDENCE: readonly AccessibilityEvidence[] = ["unverified", "verified"];
export const FIELD_VERIFICATION_STATES: readonly FieldVerificationState[] = ["not-started", "pending", "partial", "verified"];

/** Venue-level truth summary. Entity-level evidence is always explicit; this is the headline. */
export interface VenueEvidence {
  geometry: GeometryEvidence;
  measurement: MeasurementEvidence;
  field_verification: FieldVerificationState;
  accessibility: AccessibilityEvidence;
  /** Free-text provenance summary (source policy, precision caveats). Plain text. */
  note?: string;
}

export interface VenueSource {
  /** What this source is (e.g. "official mall map lightbox", "tenant directory page"). */
  kind: string;
  /** URL or citation. Stored as text; never rendered as a link by Core. */
  reference: string;
  retrieved?: string;
  note?: string;
}

// ── Venue ────────────────────────────────────────────────────────────────────
export type DeploymentState = "internal-pilot" | "controlled-pilot" | "public" | "retired";
export const DEPLOYMENT_STATES: readonly DeploymentState[] = ["internal-pilot", "controlled-pilot", "public", "retired"];

export interface VenueMeta {
  id: string;
  name: string;
  /** Revision of THIS venue's pack (1, 2, …) — independent of schema_version. A field survey bumps it. */
  pack_version: number;
  /** What changed in this revision (plain text). */
  revision_note?: string;
  short_name?: string;
  city?: string;
  country?: string;
  /** Only when genuinely known; never approximated. */
  geo?: { lat: number; lng: number };
  deployment: {
    state: DeploymentState;
    /** true only for a deployment the venue operator sanctioned. */
    official: boolean;
    /** Human-readable pilot label shown in truth copy (plain text). */
    label?: string;
  };
  evidence: VenueEvidence;
  sources?: VenueSource[];
  notes?: string;
}

// ── Floors ───────────────────────────────────────────────────────────────────
export interface VenueFloorPlanImage {
  url: string;
  width_px: number;
  height_px: number;
  evidence: GeometryEvidence;
  rights?: string;
}

export interface VenueFloor {
  /** Stable id used by nodes; any string the venue uses (G, LF, L1, Parking, Mezzanine, …). */
  id: string;
  label: string;
  /** Vertical order, lowest first. */
  order: number;
  aliases?: string[];
  /** Optional plan artwork prepared at the MallMind plane aspect (validated). */
  plan_image?: VenueFloorPlanImage | null;
}

// ── Graph ────────────────────────────────────────────────────────────────────
export type DistanceUnit = "m" | "px";
export const DISTANCE_UNITS: readonly DistanceUnit[] = ["m", "px"];

export type NodeKind = "entrance" | "corridor" | "junction" | "arrival" | "amenity" | "landmark" | "vertical";
export const NODE_KINDS: readonly NodeKind[] = ["entrance", "corridor", "junction", "arrival", "amenity", "landmark", "vertical"];

export interface VenueNode {
  id: string;
  name: string;
  kind: NodeKind;
  floor: string;
  /** Percent coordinates on the MallMind plane (0..100). */
  x_percent: number;
  y_percent: number;
  evidence: { geometry: GeometryEvidence };
  source?: string;
  notes?: string;
  /** Provenance extras (source pixels, measurement notes …). Scalars only; never interpreted by Core. */
  provenance?: Record<string, string | number | boolean | null>;
}

export type VerticalKind = "lift" | "escalator" | "stairs" | "ramp";
export const VERTICAL_KINDS: readonly VerticalKind[] = ["lift", "escalator", "stairs", "ramp"];

// ── Vertical connectors (Sprint 7; additive to schema 1) ─────────────────────
export type ConnectorDirection = "both" | "up" | "down";
export const CONNECTOR_DIRECTIONS: readonly ConnectorDirection[] = ["both", "up", "down"];
export type ConnectorAvailability = "open" | "closed";
export const CONNECTOR_AVAILABILITY: readonly ConnectorAvailability[] = ["open", "closed"];
/** Accessibility is EVIDENCE, never inferred from a connector's kind. */
export type StepFreeEvidence = "unknown" | "field_verified_yes" | "field_verified_no";
export const STEP_FREE_EVIDENCE: readonly StepFreeEvidence[] = ["unknown", "field_verified_yes", "field_verified_no"];

export interface VenueConnectorLanding { floor: string; node: string }

/**
 * A physical vertical connector (one lift shaft, one flight of stairs, one escalator). Declared
 * ONCE with its landings; the loader expands it into routable one-way/two-way edges between every
 * pair of landings (direction-aware), so authors never hand-duplicate pairwise edges and Dijkstra
 * stays unchanged. Connector edges carry NO horizontal length: their routing cost comes from
 * policy, never from a fabricated distance.
 */
export interface VenueConnector {
  id: string;
  kind: VerticalKind;
  name?: string;
  /** Real graph nodes (kind "vertical"), one per floor served, at least two, distinct floors. */
  landings: VenueConnectorLanding[];
  /** "up"/"down" follow the floors' `order`; "both" for lifts, stairs, ramps. */
  direction: ConnectorDirection;
  /** A closed connector produces no routable edge. Data, not telemetry. */
  availability: ConnectorAvailability;
  /** `measurement: "measured"` is required to carry traversal_seconds. */
  evidence: { geometry: GeometryEvidence; measurement?: MeasurementEvidence };
  /** Only with measured evidence; contributes to route time, never to distance. */
  traversal_seconds?: number | null;
  accessibility?: { step_free: StepFreeEvidence };
  source?: string;
  notes?: string;
}

export interface VenueEdge {
  id: string;
  from: string;
  to: string;
  /** Default true. A one-way link (e.g. a down-only escalator) sets false. */
  bidirectional?: boolean;
  floor_change?: boolean;
  vertical_kind?: VerticalKind;
  /** Pixel length on the traced source; required for "px" packs (shortest-path weight). */
  length_px?: number | null;
  /** Measured metres; required for "m" packs, optional in "px" packs ONLY when measurement is "measured". */
  distance_m?: number | null;
  evidence: { geometry: GeometryEvidence; measurement: MeasurementEvidence };
  /** Directional wording. `forward` = from→to, `reverse` = to→from. Neither is derived from the other. */
  instructions?: { forward?: string | null; reverse?: string | null };
  /** A hand-written vertical edge may name the connector it belongs to (must exist). */
  connector_id?: string;
  source?: string;
  notes?: string;
}

export interface VenueGraph {
  distance_unit: DistanceUnit;
  /** The coordinate plane the percent coordinates refer to (informational; Core uses 1000×620). */
  plane?: { width: number; height: number };
  nodes: VenueNode[];
  edges: VenueEdge[];
}

// ── Destinations / anchors / amenities ───────────────────────────────────────
export type DestinationKind = "store" | "service" | "food" | "entertainment" | "landmark";
export const DESTINATION_KINDS: readonly DestinationKind[] = ["store", "service", "food", "entertainment", "landmark"];

export interface VenueDestination {
  id: string;
  name: string;
  kind: DestinationKind;
  category?: string;
  /** Graph node the route ends at (a corridor arrival point or a verified door). */
  arrival_node: string;
  /** Store / unit identifier where the venue publishes one. */
  unit?: string | null;
  aliases?: string[];
  evidence: { identity: IdentityEvidence; arrival: ArrivalEvidence; identity_source?: string };
  notes?: string;
}

export type AnchorKind = "entrance" | "landmark" | "kiosk" | "parking_interface" | "amenity";
export const ANCHOR_KINDS: readonly AnchorKind[] = ["entrance", "landmark", "kiosk", "parking_interface", "amenity"];

export interface VenueAnchor {
  id: string;
  node: string;
  label: string;
  kind: AnchorKind;
  /** May a visitor (manual pick or QR) start a route here? */
  start_permitted: boolean;
  /** May a QR code be printed for this anchor? Default = start_permitted. */
  qr_eligible?: boolean;
  evidence?: { geometry: GeometryEvidence };
  notes?: string;
}

export type AmenityKind =
  | "toilet" | "accessible_toilet" | "baby_room" | "information" | "atm" | "lift" | "escalator" | "stairs"
  | "parking" | "charging" | "security" | "first_aid" | "food_court" | "seating";
export const AMENITY_KINDS: readonly AmenityKind[] = [
  "toilet", "accessible_toilet", "baby_room", "information", "atm", "lift", "escalator", "stairs",
  "parking", "charging", "security", "first_aid", "food_court", "seating",
];

export interface VenueAmenity {
  id: string;
  kind: AmenityKind;
  name: string;
  node: string;
  /** Offered as a destination? Venue data decides; nothing is routable by default. */
  routable: boolean;
  aliases?: string[];
  evidence: { geometry: GeometryEvidence; accessibility?: AccessibilityEvidence };
  notes?: string;
}

// ── Policies (declarative, enum/flag only) ───────────────────────────────────
export interface VenuePolicies {
  start: {
    /** Anchor id preselected for manual entry. Must be start_permitted. */
    default_anchor?: string;
    /** Only anchors of these kinds may be starts (in addition to start_permitted). */
    allowed_anchor_kinds?: AnchorKind[];
  };
  destinations: {
    /** Destination kinds offered in search (default: all). */
    searchable_kinds?: DestinationKind[];
    /** Offer amenities flagged routable as destinations too. */
    include_routable_amenities: boolean;
  };
  floors: {
    /** How a floor is shown: its label (default) or its id. */
    display: "label" | "id";
  };
  metrics: {
    /** "when-measured": metres/minutes only if every traversed edge is measured; "never": suppress. */
    show: "when-measured" | "never";
  };
  instructions: {
    /** Allow topology-derived generic sentences where no directional text exists. */
    generic_fallback: boolean;
    /** Prefix the first leg with "Start at <anchor label>." unless the leg text already names it. */
    start_prefix: boolean;
  };
  /**
   * Routing COST (not distance). Connector costs are in the pack's distance unit equivalents and
   * shape which path Dijkstra prefers; they are never displayed. Absent → code defaults.
   */
  routing?: {
    connector_cost?: Partial<Record<VerticalKind, number>>;
    preference?: RoutePreference;
  };
}

/** How a route is chosen. "step_free" EXCLUDES stairs, escalators and connectors with step_free field_verified_no. */
export type RoutePreference = "shortest" | "fewest_changes" | "step_free";
export const ROUTE_PREFERENCES: readonly RoutePreference[] = ["shortest", "fewest_changes", "step_free"];

// ── The pack ─────────────────────────────────────────────────────────────────
export interface VenuePack {
  schema_version: typeof VENUE_PACK_SCHEMA_VERSION;
  venue: VenueMeta;
  floors: VenueFloor[];
  graph: VenueGraph;
  destinations: VenueDestination[];
  anchors: VenueAnchor[];
  amenities: VenueAmenity[];
  /** Optional (schema 1 additive): vertical connectors, expanded to edges by the loader. */
  connectors?: VenueConnector[];
  policies: VenuePolicies;
}

/** Ids are URL/QR-safe slugs. */
export const VENUE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
