/**
 * Live Data Apply Planner Bot
 *
 * Sprint 9C · MallMind Navigator
 *
 * Proposes a field-level patch plan for applying a finding to live data.
 * NEVER writes to the database. The plan is a proposal only — an admin
 * must review it and take an explicit apply action.
 *
 * Deterministic — pure function, no external calls, no DB writes.
 */

import type { BotOutputBase, LiveDataActionSafety } from "./types.js";
import type { TrustState } from "../dataTrustPolicy.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export type PlanTargetTable = "shops" | "products" | "mall_nodes" | "none";

export interface FieldPatch {
  field:         string;
  proposed_value: unknown;
  current_value?: unknown;
  confidence:    number;  // 0–100
  notes?:        string;
}

export interface LiveDataApplyPlannerInput {
  finding_type:  "shop" | "product" | "price" | "trading_hours" | "floor_layout" | "promotion" | "other";
  trust_level:   string;
  confidence_score: number;
  structured_data: Record<string, unknown>;
  target_record_id?: string;  // Existing DB record to patch, if known
  mall_id?: string;
  /**
   * Sprint 9G: 12-state trust state from the Data Trust Policy engine.
   * If provided, states stale / disputed / rejected / raw / reported /
   * evidence_submitted / source_matched block plan generation regardless
   * of the trust_level value.
   */
  trust_state?: TrustState | string;
}

export interface LiveDataApplyPlannerResult extends BotOutputBase {
  target_table:    PlanTargetTable;
  target_record_id?: string;
  proposed_patches: FieldPatch[];
  fields_skipped:   string[];
  plan_summary:     string;
  plan_blocked:     boolean;
  block_reason?:    string;
}

// ── Field maps per finding type ───────────────────────────────────────────────
// Only these fields are allowed in a live data patch plan.
// Prevents accidental inclusion of sensitive or system-managed fields.

const SHOP_ALLOWED_FIELDS = new Set([
  "name", "floor", "unit_number", "category",
  "opening_time", "closing_time", "phone", "email", "website",
]);

const PRODUCT_ALLOWED_FIELDS = new Set([
  "name", "brand", "price", "is_on_special",
  "original_price", "special_price", "category", "description",
]);

const MALL_NODES_ALLOWED_FIELDS = new Set([
  "name", "floor", "type", "x", "y",
]);

// ── Trust level gate ──────────────────────────────────────────────────────────
// A plan can only be proposed at admin_verified (4) or above.

const TRUST_RANK: Record<string, number> = {
  demo:               0,
  user_submitted:     1,
  evidence_submitted: 2,
  source_matched:     3,
  admin_verified:     4,
  physically_verified: 5,
  retailer_verified:  6,
  mall_verified:      7,
};

function trustRank(level: string): number {
  return TRUST_RANK[level] ?? 0;
}

// ── Determine target table ────────────────────────────────────────────────────

function targetTable(findingType: LiveDataApplyPlannerInput["finding_type"]): PlanTargetTable {
  switch (findingType) {
    case "shop":          return "shops";
    case "product":
    case "price":
    case "promotion":     return "products";
    case "floor_layout":  return "mall_nodes";
    default:              return "none";
  }
}

// ── Build field patches ───────────────────────────────────────────────────────

function buildPatches(
  table: PlanTargetTable,
  structured_data: Record<string, unknown>,
  confidence_score: number,
): { patches: FieldPatch[]; skipped: string[] } {
  const patches: FieldPatch[]   = [];
  const skipped: string[]       = [];

  let allowedFields: Set<string>;
  switch (table) {
    case "shops":       allowedFields = SHOP_ALLOWED_FIELDS;     break;
    case "products":    allowedFields = PRODUCT_ALLOWED_FIELDS;  break;
    case "mall_nodes":  allowedFields = MALL_NODES_ALLOWED_FIELDS; break;
    default:            return { patches: [], skipped: Object.keys(structured_data) };
  }

  for (const [key, value] of Object.entries(structured_data)) {
    if (!allowedFields.has(key)) {
      skipped.push(key);
      continue;
    }
    if (value === null || value === undefined || value === "") {
      skipped.push(`${key} (empty value)`);
      continue;
    }

    let fieldConfidence = confidence_score;
    let notes: string | undefined;

    // Price fields get a slight confidence penalty — prices change frequently
    if (key === "price" || key === "special_price" || key === "original_price") {
      fieldConfidence = Math.max(fieldConfidence - 5, 0);
      notes = "Price fields decay quickly — verify date observed is recent.";
    }
    // Promotion fields expire
    if (key === "is_on_special") {
      notes = "Check promotion expiry date before applying.";
    }

    patches.push({
      field:          key,
      proposed_value: value,
      confidence:     fieldConfidence,
      notes,
    });
  }

  return { patches, skipped };
}

// ── Main export ───────────────────────────────────────────────────────────────

export function runLiveDataApplyPlannerBot(
  input: LiveDataApplyPlannerInput
): LiveDataApplyPlannerResult {
  const now   = new Date().toISOString();
  const table = targetTable(input.finding_type);

  // ── Gate: policy trust_state (Sprint 9G) ─────────────────────────────────
  // States that are ALWAYS blocked regardless of trust_level value:
  const POLICY_BLOCKED_STATES = new Set<string>([
    "stale", "disputed", "rejected",
    "raw", "reported", "evidence_submitted", "source_matched", "community_supported",
  ]);

  if (input.trust_state && POLICY_BLOCKED_STATES.has(input.trust_state)) {
    const blockReason =
      `Trust state "${input.trust_state}" is not eligible for a live data apply plan. ` +
      `Required: admin_verified, physically_verified, retailer_verified, or mall_verified. ` +
      (input.trust_state === "stale"    ? "Data has expired its freshness window — re-verify first." :
       input.trust_state === "disputed" ? "Conflicting reports must be resolved before applying." :
       input.trust_state === "rejected" ? "This submission was rejected." :
       "Elevate trust level before generating a patch plan.");

    return {
      bot_name:                  "LiveDataApplyPlannerBot",
      processed_at:              now,
      risk_level:                input.trust_state === "disputed" ? "critical" : "high",
      recommendation:            "reject",
      live_data_action_safety:   input.trust_state === "disputed" ? "blocked_by_policy" : "do_not_apply",
      must_not_update_live_data: true,
      reasoning:                 [blockReason],
      target_table:              table,
      target_record_id:          input.target_record_id,
      proposed_patches:          [],
      fields_skipped:            Object.keys(input.structured_data),
      plan_summary:              `BLOCKED — ${blockReason}`,
      plan_blocked:              true,
      block_reason:              blockReason,
    };
  }

  // ── Gate: minimum trust level ────────────────────────────────────────────
  if (trustRank(input.trust_level) < 4) {
    const blockReason =
      `Trust level "${input.trust_level}" is below the minimum threshold for a live data apply plan. ` +
      `Minimum required: admin_verified (level 4). Current rank: ${trustRank(input.trust_level)}.`;

    return {
      bot_name:                  "LiveDataApplyPlannerBot",
      processed_at:              now,
      risk_level:                "high",
      recommendation:            "reject",
      live_data_action_safety:   "do_not_apply",
      must_not_update_live_data: true,
      reasoning:                 [blockReason],
      target_table:              table,
      target_record_id:          input.target_record_id,
      proposed_patches:          [],
      fields_skipped:            Object.keys(input.structured_data),
      plan_summary:              `BLOCKED — ${blockReason}`,
      plan_blocked:              true,
      block_reason:              blockReason,
    };
  }

  // ── Gate: unknown target table ────────────────────────────────────────────
  if (table === "none") {
    const blockReason = `Finding type "${input.finding_type}" does not map to a supported live data table.`;
    return {
      bot_name:                  "LiveDataApplyPlannerBot",
      processed_at:              now,
      risk_level:                "medium",
      recommendation:            "needs_admin_review",
      live_data_action_safety:   "do_not_apply",
      must_not_update_live_data: true,
      reasoning:                 [blockReason],
      target_table:              "none",
      target_record_id:          input.target_record_id,
      proposed_patches:          [],
      fields_skipped:            Object.keys(input.structured_data),
      plan_summary:              `No target table — ${blockReason}`,
      plan_blocked:              true,
      block_reason:              blockReason,
    };
  }

  // ── Gate: no structured data ──────────────────────────────────────────────
  if (!input.structured_data || Object.keys(input.structured_data).length === 0) {
    const blockReason = "No structured_data provided — cannot generate a patch plan.";
    return {
      bot_name:                  "LiveDataApplyPlannerBot",
      processed_at:              now,
      risk_level:                "medium",
      recommendation:            "needs_admin_review",
      live_data_action_safety:   "do_not_apply",
      must_not_update_live_data: true,
      reasoning:                 [blockReason],
      target_table:              table,
      target_record_id:          input.target_record_id,
      proposed_patches:          [],
      fields_skipped:            [],
      plan_summary:              blockReason,
      plan_blocked:              true,
      block_reason:              blockReason,
    };
  }

  // ── Build patch plan ──────────────────────────────────────────────────────
  const { patches, skipped } = buildPatches(table, input.structured_data, input.confidence_score);

  if (!patches.length) {
    const blockReason = `All provided fields were filtered out (not in allowed field set for ${table}).`;
    return {
      bot_name:                  "LiveDataApplyPlannerBot",
      processed_at:              now,
      risk_level:                "medium",
      recommendation:            "needs_admin_review",
      live_data_action_safety:   "do_not_apply",
      must_not_update_live_data: true,
      reasoning:                 [blockReason, `Skipped fields: ${skipped.join(", ")}.`],
      target_table:              table,
      target_record_id:          input.target_record_id,
      proposed_patches:          [],
      fields_skipped:            skipped,
      plan_summary:              blockReason,
      plan_blocked:              true,
      block_reason:              blockReason,
    };
  }

  // ── Safety signal based on confidence ────────────────────────────────────
  const safety: LiveDataActionSafety =
    input.confidence_score >= 90 ? "safe_to_plan" : "requires_review";

  const reasoning: string[] = [
    `Trust level: ${input.trust_level} (rank ${trustRank(input.trust_level)}/7) — meets minimum threshold.`,
    `Confidence: ${input.confidence_score}%.`,
    `Target table: ${table}. ${patches.length} field(s) proposed.`,
    skipped.length ? `Skipped ${skipped.length} field(s) not in allowed set: ${skipped.join(", ")}.` : "All fields accepted.",
    "This is a PROPOSAL ONLY. An explicit admin apply action is required. No automatic updates occur.",
  ];

  const summary =
    `Proposed ${patches.length} patch(es) to ${table}` +
    (input.target_record_id ? ` (record ${input.target_record_id})` : " (new record)") +
    `. Trust: ${input.trust_level} · Confidence: ${input.confidence_score}%.` +
    " ADMIN APPLY ACTION REQUIRED — not automatic.";

  return {
    bot_name:                  "LiveDataApplyPlannerBot",
    processed_at:              now,
    risk_level:                input.confidence_score >= 90 ? "low" : "medium",
    recommendation:            "proceed_with_caution",
    live_data_action_safety:   safety,
    must_not_update_live_data: true, // Always true — even a safe plan requires explicit apply action
    reasoning,
    target_table:              table,
    target_record_id:          input.target_record_id,
    proposed_patches:          patches,
    fields_skipped:            skipped,
    plan_summary:              summary,
    plan_blocked:              false,
  };
}
