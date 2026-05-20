/**
 * safetyGuard.ts
 *
 * Hardcoded safety checks that run BEFORE any agent action.
 * These checks are pure TypeScript — they do not call Gemini or any external service.
 * They cannot be overridden by prompt content or task instructions.
 *
 * Phase 2 additions:
 *   - IMPLEMENT_TASK added to ALLOWED_TASK_TYPES
 *   - ALLOWED_WRITE_GLOBS allowlist (positive match required for writes)
 *   - Extended BLOCKED_FILE_PATTERNS (config files, migrations, package.json)
 *   - isFilePathAllowed() now checks both allowlist AND blocklist
 *
 * If checkSafety returns safe: false, the agent must stop immediately.
 */

// ── Allowed task types ────────────────────────────────────────────────────────

export const ALLOWED_TASK_TYPES = ["VERIFY_BACKEND_DEV", "IMPLEMENT_TASK"] as const;
export type TaskType = (typeof ALLOWED_TASK_TYPES)[number];

// ── Allowed write globs (positive allowlist) ──────────────────────────────────
// A file path must match at least ONE of these patterns to be writable.
// Paths are relative to the repo root, forward-slash separated.

export const ALLOWED_WRITE_GLOBS: string[] = [
  "src/**/*.ts",
  "src/**/*.tsx",
  "google-cloud-backend/src/**/*.ts",
  "google-dev-agent/src/**/*.ts",
  "google-dev-agent/tasks/**/*.json",
];

// ── Blocked file patterns (negative blocklist) ────────────────────────────────
// Any file path matching one of these patterns cannot be read OR written.
// This is belt-and-suspenders: the allowlist is the primary guard for writes,
// the blocklist catches dangerous files that might slip through naming conventions.

export const BLOCKED_FILE_PATTERNS: RegExp[] = [
  // Payment / financial files
  /wallet/i,
  /payment/i,
  /p2p/i,

  // Secrets and credentials
  /\.env$/,
  /\.env\./,
  /secret/i,
  /credential/i,

  // Infrastructure — never touch
  /cloudbuild\.yaml$/i,
  /Dockerfile$/i,
  /iam/i,
  /billing/i,

  // Database migrations — SQL must be run by a human
  /supabase[/\\]migrations/i,
  /supabase[/\\]functions/i,

  // Build and tooling config — changes here affect the whole project
  /vite\.config\./i,
  /postcss\.config\./i,
  /tailwind\.config\./i,
  /eslint\.config\./i,
  /vitest\.config\./i,
  /tsconfig.*\.json$/i,

  // Package manifests — no automatic dependency changes
  /package\.json$/i,
  /package-lock\.json$/i,
  /yarn\.lock$/i,
  /pnpm-lock\.yaml$/i,
];

// ── Blocked instruction patterns ──────────────────────────────────────────────
// Any instruction containing these strings is rejected outright.

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

  // git / deployment automation
  "git commit",
  "git push",
  "git merge",
  "npm publish",
  "gcloud deploy",
  "supabase db push",
];

// ── Result types ──────────────────────────────────────────────────────────────

export interface SafetyResult {
  safe: boolean;
  reason?: string;
  blockedPatterns?: string[];
  blockedTaskType?: string;
}

export interface FilePathResult {
  allowed: boolean;
  reason?: string;
}

// ── Glob matcher ──────────────────────────────────────────────────────────────
// Supports: * (non-slash chars), ** (any path including slashes), ? (single char)
// All paths normalised to forward slashes before matching.
//
// Implementation note: glob wildcards are replaced with temporary null-byte
// placeholders BEFORE regex special-char escaping so the regex quantifiers
// inserted for `**` are never corrupted by the `*` → `[^/]*` substitution.

export function matchesGlob(filePath: string, pattern: string): boolean {
  const p = filePath.replace(/\\/g, "/");
  const g = pattern.replace(/\\/g, "/");

  // Step 1: replace glob wildcards with NUL-byte placeholders (safe — paths
  //         never contain NUL bytes, so there is no collision risk).
  const DS = "\x00ds\x00"; // placeholder for **/
  const D  = "\x00d\x00";  // placeholder for **
  const S  = "\x00s\x00";  // placeholder for *
  const Q  = "\x00q\x00";  // placeholder for ?

  let r = g
    .replace(/\*\*\//g, DS)  // **/ first (more specific)
    .replace(/\*\*/g,   D)   // then **
    .replace(/\*/g,     S)   // then single *
    .replace(/\?/g,     Q);  // then ?

  // Step 2: escape all regex special chars in what remains (literal path chars)
  r = r.replace(/[.+^${}()|[\]\\]/g, "\\$&");

  // Step 3: expand placeholders into their regex equivalents
  r = r
    .replace(/\x00ds\x00/g, "(?:[^/]+/)*") // **/ → zero-or-more dir segments
    .replace(/\x00d\x00/g,  ".*")           // **  → anything
    .replace(/\x00s\x00/g,  "[^/]*")        // *   → non-slash chars
    .replace(/\x00q\x00/g,  "[^/]");        // ?   → single non-slash char

  return new RegExp(`^${r}$`).test(p);
}

// ── Main safety check ─────────────────────────────────────────────────────────

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
    const found = BLOCKED_INSTRUCTION_PATTERNS.filter((pat) => lower.includes(pat));
    if (found.length > 0) {
      return {
        safe: false,
        blockedPatterns: found,
        reason:
          `Instruction contains ${found.length} blocked pattern(s): ${found.map((p) => `"${p}"`).join(", ")}. ` +
          `This task requires a compliance review before it can be automated.`,
      };
    }
  }

  return { safe: true };
}

// ── File path check ───────────────────────────────────────────────────────────
// Used before any file write. Both gates must pass.
//
// Gate 1 (Allowlist): path must match at least one ALLOWED_WRITE_GLOB.
// Gate 2 (Blocklist): path must not match any BLOCKED_FILE_PATTERN.
//
// For reads, call isFilePathSafeToRead() which only checks the blocklist.

export function isFilePathAllowed(filePath: string): FilePathResult {
  const normalised = filePath.replace(/\\/g, "/");

  // Gate 1: Allowlist — must match at least one allowed glob
  const inAllowlist = ALLOWED_WRITE_GLOBS.some((glob) => matchesGlob(normalised, glob));
  if (!inAllowlist) {
    return {
      allowed: false,
      reason:
        `"${filePath}" does not match any allowed write glob. ` +
        `Allowed patterns: ${ALLOWED_WRITE_GLOBS.join(", ")}. ` +
        `To allow writes here, add a new glob to ALLOWED_WRITE_GLOBS in safetyGuard.ts after a safety review.`,
    };
  }

  // Gate 2: Blocklist — must not match any blocked pattern
  for (const pattern of BLOCKED_FILE_PATTERNS) {
    if (pattern.test(normalised)) {
      return {
        allowed: false,
        reason: `"${filePath}" matches blocked pattern ${pattern}. This file cannot be modified by the agent.`,
      };
    }
  }

  return { allowed: true };
}

// Reads are always allowed EXCEPT for secrets/env files (blocklist only).
export function isFilePathSafeToRead(filePath: string): FilePathResult {
  const normalised = filePath.replace(/\\/g, "/");
  for (const pattern of BLOCKED_FILE_PATTERNS) {
    if (pattern.test(normalised)) {
      return {
        allowed: false,
        reason: `"${filePath}" matches blocked pattern ${pattern}. This file cannot be read by the agent.`,
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
