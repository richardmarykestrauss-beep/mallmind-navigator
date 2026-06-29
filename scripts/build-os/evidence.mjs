/**
 * MallMind Build OS — AF-1 Evidence Reporter
 *
 * Assembles a deterministic evidence pack for one autonomous run. The FINAL
 * STATUS and the PRIMARY BLOCKER are derived strictly from the deterministic
 * step states — never from the agent's prose.
 *
 * Cascading-failure honesty: when the Claude action fails before producing work
 * (e.g. the OIDC/App-token error), the downstream gates were never independent
 * defects. This reporter distinguishes:
 *   - passed
 *   - failed
 *   - skipped        (the step did not run)
 *   - not-applicable (n/a — could not run because an earlier stage failed)
 * and identifies the earliest real cause as the PRIMARY BLOCKER.
 *
 * Inputs (env, all strings):
 *   AF1_ISSUE, AF1_TASK_TITLE, AF1_TASK_TYPE, AF1_BRANCH, AF1_BASE, AF1_HEAD
 *   AF1_CLAUDE_STATE   ("success" | "failure" | "skipped" | "")
 *   AF1_COMMITTED      ("true" | "false")
 *   AF1_SCOPE_STATE    ("success" | "failure" | "skipped" | "")
 *   AF1_VERIFY_STATE   ("success" | "failure" | "skipped" | "")
 *   AF1_PR_EXISTS      ("true" | "false")
 *   AF1_PR_URL
 *   AF1_OUT  (markdown output path, default "af1-evidence.md"; JSON sibling "<base>.json")
 */

import { execFileSync } from "node:child_process";
import { writeFileSync, appendFileSync } from "node:fs";
import process from "node:process";

const PASSED = "passed", FAILED = "failed", SKIPPED = "skipped", NA = "not-applicable";

/**
 * Pure status derivation. Returns gate states + the single primary blocker.
 * @param {object} s state strings (claude, committed, scope, verify, prExists)
 */
export function deriveStatus(s = {}) {
  const claudeState = String(s.claude || "").toLowerCase();
  const committed = String(s.committed || "").toLowerCase() === "true";
  const scopeState = String(s.scope || "").toLowerCase();
  const verifyState = String(s.verify || "").toLowerCase();
  const prExists = String(s.prExists || "").toLowerCase() === "true";

  const claudeOk = claudeState === "success";
  const mapStep = (st) => (st === "success" ? PASSED : st === "failure" ? FAILED : SKIPPED);

  const gates = {
    claude: claudeOk ? PASSED : (claudeState === "failure" ? FAILED : SKIPPED),
    commit: NA,
    scope: NA,
    verify: NA,
    pr: NA,
  };

  let primaryBlocker = null;

  if (!claudeOk) {
    // The agent never produced work — everything downstream is not-applicable.
    primaryBlocker = "Claude action failed (authentication/OIDC or execution) before producing any work";
  } else {
    gates.commit = committed ? PASSED : FAILED;
    if (!committed) {
      primaryBlocker = "the agent produced no commit";
      // scope/verify could not meaningfully run → remain not-applicable
    } else {
      gates.scope = mapStep(scopeState);
      gates.verify = mapStep(verifyState);
      gates.pr = prExists ? PASSED : FAILED;
      if (gates.scope !== PASSED) primaryBlocker = gates.scope === FAILED ? "scope guard failed" : "scope guard did not run";
      else if (gates.verify !== PASSED) primaryBlocker = gates.verify === FAILED ? "npm run verify:all failed" : "npm run verify:all did not run";
      else if (!prExists) primaryBlocker = "no draft pull request was created";
    }
  }

  const pass = claudeOk && committed && gates.scope === PASSED && gates.verify === PASSED && prExists;
  const finalStatus = pass ? "ready for approval" : "human investigation required";
  const label = pass ? "agent:done" : "agent:needs-human";
  return { pass, finalStatus, label, primaryBlocker, gates };
}

// ── CLI (skipped during unit tests, which import deriveStatus directly) ───────
function isMain() {
  return (process.argv[1] || "").replace(/\\/g, "/").endsWith("scripts/build-os/evidence.mjs");
}

if (isMain()) {
  const env = process.env;
  const git = (args, fb = "") => { try { return execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).trim(); } catch { return fb; } };

  const issue = env.AF1_ISSUE || "(unknown)";
  const title = env.AF1_TASK_TITLE || "(untitled task)";
  const type = env.AF1_TASK_TYPE || "(unknown)";
  const branch = env.AF1_BRANCH || git(["rev-parse", "--abbrev-ref", "HEAD"], "(unknown)");
  const base = env.AF1_BASE || "origin/claude-premium-nav-test";
  const head = env.AF1_HEAD || git(["rev-parse", "HEAD"], "(unknown)");
  const prUrl = env.AF1_PR_URL || "(not opened)";
  const out = env.AF1_OUT || "af1-evidence.md";
  const jsonOut = out.replace(/\.md$/, "") + ".json";

  const st = deriveStatus({
    claude: env.AF1_CLAUDE_STATE,
    committed: env.AF1_COMMITTED,
    scope: env.AF1_SCOPE_STATE,
    verify: env.AF1_VERIFY_STATE,
    prExists: env.AF1_PR_EXISTS,
  });

  const range = `${base}...${head}`;
  const diffstat = git(["diff", "--stat", range], "(diff unavailable)");
  const nameStatus = git(["diff", "--name-status", range], "");
  const changedFiles = nameStatus ? nameStatus.split("\n").filter(Boolean) : [];
  const baseSha = git(["rev-parse", base], base);

  const icon = (g) => ({ passed: "✅ passed", failed: "❌ failed", skipped: "⏭️ skipped", "not-applicable": "— n/a" }[g] || g);

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
| Execution bound | Claude --max-turns + job timeout-minutes (repair-attempt count not tracked in AF-1) |

## Stage results (authoritative; failed != skipped != not-applicable)

| Stage | Result |
|---|---|
| Claude action (App auth + implement) | ${icon(st.gates.claude)} |
| Agent commit produced | ${icon(st.gates.commit)} |
| Scope guard | ${icon(st.gates.scope)} |
| \`npm run verify:all\` | ${icon(st.gates.verify)} |
| Draft PR created | ${icon(st.gates.pr)} |

**Final status: ${st.finalStatus.toUpperCase()}**
${st.primaryBlocker ? `\n**Primary blocker:** ${st.primaryBlocker}. Downstream stages marked \`not-applicable\`/\`skipped\` are consequences, not independent defects.` : ""}

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
- \`id-token: write\` only permits requesting a GitHub OIDC identity token used to mint the repo-scoped Claude App token; it grants no cloud/production access.
- This pull request is a **draft** and cannot merge without human approval and required status checks.

> The agent's narrative does not determine pass/fail. The deterministic stage results above do.
`;

  writeFileSync(out, md, "utf8");
  writeFileSync(jsonOut, JSON.stringify({
    issue, task_title: title, task_type: type, branch, base, base_sha: baseSha, head,
    gates: st.gates, primary_blocker: st.primaryBlocker, final_status: st.finalStatus,
    label: st.label, pass: st.pass, pr_url: prUrl, changed_files: changedFiles.length,
    deployment_performed: false, production_db_action_performed: false,
  }, null, 2), "utf8");

  if (env.GITHUB_STEP_SUMMARY) { try { appendFileSync(env.GITHUB_STEP_SUMMARY, md + "\n", "utf8"); } catch {} }

  console.log("AF1_EVIDENCE_JSON_BEGIN");
  console.log(JSON.stringify({ pass: st.pass, final_status: st.finalStatus, primary_blocker: st.primaryBlocker, gates: st.gates }, null, 2));
  console.log("AF1_EVIDENCE_JSON_END");

  process.exit(st.pass ? 0 : 1);
}
