/**
 * MallMind Retail Intelligence Fabric — Sprint 2B: hardened recommendation spine.
 *
 * The ONE canonical shopper-facing retrieval path. In NORMAL mode it returns only
 * governed offers (approved + publication eligible + evidence backed + not stale/
 * expired/unavailable/conflicted + scope-compatible). Demo data can never leak
 * into normal mode; curated demonstration data is an explicit, labelled mode.
 *
 * This layer sits ON TOP of the existing ranking/publication/assistant-safe logic
 * — it does not replace or weaken any existing trust/freshness protection, and it
 * never mutates evidence or review records.
 */

import type { IngestionDatabase, ProductOffer, GeographicScope } from "@/lib/ingestion/model";
import type { FabricDatabase } from "./types";
import { buildOfferContext, compareOffers, storeConfirmedAtMall, type OfferContext } from "@/lib/ingestion/ranking";
import { offerPublication } from "./assistantSafe";
import { trustMeta } from "@/lib/ingestion/labels";
import { relativeAge } from "@/lib/ingestion/freshness";

export type RecommendationMode = "normal" | "curated_demo" | "admin_preview";
export type TrustPreference = "any" | "verified_only";
export type QueryIntent = "budget" | "cheapest" | "verified_only";

export interface ShopperQuery {
  mallId: string;
  storeId?: string | null;
  category?: string;
  budget?: number | null;
  trustPreference?: TrustPreference;
  intent?: QueryIntent;
}

/** Machine exclusion reasons — for tests + admin observability ONLY, never shown to shoppers. */
export type ExclusionReason =
  | "not_approved" | "publication_blocked" | "stale_or_expired" | "unavailable"
  | "conflict" | "missing_evidence" | "mall_store_mismatch" | "identity_unresolved" | "not_verified";

export interface OfferExclusion { offerId: string; reasons: ExclusionReason[]; blockers: string[]; }

export interface EligibilityDiagnostics {
  totalConsidered: number;
  eligible: number;
  excludedByReview: number;
  excludedByPublication: number;
  excludedStaleExpired: number;
  excludedUnavailable: number;
  excludedConflict: number;
  excludedMallStoreMismatch: number;
  excludedMissingEvidence: number;
  excludedIdentityUnresolved: number;
  excludedNotVerified: number;
  exclusions: OfferExclusion[];
}

function emptyDiagnostics(total: number): EligibilityDiagnostics {
  return {
    totalConsidered: total, eligible: 0, excludedByReview: 0, excludedByPublication: 0, excludedStaleExpired: 0,
    excludedUnavailable: 0, excludedConflict: 0, excludedMallStoreMismatch: 0, excludedMissingEvidence: 0,
    excludedIdentityUnresolved: 0, excludedNotVerified: 0, exclusions: [],
  };
}

/** Mall/store scope compatibility. Mall/branch-scoped offers require store presence. */
function scopeMismatch(offer: ProductOffer, query: ShopperQuery, ingestion: IngestionDatabase): boolean {
  const geo: GeographicScope = offer.geographicScope ?? "unknown";
  if (geo === "mall" || geo === "branch") {
    // A mall/branch-scoped offer must come from a retailer with a confirmed store at this mall.
    if (!storeConfirmedAtMall(offer.retailerId, query.mallId, ingestion)) return true;
    // If a specific branch/store was requested, the retailer's store there must exist.
    if (query.storeId && !ingestion.stores.some((s) => s.id === query.storeId && s.retailerId === offer.retailerId && s.mallId === query.mallId)) return true;
  }
  return false;
}

/** True only when a verified-grade claim is defensible: explicitly verified_live. */
export function isVerifiedGrade(offer: ProductOffer): boolean {
  return offer.priceTrustLabel === "verified_live";
}

/** Evaluate one offer against all shopper gates, returning any exclusion reasons. */
function evaluateOffer(offer: ProductOffer, ingestion: IngestionDatabase, fabric: FabricDatabase, query: ShopperQuery, nowMs: number, verifiedOnly: boolean): OfferExclusion | null {
  const reasons: ExclusionReason[] = [];
  const pub = offerPublication(offer, fabric, nowMs);

  if (offer.reviewStatus !== "approved" || pub.blockers.includes("not_approved")) reasons.push("not_approved");
  // Publication STATUS (published/active) is distinct from publication ELIGIBILITY.
  if (!offer.published) reasons.push("publication_blocked");
  if (pub.blockers.includes("missing_evidence")) reasons.push("missing_evidence");
  if (pub.blockers.includes("expired") || pub.blockers.includes("stale_beyond_policy")) reasons.push("stale_or_expired");
  if (pub.blockers.includes("availability_unavailable")) reasons.push("unavailable");
  if (pub.blockers.includes("unresolved_conflict") || pub.blockers.includes("trust_conflict_detected")) reasons.push("conflict");
  if (pub.blockers.includes("source_policy_blocked") || pub.blockers.includes("missing_source_reference") || pub.blockers.includes("verified_live_requirements_not_met")) reasons.push("publication_blocked");
  if (!ingestion.products.some((p) => p.id === offer.productId)) reasons.push("identity_unresolved");
  if (scopeMismatch(offer, query, ingestion)) reasons.push("mall_store_mismatch");
  if (verifiedOnly && !isVerifiedGrade(offer)) reasons.push("not_verified");

  if (reasons.length === 0) return null;
  return { offerId: offer.id, reasons: Array.from(new Set(reasons)), blockers: pub.blockers };
}

/**
 * The canonical shopper retrieval. NORMAL mode enforces every gate; ADMIN_PREVIEW
 * returns the same eligible set (diagnostics carry the ineligible ones);
 * CURATED_DEMO bypasses governance for the explicitly-labelled demo path only.
 */
export function getShopperEligibleOffers(
  ingestion: IngestionDatabase, fabric: FabricDatabase, query: ShopperQuery, nowMs: number, mode: RecommendationMode = "normal",
): { offers: ProductOffer[]; diagnostics: EligibilityDiagnostics } {
  const verifiedOnly = query.trustPreference === "verified_only" || query.intent === "verified_only";
  const considered = ingestion.offers;
  const diag = emptyDiagnostics(considered.length);

  if (mode === "curated_demo") {
    // Explicit demo path: still honest about availability/unpublished, but not governance-gated.
    const demo = considered.filter((o) => o.published && o.reviewStatus === "approved");
    diag.eligible = demo.length;
    return { offers: demo, diagnostics: diag };
  }

  const eligible: ProductOffer[] = [];
  for (const offer of considered) {
    const ex = evaluateOffer(offer, ingestion, fabric, query, nowMs, verifiedOnly);
    if (!ex) { eligible.push(offer); continue; }
    diag.exclusions.push(ex);
    for (const r of ex.reasons) {
      if (r === "not_approved") diag.excludedByReview++;
      else if (r === "publication_blocked") diag.excludedByPublication++;
      else if (r === "stale_or_expired") diag.excludedStaleExpired++;
      else if (r === "unavailable") diag.excludedUnavailable++;
      else if (r === "conflict") diag.excludedConflict++;
      else if (r === "missing_evidence") diag.excludedMissingEvidence++;
      else if (r === "mall_store_mismatch") diag.excludedMallStoreMismatch++;
      else if (r === "identity_unresolved") diag.excludedIdentityUnresolved++;
      else if (r === "not_verified") diag.excludedNotVerified++;
    }
  }
  diag.eligible = eligible.length;
  return { offers: eligible, diagnostics: diag };
}

// ── Ranking over the eligible set ────────────────────────────────────────────

/** Rank eligible offers per intent. Ranking NEVER promotes an ineligible offer (they are pre-filtered). */
export function rankEligible(offers: ProductOffer[], ingestion: IngestionDatabase, query: ShopperQuery, nowMs: number): OfferContext[] {
  const contexts = offers
    .map((o) => buildOfferContext(o, query.mallId, ingestion, nowMs))
    .filter((c): c is OfferContext => c != null)
    .filter((c) => (query.budget != null ? c.offer.currentPrice <= query.budget : true))
    .filter((c) => (query.category ? matchesCategory(c.product.category, query.category) : true));

  const intent = query.intent ?? "budget";
  if (intent === "cheapest") {
    // Cheapest eligible wins; trust/freshness only break price ties.
    return [...contexts].sort((a, b) => a.offer.currentPrice - b.offer.currentPrice || compareOffers(a, b));
  }
  // budget / verified: mall relevance first, then the honest trust→freshness→branch→price order.
  return [...contexts].sort((a, b) => {
    const mall = (b.storeAtMallConfirmed ? 1 : 0) - (a.storeAtMallConfirmed ? 1 : 0);
    if (mall !== 0) return mall;
    return compareOffers(a, b);
  });
}

const matchesCategory = (productCategory: string | null | undefined, category: string) => {
  const pc = (productCategory ?? "").trim().toLowerCase();   // null-safe: unknown category matches nothing
  const q = category.trim().toLowerCase();
  return pc === q || (q === "television" && /\btv\b|television/i.test(productCategory ?? ""));
};

// ── Shopper-safe response contract ───────────────────────────────────────────

const SCOPE_STATEMENT: Record<GeographicScope, string> = {
  online_only: "Online-only benchmark — not confirmed in a physical branch.",
  national: "National retailer price — branch stock is not confirmed.",
  province: "Provincial price — branch stock is not confirmed.",
  mall: "Applies at this mall — specific branch stock is not confirmed.",
  branch: "Confirmed at this branch.",
  unknown: "Geographic scope is unknown — treat with caution.",
};

export interface ShopperOption {
  offerId: string;
  productTitle: string;
  retailer: string;
  storeTradingName: string | null;
  price: number;
  priceFormatted: string;
  originalPrice: number | null;
  trustLabel: string;                 // human-facing label text (NOT the enum token)
  observedDate: string;
  freshnessStatement: string;
  sourceType: string;                 // human-facing (spaces, not enum token)
  geographicScope: GeographicScope;
  scopeStatement: string;
  availabilityStatement: string;
  branchStock: "confirmed" | "not_confirmed";
  expiry: string | null;
  explanation: string;
  routeAction: { storeId: string; storeTradingName: string } | null;
}

function availabilityStatement(o: ProductOffer): string {
  switch (o.availabilityStatus) {
    case "known_available": return "Availability supported by evidence.";
    case "inferred": return "In the retailer's range — branch stock not confirmed.";
    case "unavailable": return "Currently unavailable.";
    default: return "Availability unknown — do not assume in stock.";
  }
}

export function buildShopperOption(ctx: OfferContext, ingestion: IngestionDatabase, nowMs: number): ShopperOption {
  const o = ctx.offer;
  const store = ingestion.stores.find((s) => s.retailerId === o.retailerId && s.verificationStatus === "verified" && ctx.storeAtMallConfirmed);
  const scope: GeographicScope = o.geographicScope ?? (ctx.isOnlineComparison ? "online_only" : "national");
  const tm = trustMeta(ctx.effectiveTrust);
  const parts: string[] = [];
  if (ctx.storeAtMallConfirmed) parts.push("Store is present at this mall; branch stock is not confirmed unless stated");
  else if (scope === "online_only") parts.push("Online-only benchmark");
  else parts.push("From the retailer's range");
  if ((o.evidenceIds?.length ?? 0) > 0) parts.push("evidence-backed");
  return {
    offerId: o.id,
    productTitle: ctx.product.canonicalName,
    retailer: ctx.retailer.name,
    storeTradingName: store?.tradingName ?? null,
    price: o.currentPrice,
    priceFormatted: o.currency === "ZAR" ? `R${o.currentPrice.toLocaleString("en-ZA")}` : `${o.currency} ${o.currentPrice.toLocaleString()}`,
    originalPrice: o.previousPrice != null && o.previousPrice > o.currentPrice ? o.previousPrice : null,
    trustLabel: tm.label,
    observedDate: o.sourceObservedAt,
    freshnessStatement: `Observed ${relativeAge(o.sourceObservedAt, nowMs)}${o.demonstrationData ? " (curated demonstration data — not live)" : ""}.`,
    sourceType: o.sourceType.replace(/_/g, " "),
    geographicScope: scope,
    scopeStatement: SCOPE_STATEMENT[scope],
    availabilityStatement: availabilityStatement(o),
    branchStock: ctx.branchStockConfirmed ? "confirmed" : "not_confirmed",
    expiry: o.validUntil ?? o.expiresAt ?? null,
    explanation: `${parts.join(", ")}.`,
    routeAction: store ? { storeId: store.id, storeTradingName: store.tradingName } : null,
  };
}

export interface ShopperAnswer {
  mode: RecommendationMode;
  intent: QueryIntent;
  headline: string;
  options: ShopperOption[];
  disclosure: string;
  diagnostics: EligibilityDiagnostics;
}

/** The one governed answer builder. Normal mode uses ONLY eligible offers. */
export function buildShopperAnswer(
  ingestion: IngestionDatabase, fabric: FabricDatabase, query: ShopperQuery, nowMs: number, mode: RecommendationMode = "normal",
): ShopperAnswer {
  const intent = query.intent ?? (query.trustPreference === "verified_only" ? "verified_only" : "budget");
  const { offers, diagnostics } = getShopperEligibleOffers(ingestion, fabric, query, nowMs, mode);
  const ranked = rankEligible(offers, ingestion, query, nowMs);
  const options = ranked.map((c) => buildShopperOption(c, ingestion, nowMs));

  const disclosure = mode === "curated_demo"
    ? "Curated demonstration data — not live and not governed by the review pipeline."
    : "Only governed, evidence-backed, human-approved offers are shown. Branch stock is confirmed only with branch-specific evidence.";

  let headline: string;
  if (options.length === 0) {
    headline = intent === "verified_only"
      ? "No verified, evidence-backed offers match — nothing shown rather than widening to unverified data."
      : "No governed offers match this query.";
  } else {
    headline = intent === "cheapest" ? "Cheapest eligible offer" : intent === "verified_only" ? "Verified eligible offers" : "Recommended eligible offers";
  }
  return { mode, intent, headline, options, disclosure, diagnostics };
}

// ── Gemini / tool candidate sanitization ─────────────────────────────────────

/** Only safe, shopper-appropriate fields — NO internal tokens, blockers, notes or raw evidence. */
export interface GeminiCandidate {
  productTitle: string;
  retailer: string;
  store: string | null;
  price: number;
  currency: "ZAR";
  originalPrice: number | null;
  trust: string;
  observed: string;
  freshness: string;
  availability: string;
  scope: string;
  branchStock: string;
  expiry: string | null;
  routeStoreId: string | null;
}

/** Map an eligible shopper option to the sanitized model-facing candidate. */
export function toGeminiCandidate(o: ShopperOption): GeminiCandidate {
  return {
    productTitle: o.productTitle,
    retailer: o.retailer,
    store: o.storeTradingName,
    price: o.price,
    currency: "ZAR",
    originalPrice: o.originalPrice,
    trust: o.trustLabel,
    observed: o.observedDate,
    freshness: o.freshnessStatement,
    availability: o.availabilityStatement,
    scope: o.scopeStatement,
    branchStock: o.branchStock === "confirmed" ? "confirmed at branch" : "not confirmed at branch",
    expiry: o.expiry,
    routeStoreId: o.routeAction?.storeId ?? null,
  };
}

/** Build the sanitized candidate list for the model/tool path from a governed answer. */
export function buildGeminiCandidates(answer: ShopperAnswer): GeminiCandidate[] {
  return answer.options.map(toGeminiCandidate);
}
