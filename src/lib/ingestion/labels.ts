/**
 * Trust + availability label systems.
 *
 * Machine labels are the source of truth; user-facing strings, badge tones,
 * descriptions and ranking priority are derived here so the UI and the assistant
 * render the SAME honest language everywhere.
 */

import type { PriceTrustLabel, AvailabilityLabel, AvailabilityStatus } from "./model";

export type BadgeTone = "verified" | "fresh" | "special" | "info" | "muted" | "warning" | "danger";

export interface TrustLabelMeta {
  key: PriceTrustLabel;
  label: string;       // user-facing
  tone: BadgeTone;
  description: string;
  /** Ranking priority — lower is better (1 = strongest trust). */
  priority: number;
}

export const PRICE_TRUST_LABELS: Record<PriceTrustLabel, TrustLabelMeta> = {
  verified_live:     { key: "verified_live",     label: "Verified live",             tone: "verified", priority: 1, description: "Confirmed against a live retailer source within its freshness window." },
  recently_observed: { key: "recently_observed", label: "Recently observed",         tone: "fresh",    priority: 2, description: "Observed from a retailer source recently; may drift over time." },
  catalogue_special: { key: "catalogue_special", label: "Catalogue special",         tone: "special",  priority: 3, description: "A dated catalogue/promotion price, valid until its end date." },
  manual_admin:      { key: "manual_admin",      label: "Manual admin",              tone: "info",     priority: 4, description: "Entered by an admin from a cited source." },
  partner_feed:      { key: "partner_feed",      label: "Partner feed",              tone: "info",     priority: 5, description: "Supplied by a data partner feed (not live-verified by MallMind)." },
  user_submitted:    { key: "user_submitted",    label: "User submitted",            tone: "muted",    priority: 6, description: "Reported by a shopper; unpublished until reviewed." },
  stale:             { key: "stale",             label: "Stale — needs verification", tone: "warning",  priority: 7, description: "Past its freshness window; confirm before relying on it." },
  conflict_detected: { key: "conflict_detected", label: "Conflict detected",         tone: "warning",  priority: 8, description: "Conflicting prices exist for this product from the same source category — needs review." },
  unavailable:       { key: "unavailable",       label: "Unavailable",               tone: "danger",   priority: 9, description: "No usable current price." },
};

/** Trust priority order (best → worst) for deterministic ranking. */
export const TRUST_PRIORITY: PriceTrustLabel[] = [
  "verified_live", "recently_observed", "catalogue_special", "manual_admin", "partner_feed", "user_submitted", "stale", "conflict_detected", "unavailable",
];

// ── Coarse availability status (RC1) ─────────────────────────────────────────
export interface AvailabilityStatusMeta { key: AvailabilityStatus; label: string; tone: BadgeTone; description: string; }

export const AVAILABILITY_STATUS_LABELS: Record<AvailabilityStatus, AvailabilityStatusMeta> = {
  known_available: { key: "known_available", label: "Known available", tone: "verified", description: "Availability is known and the source supports it." },
  inferred:        { key: "inferred",        label: "Inferred",        tone: "info",     description: "Availability inferred from the retailer's range, not confirmed." },
  unknown:         { key: "unknown",         label: "Unknown",         tone: "warning",  description: "Availability is not known." },
  unavailable:     { key: "unavailable",     label: "Unavailable",     tone: "danger",   description: "Confirmed unavailable / not listed." },
};

export function availabilityStatusMeta(key: AvailabilityStatus): AvailabilityStatusMeta {
  return AVAILABILITY_STATUS_LABELS[key];
}

export function trustMeta(key: PriceTrustLabel): TrustLabelMeta {
  return PRICE_TRUST_LABELS[key];
}
export function trustPriority(key: PriceTrustLabel): number {
  return PRICE_TRUST_LABELS[key]?.priority ?? 99;
}

// ── Availability ────────────────────────────────────────────────────────────

export interface AvailabilityLabelMeta {
  key: AvailabilityLabel;
  label: string;
  tone: BadgeTone;
  description: string;
  /** True ONLY for the label that asserts confirmed branch stock. */
  isBranchStockConfirmed: boolean;
}

export const AVAILABILITY_LABELS: Record<AvailabilityLabel, AvailabilityLabelMeta> = {
  branch_stock_confirmed:  { key: "branch_stock_confirmed",  label: "Branch stock confirmed",  tone: "verified", isBranchStockConfirmed: true,  description: "Stock confirmed at this specific mall branch by branch-level evidence." },
  collection_available:    { key: "collection_available",    label: "Collection available",    tone: "fresh",    isBranchStockConfirmed: false, description: "Click-and-collect available at this branch." },
  online_stock_only:       { key: "online_stock_only",       label: "Online stock only",       tone: "info",     isBranchStockConfirmed: false, description: "Stock is online only, not confirmed in the physical branch." },
  retailer_range_observed: { key: "retailer_range_observed", label: "Retailer range observed", tone: "muted",    isBranchStockConfirmed: false, description: "Product is in the retailer's range; branch stock not established." },
  store_presence_confirmed:{ key: "store_presence_confirmed",label: "Store presence confirmed",tone: "info",     isBranchStockConfirmed: false, description: "The retailer has a store at this mall; product stock not established." },
  availability_unknown:    { key: "availability_unknown",    label: "Availability unknown",    tone: "warning",  isBranchStockConfirmed: false, description: "No availability evidence either way." },
  inferred_not_confirmed:  { key: "inferred_not_confirmed",  label: "Inferred — not confirmed",tone: "warning",  isBranchStockConfirmed: false, description: "Availability inferred, not confirmed by evidence." },
  out_of_stock:            { key: "out_of_stock",            label: "Out of stock",            tone: "danger",   isBranchStockConfirmed: false, description: "Confirmed out of stock." },
  no_longer_listed:        { key: "no_longer_listed",        label: "No longer listed",        tone: "danger",   isBranchStockConfirmed: false, description: "The offer is no longer listed at source." },
};

export function availabilityMeta(key: AvailabilityLabel): AvailabilityLabelMeta {
  return AVAILABILITY_LABELS[key];
}

/** The single availability label that claims confirmed branch stock. */
export const BRANCH_STOCK_CONFIRMED: AvailabilityLabel = "branch_stock_confirmed";
