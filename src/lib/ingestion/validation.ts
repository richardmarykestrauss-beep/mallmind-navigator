/**
 * Validation engine — produces typed issues (errors/warnings) rather than
 * silently accepting uncertain data. The most important rule: a
 * `branch_stock_confirmed` availability claim REQUIRES branch-specific evidence;
 * website presence + a store at the mall are separate facts and never sufficient.
 */

import type { IngestionDatabase, Product, ProductOffer, Store } from "./model";

export interface ValidationIssue {
  code: string;
  severity: "error" | "warning";
  field?: string;
  message: string;
}

/** Currencies MallMind accepts in this sprint. */
export const SUPPORTED_CURRENCIES = ["ZAR", "USD", "EUR", "GBP"];

export function isValidHttpUrl(value: string | null | undefined): boolean {
  if (!value) return false;
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

const norm = (s: string | null | undefined) => String(s ?? "").trim().toLowerCase().replace(/\/+$/, "");

/** Branch-specific evidence = an in-branch/phone/staff observation confirming stock. */
export function hasBranchStockEvidence(offerId: string, db: IngestionDatabase): boolean {
  const branchEvidence = new Set(["phone_confirmation", "in_store_photo", "staff_confirmation"]);
  return db.observations.some(
    (o) =>
      o.productOfferId === offerId &&
      branchEvidence.has(o.evidenceType) &&
      (o.availabilityStatus === "in_stock" || o.availabilityStatus === "low_stock") &&
      o.reviewStatus !== "rejected",
  );
}

/** Duplicate = same product + retailer + channel + source URL (different id). */
export function duplicateOfferExists(offer: ProductOffer, db: IngestionDatabase): boolean {
  return db.offers.some(
    (o) =>
      o.id !== offer.id &&
      o.productId === offer.productId &&
      o.retailerId === offer.retailerId &&
      o.channel === offer.channel &&
      norm(o.sourceUrl) === norm(offer.sourceUrl),
  );
}

export function validateOffer(offer: ProductOffer, db: IngestionDatabase, nowMs: number): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const err = (code: string, message: string, field?: string) => issues.push({ code, severity: "error", message, field });
  const warn = (code: string, message: string, field?: string) => issues.push({ code, severity: "warning", message, field });

  // URL + source
  if (!isValidHttpUrl(offer.sourceUrl)) err("malformed_url", "Source URL is missing or malformed.", "sourceUrl");
  if (!offer.sourceObservedAt || !Number.isFinite(Date.parse(offer.sourceObservedAt)))
    err("missing_observed_at", "Observation timestamp is missing or invalid.", "sourceObservedAt");

  // Currency + price
  if (!SUPPORTED_CURRENCIES.includes(offer.currency)) err("invalid_currency", `Unsupported currency "${offer.currency}".`, "currency");
  if (!(offer.currentPrice > 0)) err("negative_price", "Current price must be a positive number.", "currentPrice");
  if (offer.previousPrice != null && offer.previousPrice <= 0) err("negative_previous_price", "Previous price must be positive.", "previousPrice");
  // "Saving" sanity: if a previous price / promo implies a saving, current must be lower.
  const claimsSaving = offer.previousPrice != null || !!offer.promotionLabel;
  if (claimsSaving && offer.previousPrice != null && offer.currentPrice > offer.previousPrice)
    err("price_increase_marked_saving", "Current price is higher than the previous price but is marked as a saving.", "currentPrice");

  // Relationships
  const retailer = db.retailers.find((r) => r.id === offer.retailerId);
  const product = db.products.find((p) => p.id === offer.productId);
  if (!retailer) err("missing_retailer", "Offer references a retailer that does not exist.", "retailerId");
  if (!product) err("missing_product", "Offer references a product that does not exist.", "productId");

  // Marketplace offers need seller context.
  if (offer.channel === "marketplace" && !offer.sellerName?.trim())
    err("marketplace_without_seller", "Marketplace offer is missing seller context.", "sellerName");

  // Catalogue expiry.
  if (offer.priceTrustLabel === "catalogue_special" && offer.validUntil && Date.parse(offer.validUntil) < nowMs)
    warn("expired_catalogue", "Catalogue special is past its valid-until date — mark stale/unavailable.", "validUntil");

  // Duplicate.
  if (duplicateOfferExists(offer, db)) warn("duplicate_offer", "A matching offer already exists (same product, retailer, channel and source).");

  // ── The branch-stock rule (capability 8) ──
  if (offer.availabilityScope === "branch_stock_confirmed" && !hasBranchStockEvidence(offer.id, db))
    err("branch_stock_without_evidence", "Branch stock is claimed but no branch-specific evidence exists for this offer.", "availabilityScope");

  // Online-only retailer should not present as physical branch availability.
  if (retailer && !retailer.physicalRetailer &&
    (offer.availabilityScope === "branch_stock_confirmed" || offer.availabilityScope === "store_presence_confirmed" || offer.availabilityScope === "collection_available"))
    warn("online_only_branch_claim", "An online-only retailer is presenting branch/collection availability.", "availabilityScope");

  return issues;
}

export function validateProduct(product: Product, db: IngestionDatabase): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!product.canonicalName?.trim()) issues.push({ code: "missing_name", severity: "error", field: "canonicalName", message: "Canonical name is required." });
  if (!product.modelNumber?.trim()) issues.push({ code: "missing_model", severity: "warning", field: "modelNumber", message: "Model number is recommended for normalization." });
  const dup = db.products.find((p) => p.id !== product.id && norm(p.modelNumber) && norm(p.modelNumber) === norm(product.modelNumber));
  if (dup) issues.push({ code: "duplicate_model_number", severity: "warning", field: "modelNumber", message: `Model number "${product.modelNumber}" already exists (${dup.canonicalName}). Confirm they are the same product.` });
  return issues;
}

export function validateStore(store: Store, db: IngestionDatabase): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const retailer = db.retailers.find((r) => r.id === store.retailerId);
  const mall = db.malls.find((m) => m.id === store.mallId);
  if (!retailer) issues.push({ code: "missing_retailer", severity: "error", field: "retailerId", message: "Store references a retailer that does not exist." });
  if (!mall) issues.push({ code: "wrong_mall", severity: "error", field: "mallId", message: "Store references a mall that does not exist." });
  if (retailer && !retailer.physicalRetailer)
    issues.push({ code: "online_only_mapped_to_mall", severity: "error", field: "retailerId", message: `"${retailer.name}" is online-only and should not be mapped to a physical mall store.` });
  return issues;
}

/** Split issues into blocking errors vs. non-blocking warnings. */
export function hasBlockingErrors(issues: ValidationIssue[]): boolean {
  return issues.some((i) => i.severity === "error");
}
