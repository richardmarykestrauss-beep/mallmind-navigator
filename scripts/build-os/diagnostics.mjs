/**
 * MallMind Build OS — AF-1 Claude diagnostics (sanitized, attempt-specific).
 *
 * The issue #19 run redirected Claude's stderr to a temp file that was never
 * persisted, so the benign exit-1 reason could not be inspected afterwards
 * (report §F). This module builds a SANITIZED diagnostic record for each attempt
 * and provides attempt-unique artifact names, so multiple attempts of one run no
 * longer collide under a single artifact name.
 *
 * SECURITY: diagnostics must NEVER expose API keys, tokens, authorization
 * headers, private keys, JWTs, full prompts, environment values, or file
 * contents. `sanitize()` redacts token-like values; only a short, sanitized tail
 * of stderr and a coarse category are ever emitted.
 *
 * Pure helpers are exported for unit testing; the CLI block writes the record.
 */

import { readFileSync, writeFileSync } from "node:fs";
import process from "node:process";

// Ordered redaction rules. Each strips a class of secret to a stable placeholder.
const REDACTIONS = [
  [/-----BEGIN [^-]+-----[\s\S]*?-----END [^-]+-----/g, "***REDACTED_KEY_BLOCK***"],
  [/sk-ant-[A-Za-z0-9_-]{8,}/g, "sk-ant-***REDACTED***"],
  [/ghp_[A-Za-z0-9]{20,}/g, "ghp_***REDACTED***"],
  [/ghs_[A-Za-z0-9]{20,}/g, "ghs_***REDACTED***"],
  [/gho_[A-Za-z0-9]{20,}/g, "gho_***REDACTED***"],
  [/github_pat_[A-Za-z0-9_]{20,}/g, "github_pat_***REDACTED***"],
  [/AKIA[0-9A-Z]{16}/g, "AKIA***REDACTED***"],
  [/eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/g, "***REDACTED_JWT***"],
  [/x-access-token:[^@\s"']+/gi, "x-access-token:***REDACTED***"],
  // header/keyword = value  (authorization, bearer, x-api-key, api_key, token, secret, private-key)
  [/\b(authorization|bearer|x-api-key|api[_-]?key|token|secret|private[_-]?key|password)\b(\s*[:=]\s*|\s+)("?)[^\s"']+\3/gi, "$1$2***REDACTED***"],
];

/** Redact token-like values from arbitrary text. Never throws. */
export function sanitize(text) {
  if (text == null) return "";
  let out = String(text);
  for (const [re, rep] of REDACTIONS) out = out.replace(re, rep);
  return out;
}

/**
 * Coarse classification of a Claude CLI exit, from the exit code, whether edits
 * exist, and (already-sanitized-safe) stderr/stdout signatures. Detects
 * auth / rate-limit / timeout / tool-denial where possible; otherwise
 * distinguishes a benign post-edit non-zero exit from a pre-edit failure.
 */
export function classifyClaudeExit({ code = 0, edited = false, stderr = "", stdout = "" } = {}) {
  const n = Number(code) || 0;
  if (n === 0) return "success";
  const hay = `${stderr}\n${stdout}`.toLowerCase();
  const hasEdits = edited === true || String(edited).toLowerCase() === "true";
  if (/authentication|invalid api key|x-api-key|\b401\b|unauthorized|forbidden/.test(hay)) return "auth";
  if (/rate.?limit|\b429\b|overloaded|quota|too many requests/.test(hay)) return "rate-limit";
  if (/timed out|timeout|etimedout|deadline exceeded|context deadline/.test(hay)) return "timeout";
  if (/permission denied|not allowed|tool.*deni|blocked by|disallowed tool/.test(hay)) return "tool-denial";
  return hasEdits ? "benign-post-edit-exit" : "unknown-pre-edit-failure";
}

/** Extract only non-sensitive result metadata from the --output-format json stdout. */
export function parseResultSubtype(stdoutJson) {
  try {
    const j = typeof stdoutJson === "string" ? JSON.parse(stdoutJson) : stdoutJson;
    if (!j || typeof j !== "object") return null;
    const subtype = typeof j.subtype === "string" ? j.subtype : null;
    const is_error = typeof j.is_error === "boolean" ? j.is_error : null;
    const num_turns = Number.isFinite(j.num_turns) ? j.num_turns : null;
    return { subtype, is_error, num_turns };
  } catch {
    return null;
  }
}

const MAX_TAIL_LINES = 8;

/** Build the full sanitized diagnostic record (no secrets, bounded size). */
export function buildDiagnostics({ issue, runId, runAttempt, code, edited, stderr = "", stdout = "" } = {}) {
  const sanitizedErr = sanitize(stderr);
  const tail = sanitizedErr.split(/\r?\n/).filter((l) => l.trim()).slice(-MAX_TAIL_LINES).join("\n");
  const hasEdits = edited === true || String(edited).toLowerCase() === "true";
  const result = parseResultSubtype(stdout);
  const cat = /authentication|\b401\b|unauthorized/i.test(sanitizedErr) ? "auth"
    : /rate.?limit|\b429\b|overloaded/i.test(sanitizedErr) ? "rate-limit"
    : /timed out|timeout|deadline/i.test(sanitizedErr) ? "timeout"
    : /permission denied|disallowed tool|blocked by/i.test(sanitizedErr) ? "tool-denial"
    : sanitizedErr.trim() ? "other" : "empty";
  return {
    issue: issue ?? null,
    run_id: runId ?? null,
    run_attempt: runAttempt ?? null,
    exit_code: Number(code) || 0,
    edits_existed_at_exit: hasEdits,
    classification: classifyClaudeExit({ code, edited, stderr, stdout }),
    stderr_category: cat,
    stderr_tail_sanitized: tail,
    result_subtype: result?.subtype ?? null,
    result_is_error: result?.is_error ?? null,
    result_num_turns: result?.num_turns ?? null,
  };
}

// ── Attempt-unique artifact names (issue + run id + attempt) ──────────────────
const slug = (v) => String(v ?? "unknown").replace(/[^A-Za-z0-9._-]/g, "-");
export function evidenceArtifactName({ issue, runId, runAttempt } = {}) {
  return `af1-evidence-${slug(issue)}-${slug(runId)}-attempt-${slug(runAttempt)}`;
}
export function diagnosticsArtifactName({ issue, runId, runAttempt } = {}) {
  return `af1-claude-diagnostics-${slug(issue)}-${slug(runId)}-attempt-${slug(runAttempt)}`;
}

// ── CLI: read the Claude out/err temp files and write a sanitized record. ──────
function isMain() {
  return (process.argv[1] || "").replace(/\\/g, "/").endsWith("scripts/build-os/diagnostics.mjs");
}

if (isMain()) {
  const env = process.env;
  const read = (p) => { try { return p ? readFileSync(p, "utf8") : ""; } catch { return ""; } };
  const diag = buildDiagnostics({
    issue: env.AF1_ISSUE,
    runId: env.AF1_RUN_ID,
    runAttempt: env.AF1_RUN_ATTEMPT,
    code: env.AF1_CLI_EXIT_CODE,
    edited: env.AF1_EDITED,
    stderr: read(env.AF1_CLAUDE_ERR_FILE),
    stdout: read(env.AF1_CLAUDE_OUT_FILE),
  });
  const out = env.AF1_DIAG_OUT || "af1-claude-diagnostics.json";
  writeFileSync(out, JSON.stringify(diag, null, 2), "utf8");
  console.log(`AF-1 Claude diagnostics: exit=${diag.exit_code} edits_existed=${diag.edits_existed_at_exit} class=${diag.classification} stderr=${diag.stderr_category}`);
}
