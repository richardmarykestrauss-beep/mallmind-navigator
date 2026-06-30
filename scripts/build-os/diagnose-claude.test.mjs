/**
 * MallMind Build OS — AF-1 Claude execution-trace sanitizer tests.
 * Run: npm run test:diagnose
 */

import { redact, summarizeBash, parseExecution, analyze } from "./diagnose-claude.mjs";
import process from "node:process";

let passed = 0, failed = 0;
const assert = (c, label) => { if (c) { console.log(`  ✓ ${label}`); passed++; } else { console.error(`  ✗ ${label}`); failed++; } };

console.log("\nAF-1 diagnose-claude sanitizer");

// Redaction of token-like strings.
{
  assert(!redact("ANTHROPIC=sk-ant-api03-ABCDEF123456").includes("sk-ant-api03"), "redacts sk-ant key");
  assert(redact("ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345").includes("<REDACTED>"), "redacts ghp_ token");
  assert(redact("github_pat_11ABCDEFG_longtokenvalue1234567").includes("<REDACTED>"), "redacts fine-grained PAT");
  assert(redact("Authorization: Bearer abcdef.ghijkl.mnopqr").includes("<REDACTED>"), "redacts Bearer header");
  assert(redact("key eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV").includes("<REDACTED>"), "redacts JWT/Supabase key");
  assert(redact("url https://x-access-token:abc123secret@github.com/x").includes("<REDACTED>"), "redacts x-access-token");
  assert(redact("password=hunter2supersecret").includes("<REDACTED>"), "redacts password=… (env-style value)");
  assert(redact("just a normal sentence").toLowerCase().includes("normal sentence"), "leaves normal text intact");
  // Git SHAs must NOT be over-redacted.
  assert(redact("commit f0b92b73858ef2dc6ca19a47effb6907aaa4bfa9 ok") === "commit f0b92b73858ef2dc6ca19a47effb6907aaa4bfa9 ok", "does not redact plain git SHA");
}

// Bash summary: command categories only, no args, git identified, token redacted.
{
  const s = summarizeBash('git push "https://x-access-token:SECRETTOKEN@github.com/o/r.git" HEAD:refs/heads/x');
  assert(s.binaries.includes("git") && s.subcommands.includes("git push"), "identifies git push category");
  assert(JSON.stringify(s).indexOf("SECRETTOKEN") === -1, "bash summary never contains the token");
  assert(typeof s.argCount === "number" && !("command" in s), "no raw command string returned, only categories + count");
  const chain = summarizeBash("npm ci && node scripts/x.mjs | grep foo");
  assert(chain.binaries.includes("npm") && chain.binaries.includes("node") && chain.binaries.includes("grep"), "splits piped/chained binaries");
}

// Parse JSON array, JSONL, and concatenated forms.
{
  assert(parseExecution('[{"type":"result","subtype":"success"}]').length === 1, "parses JSON array");
  assert(parseExecution('{"type":"system"}\n{"type":"result"}').length === 2, "parses JSONL");
  assert(parseExecution("").length === 0, "empty file → no events");
  assert(parseExecution("not json at all").length === 0, "garbage → no events (no throw)");
}

// analyze: Edit/Write tool names + file paths reported; target referenced.
{
  const events = [
    { type: "system", subtype: "init", cwd: "/home/runner/work/repo/repo", model: "x" },
    { type: "assistant", message: { content: [
      { type: "text", text: "ok" },
      { type: "tool_use", name: "Read", input: { file_path: "docs/AUTHORITY.md" } },
      { type: "tool_use", name: "Write", input: { file_path: "docs/AF1_PILOT_NOTE.md", content: "TOP SECRET FILE BODY THAT MUST NOT LEAK" } },
      { type: "tool_use", name: "Bash", input: { command: "git status --porcelain" } },
    ] } },
    { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "1", content: "secret tool output xyz" }] } },
    { type: "result", subtype: "success", is_error: false, num_turns: 5, permission_denials_count: 0, duration_ms: 1000 },
  ];
  const r = analyze(events, { workspace: "/home/runner/work/repo/repo", targetFile: "docs/AF1_PILOT_NOTE.md", branchName: "claude/issue-5" });
  assert(r.tool_names_invoked.includes("Write") && r.tool_names_invoked.includes("Read"), "reports Edit/Write/Read tool names");
  assert(r.edit_write_file_paths.includes("docs/AF1_PILOT_NOTE.md"), "reports the Write file path");
  assert(r.references_target_file === true, "flags the target file reference");
  assert(r.git_operations_attempted === true && r.git_subcommands.includes("git status"), "identifies git ops without args");
  assert(r.completion_reason === "success" && r.result.num_turns === 5, "captures result/completion");
  assert(r.branch_name === "claude/issue-5", "captures action branch_name");
  assert(r.sufficient_metadata === true, "marks metadata sufficient when tool_use present");
  // Critical: no file contents or raw tool results anywhere in the report.
  const blob = JSON.stringify(r);
  assert(blob.indexOf("TOP SECRET FILE BODY") === -1, "never includes Write content");
  assert(blob.indexOf("secret tool output") === -1, "never includes tool_result content");
  assert(r.tool_result_blocks === 1, "counts tool_result blocks without reading them");
}

// Isolated-workspace detection.
{
  const events = [{ type: "assistant", message: { content: [
    { type: "tool_use", name: "Write", input: { file_path: "/tmp/elsewhere/AF1_PILOT_NOTE.md", content: "x" } },
  ] } }, { type: "result", subtype: "success", is_error: false }];
  const r = analyze(events, { workspace: "/home/runner/work/repo/repo", targetFile: "docs/AF1_PILOT_NOTE.md" });
  assert(r.isolated_workspace_paths.some((p) => p.includes("/tmp/elsewhere")), "flags writes outside the workspace");
}

// Missing / malformed execution file handled gracefully.
{
  const r = analyze([], { workspace: "/x", targetFile: "docs/AF1_PILOT_NOTE.md" });
  assert(r.sufficient_metadata === false && r.missing.length > 0, "empty events → sufficient_metadata=false + missing noted");
  const r2 = analyze(parseExecution("garbage"), {});
  assert(r2.sufficient_metadata === false, "garbage file → not sufficient");
}

console.log(`\n===== AF-1 DIAGNOSE-CLAUDE: ${passed} passed, ${failed} failed =====`);
if (failed > 0) process.exit(1);
