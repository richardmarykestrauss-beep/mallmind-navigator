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

const CLAIM: Record<RouteEvidenceTier, string> = {
  schematic: "Schematic route preview",
  "source-backed": "Source-backed route",
  "field-verified": "Field-verified route",
};

/** The one-line claim shown next to a route. */
export function routeClaim(evidence: Pick<VenueEvidence, "geometry" | "field_verification">): string {
  return CLAIM[routeEvidenceTier(evidence)];
}

/** Arrival wording from the destination's OWN arrival evidence — never from the venue headline. */
export function arrivalWording(name: string, arrival: ArrivalEvidence | undefined): string {
  return arrival === "verified_public_door" ? `You’ve reached ${name}.` : `You’ve reached the mapped arrival point for ${name}.`;
}

export function arrivalNote(destination: Pick<VenueDestination, "name" | "evidence">): string {
  return destination.evidence.arrival === "verified_public_door"
    ? "This doorway was verified on site."
    : `MallMind's map ends at the corridor point nearest ${destination.name}, not at its door. Look for the storefront from here.`;
}

export interface TruthCopy {
  /** Compact status shown in the footer summary. */
  summary: string;
  /** Status line under a route. */
  statusLine: string;
  /** Expandable details. */
  details: string[];
}

/**
 * Truthful status copy for a venue, derived only from its evidence + deployment metadata.
 * `metric` = does the venue's graph support measured metres (every edge measured)?
 */
export function truthCopy(venue: Pick<VenueMeta, "name" | "deployment" | "evidence">, metric: boolean): TruthCopy {
  const tier = routeEvidenceTier(venue.evidence);
  const measured = metric ? "" : " Distance not yet measured.";
  const official = venue.deployment.official ? `An official ${venue.name} deployment.` : `Not an official ${venue.name} deployment. Controlled pilot only.`;
  const accessibility = venue.evidence.accessibility === "verified" ? "Accessibility of this route was verified on site." : "Not accessibility-verified. Not for emergency or evacuation use.";
  if (tier === "schematic") {
    return {
      summary: "Pilot schematic · not an official floorplan · route preview only",
      statusLine: `Route preview — your position is not tracked.${measured}`,
      details: [
        "Pilot schematic — route geometry awaits on-site verification.",
        `Not an official ${venue.name} floorplan.`,
        "Route preview only — live indoor positioning is not active.",
        accessibility,
      ],
    };
  }
  const walked = tier === "field-verified" ? "walked on site" : "not yet walked on site";
  const claim = tier === "field-verified" ? "Field-verified route" : "Source-backed route preview";
  return {
    summary: `${claim} · ${walked}${metric ? "" : " · distance not measured"}`,
    statusLine: `${claim}.${measured} Your position is not tracked.`,
    details: [
      `Route traced from ${venue.name}'s published floor plan; ${walked}.`,
      official,
      metric ? "Distances are measured." : "Distance not yet measured — no walking time is shown.",
      tier === "field-verified" ? "Store arrival points reflect what was verified on site." : "Store entrances shown as the nearest corridor point, not the door.",
      accessibility,
    ],
  };
}

/** Which of two geometry evidence levels is stronger (for summaries). */
export function strongerGeometry(a: GeometryEvidence, b: GeometryEvidence): GeometryEvidence {
  const rank: Record<GeometryEvidence, number> = { schematic: 0, "source-backed": 1, "field-verified": 2 };
  return rank[a] >= rank[b] ? a : b;
}
