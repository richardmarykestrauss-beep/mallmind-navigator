/**
 * retailWarnings.ts — Retail Intelligence Core v1
 *
 * Single source of truth for publish warnings on weak / manual /
 * low-confidence observations. Warning strings are admin-facing only and
 * must never be shown to shoppers.
 *
 * Pure functions only: no I/O, no Supabase, no env reads.
 */

import { ObservationLike, ProductQualityStatus } from "./retailTypes";
import { EVIDENCE_VERIFIED_METHODS } from "./retailTrustMapper";

/** Confidence below this threshold triggers a warning. */
export const LOW_CONFIDENCE_THRESHOLD = 0.8;

/**
 * Build admin-facing warnings for a single observation, given its projected
 * product quality tier. Mirrors the 19C.5 publish-preview warnings.
 */
export function buildPublishWarnings(
  obs: Pick<ObservationLike, "trust_state" | "verification_method" | "confidence">,
  productQuality: ProductQualityStatus | string
): string[] {
  const warnings: string[] = [];

  if (obs.trust_state === "manual_fact_entry" && productQuality === "needs_review") {
    warnings.push(
      "Manual CSV/admin-entered row will publish as needs_review, not Verified price."
    );
  }

  if (!EVIDENCE_VERIFIED_METHODS.has(String(obs.verification_method ?? ""))) {
    warnings.push(
      `Verification method '${obs.verification_method ?? "none"}' is not external evidence-backed.`
    );
  }

  if (Number(obs.confidence ?? 0) < LOW_CONFIDENCE_THRESHOLD) {
    warnings.push(
      `Confidence is ${obs.confidence}; consider stronger evidence before publishing.`
    );
  }

  return warnings;
}
