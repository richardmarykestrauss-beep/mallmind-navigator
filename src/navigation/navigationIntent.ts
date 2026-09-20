/**
 * navigationIntent.ts — the ONE contract between "someone wants to go somewhere" and navigation.
 *
 * Search, the assistant, QR links and (later) voice or recommendations all express intent. None of
 * them may invent route geometry. An intent names a venue and a destination the venue's own Venue
 * Pack knows; the deterministic router, the NavigationSession and Navigation Experience V2 do the
 * rest — the same runtime for every source.
 *
 *   USER INTENT → DESTINATION RESOLUTION (this file) → VENUE PACK → ROUTER → SESSION → EXPERIENCE
 *
 * Resolution runs on the device against the same vocabulary destination search uses (names,
 * aliases, routable amenities). Nothing here talks to a backend.
 */

import type { LoadedVenue } from "@/venue/load";
import { searchDestinations, searchableDestinations, type SearchableDestination } from "@/venue/search";
import { listVenuePacks, getVenuePack } from "@/venue/registry";
import { MALL_PARAM } from "@/components/navigation/wayfindingAnchor";

export type IntentSource = "search" | "assistant" | "link";

/** A validated navigation intent. Deliberately small: no geometry, no instructions, no distance, no floors. */
export interface NavigationIntent {
  type: "navigate";
  venue_id: string;
  destination_id: string;
  /** The destination's display name, for confirmation copy. */
  resolved_label: string;
  resolution_source: IntentSource;
}

export interface IntentCandidate { id: string; name: string; kind: string }

export type IntentResolution =
  | { status: "resolved"; intent: NavigationIntent }
  | { status: "ambiguous"; venue_id: string; query: string; candidates: IntentCandidate[] }
  | { status: "unknown"; venue_id: string; query: string }
  | { status: "no_venue"; query: string };

export const DESTINATION_PARAM = "to";
export const SOURCE_PARAM = "src";

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, " ").trim();

/**
 * Resolve a free-text destination against ONE venue's Venue Pack.
 *   • exactly one exact name/alias match → resolved;
 *   • several exact matches, or no exact match but several search hits → ambiguous (candidates);
 *   • no exact match and exactly one search hit → resolved;
 *   • nothing → unknown. Never guesses between candidates.
 */
export function resolveNavigationIntent(venue: LoadedVenue, query: string, source: IntentSource): IntentResolution {
  const q = norm(query);
  if (!q) return { status: "unknown", venue_id: venue.id, query };
  const all = searchableDestinations(venue);
  const exact = all.filter((d) => norm(d.name) === q || d.aliases.some((a) => norm(a) === q));
  const hits = exact.length ? exact : searchDestinations(venue, query);
  const candidate = (d: SearchableDestination): IntentCandidate => ({ id: d.id, name: d.name, kind: d.type });
  if (hits.length === 1) {
    return { status: "resolved", intent: { type: "navigate", venue_id: venue.id, destination_id: hits[0].id, resolved_label: hits[0].name, resolution_source: source } };
  }
  if (hits.length > 1) return { status: "ambiguous", venue_id: venue.id, query, candidates: hits.slice(0, 5).map(candidate) };
  return { status: "unknown", venue_id: venue.id, query };
}

/** An intent for a destination id that is known to exist (e.g. from a candidate chip). */
export function intentForDestination(venue: LoadedVenue, destinationId: string, source: IntentSource): NavigationIntent | null {
  const d = searchableDestinations(venue).find((x) => x.id === destinationId);
  return d ? { type: "navigate", venue_id: venue.id, destination_id: d.id, resolved_label: d.name, resolution_source: source } : null;
}

/**
 * The venue whose Venue Pack corresponds to a directory mall, by name (the app's directory keys
 * malls by database id; packs by slug; no production ids live in the repository). Null when
 * MallMind cannot walk visitors around that mall yet.
 */
export function findVenueForMall(mallName: string | null | undefined): LoadedVenue | null {
  const q = norm(mallName ?? "");
  if (!q) return null;
  const hit = listVenuePacks().find((v) => norm(v.name) === q || norm(v.shortName) === q);
  return hit ? getVenuePack(hit.id) : null;
}

/** The in-app link that hands a resolved intent to the navigation runtime. */
export function navigationIntentLink(intent: NavigationIntent, path = "/navigate"): string {
  const p = new URLSearchParams({ [MALL_PARAM]: intent.venue_id, [DESTINATION_PARAM]: intent.destination_id, [SOURCE_PARAM]: intent.resolution_source });
  return `${path}?${p.toString()}`;
}

/** Parse an intent hand-off from a query string; null when there is none or it is malformed. */
export function parseNavigationIntentLink(search: string): { venueId: string; destinationId: string; source: IntentSource } | null {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const venueId = (params.get(MALL_PARAM) ?? "").trim();
  const destinationId = (params.get(DESTINATION_PARAM) ?? "").trim();
  if (!venueId || !destinationId || !/^[a-z0-9][a-z0-9-]{0,63}$/i.test(venueId) || !/^[a-z0-9][a-z0-9_-]{0,127}$/i.test(destinationId)) return null;
  const src = params.get(SOURCE_PARAM);
  return { venueId, destinationId, source: src === "assistant" ? "assistant" : src === "search" ? "search" : "link" };
}
