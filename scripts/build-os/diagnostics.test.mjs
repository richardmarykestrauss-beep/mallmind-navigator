/**
 * MallMind Build OS — AF-1 diagnostics (sanitizer + classifier + naming) tests.
 * Run: npm run test:diagnostics
 */

import {
  sanitize, classifyClaudeExit, parseResultSubtype, buildDiagnostics,
  evidenceArtifactName, diagnosticsArtifactName,
} from "./diagnostics.mjs";
import process from "node:process";

let passed = 0, failed = 0;
const assert = (c, label) => { if (c) { console.log(`  ✓ ${label}`); passed++; } else { console.error(`  ✗ ${label}`); failed++; } };

console.log("\nAF-1 diagnostics — sanitizer");

// 11. Sanitizer removes token-like values.
{
  const raw = [
    "Anthropic key sk-ant-api03-ABCDEF1234567890abcdef",
    "GitHub token ghp_ABCDEFGHIJKLMNOPQRST1234",
    "App token ghs_ZYXWVUTSRQPONMLKJIHG9876",
    "Fine-grained github_pat_11ABCDEFG0abcdefghij_KLMNOPqrstuvwxyz",
    "Authorization: Bearer eyJhbGciOi.JIUzI1NiIsInR5cCI6.IkpXVCJ9abc",
    "url https://x-access-token:ghs_secretTokenValue123456@github.com/o/r.git",
    "aws AKIAIOSFODNN7EXAMPLE",
    "x-api-key: super-secret-value",
  ].join("\n");
  const out = sanitize(raw);
  const leaked = ["sk-ant-api03-ABCDEF", "ghp_ABCDEFGHIJKLMNOPQRST", "ghs_ZYXWVUTSRQ", "github_pat_11ABCDEFG0",
    "eyJhbGciOi.JIUzI1NiIsInR5cCI6.IkpXVCJ9", "ghs_secretTokenValue", "AKIAIOSFODNN7EXAMPLE", "super-secret-value"];
  assert(leaked.every((s) => !out.includes(s)), "all token-like values are redacted");
  assert(/REDACTED/.test(out), "redaction placeholder present");
}

// Private key blocks are stripped whole.
{
  const pem = "-----BEGIN RSA PRIVATE KEY-----\nMIIEabc\ndefg\n-----END RSA PRIVATE KEY-----";
  const out = sanitize(pem);
  assert(!out.includes("MIIEabc") && out.includes("REDACTED_KEY_BLOCK"), "PEM private key block redacted");
}

// Non-sensitive text is preserved.
{
  const msg = "Edited src/pages/NavigateScreen.tsx; verify:all passed in 16s";
  assert(sanitize(msg) === msg, "ordinary diagnostic text is left intact");
}

console.log("\nAF-1 diagnostics — exit classification");
{
  assert(classifyClaudeExit({ code: 0 }) === "success", "exit 0 → success");
  assert(classifyClaudeExit({ code: 1, edited: true, stderr: "" }) === "benign-post-edit-exit", "exit 1 after edits, no signature → benign-post-edit-exit");
  assert(classifyClaudeExit({ code: 1, edited: false, stderr: "" }) === "unknown-pre-edit-failure", "exit 1 before edits, no signature → unknown-pre-edit-failure");
  assert(classifyClaudeExit({ code: 1, edited: true, stderr: "401 Unauthorized: invalid api key" }) === "auth", "auth signature → auth");
  assert(classifyClaudeExit({ code: 1, edited: true, stderr: "429 rate limit exceeded" }) === "rate-limit", "rate-limit signature → rate-limit");
  assert(classifyClaudeExit({ code: 1, edited: true, stderr: "context deadline exceeded / timed out" }) === "timeout", "timeout signature → timeout");
  assert(classifyClaudeExit({ code: 1, edited: true, stderr: "tool denied: permission denied" }) === "tool-denial", "tool-denial signature → tool-denial");
}

console.log("\nAF-1 diagnostics — result subtype + full record");
{
  const stdout = JSON.stringify({ type: "result", subtype: "success", is_error: false, num_turns: 12, result: "…" });
  const r = parseResultSubtype(stdout);
  assert(r && r.subtype === "success" && r.is_error === false && r.num_turns === 12, "parses subtype/is_error/num_turns");
  assert(parseResultSubtype("not json") === null, "malformed stdout → null (no throw)");

  const diag = buildDiagnostics({
    issue: "19", runId: "28540257532", runAttempt: "1", code: 1, edited: "true",
    stderr: "warning: token ghp_ABCDEFGHIJKLMNOPQRST1234 in log\nprocess exited 1",
    stdout,
  });
  assert(diag.exit_code === 1 && diag.edits_existed_at_exit === true, "record captures exit code + edits-existed");
  assert(diag.classification === "benign-post-edit-exit", "record classifies the benign post-edit exit");
  assert(!JSON.stringify(diag).includes("ghp_ABCDEFGHIJKLMNOPQRST"), "record never contains a raw token (stderr tail sanitized)");
  assert(diag.result_subtype === "success", "record surfaces the result subtype");
  assert(typeof diag.stderr_tail_sanitized === "string", "record includes a sanitized stderr tail");
}

console.log("\nAF-1 diagnostics — attempt-unique artifact names");
{
  assert(evidenceArtifactName({ issue: "19", runId: "28540257532", runAttempt: "1" })
    === "af1-evidence-19-28540257532-attempt-1", "evidence artifact name = issue+run+attempt");
  assert(diagnosticsArtifactName({ issue: "19", runId: "28540257532", runAttempt: "2" })
    === "af1-claude-diagnostics-19-28540257532-attempt-2", "diagnostics artifact name = issue+run+attempt");
  // Distinct attempts of one run never collide.
  const a1 = evidenceArtifactName({ issue: "19", runId: "R", runAttempt: "1" });
  const a2 = evidenceArtifactName({ issue: "19", runId: "R", runAttempt: "2" });
  assert(a1 !== a2, "different attempts yield different artifact names");
  const injected = evidenceArtifactName({ issue: "1/../x", runId: "a b", runAttempt: "1" });
  assert(!/[\/\\\s]/.test(injected), "names are slugged (no slash/backslash/space injection)");
}

console.log(`\n===== AF-1 DIAGNOSTICS CONTRACT: ${passed} passed, ${failed} failed =====`);
if (failed > 0) process.exit(1);
