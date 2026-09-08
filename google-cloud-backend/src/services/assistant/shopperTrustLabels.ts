/**
 * shopperTrustLabels.ts — Shopping Assistant Intelligence Engine v1
 *
 * Single source of truth for translating internal trust/quality statuses
 * into shopper-safe language. Raw internal statuses must NEVER reach a
 * shopper-facing string (doctrine: Internal-to-Shopper Trust Translation).
 */

import { ConfidenceBand, ShopperCandidate, ShopperTrustInfo } from "./assistantTypes";

/**
 * Internal tokens that must never appear in shopper-facing text.
 * Used defensively by the answer builder and as proof in the harness.
 */
export const INTERNAL_STATUS_TOKENS: readonly string[] = [
  "manual_fact_entry",
  "csv_manual",
  "retail_observation",
  "data_quality_status",
  "review_status",
  "manually_verified",
  "live_feed",
  "needs_review",
  "user_submitted",
  "needs_more_info",
  "pending",
  "approved",
  "published",
];

/** True when text contains any internal status token (case-insensitive). */
export function containsInternalStatus(text: string): boolean {
  const lower = String(text ?? "").toLowerCase();
  return INTERNAL_STATUS_TOKENS.some((token) =>
    new RegExp(`\\b${token}\\b`, "i").test(lower)
  );
}

/** Defence-in-depth: replace internal tokens if they ever leak into text. */
export function scrubInternalStatus(text: string): string {
  let result = String(text ?? "");
  for (const token of INTERNAL_STATUS_TOKENS) {
    result = result.replace(new RegExp(`\\b${token}\\b`, "gi"), "unconfirmed");
  }
  return result;
}

const NOT_CONFIRMED: ShopperTrustInfo = {
  label: "Not confirmed yet",
  confidenceBand: "low",
  cautionNote: "Please confirm with the store.",
};

/**
 * Translate a candidate's trust into shopper-safe label + confidence band.
 *
 * Prefers trustState (computed by priceTrust.calculatePriceTrust — already
 * includes verification expiry and pending disputes) and falls back to the
 * raw data_quality_status only when trustState is absent.
 */
export function getShopperTrustInfo(
  candidate: Pick<ShopperCandidate, "trustState" | "dataQualityStatus">
): ShopperTrustInfo {
  const state = String(candidate.trustState ?? "").toLowerCase();

  switch (state) {
    case "verified":
      return { label: "Verified option", confidenceBand: "high", cautionNote: null };
    case "live":
      return { label: "Live retailer feed", confidenceBand: "high", cautionNote: null };
    case "expired":
      return {
        label: "Price may have changed",
        confidenceBand: "medium",
        cautionNote: "Please confirm in-store before buying.",
      };
    case "disputed":
      return {
        label: "Recently flagged by a shopper",
        confidenceBand: "low",
        cautionNote: "Please confirm in-store before buying.",
      };
    case "needs_review":
      return {
        label: "Price may need confirmation",
        confidenceBand: "medium",
        cautionNote: "Please confirm with the store.",
      };
    case "sample":
      return {
        label: "Example/demo data",
        confidenceBand: "low",
        cautionNote: "This is sample data — the real price may differ.",
      };
  }

  const quality = String(candidate.dataQualityStatus ?? "").toLowerCase();

  switch (quality) {
    case "manually_verified":
      return { label: "Verified option", confidenceBand: "high", cautionNote: null };
    case "live_feed":
      return { label: "Live retailer feed", confidenceBand: "high", cautionNote: null };
    case "stale":
      return {
        label: "Price may have changed",
        confidenceBand: "medium",
        cautionNote: "Please confirm in-store before buying.",
      };
    case "needs_review":
    case "user_submitted":
      return {
        label: "Price may need confirmation",
        confidenceBand: "medium",
        cautionNote: "Please confirm with the store.",
      };
    case "demo":
      return {
        label: "Example/demo data",
        confidenceBand: "low",
        cautionNote: "This is sample data — the real price may differ.",
      };
    default:
      return NOT_CONFIRMED;
  }
}

/** Convenience: confidence band only. */
export function getConfidenceBand(
  candidate: Pick<ShopperCandidate, "trustState" | "dataQualityStatus">
): ConfidenceBand {
  return getShopperTrustInfo(candidate).confidenceBand;
}
