/**
 * Freshness engine.
 *
 * Computes an EFFECTIVE freshness state and (where decay applies) an effective
 * trust label — WITHOUT ever overwriting the offer's stored priceTrustLabel. The
 * original label is preserved for auditability; the effective state is derived on
 * read so ranking and UI reflect real freshness.
 */

import type { ProductOffer, PriceTrustLabel } from "./model";

export type FreshnessState =
  | "fresh"        // within its freshness window
  | "aging"        // usable but past a soft warning threshold
  | "stale"        // past its hard freshness window — verify before relying
  | "expired"      // dated offer past validUntil
  | "unpublished"  // not yet approved/published (e.g. user-submitted)
  | "unavailable"; // no usable price

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export interface FreshnessConfig {
  verifiedLiveTtlMs: number;      // default 6h when no provider rule
  recentlyObservedTtlMs: number;  // electronics: 24h
  manualAdminWarnMs: number;      // warning after 7d
}

export const DEFAULT_FRESHNESS: FreshnessConfig = {
  verifiedLiveTtlMs: 6 * HOUR,
  recentlyObservedTtlMs: 24 * HOUR,
  manualAdminWarnMs: 7 * DAY,
};

export interface FreshnessResult {
  state: FreshnessState;
  /** Effective label to display/rank with (may downgrade to "stale"); original is untouched. */
  effectiveTrustLabel: PriceTrustLabel;
  originalTrustLabel: PriceTrustLabel;
  ageMs: number;
  ageHours: number;
  expired: boolean;
  reason: string;
}

function parse(ts: string | null | undefined): number | null {
  if (!ts) return null;
  const t = Date.parse(ts);
  return Number.isFinite(t) ? t : null;
}

/**
 * Derive the effective freshness of an offer at time `nowMs`. Pure.
 */
export function computeEffectiveFreshness(
  offer: Pick<ProductOffer, "priceTrustLabel" | "sourceObservedAt" | "validUntil" | "reviewStatus" | "published">,
  nowMs: number,
  config: FreshnessConfig = DEFAULT_FRESHNESS,
): FreshnessResult {
  const original = offer.priceTrustLabel;
  const observed = parse(offer.sourceObservedAt);
  const ageMs = observed == null ? Number.POSITIVE_INFINITY : Math.max(0, nowMs - observed);
  const ageHours = Number.isFinite(ageMs) ? Math.round((ageMs / HOUR) * 10) / 10 : Infinity;
  const validUntil = parse(offer.validUntil);
  const pastValidUntil = validUntil != null && nowMs > validUntil;

  const result = (state: FreshnessState, effective: PriceTrustLabel, reason: string): FreshnessResult =>
    ({ state, effectiveTrustLabel: effective, originalTrustLabel: original, ageMs, ageHours, expired: pastValidUntil, reason });

  // Terminal / non-decaying states first.
  if (original === "unavailable") return result("unavailable", "unavailable", "Marked unavailable.");
  if (original === "user_submitted" && offer.reviewStatus !== "approved") {
    return result("unpublished", "user_submitted", "User-submitted — unpublished until reviewed.");
  }
  if (original === "stale") return result("stale", "stale", "Already flagged stale.");

  switch (original) {
    case "catalogue_special": {
      if (pastValidUntil) return result("expired", "stale", "Catalogue special past its valid-until date.");
      return result("fresh", "catalogue_special", validUntil ? "Valid until its end date." : "Catalogue special.");
    }
    case "verified_live": {
      const ttl = validUntil != null ? Math.max(0, validUntil - (observed ?? nowMs)) : config.verifiedLiveTtlMs;
      if (ageMs > ttl) return result("stale", "stale", "Verified-live price is past its freshness window.");
      return result("fresh", "verified_live", "Within the verified-live window.");
    }
    case "recently_observed": {
      if (ageMs > config.recentlyObservedTtlMs) return result("stale", "stale", "Observed more than 24h ago (electronics).");
      if (ageMs > config.recentlyObservedTtlMs * 0.75) return result("aging", "recently_observed", "Approaching the 24h freshness limit.");
      return result("fresh", "recently_observed", "Recently observed.");
    }
    case "manual_admin": {
      if (ageMs > config.manualAdminWarnMs) return result("aging", "manual_admin", "Manual entry older than 7 days — re-verify.");
      return result("fresh", "manual_admin", "Manually entered from a cited source.");
    }
    case "user_submitted":
      // approved user submission — treat as recently observed for decay
      if (ageMs > config.recentlyObservedTtlMs) return result("stale", "stale", "Approved user submission is now stale.");
      return result("fresh", "user_submitted", "Approved user submission.");
    default:
      return result("fresh", original, "No decay rule; treated as current.");
  }
}

/** Convenience: is this offer stale/expired/unavailable/unpublished at `nowMs`? */
export function isEffectivelyStale(
  offer: Parameters<typeof computeEffectiveFreshness>[0],
  nowMs: number,
  config?: FreshnessConfig,
): boolean {
  const s = computeEffectiveFreshness(offer, nowMs, config).state;
  return s === "stale" || s === "expired" || s === "unavailable";
}

/** Human-friendly relative age, e.g. "3 hours ago". */
export function relativeAge(observedAt: string, nowMs: number): string {
  const t = parse(observedAt);
  if (t == null) return "unknown time";
  const ms = Math.max(0, nowMs - t);
  const mins = Math.round(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? "" : "s"} ago`;
  const days = Math.round(hrs / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}
