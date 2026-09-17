/**
 * evidence.ts — the boundary between "what the Venue Pack's evidence supports" and "what MallMind
 * says". Field verification is a data upgrade (the pack's evidence changes); this module turns
 * whatever the evidence is into truthful wording. No mall-specific branches.
 */

import type { VenueEvidence, VenueDestination, VenueMeta, ArrivalEvidence, GeometryEvidence } from "./contract";

export type RouteEvidenceTier = "schematic" | "source-backed" | "field-verified";

export function routeEvidenceTier(evidence: Pick<VenueEvidence, "geometry" | "field_verification">): RouteEvidenceTier {
  if (evidence.geometry === "field-verified" || evidence.field_verification === "verified") return "field-verified";
  if (evidence.geometry === "source-backed") return "source-backed";
  return "schematic";
}

/**
 * Product language for evidence tiers. Raw enums (source-backed, corridor_arrival, …) never reach
 * the visitor; these three phrases do. They deliberately do not oversell: "Mapped" means traced
 * from the mall's published plan and not yet walked; only field verification earns "Verified".
 */
const CLAIM: Record<RouteEvidenceTier, string> = {
  schematic: "Preview route",
  "source-backed": "Mapped route",
  "field-verified": "Verified route",
};

/** The one-line claim shown next to a route. */
export function routeClaim(evidence: Pick<VenueEvidence, "geometry" | "field_verification">): string {
  return CLAIM[routeEvidenceTier(evidence)];
}

/** One plain sentence explaining what the claim rests on. */
export function routeClaimExplanation(tier: RouteEvidenceTier): string {
  if (tier === "field-verified") return "This route was walked and checked on site.";
  if (tier === "source-backed") return "Traced from the mall’s published floor plan. Not yet walked on site.";
  return "Drawn from a simplified sketch of the mall, not from a surveyed floor plan.";
}

/**
 * Arrival headline from the destination's OWN arrival evidence — never from the venue headline.
 * A corridor point is never "reached X"; a preview (schematic) route ends at "the end of this
 * preview route". Used both for the route's last step and the arrival card.
 */
export function arrivalWording(name: string, arrival: ArrivalEvidence | undefined, tier: RouteEvidenceTier = "source-backed"): string {
  if (arrival === "verified_public_door") return `You’ve reached ${name}.`;
  if (tier === "schematic") return `You’ve reached the end of this preview route to ${name}.`;
  return `You’ve reached the mapped arrival point for ${name}.`;
}

export function arrivalNote(destination: Pick<VenueDestination, "name" | "evidence">, tier: RouteEvidenceTier = "source-backed"): string {
  if (destination.evidence.arrival === "verified_public_door") return "This entrance was checked on site.";
  if (tier === "schematic") return `This sketch ends near ${destination.name}, not at its entrance. Look around for the storefront.`;
  return `The map ends at the walkway point nearest ${destination.name}, not at its entrance. Look around for the storefront.`;
}

export interface TruthCopy {
  /** Compact status line shown with a route (one line, product language). */
  summary: string;
  /** Alias of summary (kept for callers). */
  statusLine: string;
  /** Expandable "Route details". */
  details: string[];
}

/**
 * Truthful status copy for a venue, derived only from its evidence + deployment metadata.
 * `metric` = does the venue's graph support measured metres (every edge measured)?
 */
export function truthCopy(venue: Pick<VenueMeta, "name" | "deployment" | "evidence">, metric: boolean): TruthCopy {
  const tier = routeEvidenceTier(venue.evidence);
  const claim = CLAIM[tier];
  const walked = tier === "field-verified" ? "checked on site" : "not yet walked on site";
  const summary = `${claim} · ${walked}${metric ? "" : " · distance not measured"}`;
  const official = venue.deployment.official
    ? `An official ${venue.name} service.`
    : `Not an official ${venue.name} service. MallMind is being trialled here with the centre’s knowledge but without its endorsement.`;
  const accessibility = venue.evidence.accessibility === "verified"
    ? "The accessibility of this route was checked on site."
    : "Route accessibility has not been checked. Not for emergency or evacuation use.";
  const arrival = tier === "field-verified"
    ? "Store entrances reflect what was checked on site."
    : "Routes end at the walkway point nearest a store, not at its door.";
  const distance = metric ? "Distances were measured." : "Distances have not been measured yet, so no walking time is shown.";
  const details = [routeClaimExplanation(tier), official, distance, arrival, accessibility, "MallMind does not track your position. You confirm each step yourself."];
  if (tier === "schematic") details.splice(1, 0, `Not an official ${venue.name} floor plan.`);
  return { summary, statusLine: summary, details };
}

/** Which of two geometry evidence levels is stronger (for summaries). */
export function strongerGeometry(a: GeometryEvidence, b: GeometryEvidence): GeometryEvidence {
  const rank: Record<GeometryEvidence, number> = { schematic: 0, "source-backed": 1, "field-verified": 2 };
  return rank[a] >= rank[b] ? a : b;
}
