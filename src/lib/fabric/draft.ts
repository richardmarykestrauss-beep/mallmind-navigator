/**
 * Extraction → OfferDraft normalizer.
 *
 * Deterministic, idempotent conversion of an ExtractionCandidate into a
 * normalized, reviewable OfferDraft. It validates required fields, safely
 * normalizes ZAR prices, records warnings, and NEVER invents missing fields or
 * infers mall/branch scope from a national retailer page.
 *
 * Idempotence: the same candidate + normalizer version always produces the same
 * `draftHash` (and therefore the same draft id).
 */

import type {
  ExtractionCandidate, OfferDraft, ConfidenceDimensions, AdapterMode, GeographicScope,
} from "./types";
import type { AvailabilityStatus, PriceTrustLabel } from "@/lib/ingestion/model";
import { structuredHash } from "./hash";
import { normalizeTitle, normalizeModel } from "./normalize";
import { suggestTrustLabel } from "./evidence";

export const DRAFT_NORMALIZER_VERSION = "1.0.0";

const SUPPORTED_CURRENCIES = new Set(["ZAR", "USD", "EUR", "GBP"]);
const MAX_REASONABLE_PRICE = 100_000_000; // guard against absurd extractions
const VALID_AVAILABILITY = new Set<AvailabilityStatus>(["known_available", "unknown", "inferred", "unavailable"]);

/** Scope by access mode. NEVER mall/branch — those require explicit branch evidence at review. */
const MODE_SCOPE: Record<AdapterMode, GeographicScope> = {
  json_ld: "online_only", sitemap: "online_only", browser_observation: "online_only",
  catalogue: "national", partner_api: "national", merchant_feed: "national", newsletter: "national",
  manual: "unknown",
};

export class NormalizationError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "NormalizationError";
  }
}

export interface NormalizeContext {
  sourceId: string;
  adapterId: string;
  adapterMode: AdapterMode;
  extractorId?: string | null;
  retailerId?: string | null;
  retailerName?: string | null;
  mallId?: string | null;
  storeId?: string | null;
  productIdentityCandidateId?: string | null;
  sellerName?: string | null;
  evidenceIds: string[];
  confidence: ConfidenceDimensions;
  observedAt: string;
  hasConflict?: boolean;
  branchAvailabilityConfirmed?: boolean;
  nowIso: string;
}

function fieldVal(ext: ExtractionCandidate, name: string): unknown {
  return ext.fields.find((f) => f.field === name)?.value;
}
const str = (v: unknown): string | null => (v == null || v === "" ? null : String(v).trim());

export function normalizeToDraft(ext: ExtractionCandidate, ctx: NormalizeContext): OfferDraft {
  const warnings: string[] = [];

  // Required: title.
  const productTitle = str(fieldVal(ext, "productTitle"));
  if (!productTitle) throw new NormalizationError("missing_title", "Cannot normalize: extraction has no product title.");

  // Required: a sane price.
  const rawPrice = fieldVal(ext, "price");
  const price = typeof rawPrice === "number" ? rawPrice : Number(str(rawPrice));
  if (!Number.isFinite(price) || price <= 0) throw new NormalizationError("invalid_price", `Cannot normalize: price "${String(rawPrice)}" is invalid.`);
  if (price > MAX_REASONABLE_PRICE) throw new NormalizationError("impossible_price", `Cannot normalize: price ${price} exceeds the sane maximum.`);

  // Currency: must be supported.
  const currency = (str(fieldVal(ext, "currency")) ?? "ZAR").toUpperCase();
  if (!SUPPORTED_CURRENCIES.has(currency)) throw new NormalizationError("unsupported_currency", `Unsupported currency "${currency}".`);

  // Availability: trust only an explicit coarse status; never invent "known" from a UI signal.
  const rawAvail = str(fieldVal(ext, "availability")) as AvailabilityStatus | null;
  const availabilityStatus: AvailabilityStatus = rawAvail && VALID_AVAILABILITY.has(rawAvail) ? rawAvail : "unknown";
  if (availabilityStatus === "unknown") warnings.push("Availability is unknown — not presented as in-stock.");

  const originalPriceRaw = fieldVal(ext, "originalPrice");
  const originalPrice = originalPriceRaw == null || originalPriceRaw === "" ? null : Number(originalPriceRaw);
  if (originalPrice != null && (!Number.isFinite(originalPrice) || originalPrice <= 0)) warnings.push("Original price could not be parsed — dropped.");

  const brand = str(fieldVal(ext, "brand"));
  const manufacturerModel = str(fieldVal(ext, "model"));
  const retailerSku = str(fieldVal(ext, "sku"));
  const gtin = str(fieldVal(ext, "gtin"));
  const category = str(fieldVal(ext, "category"));
  const promoStart = str(fieldVal(ext, "validFrom"));
  const promoEnd = str(fieldVal(ext, "validTo"));
  const promoText = str(fieldVal(ext, "promoText"));
  const expiresAt = promoEnd;

  if (!brand) warnings.push("No brand extracted.");
  if (!manufacturerModel && !gtin && !retailerSku) warnings.push("No stable product identifier (gtin/model/sku) — identity is title-only.");

  const geographicScope = MODE_SCOPE[ctx.adapterMode] ?? "unknown";

  const ageHours = (Date.parse(ctx.nowIso) - Date.parse(ctx.observedAt)) / 3_600_000;
  const suggestedTrustLabel: PriceTrustLabel = suggestTrustLabel({
    mode: ctx.adapterMode,
    hasConflict: !!ctx.hasConflict,
    ageHours: Number.isFinite(ageHours) ? ageHours : null,
    hasValidityDates: !!promoEnd,
    branchAvailabilityConfirmed: !!ctx.branchAvailabilityConfirmed,
    confidence: ctx.confidence,
  }).suggested;

  const lowDims = Object.entries(ctx.confidence).filter(([, v]) => v > 0 && v < 0.4).map(([k]) => k);
  if (lowDims.length) warnings.push(`Low confidence: ${lowDims.join(", ")}.`);

  // Idempotent identity hash over the normalized fields (not timestamps that vary per run).
  const draftHash = structuredHash({
    v: DRAFT_NORMALIZER_VERSION,
    sourceId: ctx.sourceId,
    title: normalizeTitle(productTitle),
    price,
    currency,
    gtin: gtin ?? "",
    model: manufacturerModel ? normalizeModel(manufacturerModel) : "",
    sku: retailerSku ?? "",
    observedAt: ctx.observedAt,
  });
  const id = `draft_${draftHash.replace(/^sha256:txt-/, "").slice(0, 24)}`;

  return {
    id,
    sourceId: ctx.sourceId,
    retailerId: ctx.retailerId ?? null,
    retailerName: ctx.retailerName ?? null,
    mallId: ctx.mallId ?? null,
    storeId: ctx.storeId ?? null,
    productIdentityCandidateId: ctx.productIdentityCandidateId ?? null,
    productTitle,
    brand,
    manufacturerModel,
    retailerSku,
    gtin,
    category,
    price,
    currency,
    originalPrice: originalPrice != null && Number.isFinite(originalPrice) && originalPrice > 0 ? originalPrice : null,
    promoText,
    promoStart,
    promoEnd,
    availabilityStatus,
    geographicScope,
    sellerName: ctx.sellerName ?? null,
    observedAt: ctx.observedAt,
    expiresAt,
    suggestedTrustLabel,
    finalTrustLabel: null,
    reviewStatus: "needs_review",
    evidenceIds: [...ctx.evidenceIds],
    confidence: ctx.confidence,
    warnings,
    conflictState: ctx.hasConflict ? "conflict_detected" : "none",
    draftHash,
    normalizerVersion: DRAFT_NORMALIZER_VERSION,
    adapterId: ctx.adapterId,
    extractorId: ctx.extractorId ?? ext.extractorId ?? null,
    createdAt: ctx.nowIso,
    updatedAt: ctx.nowIso,
  };
}
