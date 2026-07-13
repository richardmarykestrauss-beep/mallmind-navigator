/**
 * Conflict + stale detection for the Data Command Center.
 *
 * A conflict = the same product has materially different prices from the SAME
 * source category (e.g. two retailer product pages disagree). These are surfaced
 * for human review; RC1 never auto-resolves them.
 */

import type { IngestionDatabase, ProductOffer, SourceType } from "./model";
import { computeEffectiveFreshness } from "./freshness";

export type SourceCategory = "retailer_page" | "catalogue" | "partner_feed" | "manual" | "user" | "directory" | "other";

export function sourceCategory(t: SourceType): SourceCategory {
  switch (t) {
    case "retailer_product_page":
    case "retailer_search_page":
      return "retailer_page";
    case "retailer_specials_page":
    case "retailer_catalogue":
    case "catalogue_pdf":
    case "catalogue_image":
      return "catalogue";
    case "partner_feed":
      return "partner_feed";
    case "admin_csv":
    case "manual_entry":
    case "manual_admin":
    case "csv_import":
      return "manual";
    case "user_submission":
      return "user";
    case "mall_directory":
      return "directory";
    default:
      return "other";
  }
}

export interface ConflictAlert {
  id: string;
  productId: string;
  productName: string;
  sourceCategory: SourceCategory;
  offerIds: string[];
  prices: number[];
  minPrice: number;
  maxPrice: number;
  spread: number;
  spreadPct: number;
  severity: "warning" | "error";
}

export interface ConflictConfig {
  /** Minimum relative spread (%) between conflicting prices to flag. */
  minSpreadPct: number;
  /** Minimum absolute spread (currency units) to flag. */
  minAbsSpread: number;
  /** Spread (%) at/above which the conflict is an error. */
  errorSpreadPct: number;
}

export const DEFAULT_CONFLICT_CONFIG: ConflictConfig = { minSpreadPct: 3, minAbsSpread: 50, errorSpreadPct: 15 };

const CONSIDERED = new Set(["staged", "needs_review", "approved"]);

/** Detect conflicting prices per (product, source category). Pure + deterministic. */
export function detectConflicts(db: IngestionDatabase, config: ConflictConfig = DEFAULT_CONFLICT_CONFIG): ConflictAlert[] {
  const groups = new Map<string, ProductOffer[]>();
  for (const o of db.offers) {
    if (!CONSIDERED.has(o.reviewStatus)) continue;
    if (o.priceTrustLabel === "unavailable") continue;
    const key = `${o.productId}::${sourceCategory(o.sourceType)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(o);
  }

  const alerts: ConflictAlert[] = [];
  for (const [key, offers] of groups) {
    if (offers.length < 2) continue;
    const prices = offers.map((o) => o.currentPrice).sort((a, b) => a - b);
    const minPrice = prices[0], maxPrice = prices[prices.length - 1];
    const spread = maxPrice - minPrice;
    const spreadPct = minPrice > 0 ? Math.round((spread / minPrice) * 1000) / 10 : 0;
    if (spread < config.minAbsSpread || spreadPct < config.minSpreadPct) continue;
    const [productId, cat] = key.split("::");
    alerts.push({
      id: `conflict_${key}`,
      productId,
      productName: db.products.find((p) => p.id === productId)?.canonicalName ?? productId,
      sourceCategory: cat as SourceCategory,
      offerIds: offers.map((o) => o.id),
      prices,
      minPrice, maxPrice, spread, spreadPct,
      severity: spreadPct >= config.errorSpreadPct ? "error" : "warning",
    });
  }
  return alerts.sort((a, b) => b.spreadPct - a.spreadPct);
}

/** True when a specific offer participates in any detected conflict. */
export function offerHasConflict(offerId: string, alerts: ConflictAlert[]): boolean {
  return alerts.some((a) => a.offerIds.includes(offerId));
}

export interface StaleAlert {
  offerId: string;
  productName: string;
  retailerName: string;
  state: string;
  ageHours: number;
}

/** Offers whose effective freshness is stale/expired (published or not). */
export function detectStaleOffers(db: IngestionDatabase, nowMs: number): StaleAlert[] {
  const out: StaleAlert[] = [];
  for (const o of db.offers) {
    const f = computeEffectiveFreshness(o, nowMs);
    if (f.state === "stale" || f.state === "expired") {
      out.push({
        offerId: o.id,
        productName: db.products.find((p) => p.id === o.productId)?.canonicalName ?? o.productId,
        retailerName: db.retailers.find((r) => r.id === o.retailerId)?.name ?? o.retailerId,
        state: f.state,
        ageHours: f.ageHours,
      });
    }
  }
  return out.sort((a, b) => b.ageHours - a.ageHours);
}
