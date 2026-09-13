/**
 * search.ts — Venue-Pack-driven destination discovery. Purely local: a bundled venue is searchable
 * without any backend. Matches destination names, aliases, units, categories, and routable
 * amenities (by name, kind and aliases) according to the pack's destination policy.
 */

import type { LoadedVenue } from "./load";
import type { AmenityKind, DestinationKind } from "./contract";

export interface SearchableDestination {
  /** Destination id (routing target). For amenities this is the amenity id. */
  id: string;
  name: string;
  kind: "store" | "amenity";
  /** Destination kind or amenity kind — for icons/badges. */
  type: DestinationKind | AmenityKind;
  /** Graph node the route ends at. */
  arrivalNode: string;
  unit?: string | null;
  aliases: string[];
}

const AMENITY_WORDS: Partial<Record<AmenityKind, string[]>> = {
  toilet: ["toilets", "restroom", "bathroom", "loo", "wc"],
  accessible_toilet: ["accessible toilet", "disabled toilet", "toilets"],
  baby_room: ["baby change", "nappy", "parents room"],
  information: ["info", "information desk", "help desk"],
  atm: ["cash", "cash machine", "bank machine"],
  lift: ["elevator", "lifts"],
  escalator: ["escalators"],
  stairs: ["staircase", "steps"],
  parking: ["car park", "parking"],
  charging: ["charge", "ev charging", "phone charging"],
  security: ["security office", "guard"],
  first_aid: ["medical", "first aid"],
  food_court: ["food", "restaurants", "eat"],
  seating: ["seats", "rest area"],
};

function norm(s: string): string { return s.trim().toLowerCase().replace(/\s+/g, " "); }

/** Everything offered as a destination by this venue's policy (cached on the venue object). */
export function searchableDestinations(venue: LoadedVenue): SearchableDestination[] {
  const cacheKey = "__searchable" as const;
  const cached = (venue as unknown as Record<string, unknown>)[cacheKey] as SearchableDestination[] | undefined;
  if (cached) return cached;
  const kinds = venue.policies.destinations.searchable_kinds;
  const connected = new Set(venue.edges.flatMap((e) => [e.from_node_id, e.to_node_id]));
  const list: SearchableDestination[] = [];
  for (const d of venue.destinations) {
    if (kinds && !kinds.includes(d.kind)) continue;
    if (!connected.has(d.arrival_node)) continue; // honestly limited to routable nodes
    list.push({ id: d.id, name: d.name, kind: "store", type: d.kind, arrivalNode: d.arrival_node, unit: d.unit ?? null, aliases: d.aliases ?? [] });
  }
  if (venue.policies.destinations.include_routable_amenities) {
    for (const a of venue.amenities) {
      if (!a.routable || !connected.has(a.node)) continue;
      list.push({ id: a.id, name: a.name, kind: "amenity", type: a.kind, arrivalNode: a.node, aliases: [...(a.aliases ?? []), ...(AMENITY_WORDS[a.kind] ?? [])] });
    }
  }
  Object.defineProperty(venue, cacheKey, { value: list, enumerable: false });
  return list;
}

/** Search-as-you-type: case-insensitive substring over name, aliases, unit and kind words. */
export function searchDestinations(venue: LoadedVenue, query: string): SearchableDestination[] {
  const q = norm(query);
  const all = searchableDestinations(venue);
  if (!q) return all;
  return all.filter((d) =>
    norm(d.name).includes(q) ||
    d.aliases.some((a) => norm(a).includes(q)) ||
    (d.unit ? norm(d.unit).includes(q) : false) ||
    norm(d.type.replace(/_/g, " ")).includes(q),
  );
}

/** Resolve a search result / id to the graph node a route should end at. */
export function arrivalNodeFor(venue: LoadedVenue, destinationId: string): string | null {
  const d = venue.destinationById.get(destinationId);
  if (d) return d.arrival_node;
  const a = venue.amenityById.get(destinationId);
  if (a && a.routable) return a.node;
  return null;
}
