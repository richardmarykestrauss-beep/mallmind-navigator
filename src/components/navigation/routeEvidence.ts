/**
 * routeEvidence.ts — compatibility surface over src/venue/evidence.ts for loaded venues and nodes.
 * Field verification is an EXTERNAL evidence upgrade: it changes the wording produced here, never
 * how a navigation session operates.
 */

import type { BackendNodeLike } from "./floorplanModel";
import type { LoadedVenue } from "@/venue/load";
import { routeEvidenceTier as tierOf, routeClaim as claimOf, arrivalWording as wordingOf, type RouteEvidenceTier } from "@/venue/evidence";
import type { ArrivalEvidence } from "@/venue/contract";

export type { RouteEvidenceTier };

export function routeEvidenceTier(venue: Pick<LoadedVenue, "evidence">): RouteEvidenceTier {
  return tierOf(venue.evidence);
}

/** The one-line claim shown with a route ("Schematic route preview" / "Source-backed route" / …). */
export function routeClaim(venue: Pick<LoadedVenue, "evidence">): string {
  return claimOf(venue.evidence);
}

/** True only when the destination's arrival evidence is a verified public door. */
export function isArrivalVerified(node: Pick<BackendNodeLike, "arrival_evidence">): boolean {
  return node.arrival_evidence === "verified_public_door";
}

/** Arrival wording from the node's own arrival evidence (a corridor point is never "reached X"). */
export function arrivalWording(node: Pick<BackendNodeLike, "name" | "arrival_evidence">): string {
  return wordingOf(node.name, (node.arrival_evidence as ArrivalEvidence | null) ?? undefined);
}
