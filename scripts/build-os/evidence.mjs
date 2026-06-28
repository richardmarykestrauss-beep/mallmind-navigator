/**
 * MallMind Build OS — AF-1 Evidence Reporter
 *
 * Assembles a deterministic evidence pack for one autonomous run. The FINAL
 * STATUS is derived strictly from the deterministic gate results (scope guard +
 * verify:all) passed in via env — never from the agent's prose.
 *
 * Inputs (env):
 *   AF1_ISSUE, AF1_TASK_TITLE, AF1_TASK_TYPE, AF1_BRANCH,
 *   AF1_BASE (ref/sha), AF1_HEAD (sha),
 *   AF1_SCOPE_OK ("true"|"false"), AF1_VERIFY_OK ("true"|"false"),
 *   AF1_REPAIR_ATTEMPTS (int), AF1_PR_URL, AF1_NOTES (optional),
 *   AF1_OUT (output markdown path, default "af1-evidence.md")
 *
 * Side effects: writes the markdown file, appends to $GITHUB_STEP_SUMMARY when
 * present, and prints a machine-readable JSON block to stdout.
 */

import { execFileSync } from "node:child_process";
import { writeFileSync, appendFileSync } from "node:fs";
import process from "node:process";

const env = process.env;
const bool = (v) => String(v).toLowerCase() === "true";

function git(args, fallback = "") {
  try {
    return execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).trim();
  } catch {
    return fallback;
  }
}

const issue = env.AF1_ISSUE || "(unknown)";
const title = env.AF1_TASK_TITLE || "(untitled task)";
const type = env.AF1_TASK_TYPE || "(unknown)";
const branch = env.AF1_BRANCH || git(["rev-parse", "--abbrev-ref", "HEAD"], "(unknown)");
const base = env.AF1_BASE || "origin/claude-premium-nav-test";
const head = env.AF1_HEAD || git(["rev-parse", "HEAD"], "(unknown)");
const scopeOk = bool(env.AF1_SCOPE_OK);
const verifyOk = bool(env.AF1_VERIFY_OK);
// AF-1 does NOT count individual repair attempts. Execution is bounded by the
// Claude action's --max-turns and the job's timeout-minutes; correctness is
// decided deterministically AFTER execution by the gates below.
const executionBound = env.AF1_EXECUTION_BOUND || "Claude --max-turns + job timeout-minutes (exact repair-attempt count not tracked in AF-1)";
const prUrl = env.AF1_PR_URL || "(not opened)";
const notes = env.AF1_NOTES || "";
const out = env.AF1_OUT || "af1-evidence.md";

const range = `${base}...${head}`;
const diffstat = git(["diff", "--stat", range], "(diff unavailable)");
const nameStatus = git(["diff", "--name-status", range], "");
const changedFiles = nameStatus ? nameStatus.split("\n") : [];
const baseSha = git(["rev-parse", base], base);

// Final status is a pure function of the deterministic gates.
let finalStatus;
const unresolved = [];
if (scopeOk && verifyOk) {
  finalStatus = "ready for approval";
} else {
  finalStatus = "human investigation required";
  if (!scopeOk) unresolved.push("scope guard failed (changes outside approved scope)");
  if (!verifyOk) unresolved.push("npm run verify:all failed");
}

const md = `# AF-1 Autonomous Run — Evidence Pack

| Field | Value |
|---|---|
| Task | ${title} |
| Issue | #${issue} |
| Task type | \`${type}\` |
| Agent branch | \`${branch}\` |
| Base | \`${base}\` (\`${baseSha.slice(0, 12)}\`) |
| Result commit | \`${head}\` |
| Draft PR | ${prUrl} |
| Execution bound | ${executionBound} |

## Deterministic gate results (authoritative)

| Gate | Result |
|---|---|
| Scope guard | ${scopeOk ? "✅ PASS" : "❌ FAIL"} |
| \`npm run verify:all\` | ${verifyOk ? "✅ PASS" : "❌ FAIL"} |

**Final status: ${finalStatus.toUpperCase()}**
${unresolved.length ? `\n**Unresolved failures:**\n${unresolved.map((u) => `- ${u}`).join("\n")}` : ""}

## Changed files (${changedFiles.length})

${changedFiles.length ? changedFiles.map((l) => `- \`${l}\``).join("\n") : "_none_"}

## Diff summary

\`\`\`
${diffstat}
\`\`\`

## Production-safety statement

- No deployment was performed.
- No production database / migration action was performed.
- No production credentials (Supabase service role, Google Cloud, deploy keys) were available to this run.
- This pull request is a **draft** and cannot merge without human approval and required status checks.
${notes ? `\n## Notes\n\n${notes}\n` : ""}
> The agent's narrative does not determine pass/fail. The two deterministic gates above do.
`;

writeFileSync(out, md, "utf8");

if (env.GITHUB_STEP_SUMMARY) {
  appendFileSync(env.GITHUB_STEP_SUMMARY, md + "\n", "utf8");
}

const json = {
  issue,
  task_title: title,
  task_type: type,
  branch,
  base,
  base_sha: baseSha,
  head,
  scope_ok: scopeOk,
  verify_ok: verifyOk,
  execution_bound: executionBound,
  repair_attempts_tracked: false,
  changed_files: changedFiles.length,
  final_status: finalStatus,
  pr_url: prUrl,
  deployment_performed: false,
  production_db_action_performed: false,
};
console.log("AF1_EVIDENCE_JSON_BEGIN");
console.log(JSON.stringify(json, null, 2));
console.log("AF1_EVIDENCE_JSON_END");

// Exit non-zero if the run is not clean, so the workflow can branch on it.
process.exit(scopeOk && verifyOk ? 0 : 1);
