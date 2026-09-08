/**
 * Deterministic publication policy.
 *
 * A separate gate between "approved data" and "publishable / assistant-visible".
 * It returns explicit blockers + warnings. A blocker is NEVER silently downgraded
 * to a warning.
 */

import type { PublicationDecision, ConflictState, SourceAccessPolicy, ConfidenceDimensions, GeographicScope } from "./types";
import type { AvailabilityStatus, PriceTrustLabel, ReviewStatus } from "@/lib/ingestion/model";

const DAY = 86_400_000;
export const DEFAULT_STALE_POLICY_MS = 30 * DAY;
const UPCOMING_EXPIRY_MS = 3 * DAY;
const LOW_CONFIDENCE = 0.4;

export interface PublicationContext {
  reviewStatus: ReviewStatus;
  evidenceIds: string[];
  policy: SourceAccessPolicy | undefined;
  finalTrustLabel: PriceTrustLabel | null;
  availabilityStatus: AvailabilityStatus;
  geographicScope: GeographicScope;
  conflictState: ConflictState;
  sourceUrl: string | null;
  observedAt: string;
  expiresAt: string | null;
  confidence?: ConfidenceDimensions | null;
  liveVerificationSupported?: boolean;
  nowMs: number;
  stalePolicyMs?: number;
}

export function evaluatePublication(ctx: PublicationContext): PublicationDecision {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const stalePolicyMs = ctx.stalePolicyMs ?? DEFAULT_STALE_POLICY_MS;

  // ── Blockers ──
  if (ctx.reviewStatus !== "approved") blockers.push("not_approved");
  if (ctx.evidenceIds.length === 0) blockers.push("missing_evidence");
  if (ctx.policy?.automationStatus === "blocked") blockers.push("source_policy_blocked");
  if (!ctx.sourceUrl?.trim()) blockers.push("missing_source_reference");

  const expiresMs = ctx.expiresAt ? Date.parse(ctx.expiresAt) : null;
  if (expiresMs != null && Number.isFinite(expiresMs) && expiresMs < ctx.nowMs) blockers.push("expired");

  const observedMs = Date.parse(ctx.observedAt);
  const ageMs = Number.isFinite(observedMs) ? ctx.nowMs - observedMs : Infinity;
  if (ageMs > stalePolicyMs) blockers.push("stale_beyond_policy");

  if (ctx.conflictState === "conflict_detected") blockers.push("unresolved_conflict");
  if (ctx.finalTrustLabel === "conflict_detected") blockers.push("trust_conflict_detected");
  if (ctx.availabilityStatus === "unavailable") blockers.push("availability_unavailable");
  if (ctx.finalTrustLabel === "verified_live" && !ctx.liveVerificationSupported) blockers.push("verified_live_requirements_not_met");

  // ── Warnings (only surfaced; never replace a blocker) ──
  if (ctx.availabilityStatus === "unknown") warnings.push("availability_unknown");
  if (ctx.geographicScope === "online_only") warnings.push("online_only");
  if (ctx.geographicScope !== "branch") warnings.push("branch_not_confirmed");
  if (ctx.finalTrustLabel === "manual_admin") warnings.push("manual_admin_data");
  if (ctx.confidence) {
    for (const [k, v] of Object.entries(ctx.confidence)) if (v > 0 && v < LOW_CONFIDENCE) warnings.push(`low_confidence:${k}`);
  }
  if (expiresMs != null && Number.isFinite(expiresMs) && expiresMs >= ctx.nowMs && expiresMs - ctx.nowMs <= UPCOMING_EXPIRY_MS) warnings.push("upcoming_expiry");

  return { eligible: blockers.length === 0, blockers, warnings };
}
