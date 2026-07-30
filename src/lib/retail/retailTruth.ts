/**
 * retailTruth.ts — Sprint 2I
 *
 * Shopper-facing HONESTY helpers. The database (migration 036) enforces truthful
 * scope, but the assistant/UI must also SPEAK truthfully: an online-observed price is
 * never rendered as "available at this branch", an unknown category is never
 * "Uncategorised", and a branch-stock claim is made ONLY when availability is
 * branch_confirmed — not merely because a product row references a shop.
 */

import type { AvailabilityScope, PriceCondition } from "./retailAdapter";

/**
 * A branch-stock claim is permitted ONLY when availability is branch_confirmed.
 * Note: a product carrying a shop_id is NOT sufficient — a record may reference a
 * branch for context while availability is unknown.
 */
export function canClaimBranchAvailability(scope: AvailabilityScope | null | undefined): boolean {
  return scope === "branch_confirmed";
}

/** Truthful availability sentence. Never claims a branch unless branch_confirmed. */
export function describeAvailability(
  scope: AvailabilityScope | null | undefined,
  mallName?: string | null,
): string {
  switch (scope) {
    case "branch_confirmed":
      return mallName ? `Available at ${mallName}` : "Available in-store";
    case "click_collect":
      return "Available online for click & collect; in-store stock not confirmed";
    case "delivery_area":
      return "Available online for delivery; in-store stock not confirmed";
    case "online":
      return "Online price observed; in-store availability not confirmed";
    case "not_observed":
    case "unknown":
    default:
      return "Availability not confirmed";
  }
}

/** Unknown category renders honestly — never "", "Other", "General", or "Uncategorised". */
export function describeProductCategory(category: string | null | undefined): string {
  const raw = (category ?? "").trim();
  return raw === "" ? "Category not yet classified" : raw;
}

/**
 * A short price-condition badge, or null when there is nothing to add (standard /
 * unknown). Prefers the source's own label (e.g. "ClubCard price", "Buy 3 for R100").
 */
export function describePriceCondition(
  condition: PriceCondition | null | undefined,
  label?: string | null,
): string | null {
  const trimmed = (label ?? "").trim();
  if (trimmed) return trimmed;
  switch (condition) {
    case "loyalty": return "Loyalty price";
    case "bulk":
    case "bundle": return "Multi-buy price";
    case "promotional": return "Promotional price";
    case "online_only": return "Online-only price";
    default: return null; // standard / unknown → no badge
  }
}
