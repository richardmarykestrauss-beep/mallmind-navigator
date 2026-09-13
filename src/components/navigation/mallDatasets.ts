/**
 * mallDatasets.ts — compatibility surface over the Venue Pack registry (src/venue).
 *
 * Every helper here is generic: it asks the registry for a venue and reads the venue's own
 * destinations, anchors, amenities and policies. There is no mall-specific branch anywhere in this
 * file. Existing call sites (wayfinding screens, anchor providers, tests) keep their API; new code
 * may use `src/venue` directly.
 */

import { getVenuePack, listVenuePacks, defaultVenueId, type VenueSummary } from "@/venue/registry";
import type { LoadedVenue } from "@/venue/load";
import { searchDestinations, searchableDestinations, type SearchableDestination } from "@/venue/search";
import { routeEvidenceTier } from "@/venue/evidence";

/** The runtime venue object Core consumes (alias kept for older imports). */
export type LoadedPilotDataset = LoadedVenue;
export type DatasetStatus = "schematic" | "source-backed" | "field-verified";

/** All venues with a bundled pack, in registry order (the first is the manual-entry default). */
export function listWayfindingMalls(): Array<{ id: string; name: string; datasetStatus: DatasetStatus; metric: boolean; fieldVerified: boolean }> {
  return listVenuePacks().map((v: VenueSummary) => ({
    id: v.id,
    name: v.name,
    datasetStatus: routeEvidenceTier(v.evidence),
    metric: v.metric,
    fieldVerified: v.evidence.field_verification === "verified",
  }));
}

/** Manual-entry default venue: registry order (data), never a mall id in code. */
export const DEFAULT_WAYFINDING_MALL_ID = defaultVenueId();

/** Load (validated, cached) the venue for an id, or null when unknown — never throws for unknown ids. */
export function getWayfindingMall(mallId: string): LoadedVenue | null {
  return getVenuePack(mallId);
}

// ── Points of interest (destination-first finder) ────────────────────────────
export type PilotPoiKind = "store" | "amenity";
export interface PilotPoi { id: string; name: string; kind: PilotPoiKind; type: string }

const toPoi = (d: SearchableDestination): PilotPoi => ({ id: d.id, name: d.name, kind: d.kind, type: d.kind === "store" ? "shop" : d.type });

/** Everything the venue's policy offers as a destination (destinations + routable amenities), routable only. */
export function pointsOfInterest(venue: LoadedVenue): PilotPoi[] {
  return searchableDestinations(venue).map(toPoi);
}

/** Search-as-you-type over names, aliases, units and amenity words. */
export function searchPois(venue: LoadedVenue, query: string): PilotPoi[] {
  return searchDestinations(venue, query).map(toPoi);
}

/** Start points a visitor may choose: the venue's start-permitted anchors. Never auto-detected. */
export function startOptions(venue: LoadedVenue): Array<{ id: string; label: string; nodeId: string }> {
  return venue.startAnchors.map((a) => ({ id: a.id, label: a.label, nodeId: a.node }));
}

// ── Current-location anchor abstraction (positioning seam) ───────────────────
/**
 * The route consumes ONLY `nodeId`; how it was obtained (`source`) is decoupled, so a future
 * positioning provider can set the anchor WITHOUT the route UI changing.
 */
export type PilotAnchorSource =
  | "manual"        // the visitor chose a start point in the UI
  | "url"           // a /navigate?mall=&start= link
  | "qr"            // a scanned MallMind QR code (via=qr)
  | "native" | "wifi_rtt" | "uwb" | "apple_indoor"; // future positioning providers (not built)
export interface PilotAnchor { nodeId: string; label: string; source: PilotAnchorSource; anchorId?: string }

/** The venue's default start: its policy's default anchor, else the first start-permitted anchor. */
export function defaultAnchor(venue: LoadedVenue): PilotAnchor {
  const preferred = venue.policies.start.default_anchor ? venue.anchorById.get(venue.policies.start.default_anchor) : undefined;
  const a = preferred && venue.startAnchors.includes(preferred) ? preferred : venue.startAnchors[0];
  return { nodeId: a.node, label: a.label, source: "manual", anchorId: a.id };
}

/** Build an anchor from a start anchor id (or, for compatibility, the anchor's node id). */
export function anchorFor(venue: LoadedVenue, anchorOrNodeId: string, source: PilotAnchorSource = "manual"): PilotAnchor {
  const a = venue.startAnchors.find((x) => x.id === anchorOrNodeId) ?? venue.startAnchors.find((x) => x.node === anchorOrNodeId);
  return a ? { nodeId: a.node, label: a.label, source, anchorId: a.id } : { nodeId: anchorOrNodeId, label: anchorOrNodeId, source };
}
