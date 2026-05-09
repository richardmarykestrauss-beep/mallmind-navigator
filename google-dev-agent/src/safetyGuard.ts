/**
 * safetyGuard.ts
 *
 * Hardcoded safety checks that run BEFORE any agent action.
 * These checks are pure TypeScript — they do not call Gemini or any external service.
 * They cannot be overridden by prompt content or task instructions.
 *
 * If checkSafety returns safe: false, the agent must stop immediately.
 */

// ── Allowed task types ────────────────────────────────────────────────────────

export const ALLOWED_TASK_TYPES = ["VERIFY_BACKEND_DEV"] as const;
export type TaskType = (typeof ALLOWED_TASK_TYPES)[number];

// ── Blocked patterns ──────────────────────────────────────────────────────────
// Any instruction containing these strings is rejected.
// This list is intentionally broad for the MVP — false positives are fine;
// false negatives (missing a dangerous instruction) are not.

const BLOCKED_INSTRUCTION_PATTERNS: string[] = [
  // Payment / financial features (compliance-blocked)
  "wallet",
  "payment",
  "p2p",
  "peer-to-peer",
  "transfer",
  "balance",
  "crypto",
  "bnpl",
  "buy now pay later",
  "cash-out",
  "cashout",
  "withdraw",
  "deposit",
  "escrow",
  "refund",
  "chargeback",

  // Destructive database operations
  "drop table",
  "truncate",
  "delete from",
  "destroy",
  "wipe",
  "nuke",

  // Infrastructure mutations
  "change iam",
  "update iam",
  "grant role",
  "revoke role",
  "change billing",
  "update billing",
  "delete secret",
  "rotate secret",
  "change secret",

  // Production targets
  "deploy production",
  "deploy prod",
  "push to main",
  "merge to main",
  "push main",
  "force push",
  "production database",
  "prod database",
];

// ── File path patterns the agent must never touch ─────────────────────────────
// Even if code-editing is added in a future version, these paths are blocked.

export const BLOCKED_FILE_PATTERNS: RegExp[] = [
  /wallet/i,
  /payment/i,
  /p2p/i,
  /\.env$/,
  /\.env\./,
  /secret/i,
  /credential/i,
  /cloudbuild\.yaml$/,
  /Dockerfile$/,
  /iam/i,
  /billing/i,
];

// ── Result types ──────────────────────────────────────────────────────────────

export interface SafetyResult {
  safe: boolean;
  reason?: string;
  blockedPatterns?: string[];
  blockedTaskType?: string;
}

// ── Main check ────────────────────────────────────────────────────────────────

export function checkSafety(taskType: string, instruction?: string): SafetyResult {
  // 1. Task type must be on the allowed list
  if (!ALLOWED_TASK_TYPES.includes(taskType as TaskType)) {
    return {
      safe: false,
      blockedTaskType: taskType,
      reason:
        `Task type "${taskType}" is not in the allowed list for this agent version. ` +
        `Allowed types: ${ALLOWED_TASK_TYPES.join(", ")}. ` +
        `To add new task types, update the ALLOWED_TASK_TYPES list and redeploy.`,
    };
  }

  // 2. Instruction must not contain blocked patterns
  if (instruction) {
    const lower = instruction.toLowerCase();
    const found = BLOCKED_INSTRUCTION_PATTERNS.filter((p) => lower.includes(p));
    if (found.length > 0) {
      return {
        safe: false,
        blockedPatterns: found,
        reason:
          `Instruction contains ${found.length} blocked pattern(s): ${found.map((p) => `"${p}"`).join(", ")}. ` +
          `This task requires a compliance review before it can be automated. ` +
          `See docs/wallet-payments-compliance-plan.md.`,
      };
    }
  }

  return { safe: true };
}

// ── File path check (used by future code-editing modules) ────────────────────

export function isFilePathAllowed(filePath: string): { allowed: boolean; reason?: string } {
  for (const pattern of BLOCKED_FILE_PATTERNS) {
    if (pattern.test(filePath)) {
      return {
        allowed: false,
        reason: `File path "${filePath}" matches blocked pattern ${pattern}. This file cannot be modified by the agent.`,
      };
    }
  }
  return { allowed: true };
}

// ── Log-safe summary ──────────────────────────────────────────────────────────

export function summariseSafetyResult(result: SafetyResult): string {
  if (result.safe) return "✅ Safety check passed.";
  return [
    "🚫 Safety check FAILED — agent stopped.",
    `   Reason: ${result.reason}`,
    result.blockedPatterns?.length
      ? `   Blocked patterns: ${result.blockedPatterns.join(", ")}`
      : "",
    result.blockedTaskType
      ? `   Blocked task type: ${result.blockedTaskType}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}
