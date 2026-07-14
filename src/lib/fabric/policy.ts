/**
 * Source policy engine.
 *
 * Every source MUST have a policy before any adapter runs. There is NO silent
 * fallback to automation: if a policy is missing, the source is blocked, or the
 * requested mode is not permitted by both the policy's allow-list AND the
 * automation-status tier, execution is denied and the reason is surfaced.
 */

import type { AdapterMode, AutomationStatus, SourceAccessPolicy, PolicyDecision } from "./types";

/**
 * The widest set of modes each automation tier can EVER permit. The policy's
 * explicit `allowedModes` is intersected with this — a mode must clear both.
 * `manual_only` may only use manual + catalogue (manual snapshot) flows.
 */
const TIER_MODE_CAPS: Record<AutomationStatus, AdapterMode[]> = {
  blocked: [],
  manual_only: ["manual", "catalogue"],
  approved_public_observation: ["manual", "catalogue", "json_ld", "sitemap", "browser_observation"],
  authorized_feed: ["manual", "catalogue", "json_ld", "sitemap", "browser_observation", "merchant_feed", "newsletter"],
  authorized_api: ["manual", "catalogue", "json_ld", "sitemap", "browser_observation", "merchant_feed", "newsletter", "partner_api"],
};

/** Modes considered "automated" (i.e. not human-driven manual/catalogue capture). */
export const AUTOMATED_MODES: AdapterMode[] = ["partner_api", "merchant_feed", "json_ld", "sitemap", "newsletter", "browser_observation"];

export function tierPermits(status: AutomationStatus, mode: AdapterMode): boolean {
  return TIER_MODE_CAPS[status].includes(mode);
}

/**
 * Decide whether an adapter of `mode` may run against `policy`. Pure.
 * `policy` may be undefined (no policy registered) → always denied.
 */
export function evaluatePolicy(mode: AdapterMode, policy: SourceAccessPolicy | undefined): PolicyDecision {
  if (!policy) {
    return { allowed: false, reason: "no_policy", message: "No source access policy exists — adapter execution is blocked until a policy is defined.", requiresHumanReview: true };
  }
  if (policy.automationStatus === "blocked") {
    return { allowed: false, reason: "source_blocked", message: `Source ${policy.sourceId} is policy-blocked and cannot run any adapter.`, requiresHumanReview: true };
  }
  if (!policy.allowedModes.includes(mode)) {
    return { allowed: false, reason: "mode_not_allowed", message: `Adapter mode "${mode}" is not in this source's allowed modes (${policy.allowedModes.join(", ") || "none"}).`, requiresHumanReview: policy.requiresHumanReview };
  }
  if (!tierPermits(policy.automationStatus, mode)) {
    const hint = policy.automationStatus === "manual_only" ? " Manual-only sources may only use manual/catalogue capture." : "";
    return { allowed: false, reason: "tier_forbids_mode", message: `Automation status "${policy.automationStatus}" does not permit mode "${mode}".${hint}`, requiresHumanReview: true };
  }
  return { allowed: true, reason: "ok", message: "Adapter permitted by policy.", requiresHumanReview: policy.requiresHumanReview };
}

/** Convenience guard used by the runner. */
export function isExecutionAllowed(mode: AdapterMode, policy: SourceAccessPolicy | undefined): boolean {
  return evaluatePolicy(mode, policy).allowed;
}
