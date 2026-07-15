/**
 * Assistant safety path.
 *
 * The assistant may ONLY retrieve offers that are approved AND publication
 * eligible (which already excludes stale-beyond-policy, unavailable, conflict-
 * blocked, missing-evidence, blocked-source, and unmet verified_live). Every
 * assistant-facing offer carries an explicit trust/freshness/scope/availability
 * statement so nothing is presented as more certain than the evidence supports.
 */

import type { IngestionDatabase, ProductOffer, GeographicScope, AvailabilityStatus, PriceTrustLabel } from "@/lib/ingestion/model";
import type { FabricDatabase, SourceAccessPolicy, ConflictState, PublicationDecision } from "./types";
import { evaluatePublication } from "./publication";
import { trustMeta } from "@/lib/ingestion/labels";
import { relativeAge } from "@/lib/ingestion/freshness";
import { supportsLiveVerification } from "./review";

/** Resolve the publication decision for an offer using fabric policies + evidence. */
export function offerPublication(offer: ProductOffer, fabric: FabricDatabase, nowMs: number): PublicationDecision {
  const policy: SourceAccessPolicy | undefined = offer.sourceId ? fabric.policies.find((p) => p.sourceId === offer.sourceId) : undefined;
  // Evidence may be carried on the offer OR linked via provenance.
  const linkedIds = fabric.provenance.filter((l) => l.entityType === "product_offer" && l.entityId === offer.id).map((l) => l.evidenceId);
  const evidenceIds = Array.from(new Set([...(offer.evidenceIds ?? []), ...linkedIds]));
  const evidence = evidenceIds.map((id) => fabric.evidence.find((e) => e.id === id)).filter(Boolean);
  const conflictState: ConflictState = offer.conflictGroupId ? "conflict_detected" : "none";
  return evaluatePublication({
    reviewStatus: offer.reviewStatus,
    evidenceIds,
    policy,
    finalTrustLabel: offer.priceTrustLabel,
    availabilityStatus: offer.availabilityStatus,
    geographicScope: offer.geographicScope ?? "unknown",
    conflictState,
    sourceUrl: offer.sourceUrl || null,
    observedAt: offer.sourceObservedAt,
    expiresAt: offer.validUntil ?? offer.expiresAt ?? null,
    confidence: evidence[0]?.fieldConfidence ?? null,
    liveVerificationSupported: supportsLiveVerification(policy, evidence.filter(Boolean) as NonNullable<typeof evidence[number]>[]),
    nowMs,
  });
}

/** An offer is assistant-eligible only when approved AND publication eligible. */
export function isAssistantEligible(offer: ProductOffer, fabric: FabricDatabase, nowMs: number): boolean {
  if (offer.reviewStatus !== "approved") return false;
  return offerPublication(offer, fabric, nowMs).eligible;
}

/** Filter an offer set down to assistant-eligible offers. */
export function filterAssistantEligible(offers: ProductOffer[], fabric: FabricDatabase, nowMs: number): ProductOffer[] {
  return offers.filter((o) => isAssistantEligible(o, fabric, nowMs));
}

const SCOPE_STATEMENT: Record<GeographicScope, string> = {
  online_only: "Online only — not confirmed in a physical branch.",
  national: "National price — branch stock not confirmed.",
  province: "Provincial price — branch stock not confirmed.",
  mall: "Applies at this mall — specific branch stock not confirmed.",
  branch: "Confirmed at this branch.",
  unknown: "Geographic scope unknown.",
};
const AVAIL_LIMIT: Record<AvailabilityStatus, string> = {
  known_available: "Availability supported by evidence.",
  inferred: "Availability inferred from the retailer's range — not confirmed.",
  unknown: "Availability unknown — do not assume in stock.",
  unavailable: "Currently unavailable.",
};

export interface SafeAssistantOffer {
  offerId: string;
  productId: string;
  price: number;
  priceFormatted: string;
  trustLabel: PriceTrustLabel;
  trustLabelText: string;
  observedDate: string;
  sourceFreshnessStatement: string;
  geographicScope: GeographicScope;
  scopeStatement: string;
  availabilityStatus: AvailabilityStatus;
  availabilityLimitation: string;
  expiry: string | null;
  sourceUrl: string;
  warnings: string[];
}

/** Build the assistant-facing, limitation-carrying view for an eligible offer. */
export function buildSafeAssistantOffer(offer: ProductOffer, fabric: FabricDatabase, nowMs: number): SafeAssistantOffer {
  const pub = offerPublication(offer, fabric, nowMs);
  const scope = offer.geographicScope ?? "unknown";
  return {
    offerId: offer.id,
    productId: offer.productId,
    price: offer.currentPrice,
    priceFormatted: offer.currency === "ZAR" ? `R${offer.currentPrice.toLocaleString("en-ZA")}` : `${offer.currency} ${offer.currentPrice.toLocaleString()}`,
    trustLabel: offer.priceTrustLabel,
    trustLabelText: trustMeta(offer.priceTrustLabel).label,
    observedDate: offer.sourceObservedAt,
    sourceFreshnessStatement: `Observed ${relativeAge(offer.sourceObservedAt, nowMs)} from ${offer.sourceType.replace(/_/g, " ")}${offer.demonstrationData ? " (curated demonstration data — not live)" : ""}.`,
    geographicScope: scope,
    scopeStatement: SCOPE_STATEMENT[scope],
    availabilityStatus: offer.availabilityStatus,
    availabilityLimitation: AVAIL_LIMIT[offer.availabilityStatus],
    expiry: offer.validUntil ?? offer.expiresAt ?? null,
    sourceUrl: offer.sourceUrl,
    warnings: pub.warnings,
  };
}

/** Retrieve the assistant-safe offer views for a query over the ingestion db. */
export function retrieveAssistantSafeOffers(
  ingestion: IngestionDatabase, fabric: FabricDatabase, nowMs: number, filter?: (o: ProductOffer) => boolean,
): SafeAssistantOffer[] {
  return filterAssistantEligible(ingestion.offers, fabric, nowMs)
    .filter((o) => (filter ? filter(o) : true))
    .map((o) => buildSafeAssistantOffer(o, fabric, nowMs));
}
