/**
 * Evidence → offer bridge orchestrator.
 *
 * Pure `(fabric, ingestion, …) => { fabric, ingestion }` transforms that tie the
 * bridge together: submit a review decision, and (only on approval) create/update
 * a staged offer through the ONE controlled path, gate it with the publication
 * policy, and keep full provenance. The UI wraps these with load/save.
 */

import type { FabricDatabase, OfferDraft, ReviewDecision, PublicationDecision } from "./types";
import type { DecisionInput } from "./review";
import type { IngestionDatabase, Product, ProductOffer, SourceType, OfferChannel } from "@/lib/ingestion/model";
import { decide } from "./review";
import { createOfferFromDecision, applyPublication } from "./offerBridge";
import { offerPublication } from "./assistantSafe";
import { normalizeTitle } from "./normalize";
import { makeEvent } from "./events";

const cloneF = (db: FabricDatabase): FabricDatabase => JSON.parse(JSON.stringify(db));
const cloneI = (db: IngestionDatabase): IngestionDatabase => JSON.parse(JSON.stringify(db));

const ADAPTER_SOURCE_TYPE: Record<string, SourceType> = {
  jsonld_fixture: "retailer_product_page",
  catalogue_fixture: "retailer_catalogue",
  sitemap_fixture: "retailer_search_page",
  manual_snapshot: "manual_admin",
};
const ADAPTER_CHANNEL: Record<string, OfferChannel> = {
  jsonld_fixture: "online", catalogue_fixture: "catalogue", sitemap_fixture: "online", manual_snapshot: "in_store",
};

/** Resolve (or create) a product id for a draft. Never a silent fuzzy merge — exact/normalized only. */
function resolveProduct(ingestion: IngestionDatabase, draft: OfferDraft): { ingestion: IngestionDatabase; productId: string } {
  const byGtin = draft.gtin ? ingestion.products.find((p) => p.gtin && p.gtin === draft.gtin) : undefined;
  const byModel = draft.manufacturerModel ? ingestion.products.find((p) => p.modelNumber && p.modelNumber.toUpperCase().replace(/[\s._-]+/g, "") === draft.manufacturerModel!.toUpperCase().replace(/[\s._-]+/g, "")) : undefined;
  const byTitle = ingestion.products.find((p) => normalizeTitle(p.canonicalName) === normalizeTitle(draft.productTitle));
  const found = byGtin ?? byModel ?? byTitle;
  if (found) return { ingestion, productId: found.id };
  const next = ingestion;
  const product: Product = {
    id: `product_${draft.id}`, canonicalName: draft.productTitle, brand: draft.brand ?? "", modelNumber: draft.manufacturerModel ?? "",
    category: draft.category ?? "television", descriptionSummary: "", gtin: draft.gtin, manufacturerSku: draft.retailerSku, normalizationStatus: "needs_review",
  };
  next.products.push(product);
  return { ingestion: next, productId: product.id };
}

export interface SubmitResult {
  fabric: FabricDatabase;
  ingestion: IngestionDatabase;
  decision: ReviewDecision;
  offer: ProductOffer | null;
  publication: PublicationDecision | null;
}

/**
 * Submit a review decision for a draft. Approvals create/update a staged offer
 * through the controlled bridge and gate publication; rejections/archives/change
 * requests never create an offer. Throws ReviewValidationError on an invalid
 * approval (surfaced by the caller). Idempotent for a repeated approval of the
 * same draft (updates the existing offer, bumping offerRevision).
 */
export function submitDecision(
  fabric: FabricDatabase, ingestion: IngestionDatabase, draftId: string, input: DecisionInput, nowIso: string,
): SubmitResult {
  const draft = fabric.drafts.find((d) => d.id === draftId);
  if (!draft) throw new Error(`Unknown draft "${draftId}".`);
  const evidence = draft.evidenceIds.map((id) => fabric.evidence.find((e) => e.id === id)).filter(Boolean) as FabricDatabase["evidence"];
  const policy = fabric.policies.find((p) => p.sourceId === draft.sourceId);

  const decision = decide(draft, input, fabric.decisions, evidence, policy, nowIso); // throws on invalid approve

  let nextFabric = cloneF(fabric);
  let nextIngestion = cloneI(ingestion);
  nextFabric.decisions.push(decision);

  // Reflect the decision on the draft (append-only decisions; draft status mirrors latest).
  const d = nextFabric.drafts.find((x) => x.id === draftId)!;
  d.reviewStatus = decision.decision === "approve" ? "approved" : decision.decision === "reject" ? "rejected" : decision.decision === "archive" ? "archived" : "needs_review";
  if (input.finalTrustLabel) d.finalTrustLabel = input.finalTrustLabel;
  if (input.correctedFields?.some((p) => p.field === "conflictState" && p.to === "resolved")) d.conflictState = "resolved";
  d.updatedAt = nowIso;

  let offer: ProductOffer | null = null;
  let publication: PublicationDecision | null = null;

  if (decision.decision === "approve") {
    const resolved = resolveProduct(nextIngestion, draft);
    nextIngestion = resolved.ingestion;
    const existing = nextIngestion.offers.find((o) => o.draftId === draft.id) ?? null;
    const built = createOfferFromDecision(draft, decision, {
      productId: resolved.productId,
      sourceType: ADAPTER_SOURCE_TYPE[draft.adapterId ?? ""] ?? "manual_admin",
      channel: ADAPTER_CHANNEL[draft.adapterId ?? ""] ?? "online",
      sourceUrl: evidence[0]?.sourceUrl ?? "",
      evidenceText: evidence[0]?.extractedText ?? null,
      evidenceHash: evidence[0]?.contentHash ?? null,
      existing,
      nowIso,
    });
    // Publication is a SEPARATE gate — evaluate against current fabric policies/evidence.
    publication = offerPublication(built.offer, nextFabric, Date.parse(nowIso));
    const gated = applyPublication(built.offer, publication, nowIso);
    offer = gated;

    if (existing) nextIngestion.offers = nextIngestion.offers.map((o) => (o.id === gated.id ? gated : o));
    else nextIngestion.offers.push(gated);
    nextFabric.provenance.push(...built.provenance);
    nextFabric.events.push(makeEvent({ type: gated.published ? "offer.published" : "review.approved", occurredAt: nowIso, sourceId: draft.sourceId, adapterId: draft.adapterId, payload: { offerId: gated.id, published: gated.published, blockers: publication.blockers } }));
  } else {
    nextFabric.events.push(makeEvent({ type: "review.required", occurredAt: nowIso, sourceId: draft.sourceId, adapterId: draft.adapterId, payload: { draftId, decision: decision.decision } }));
  }

  return { fabric: nextFabric, ingestion: nextIngestion, decision, offer, publication };
}
