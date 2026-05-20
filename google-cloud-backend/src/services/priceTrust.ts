/**
 * priceTrust.ts
 *
 * Deterministic price trust calculator for MallMind product prices.
 *
 * RULES
 * ─────
 * 1. data_quality_status is the single source of truth for base trust.
 *    data_source="manual_seed" does NOT downgrade a manually_verified product.
 * 2. A verification older than EXPIRY_DAYS is "expired" — price may have changed.
 * 3. Pending price_correction_reports (status=pending) elevate to "disputed".
 * 4. needs_verification reports gently flag as "needs_review" when base is high.
 * 5. Admin approve → manually_verified + fresh price_verified_at → clears expired/disputed.
 * 6. Users never change prices — only reports affect trust state, not the price field.
 */

export type TrustLevel = "high" | "medium" | "low" | "disputed";
export type TrustState =
  | "verified"
  | "live"
  | "expired"
  | "disputed"
  | "needs_review"
  | "sample"
  | "unknown";

export interface PriceTrust {
  /** Short UI label for the badge, e.g. "Verified price", "Recently disputed" */
  trust_label: string;
  /** Rolled-up confidence level */
  trust_level: TrustLevel;
  /** Granular machine-readable state */
  trust_state: TrustState;
  /** True when manually_verified but price_verified_at > EXPIRY_DAYS ago */
  is_price_expired: boolean;
  /** True when at least one pending dispute report exists for this product */
  has_pending_dispute: boolean;
  /** Calendar days since price_verified_at, or null if never verified */
  price_age_days: number | null;
  /** Human-readable caution to show near the price, or null if clean */
  display_warning: string | null;
}

/** Verifications older than this many days are considered expired. */
const EXPIRY_DAYS = 7;

/**
 * Calculate the full price trust state for a single product.
 *
 * @param product             Product row fields (only the fields we need)
 * @param hasPendingDispute   True when ≥1 report with status="pending" exists
 * @param hasNeedsVerify      True when ≥1 report with status="needs_verification" exists
 */
export function calculatePriceTrust(
  product: {
    data_quality_status?: string | null;
    price_verified_at?: string | null;
  },
  hasPendingDispute  = false,
  hasNeedsVerify     = false
): PriceTrust {
  const status     = product.data_quality_status ?? "demo";
  const verifiedAt = product.price_verified_at ?? null;

  // ── Age calculation ───────────────────────────────────────────────────────
  let price_age_days: number | null = null;
  let is_price_expired               = false;

  if (verifiedAt) {
    const ageMs   = Date.now() - new Date(verifiedAt).getTime();
    price_age_days = Math.floor(ageMs / 86_400_000); // ms → days
    if (status === "manually_verified") {
      is_price_expired = price_age_days > EXPIRY_DAYS;
    }
  }

  // ── Base trust from data_quality_status ──────────────────────────────────
  let trust_state:   TrustState;
  let trust_level:   TrustLevel;
  let trust_label:   string;
  let display_warning: string | null = null;

  switch (status) {
    case "manually_verified":
      if (is_price_expired) {
        trust_state     = "expired";
        trust_level     = "medium";
        trust_label     = "Verification expired";
        display_warning = "Price was verified but may have changed — confirm before buying.";
      } else {
        trust_state = "verified";
        trust_level = "high";
        trust_label = "Verified price";
      }
      break;

    case "live_feed":
      trust_state = "live";
      trust_level = "high";
      trust_label = "Live price";
      break;

    case "stale":
      trust_state     = "expired";
      trust_level     = "low";
      trust_label     = "Verification expired";
      display_warning = "Price data is stale — confirm in-store before buying.";
      is_price_expired = true;
      break;

    case "needs_review":
      trust_state = "needs_review";
      trust_level = "medium";
      trust_label = "Needs review";
      break;

    case "user_submitted":
      trust_state = "needs_review";
      trust_level = "medium";
      trust_label = "User-submitted price";
      break;

    case "demo":
    default:
      trust_state = "sample";
      trust_level = "low";
      trust_label = "Sample data · price may vary";
      break;
  }

  // ── Dispute override (highest priority) ──────────────────────────────────
  // A pending user dispute always overrides base trust regardless of quality.
  if (hasPendingDispute) {
    trust_state     = "disputed";
    trust_level     = "disputed";
    trust_label     = "Recently disputed";
    display_warning = "Recently disputed by a shopper — confirm before buying.";
  } else if (hasNeedsVerify && (trust_state === "verified" || trust_state === "live")) {
    // Mild flag: don't fully downgrade, but note the review request.
    trust_state     = "needs_review";
    trust_level     = "medium";
    trust_label     = "Needs review";
    display_warning = "A shopper has flagged this price for review.";
  }

  return {
    trust_label,
    trust_level,
    trust_state,
    is_price_expired,
    has_pending_dispute: hasPendingDispute,
    price_age_days,
    display_warning,
  };
}
