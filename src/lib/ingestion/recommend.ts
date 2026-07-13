/**
 * Assistant answer builder — turns the ranked model into a transparent response
 * for "I need a TV under R<budget> at <mall>". Every line is generated from the
 * data model (never hardcoded), and branch stock is only ever "Confirmed" when
 * branch-specific evidence exists.
 */

import type { IngestionDatabase, PriceTrustLabel, AvailabilityLabel } from "./model";
import { trustMeta, availabilityMeta, type BadgeTone } from "./labels";
import { relativeAge } from "./freshness";
import { rankOffers, explainRecommendation, type OfferContext } from "./ranking";

export interface LabelView { key: string; label: string; tone: BadgeTone; }

export interface AssistantOfferView {
  offerId: string;
  productName: string;
  brand: string;
  modelNumber: string;
  price: number;
  currency: string;
  priceFormatted: string;
  previousPrice: number | null;
  promotionLabel: string | null;
  retailerName: string;
  channel: string;
  sellerName: string | null;
  priceTrust: LabelView;
  availability: LabelView;
  observedRelative: string;
  storeAtMall: "confirmed" | "not_a_store";
  branchStock: "confirmed" | "not_confirmed";
  sourceType: string;
  sourceUrl: string;
  demonstrationData: boolean;
  whyRecommended: string | null;
}

export interface AssistantAnswer {
  query: string;
  mallName: string;
  headline: string;
  primary: AssistantOfferView[];
  onlineComparisons: AssistantOfferView[];
  disclosure: string;
  generatedFromModel: true;
}

function formatPrice(currency: string, value: number): string {
  if (currency === "ZAR") return `R${value.toLocaleString("en-ZA")}`;
  return `${currency} ${value.toLocaleString()}`;
}

function toView(ctx: OfferContext, nowMs: number, rank: number | null): AssistantOfferView {
  const tm = trustMeta(ctx.effectiveTrust as PriceTrustLabel);
  const am = availabilityMeta(ctx.offer.availabilityScope as AvailabilityLabel);
  return {
    offerId: ctx.offer.id,
    productName: ctx.product.canonicalName,
    brand: ctx.product.brand,
    modelNumber: ctx.product.modelNumber,
    price: ctx.offer.currentPrice,
    currency: ctx.offer.currency,
    priceFormatted: formatPrice(ctx.offer.currency, ctx.offer.currentPrice),
    previousPrice: ctx.offer.previousPrice ?? null,
    promotionLabel: ctx.offer.promotionLabel ?? null,
    retailerName: ctx.retailer.name,
    channel: ctx.offer.channel,
    sellerName: ctx.offer.sellerName ?? null,
    priceTrust: { key: tm.key, label: tm.label, tone: tm.tone },
    availability: { key: am.key, label: am.label, tone: am.tone },
    observedRelative: relativeAge(ctx.offer.sourceObservedAt, nowMs),
    storeAtMall: ctx.storeAtMallConfirmed ? "confirmed" : "not_a_store",
    branchStock: ctx.branchStockConfirmed ? "confirmed" : "not_confirmed",
    sourceType: ctx.offer.sourceType,
    sourceUrl: ctx.offer.sourceUrl,
    demonstrationData: !!ctx.offer.demonstrationData,
    whyRecommended: rank != null ? explainRecommendation(ctx, rank) : null,
  };
}

export interface RecommendParams {
  mallId: string;
  maxPrice: number;
  category?: string;
  nowMs: number;
}

export function buildTvUnderBudgetAnswer(db: IngestionDatabase, params: RecommendParams): AssistantAnswer {
  const category = params.category ?? "television";
  const mall = db.malls.find((m) => m.id === params.mallId);
  const mallName = mall?.name ?? "the selected mall";
  const ranked = rankOffers(db, { mallId: params.mallId, maxPrice: params.maxPrice, category }, params.nowMs);

  const primary = ranked.primary.map((c, i) => toView(c, params.nowMs, i));
  const onlineComparisons = ranked.onlineComparisons.map((c) => toView(c, params.nowMs, null));

  const headline = primary.length
    ? `Recommended at ${mallName}`
    : `No qualifying in-mall offers under ${formatPrice("ZAR", params.maxPrice)} at ${mallName}`;

  return {
    query: `TV under ${formatPrice("ZAR", params.maxPrice)} at ${mallName}`,
    mallName,
    headline,
    primary,
    onlineComparisons,
    disclosure: "Prices shown are curated demonstration data — not live. Branch stock is only confirmed when branch-specific evidence exists.",
    generatedFromModel: true,
  };
}
