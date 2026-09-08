/**
 * Shared types for the MallMind Data Intelligence Bot Suite.
 *
 * Sprint 9C · MallMind Navigator
 *
 * All bots are deterministic — no external AI calls, no automatic live data
 * updates. Outputs are recommendations for admin review only.
 */

// ── Risk levels ───────────────────────────────────────────────────────────────

export type BotRiskLevel = "low" | "medium" | "high" | "critical";

// ── Recommendation actions ────────────────────────────────────────────────────

export type BotRecommendation =
  | "proceed"
  | "proceed_with_caution"
  | "needs_admin_review"
  | "reject"
  | "escalate";

// ── Live data action safety ───────────────────────────────────────────────────

export type LiveDataActionSafety =
  | "safe_to_plan"       // Admin may proceed to plan a live-data patch
  | "requires_review"    // More review needed before planning a patch
  | "do_not_apply"       // Data quality or trust is insufficient — block apply
  | "blocked_by_policy"; // Hard policy block (e.g. restricted source, Google Maps)

// ── Base fields shared by all bot outputs ─────────────────────────────────────

export interface BotOutputBase {
  /** Which bot produced this output */
  bot_name: string;
  /** ISO-8601 timestamp when the bot ran */
  processed_at: string;
  /** Overall risk the bot assigns to this submission */
  risk_level: BotRiskLevel;
  /** Top-level recommendation */
  recommendation: BotRecommendation;
  /** Whether it is safe to proceed with live data planning */
  live_data_action_safety: LiveDataActionSafety;
  /**
   * Structured explanation of how the bot reached its conclusion.
   * Human-readable, never shown directly to shoppers.
   */
  reasoning: string[];
  /**
   * HARD GUARANTEE — present on every bot output.
   * true  → output must NOT be used to update live shops/products/routes.
   * false → admin may proceed to the next review step (but must still
   *         take an explicit apply action — nothing is automatic).
   */
  must_not_update_live_data: boolean;
}
