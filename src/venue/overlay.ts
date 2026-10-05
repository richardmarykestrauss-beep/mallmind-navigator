/**
 * overlay.ts — OPERATIONAL OVERLAY: temporary operational truth applied on top of a Venue Pack.
 *
 *   BASE VENUE PACK (stable spatial truth, evidence-backed, factory-published)
 *   + OPERATIONAL OVERLAY (temporary: "the lift is out", "the store is closed today")
 *   = CURRENT ROUTABLE VENUE STATE
 *
 * The pack is never mutated and never recompiled for an operational change. `applyOverlay` returns
 * a NEW LoadedVenue in which closed connectors and edges are not traversable, unavailable anchors
 * cannot be a start, and unavailable destinations / amenities stay SEARCHABLE but are flagged so the
 * session never routes to them. Removing the overlay gives back the original venue object.
 *
 * Deliberately small: five target types, one state ("unavailable"), deterministic active-window
 * evaluation (starts_at ≤ now < expires_at), an actor that is never assumed to be a global admin,
 * and a `simulated` flag so a DEMO state can never be mistaken for a real venue condition.
 */

import type { LoadedVenue, AdjacencyEntry } from "./load";

export type OverlayTargetType = "connector" | "edge" | "destination" | "anchor" | "amenity";
export const OVERLAY_TARGET_TYPES: readonly OverlayTargetType[] = ["connector", "edge", "destination", "anchor", "amenity"];

/** Who asserted the operational fact. `kind` is a role in the venue's operation, not a MallMind superuser. */
export interface OverlayActor {
  id: string;
  kind: "operator" | "mallmind" | "demo" | "system";
  display: string;
}

export interface OverlayEntry {
  id: string;
  venue_id: string;
  target_type: OverlayTargetType;
  target_id: string;
  state: "unavailable";
  /** Plain text for visitors and the audit trail ("Lift under maintenance"). */
  reason: string;
  /** ISO timestamps; null = immediately / never. */
  starts_at: string | null;
  expires_at: string | null;
  actor: OverlayActor;
  created_at: string;
  /** True ONLY for demo / simulated conditions; rendered with an unmistakable label. */
  simulated?: boolean;
}

export interface OperationalOverlay {
  venue_id: string;
  entries: OverlayEntry[];
}

/** What an applied overlay did, for the UI (banner, badges) and for tests. */
export interface AppliedOverlay {
  entries: OverlayEntry[];
  simulated: boolean;
  removedEdgeIds: string[];
  unavailableDestinationIds: string[];
  unavailableAmenityIds: string[];
  unavailableAnchorIds: string[];
}

const ts = (s: string | null): number | null => { if (!s) return null; const t = Date.parse(s); return Number.isFinite(t) ? t : null; };

/** Entries whose window contains `now` (starts_at ≤ now < expires_at). Malformed timestamps never activate. */
export function activeEntries(overlay: OperationalOverlay | null | undefined, now: number | Date = Date.now()): OverlayEntry[] {
  if (!overlay) return [];
  const t = typeof now === "number" ? now : now.getTime();
  return overlay.entries.filter((e) => {
    if (e.state !== "unavailable") return false;
    const start = ts(e.starts_at), end = ts(e.expires_at);
    if (e.starts_at && start === null) return false;
    if (e.expires_at && end === null) return false;
    return (start === null || start <= t) && (end === null || t < end);
  });
}

function rebuildAdjacency(edges: LoadedVenue["edges"]): Map<string, AdjacencyEntry[]> {
  const adjacency = new Map<string, AdjacencyEntry[]>();
  for (const e of edges) {
    (adjacency.get(e.from_node_id) ?? adjacency.set(e.from_node_id, []).get(e.from_node_id)!).push({ edge: e, to: e.to_node_id, forward: true });
    if (e.bidirectional !== false) (adjacency.get(e.to_node_id) ?? adjacency.set(e.to_node_id, []).get(e.to_node_id)!).push({ edge: e, to: e.from_node_id, forward: false });
  }
  return adjacency;
}

/**
 * Apply the overlay's ACTIVE entries to a loaded venue. Pure: the input venue is untouched and the
 * result is a new object. With no active entry the SAME venue object is returned, so "overlay
 * removed" is literally the original truth.
 */
export function applyOverlay(venue: LoadedVenue, overlay: OperationalOverlay | null | undefined, now: number | Date = Date.now()): LoadedVenue {
  const active = overlay && overlay.venue_id === venue.id ? activeEntries(overlay, now) : [];
  if (active.length === 0) return venue;
  const closedConnectors = new Set(active.filter((e) => e.target_type === "connector").map((e) => e.target_id));
  const closedEdges = new Set(active.filter((e) => e.target_type === "edge").map((e) => e.target_id));
  const unavailableDestinations = new Set(active.filter((e) => e.target_type === "destination").map((e) => e.target_id));
  const unavailableAmenities = new Set(active.filter((e) => e.target_type === "amenity").map((e) => e.target_id));
  const unavailableAnchors = new Set(active.filter((e) => e.target_type === "anchor").map((e) => e.target_id));

  const edges = venue.edges.filter((e) => !closedEdges.has(e.id) && !(e.connector_id && closedConnectors.has(e.connector_id)));
  const removedEdgeIds = venue.edges.filter((e) => !edges.includes(e)).map((e) => e.id);
  const applied: AppliedOverlay = {
    entries: active, simulated: active.some((e) => e.simulated === true), removedEdgeIds,
    unavailableDestinationIds: venue.destinations.filter((d) => unavailableDestinations.has(d.id)).map((d) => d.id),
    unavailableAmenityIds: venue.amenities.filter((a) => unavailableAmenities.has(a.id)).map((a) => a.id),
    unavailableAnchorIds: venue.anchors.filter((a) => unavailableAnchors.has(a.id)).map((a) => a.id),
  };
  // A new object: caches keyed on the venue object (search index) are not inherited.
  const out: LoadedVenue = {
    ...venue,
    edges,
    adjacency: rebuildAdjacency(edges),
    connectors: venue.connectors.map((k) => (closedConnectors.has(k.id) ? { ...k, availability: "closed" as const } : k)),
    connectorById: new Map(venue.connectors.map((k) => [k.id, closedConnectors.has(k.id) ? { ...k, availability: "closed" as const } : k])),
    startAnchors: venue.startAnchors.filter((a) => !unavailableAnchors.has(a.id)),
    overlay: applied,
  };
  return out;
}

/** Visitor-facing explanation for one unavailable target, from the overlay entry. */
export function overlayReasonFor(venue: LoadedVenue, targetType: OverlayTargetType, targetId: string): string | null {
  return venue.overlay?.entries.find((e) => e.target_type === targetType && e.target_id === targetId)?.reason ?? null;
}
