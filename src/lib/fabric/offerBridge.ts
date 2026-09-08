/**
 * Offer creation bridge — the ONE controlled path from an approved review
 * decision to a staged/approved ProductOffer. No adapter invokes this; only an
 * approved ReviewDecision does.
 *
 * The created offer retains full lineage (evidence ids, review-decision id,
 * adapter/extractor/normalizer versions), receives source/trust/freshness
 * metadata, and is created UNPUBLISHED. Publication is a separate gate
 * (`applyPublication`) — approval never implies assistant visibility.
 */

import type { OfferDraft, ReviewDecision, ProvenanceLink, PublicationDecision, GeographicScope } from "./types";
import type { ProductOffer, OfferChannel, SourceType, AvailabilityStatus, AvailabilityLabel } from "@/lib/ingestion/model";
import { linkProvenance } from "./evidence";

export class NotApprovedError extends Error {
  constructor() { super("Only an approved review decision can create an offer."); this.name = "NotApprovedError"; }
}

/** Apply an explicit reviewer patch set to a base record (last patch wins). */
function applyPatches<T extends Record<string, unknown>>(base: T, patches: ReviewDecision["correctedFields"]): T {
  const out = { ...base };
  for (const p of patches) if (p.field in out) (out as Record<string, unknown>)[p.field] = p.to;
  return out;
}

/** Map coarse availability + scope onto the detailed availabilityScope. */
function scopeLabel(status: AvailabilityStatus, geo: GeographicScope): AvailabilityLabel {
  if (status === "unavailable") return "out_of_stock";
  if (status === "known_available") return geo === "branch" ? "branch_stock_confirmed" : "online_stock_only";
  if (status === "inferred") return "retailer_range_observed";
  return "availability_unknown";
}

export interface OfferBuildOptions {
  productId: string;
  sourceType: SourceType;
  channel: OfferChannel;
  /** Cited source URL, resolved from the draft's evidence by the caller. */
  sourceUrl: string;
  /** Cited evidence text/hash carried onto the offer, if available. */
  evidenceText?: string | null;
  evidenceHash?: string | null;
  existing?: ProductOffer | null;
  nowIso: string;
}

/**
 * Build (or revise) a ProductOffer from an approved decision. Idempotent: the
 * same draft+decision yields the same offer content; passing `existing` updates
 * it in place with an incremented `offerRevision` (audit lineage preserved).
 */
export function createOfferFromDecision(
  draft: OfferDraft, decision: ReviewDecision, opts: OfferBuildOptions,
): { offer: ProductOffer; provenance: ProvenanceLink[] } {
  if (decision.decision !== "approve") throw new NotApprovedError();

  const patched = applyPatches({ ...draft } as unknown as Record<string, unknown>, decision.correctedFields) as unknown as OfferDraft;
  const availabilityStatus = decision.approvedAvailabilityStatus ?? patched.availabilityStatus;
  const geographicScope = decision.approvedGeographicScope ?? patched.geographicScope;
  const priceTrustLabel = decision.finalTrustLabel ?? patched.suggestedTrustLabel;

  const id = opts.existing?.id ?? `offer_${draft.id}`;
  const createdAt = opts.existing?.createdAt ?? opts.nowIso;
  const offerRevision = (opts.existing?.offerRevision ?? 0) + 1;

  const offer: ProductOffer = {
    id,
    productId: opts.productId,
    retailerId: patched.retailerId ?? "",
    sellerName: patched.sellerName ?? null,
    channel: opts.channel,
    currency: patched.currency,
    currentPrice: Number(patched.price),
    previousPrice: patched.originalPrice ?? null,
    promotionLabel: patched.promoText ?? null,
    sourceUrl: opts.sourceUrl,
    sourceType: opts.sourceType,
    sourceObservedAt: patched.observedAt,
    expiresAt: patched.expiresAt ?? null,
    validFrom: patched.promoStart ?? null,
    validUntil: patched.expiresAt ?? null,
    availabilityStatus,
    availabilityScope: scopeLabel(availabilityStatus, geographicScope),
    priceTrustLabel,
    snapshotId: null,
    evidenceText: opts.evidenceText ?? null,
    evidenceHash: opts.evidenceHash ?? null,
    conflictGroupId: patched.conflictState === "conflict_detected" ? draft.id : null,
    reviewStatus: "approved",
    published: false, // publication is a SEPARATE gate — approval never auto-publishes
    createdAt,
    updatedAt: opts.nowIso,
    demonstrationData: true,
    // lineage
    geographicScope,
    sourceId: draft.sourceId,
    draftId: draft.id,
    reviewDecisionId: decision.id,
    evidenceIds: [...draft.evidenceIds],
    normalizerVersion: draft.normalizerVersion,
    adapterId: draft.adapterId,
    extractorId: draft.extractorId,
    offerRevision,
  };

  const provenance: ProvenanceLink[] = [
    ...draft.evidenceIds.map((evId) => linkProvenance("product_offer", offer.id, evId, "derived_via_review", opts.nowIso)),
    ...draft.evidenceIds.map((evId) => linkProvenance("review_decision", decision.id, evId, "decision_evidence", opts.nowIso)),
  ];
  return { offer, provenance };
}

/**
 * The controlled publish step: sets `published` ONLY when the publication policy
 * says the offer is eligible. Never flips a blocked offer to published.
 */
export function applyPublication(offer: ProductOffer, decision: PublicationDecision, nowIso: string): ProductOffer {
  return { ...offer, published: decision.eligible, updatedAt: nowIso };
}
