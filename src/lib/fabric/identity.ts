/**
 * Product identity foundation.
 *
 * Deterministic match hierarchy that returns MERGE CANDIDATES with confidence and
 * a human-readable explanation. It NEVER performs an automatic fuzzy merge — a
 * human always makes the final call for anything below an exact identifier match.
 *
 * Hierarchy: exact GTIN → exact manufacturer model → exact retailer SKU (within
 * retailer) → brand + model → normalized title/attributes → human review.
 */

import type { Product } from "@/lib/ingestion/model";
import type { IdentityCandidate, MergeCandidate, MatchTier } from "./types";
import { normalizeBrand, normalizeModel, normalizeTitle, collapseWhitespace } from "./normalize";

const TIER_CONFIDENCE: Record<MatchTier, number> = {
  exact_gtin: 1.0,
  exact_manufacturer_model: 0.95,
  exact_retailer_sku: 0.9,
  brand_and_model: 0.82,
  normalized_title: 0.6,
  human_review: 0.2,
};

/** Build a normalized identity candidate from loose fields. */
export function buildIdentityCandidate(input: {
  gtin?: string | null; manufacturerModel?: string | null; retailerSku?: string | null; retailerId?: string | null;
  brand: string; productTitle: string; category?: string | null;
  technicalAttributes?: Record<string, string>; sourceIdentifiers?: Record<string, string>;
}): IdentityCandidate {
  return {
    gtin: input.gtin?.trim() || null,
    manufacturerModel: input.manufacturerModel?.trim() || null,
    retailerSku: input.retailerSku?.trim() || null,
    retailerId: input.retailerId ?? null,
    brand: collapseWhitespace(input.brand),
    normalizedBrand: normalizeBrand(input.brand),
    productTitle: collapseWhitespace(input.productTitle),
    normalizedTitle: normalizeTitle(input.productTitle),
    category: input.category?.trim() || null,
    technicalAttributes: input.technicalAttributes ?? {},
    sourceIdentifiers: input.sourceIdentifiers ?? {},
  };
}

/**
 * Return ranked merge candidates against known products. Deterministic; never
 * merges. If no exact/soft match is found, returns a single `human_review`
 * candidate (productId "") explaining that a human must resolve identity.
 */
export function matchIdentity(candidate: IdentityCandidate, products: Product[]): MergeCandidate[] {
  const out: MergeCandidate[] = [];
  const add = (productId: string, tier: MatchTier, explanation: string) =>
    out.push({ productId, tier, confidence: TIER_CONFIDENCE[tier], explanation });

  for (const p of products) {
    if (candidate.gtin && p.gtin && candidate.gtin === p.gtin) {
      add(p.id, "exact_gtin", `Exact GTIN match (${candidate.gtin}).`);
      continue;
    }
    if (candidate.manufacturerModel && p.modelNumber && normalizeModel(candidate.manufacturerModel) === normalizeModel(p.modelNumber)) {
      add(p.id, "exact_manufacturer_model", `Exact manufacturer model match (${p.modelNumber}).`);
      continue;
    }
    if (candidate.retailerSku && p.manufacturerSku && candidate.retailerSku === p.manufacturerSku) {
      add(p.id, "exact_retailer_sku", `Exact SKU match (${candidate.retailerSku})${candidate.retailerId ? ` within ${candidate.retailerId}` : ""}.`);
      continue;
    }
    const brandEq = candidate.normalizedBrand && normalizeBrand(p.brand) === candidate.normalizedBrand;
    const modelEq = candidate.manufacturerModel && p.modelNumber && normalizeModel(candidate.manufacturerModel) === normalizeModel(p.modelNumber);
    if (brandEq && modelEq) {
      add(p.id, "brand_and_model", `Brand (${p.brand}) + model (${p.modelNumber}) match.`);
      continue;
    }
    if (candidate.normalizedTitle && normalizeTitle(p.canonicalName) === candidate.normalizedTitle) {
      add(p.id, "normalized_title", `Normalized title match ("${p.canonicalName}") — soft; confirm before merging.`);
      continue;
    }
  }

  if (out.length === 0) {
    out.push({ productId: "", tier: "human_review", confidence: TIER_CONFIDENCE.human_review, explanation: "No exact identifier or normalized match — a human must resolve this identity. No automatic merge performed." });
  }

  // Rank by confidence (highest tier first); stable for equal confidence.
  return out.sort((a, b) => b.confidence - a.confidence);
}

/**
 * Whether the top candidate is safe to AUTO-LINK. Only exact-identifier tiers
 * with a SINGLE unambiguous match qualify — and even then the caller must route
 * through human review before publishing. Soft tiers never auto-link.
 */
export function isAutoLinkSafe(candidates: MergeCandidate[]): boolean {
  const exact = candidates.filter((c) => c.tier === "exact_gtin" || c.tier === "exact_manufacturer_model" || c.tier === "exact_retailer_sku");
  return exact.length === 1;
}
