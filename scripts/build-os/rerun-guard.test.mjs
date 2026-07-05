/**
 * MallMind Build OS — AF-1 rerun / idempotency contract tests.
 * Run: npm run test:rerun
 */

import { decideRerunAction, ACTIONS } from "./rerun-guard.mjs";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import process from "node:process";

let passed = 0, failed = 0;
const assert = (c, label) => { if (c) { console.log(`  ✓ ${label}`); passed++; } else { console.error(`  ✗ ${label}`); failed++; } };

console.log("\nAF-1 rerun / idempotency decisions");

// 6. Existing branch + existing (open/draft) PR → report, never duplicate.
{
  const d = decideRerunAction({ issueState: "open", remoteBranchExists: true, prState: "draft" });
  assert(d.action === ACTIONS.REPORT_EXISTING_PR, "branch + draft PR → report-existing-pr");
  assert(d.proceed === false && d.destructive === false && d.forcePush === false, "report: no proceed / no destructive / no force-push");
  const dOpen = decideRerunAction({ issueState: "open", remoteBranchExists: true, prState: "open" });
  assert(dOpen.action === ACTIONS.REPORT_EXISTING_PR, "branch + open PR → report-existing-pr");
}

// 7. Existing branch WITHOUT a PR → reuse the branch, open the draft PR.
{
  const d = decideRerunAction({ issueState: "open", remoteBranchExists: true, prState: "none" });
  assert(d.action === ACTIONS.REUSE_BRANCH_OPEN_PR, "branch, no PR → reuse-branch-open-pr");
  assert(d.proceed === false && d.destructive === false && d.forcePush === false, "reuse: non-destructive, no force-push");
}

// 8. Merged PR / closed issue → exit truthfully, not a technical failure.
{
  const merged = decideRerunAction({ issueState: "open", remoteBranchExists: true, prState: "merged" });
  assert(merged.action === ACTIONS.STOP_MERGED && !merged.proceed, "merged PR → stop-merged");
  assert(/already merged|delivered/i.test(merged.reason) && !/fail/i.test(merged.reason), "stop-merged reason is truthful, not a failure");
  const mergedFlag = decideRerunAction({ issueState: "open", remoteBranchExists: true, prState: "open", prMerged: true });
  assert(mergedFlag.action === ACTIONS.STOP_MERGED, "explicit prMerged flag → stop-merged (outranks open)");
  const closed = decideRerunAction({ issueState: "closed", remoteBranchExists: true, prState: "draft" });
  assert(closed.action === ACTIONS.STOP_CLOSED && !closed.proceed, "closed issue → stop-closed (outranks branch/PR)");
  assert(!/fail/i.test(closed.reason), "stop-closed reason is not framed as a technical failure");
}

// Clean slate → proceed with a fresh implementation (the only destructive action).
{
  const d = decideRerunAction({ issueState: "open", remoteBranchExists: false, prState: "none" });
  assert(d.action === ACTIONS.PROCEED && d.proceed === true && d.destructive === true, "clean slate → proceed (destructive)");
  assert(d.forcePush === false, "even proceed never implies a force-push");
}

// 9. No decision path EVER permits a force-push or overwrite.
{
  const cases = [
    { issueState: "open", remoteBranchExists: false, prState: "none" },
    { issueState: "open", remoteBranchExists: true, prState: "none" },
    { issueState: "open", remoteBranchExists: true, prState: "draft" },
    { issueState: "open", remoteBranchExists: true, prState: "merged" },
    { issueState: "closed", remoteBranchExists: true, prState: "open" },
  ];
  assert(cases.every((c) => decideRerunAction(c).forcePush === false), "no action ever sets forcePush=true");
  assert(cases.filter((c) => !decideRerunAction(c).proceed).every((c) => decideRerunAction(c).destructive === false),
    "every non-proceed action is non-destructive (no second commit / push)");
}

// ── Workflow reliability contract (no force-push, guard + diagnostics wired) ──
console.log("\nAF-1 workflow reliability contract");
{
  const here = path.dirname(fileURLToPath(import.meta.url));
  const wf = readFileSync(path.resolve(here, "..", "..", ".github", "workflows", "agent-build.yml"), "utf8");
  const has = (s, label) => assert(wf.includes(s), label);
  const hasRe = (re, label) => assert(re.test(wf), label);

  // 9 (workflow): the push never force-pushes or overwrites.
  assert(!/--force\b/.test(wf), "workflow contains no --force");
  assert(!/--force-with-lease/.test(wf), "workflow contains no --force-with-lease");
  assert(!/git push[^\n]*\+/.test(wf), "no forced refspec (leading '+') on any git push");

  // 2 (workflow): rerun guard runs and gates the destructive implementation path.
  has("scripts/build-os/rerun-guard.mjs", "workflow runs the rerun guard");
  hasRe(/id: guard/, "guard step has an id");
  hasRe(/if: steps\.cli_install\.outcome == 'success' && steps\.guard\.outputs\.proceed == 'true'/,
    "Claude implement runs only when the guard says proceed");
  hasRe(/if: steps\.guard\.outputs\.proceed == 'true'/, "CLI install gated on guard proceed");
  has("AF1_GUARD_ACTION", "Finalize receives the guard action");
  hasRe(/guardAction !== "proceed"/, "Finalize branches to a truthful no-op when the guard did not proceed");
  hasRe(/stop-merged|stop-closed/, "Finalize special-cases delivered/closed tasks (no false failure)");

  // 3 (workflow): sanitized diagnostics are persisted per attempt.
  has("scripts/build-os/diagnostics.mjs", "workflow persists sanitized Claude diagnostics");
  has("AF1_CLAUDE_ERR_FILE", "diagnostics reads the Claude stderr file");
  has("AF1_CLI_EXIT_CODE", "diagnostics receives the Claude exit code");

  // 4 (workflow): artifact names include issue + run id + attempt.
  hasRe(/name: af1-evidence-\$\{\{ env\.AF1_ISSUE \}\}-\$\{\{ github\.run_id \}\}-attempt-\$\{\{ github\.run_attempt \}\}/,
    "evidence artifact name includes issue + run id + attempt");
  hasRe(/name: af1-claude-diagnostics-\$\{\{ env\.AF1_ISSUE \}\}-\$\{\{ github\.run_id \}\}-attempt-\$\{\{ github\.run_attempt \}\}/,
    "diagnostics artifact name includes issue + run id + attempt");

  // 5 (workflow): security model preserved — no new GITHUB_TOKEN write scopes.
  assert(!/pull-requests:\s*write/.test(wf), "still no pull-requests: write for GITHUB_TOKEN");
  assert(!/contents:\s*write/.test(wf), "still no contents: write for GITHUB_TOKEN");
  has("gh pr list --head", "PR detection uses gh (App token), not a new GITHUB_TOKEN scope");
  assert(wf.split("\n").filter((l) => /uses:/.test(l)).every((l) => /@[0-9a-f]{40}\b/.test(l)), "all actions remain pinned to 40-hex SHAs");
}

console.log(`\n===== AF-1 RERUN / IDEMPOTENCY CONTRACT: ${passed} passed, ${failed} failed =====`);
if (failed > 0) process.exit(1);
