/**
 * routeEvidence.ts — the evidence boundary between "what the data supports" and "what MallMind
 * claims". Field verification is an EXTERNAL evidence upgrade: it changes the wording produced
 * here, never how a navigation session operates.
 *
 * Uses the existing dataset contract (`dataset_status`, `field_verified`, per-node `evidence`);
 * no parallel flags are introduced.
 */

import type { BackendNodeLike } from "./floorplanModel";
import type { LoadedPilotDataset } from "./mallRedsPilotDataset";

export type RouteEvidenceTier = "schematic" | "source-backed" | "field-verified";

/** Collapse the dataset's truth flags into the tier that decides the route claim. */
export function routeEvidenceTier(g: Pick<LoadedPilotDataset, "datasetStatus" | "fieldVerified">): RouteEvidenceTier {
  if (g.datasetStatus === "on-site-verified" || g.fieldVerified) return "field-verified";
  if (g.datasetStatus === "source-backed") return "source-backed";
  return "schematic";
}

const CLAIM: Record<RouteEvidenceTier, string> = {
  schematic: "Schematic route preview",
  "source-backed": "Source-backed route",
  "field-verified": "Field-verified route",
};

/** The one-line claim shown with a route ("Schematic route preview" / "Source-backed route" / …). */
export function routeClaim(g: Pick<LoadedPilotDataset, "datasetStatus" | "fieldVerified">): string {
  return CLAIM[routeEvidenceTier(g)];
}

/** True only when the node's own position was verified on site (a real doorway, not a corridor point). */
export function isArrivalVerified(node: Pick<BackendNodeLike, "evidence">): boolean {
  return node.evidence === "on-site-verified";
}

/**
 * Arrival wording that respects evidence: a verified node is "reached"; an unverified one is the
 * "mapped arrival point" (the graph terminates at a corridor point abreast of the frontage).
 */
export function arrivalWording(node: Pick<BackendNodeLike, "name" | "evidence">): string {
  return isArrivalVerified(node)
    ? `You’ve reached ${node.name}.`
    : `You’ve reached the mapped arrival point for ${node.name}.`;
}
