/**
 * Admin Review Assistant Bot
 *
 * Sprint 9C · MallMind Navigator
 *
 * Synthesises the outputs of the Data Guardian, Source Research Bot, and
 * Duplicate Detection Bot into a single prioritised admin action summary.
 *
 * Deterministic — pure function, no external calls, no DB reads.
 */

import type { BotOutputBase, BotRiskLevel, LiveDataActionSafety } from "./types.js";
import type { DataGuardianResult }      from "../dataGuardianService.js";
import type { SourceResearchResult }    from "./sourceResearchBot.js";
import type { DuplicateDetectionResult } from "./duplicateDetectionBot.js";
import type { FindingExtractorResult }  from "./findingExtractorBot.js";
import type { TrustPolicyResult }       from "../dataTrustPolicy.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export type AdminActionPriority = "critical" | "high" | "medium" | "low";

export interface AdminReviewAction {
  priority:     AdminActionPriority;
  action_label: string;
  description:  string;
}

export interface AdminReviewAssistantInput {
  guardian_result?:    DataGuardianResult;
  source_result?:      SourceResearchResult;
  duplicate_result?:   DuplicateDetectionResult;
  extractor_result?:   FindingExtractorResult;
  /** Sprint 9G: policy engine result — used for conflict_risk, trust_state, blocked_actions */
  policy_result?:      TrustPolicyResult;
}

export interface AdminReviewAssistantResult extends BotOutputBase {
  overall_risk:          BotRiskLevel;
  recommended_actions:   AdminReviewAction[];
  summary_for_admin:     string;
  confidence_score:      number;
  trust_level?:          string;
  /** Sprint 9G: 12-state trust state from the policy engine */
  trust_state?:          string;
  safe_to_proceed:       boolean;
  blocker_reasons:       string[];
  /** Sprint 9G: policy engine result passed through for UI display */
  policy_result?:        TrustPolicyResult;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function maxRisk(...levels: (BotRiskLevel | undefined)[]): BotRiskLevel {
  const order: BotRiskLevel[] = ["low", "medium", "high", "critical"];
  let max = 0;
  for (const level of levels) {
    if (!level) continue;
    const idx = order.indexOf(level);
    if (idx > max) max = idx;
  }
  return order[max];
}

// ── Main export ───────────────────────────────────────────────────────────────

export function runAdminReviewAssistantBot(
  input: AdminReviewAssistantInput
): AdminReviewAssistantResult {
  const now = new Date().toISOString();

  const { guardian_result, source_result, duplicate_result, extractor_result, policy_result } = input;

  const actions:         AdminReviewAction[] = [];
  const blockerReasons:  string[]            = [];
  const reasoning:       string[]            = [];

  // ── 0. Policy engine signals (Sprint 9G) ──────────────────────────────────
  if (policy_result) {
    reasoning.push(
      `Policy engine: trust_state=${policy_result.trust_state}, ` +
      `conflict_risk=${policy_result.conflict_risk}, ` +
      `freshness=${policy_result.freshness_state}, ` +
      `manual_review_priority=${policy_result.manual_review_priority}.`
    );

    // Dispute → critical block
    if (policy_result.trust_state === "disputed") {
      blockerReasons.push(`Data is disputed — ${policy_result.conflict_risk} conflict risk. Resolve before proceeding.`);
      actions.push({
        priority:     "critical",
        action_label: "Resolve data dispute before proceeding",
        description:  `Conflicting reports exist (conflict risk: ${policy_result.conflict_risk}). Data must not be applied to live records until the dispute is resolved.`,
      });
    }

    // Stale data warning
    if (policy_result.trust_state === "stale" || policy_result.freshness_state === "stale") {
      actions.push({
        priority:     "high",
        action_label: "Re-verify — data is stale",
        description:  `${policy_result.safe_badge}. Data has exceeded its freshness window. Collect a new observation before applying.`,
      });
    }

    // Urgent review priority from policy engine
    if (policy_result.manual_review_priority === "urgent" && policy_result.trust_state !== "disputed") {
      actions.push({
        priority:     "high",
        action_label: "Urgent admin review required",
        description:  policy_result.reasoning_summary,
      });
    }

    // Blocked actions list from policy engine
    if (policy_result.blocked_actions.includes("apply_to_live_data") &&
        policy_result.trust_state !== "disputed" &&
        policy_result.trust_state !== "stale") {
      reasoning.push(`Policy engine blocks live data apply — trust state '${policy_result.trust_state}' is below admin_verified.`);
    }
  }

  // ── 1. Source restriction check ───────────────────────────────────────────
  if (source_result?.is_restricted) {
    blockerReasons.push(`Restricted source: ${source_result.restriction_reason ?? "policy violation"}`);
    actions.push({
      priority:     "critical",
      action_label: "Reject submission — restricted source",
      description:  `The source violates MallMind policy (${source_result.restriction_reason}). Do not process this submission further.`,
    });
    reasoning.push("Source Research Bot flagged a POLICY VIOLATION — submission must be rejected.");

    return {
      bot_name:                  "AdminReviewAssistantBot",
      processed_at:              now,
      risk_level:                "critical",
      recommendation:            "reject",
      live_data_action_safety:   "blocked_by_policy",
      must_not_update_live_data: true,
      reasoning,
      overall_risk:              "critical",
      recommended_actions:       actions,
      summary_for_admin:         `BLOCKED: ${source_result.restriction_reason ?? "Restricted source detected."}`,
      confidence_score:          0,
      trust_level:               guardian_result?.trust_level,
      safe_to_proceed:           false,
      blocker_reasons:           blockerReasons,
    };
  }

  // ── 2. Data Guardian signals ──────────────────────────────────────────────
  let confidenceScore = 0;
  let trustLevel: string | undefined;

  if (guardian_result) {
    confidenceScore = guardian_result.confidence_score;
    trustLevel      = guardian_result.trust_level;

    if (guardian_result.recommended_action === "reject") {
      blockerReasons.push("Data Guardian: insufficient content/evidence to process.");
      actions.push({
        priority:     "high",
        action_label: "Reject submission",
        description:  "Data Guardian found no content or evidence. Ask the submitter to provide more information.",
      });
    } else if (guardian_result.recommended_action === "needs_more_info") {
      actions.push({
        priority:     "high",
        action_label: "Request more information",
        description:  `Missing evidence: ${guardian_result.missing_evidence.join("; ")}.`,
      });
    } else if (guardian_result.recommended_action === "create_finding") {
      actions.push({
        priority:     "medium",
        action_label: "Create pending finding",
        description:  `Confidence ${confidenceScore}% — create a pending finding for future admin review.`,
      });
    } else if (guardian_result.recommended_action === "approve_for_admin_review") {
      actions.push({
        priority:     "medium",
        action_label: "Review and approve finding",
        description:  `Source-matched or admin-verified (${confidenceScore}% confidence). Ready for admin sign-off.`,
      });
    } else if (guardian_result.recommended_action === "apply_to_existing_record") {
      actions.push({
        priority:     "low",
        action_label: "Prepare live data apply plan",
        description:  `High-trust data (${confidenceScore}%) — eligible for a live data apply plan after dedup check.`,
      });
    }

    reasoning.push(`Guardian: trust_level=${trustLevel}, confidence=${confidenceScore}%, action=${guardian_result.recommended_action}.`);
  } else {
    reasoning.push("No Data Guardian result provided — confidence assessment unavailable.");
  }

  // ── 3. Source Research signals ────────────────────────────────────────────
  if (source_result) {
    reasoning.push(`Source: category=${source_result.source_category}, trust_ceiling=${source_result.trust_ceiling}.`);
    if (source_result.quality_flags.length) {
      actions.push({
        priority:     "medium",
        action_label: "Review source quality flags",
        description:  source_result.quality_flags.join("; "),
      });
    }
  }

  // ── 4. Duplicate Detection signals ────────────────────────────────────────
  if (duplicate_result) {
    reasoning.push(`Duplicates: found=${duplicate_result.duplicates_found}, dedup_recommendation=${duplicate_result.dedup_recommendation}.`);

    if (duplicate_result.dedup_recommendation === "link_to_existing" && duplicate_result.top_candidate) {
      const top = duplicate_result.top_candidate;
      actions.push({
        priority:     top.match_strength === "exact" ? "high" : "medium",
        action_label: top.match_strength === "exact"
          ? "Link to existing record (exact duplicate)"
          : "Possible duplicate — review before creating",
        description:  `Matched "${top.matched_name}" in ${top.matched_table} (score: ${top.match_score}%). ${top.overlap_reason}.`,
      });
    } else if (duplicate_result.dedup_recommendation === "needs_human_review") {
      actions.push({
        priority:     "medium",
        action_label: "Review duplicate candidates",
        description:  `${duplicate_result.duplicates_found} candidate(s) found. Manual comparison needed.`,
      });
    }
  }

  // ── 5. Extractor signals ──────────────────────────────────────────────────
  if (extractor_result) {
    reasoning.push(`Extractor: signals_found=${extractor_result.total_signals_found}, types=${extractor_result.finding_types_detected.join(",")}.`);
    if (extractor_result.total_signals_found === 0) {
      actions.push({
        priority:     "medium",
        action_label: "Manual data entry required",
        description:  "Finding Extractor could not parse structured data from the raw text. Admin must enter field values manually.",
      });
    }
  }

  // ── 6. Low confidence soft block ─────────────────────────────────────────
  if (confidenceScore > 0 && confidenceScore < 40 && !blockerReasons.length) {
    actions.push({
      priority:     "high",
      action_label: "Gather more evidence before proceeding",
      description:  `Confidence is only ${confidenceScore}%. Request supporting evidence (photo, receipt, official source) before creating a finding.`,
    });
  }

  // ── 7. Sort actions by priority ───────────────────────────────────────────
  const priorityOrder: Record<AdminActionPriority, number> = {
    critical: 0, high: 1, medium: 2, low: 3,
  };
  actions.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

  // ── 8. Overall risk ───────────────────────────────────────────────────────
  const overallRisk = maxRisk(
    guardian_result  ? (guardian_result.confidence_score < 40 ? "high" : "medium") : undefined,
    source_result?.risk_level,
    duplicate_result?.risk_level,
    extractor_result?.risk_level,
  );

  const safeToProceed = blockerReasons.length === 0 && overallRisk !== "critical";

  const hasCritical = actions.some((a) => a.priority === "critical");
  const recommendation = hasCritical ? "reject"
    : actions.some((a) => a.priority === "high") ? "needs_admin_review"
    : safeToProceed ? "proceed_with_caution"
    : "needs_admin_review";

  const safety: LiveDataActionSafety = hasCritical ? "blocked_by_policy"
    : safeToProceed ? "requires_review"
    : "do_not_apply";

  // ── 9. Summary ────────────────────────────────────────────────────────────
  const summaryParts: string[] = [];
  if (trustLevel)       summaryParts.push(`Trust: ${trustLevel}`);
  if (confidenceScore)  summaryParts.push(`Confidence: ${confidenceScore}%`);
  if (duplicate_result) summaryParts.push(`Duplicates: ${duplicate_result.duplicates_found}`);
  summaryParts.push(`Actions: ${actions.length}`);

  const summaryForAdmin = blockerReasons.length
    ? `BLOCKED — ${blockerReasons.join("; ")}.`
    : `${summaryParts.join(" · ")}. ${actions[0]?.action_label ?? "No actions required."}.`;

  return {
    bot_name:                  "AdminReviewAssistantBot",
    processed_at:              now,
    risk_level:                overallRisk,
    recommendation,
    live_data_action_safety:   safety,
    must_not_update_live_data: !safeToProceed,
    reasoning,
    overall_risk:              overallRisk,
    recommended_actions:       actions,
    summary_for_admin:         summaryForAdmin,
    confidence_score:          confidenceScore,
    trust_level:               trustLevel,
    trust_state:               policy_result?.trust_state,
    safe_to_proceed:           safeToProceed,
    blocker_reasons:           blockerReasons,
    policy_result,
  };
}
