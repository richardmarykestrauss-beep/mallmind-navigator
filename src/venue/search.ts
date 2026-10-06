/**
 * search.ts — Venue-Pack-driven destination discovery. Purely local: a bundled venue is searchable
 * without any backend.
 *
 * Two kinds of truth are kept apart on purpose:
 *   • IDENTITY — a tenant is listed at the venue (name, unit, aliases, category);
 *   • ROUTABILITY — MallMind has source-backed arrival geometry for it.
 * A destination with `arrival_node: null` is searchable (`routable: false`) but never routed.
 *
 * Matching covers names, aliases, units, kind words, amenity words, category labels and terms,
 * and category PRODUCT HINTS ("shampoo" → health & beauty). A hint match is reported as
 * `matched_via: "product_hint"` so the UI can say "you may find this at…", never "X has Y".
 */

import type { LoadedVenue } from "./load";
import type { AmenityKind, DestinationKind } from "./contract";
import { categoryById, categoryLabel, matchCategories, normalizeTerm, CATEGORIES } from "./vocabulary";

export interface SearchableDestination {
  /** Destination id (routing target). For amenities this is the amenity id. */
  id: string;
  name: string;
  kind: "store" | "amenity";
  /** Destination kind or amenity kind — for icons/badges. */
  type: DestinationKind | AmenityKind;
  /** Graph node the route ends at; null when only the identity is known. */
  arrivalNode: string | null;
  /** True when MallMind can walk the visitor there. */
  routable: boolean;
  unit?: string | null;
  aliases: string[];
  category: string | null;
  categoryLabel: string | null;
  /** Set by an operational overlay: listed and searchable, but not routable right now. */
  unavailable?: boolean;
}

export type SearchMatchVia = "name" | "alias" | "unit" | "kind" | "category" | "product_hint";

export interface SearchHit extends SearchableDestination {
  matched_via: SearchMatchVia;
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

const norm = normalizeTerm;

/** Everything the venue's policy offers as a destination, routable or merely listed (cached). */
export function searchableDestinations(venue: LoadedVenue): SearchableDestination[] {
  const cacheKey = "__searchable" as const;
  const cached = (venue as unknown as Record<string, unknown>)[cacheKey] as SearchableDestination[] | undefined;
  if (cached) return cached;
  const kinds = venue.policies.destinations.searchable_kinds;
  const connected = new Set(venue.edges.flatMap((e) => [e.from_node_id, e.to_node_id]));
  const list: SearchableDestination[] = [];
  for (const d of venue.destinations) {
    if (kinds && !kinds.includes(d.kind)) continue;
    const routable = d.arrival_node !== null && connected.has(d.arrival_node); // honestly limited to routable nodes
    const unavailable = venue.overlay?.unavailableDestinationIds.includes(d.id) ?? false;
    list.push({ id: d.id, name: d.name, kind: "store", type: d.kind, arrivalNode: routable ? d.arrival_node : null, routable, unit: d.unit ?? null, aliases: d.aliases ?? [], category: d.category ?? null, categoryLabel: categoryLabel(d.category), ...(unavailable ? { unavailable: true } : {}) });
  }
  if (venue.policies.destinations.include_routable_amenities) {
    for (const a of venue.amenities) {
      if (!a.routable || !connected.has(a.node)) continue;
      const unavailable = venue.overlay?.unavailableAmenityIds.includes(a.id) ?? false;
      list.push({ id: a.id, name: a.name, kind: "amenity", type: a.kind, arrivalNode: a.node, routable: true, aliases: [...(a.aliases ?? []), ...(AMENITY_WORDS[a.kind] ?? [])], category: null, categoryLabel: null, ...(unavailable ? { unavailable: true } : {}) });
    }
  }
  Object.defineProperty(venue, cacheKey, { value: list, enumerable: false });
  return list;
}

/** How one destination matches a normalised query, or null. Name/alias/unit/kind beat category beats hint. */
function matchOne(d: SearchableDestination, q: string, cats: ReturnType<typeof matchCategories>): SearchMatchVia | null {
  if (norm(d.name).includes(q)) return "name";
  if (d.aliases.some((a) => norm(a).includes(q))) return "alias";
  if (d.unit && norm(d.unit) === q) return "unit";
  if (norm(d.type.replace(/_/g, " ")).includes(q)) return "kind";
  if (d.category) {
    const label = norm(categoryLabel(d.category) ?? "");
    if (label && (label.includes(q) || q.includes(label))) return "category";
    const hit = cats.find((c) => c.category.id === d.category);
    if (hit) return hit.via === "term" ? "category" : "product_hint";
  }
  return null;
}

/** Search-as-you-type with the reason each result matched. Empty query → everything. */
export function searchDestinationsDetailed(venue: LoadedVenue, query: string): SearchHit[] {
  const q = norm(query);
  const all = searchableDestinations(venue);
  if (!q) return all.map((d) => ({ ...d, matched_via: "name" as const }));
  const cats = matchCategories(query);
  const hits: SearchHit[] = [];
  for (const d of all) { const via = matchOne(d, q, cats); if (via) hits.push({ ...d, matched_via: via }); }
  // Routable results first within the same match strength; stable otherwise.
  const rank: Record<SearchMatchVia, number> = { name: 0, alias: 0, unit: 0, kind: 1, category: 2, product_hint: 3 };
  return hits.sort((a, b) => rank[a.matched_via] - rank[b.matched_via] || Number(b.routable) - Number(a.routable));
}

/** Search-as-you-type: results only (compatibility). */
export function searchDestinations(venue: LoadedVenue, query: string): SearchableDestination[] {
  return searchDestinationsDetailed(venue, query);
}

/** Resolve a search result / id to the graph node a route should end at; null for listed-only ids. */
export function arrivalNodeFor(venue: LoadedVenue, destinationId: string): string | null {
  const d = venue.destinationById.get(destinationId);
  if (d) return d.arrival_node;
  const a = venue.amenityById.get(destinationId);
  if (a && a.routable) return a.node;
  return null;
}

// ── Search-miss classification (groundwork for demand analytics; deterministic, no ML) ───────────
export type SearchMissReason = "possible_typo_or_alias_gap" | "known_category_absent" | "unknown";

export interface SearchClassification {
  /** Normalised query; raw text is not needed downstream. */
  query_normalized: string;
  result_count: number;
  /** Strongest way any result matched, or null. */
  matched_via: SearchMatchVia | null;
  /** Category ids the query pointed at (by term or hint), whether or not the venue has them. */
  categories: string[];
  /** Why there was no result (null when there were results). */
  miss_reason: SearchMissReason | null;
  /** Closest known name when a typo is suspected (for alias curation; never shown as a result). */
  nearest_known: string | null;
}

/** Damerau-free Levenshtein distance, small inputs only. */
export function editDistance(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}

/**
 * Classify a query for analytics: results → matched_via; no results → one of three honest reasons.
 *   possible_typo_or_alias_gap — within 2 edits of a known name/alias word (≥ 4 chars) or a vocabulary term;
 *   known_category_absent      — the query names a vocabulary category the venue has no destination for;
 *   unknown                    — nothing MallMind can relate it to.
 */
export function classifySearch(venue: LoadedVenue, query: string): SearchClassification {
  const q = norm(query);
  const hits = q ? searchDestinationsDetailed(venue, query) : [];
  const cats = matchCategories(query).map((c) => c.category.id);
  const rank: Record<SearchMatchVia, number> = { name: 0, alias: 0, unit: 0, kind: 1, category: 2, product_hint: 3 };
  const best = hits.length ? hits.reduce((a, b) => (rank[b.matched_via] < rank[a.matched_via] ? b : a)).matched_via : null;
  if (!q) return { query_normalized: q, result_count: 0, matched_via: null, categories: [], miss_reason: null, nearest_known: null };
  if (hits.length) return { query_normalized: q, result_count: hits.length, matched_via: best, categories: cats, miss_reason: null, nearest_known: null };
  // No result: typo against known vocabulary first (whole query vs each known word/name).
  const known = new Set<string>();
  for (const d of searchableDestinations(venue)) { known.add(norm(d.name)); for (const a of d.aliases) known.add(norm(a)); for (const w of norm(d.name).split(" ")) if (w.length >= 4) known.add(w); }
  for (const c of CATEGORIES) { for (const t of c.terms) known.add(norm(t)); for (const h of c.product_hints) known.add(norm(h)); }
  let nearest: string | null = null; let nearestD = Infinity;
  for (const k of known) { if (k.length < 4 || Math.abs(k.length - q.length) > 2) continue; const dist = editDistance(q, k); if (dist < nearestD) { nearestD = dist; nearest = k; } }
  // Distance 0 means the word IS known vocabulary (a category term with no destination), not a typo.
  if (nearest !== null && nearestD >= 1 && nearestD <= 2 && nearestD < q.length / 2) return { query_normalized: q, result_count: 0, matched_via: null, categories: cats, miss_reason: "possible_typo_or_alias_gap", nearest_known: nearest };
  if (cats.length) return { query_normalized: q, result_count: 0, matched_via: null, categories: cats, miss_reason: "known_category_absent", nearest_known: null };
  return { query_normalized: q, result_count: 0, matched_via: null, categories: [], miss_reason: "unknown", nearest_known: null };
}

export { categoryById };
