/**
 * retailTrustMapper.ts — Retail Intelligence Core v1
 *
 * Single source of truth for mapping observation trust_state +
 * verification_method onto products.data_quality_status and
 * products.price_verification_method.
 *
 * Trust rules (19C.4 hardening — do not weaken):
 *   - manual_fact_entry only becomes manually_verified when backed by an
 *     external-evidence verification method. manual_fact_entry + csv_manual
 *     (or no method) maps to needs_review, never a Verified price.
 *   - Unknown/expired/stale/disputed states map to needs_review.
 *
 * Pure functions only: no I/O, no Supabase, no env reads.
 */

import { ProductQualityStatus } from "./retailTypes";

/** Verification methods backed by external evidence (migration 026 subset). */
export const EVIDENCE_VERIFIED_METHODS: ReadonlySet<string> = new Set([
  "phone",
  "website",
  "flyer",
  "receipt",
  "store_visit",
  "retailer_confirmation",
  "scraper",
  "retailer_api",
]);

/** Allowed values of products.price_verification_method (migration 008). */
export const VALID_PRODUCT_VERIFICATION_METHODS: ReadonlySet<string> = new Set([
  "phone",
  "website",
  "flyer",
  "receipt",
  "store_visit",
  "retailer_confirmation",
  "scraper",
  "retailer_api",
  "user_submission",
]);

/** Map observation trust_state + verification_method → product quality tier. */
export function mapTrustStateToProductQuality(
  trustState: unknown,
  verificationMethod: unknown
): ProductQualityStatus {
  const state = String(trustState ?? "");
  const method = String(verificationMethod ?? "");

  switch (state) {
    case "verified":
    case "retailer_submitted":
    case "flyer_extracted":
    case "web_observed":
      return "manually_verified";
    case "manual_fact_entry":
      return EVIDENCE_VERIFIED_METHODS.has(method)
        ? "manually_verified"
        : "needs_review";
    case "live_feed":
      return "live_feed";
    case "user_submitted":
      return "user_submitted";
    case "expired":
    case "stale":
    case "disputed":
    case "needs_review":
    default:
      return "needs_review";
  }
}

/**
 * Map an observation verification_method into a value that is valid for
 * products.price_verification_method.
 *
 * products.price_verification_method does not allow csv_manual,
 * affiliate_feed, or partner_feed. Feed methods are recorded as retailer_api;
 * csv_manual maps to null. The original method is preserved inside
 * products.data_source by the publish planner.
 */
export function mapVerificationMethod(method: unknown): string | null {
  if (!method) return null;
  const value = String(method);
  if (VALID_PRODUCT_VERIFICATION_METHODS.has(value)) return value;
  if (value === "affiliate_feed" || value === "partner_feed") return "retailer_api";
  return null;
}

/** Quality tiers that surface to shoppers as a verified/live price. */
export function isVerifiedQuality(quality: ProductQualityStatus | string): boolean {
  return quality === "manually_verified" || quality === "live_feed";
}
