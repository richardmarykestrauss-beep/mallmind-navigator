/**
 * MallMind Build OS — AF-1 rerun / idempotency guard (pure decision).
 *
 * The issue #19 re-run created a second local commit and then failed
 * non-fast-forward because the remote agent branch and its PR already existed
 * (report §F). This module makes a rerun DETERMINISTIC and IDEMPOTENT: given the
 * observable remote state, it decides the single safe action.
 *
 * Hard invariants — the returned action NEVER implies any of:
 *   - a force-push;
 *   - overwriting remote work;
 *   - a duplicate pull request;
 *   - relabelling an already-delivered task as a technical failure.
 * Only the `proceed` action is `destructive` (i.e. permitted to create a fresh
 * commit + push). Every other action is a safe, non-destructive report/stop.
 *
 * Pure and side-effect free so it can be unit-tested and reused by the workflow.
 */

export const ACTIONS = Object.freeze({
  PROCEED: "proceed",                            // clean slate → fresh implementation
  REUSE_BRANCH_OPEN_PR: "reuse-branch-open-pr",  // branch exists, no PR → reuse verified branch, open draft PR
  REPORT_EXISTING_PR: "report-existing-pr",      // branch + open/draft PR → report; never duplicate
  STOP_MERGED: "stop-merged",                    // a PR for this branch merged → task already delivered
  STOP_CLOSED: "stop-closed",                    // issue closed → stop truthfully
});

const asBool = (v) => v === true || String(v ?? "").toLowerCase() === "true";

/**
 * Decide the safe rerun action from observable remote state.
 *
 * @param {object} s
 * @param {string}  s.issueState        "open" | "closed" | ...
 * @param {boolean} s.remoteBranchExists remote agent/<issue>-<slug> branch present
 * @param {string}  s.prState           "none" | "open" | "draft" | "closed" | "merged"
 * @param {boolean} [s.prMerged]        explicit merged flag (OR'd with prState==="merged")
 * @returns {{action:string, proceed:boolean, destructive:boolean, forcePush:false, reason:string, existingPrExpected:boolean}}
 */
export function decideRerunAction(s = {}) {
  const issueState = String(s.issueState ?? "open").toLowerCase();
  const remoteBranchExists = asBool(s.remoteBranchExists);
  const prState = String(s.prState ?? "none").toLowerCase();
  const prMerged = asBool(s.prMerged) || prState === "merged";

  const stop = (action, reason) => ({ action, proceed: false, destructive: false, forcePush: false, existingPrExpected: false, reason });

  // Precedence is deliberate: a closed issue or an already-merged PR outrank any
  // branch/PR state, so a completed task is never re-attempted or marked failed.

  // 1. Issue not open → the task is closed/complete. Stop truthfully.
  if (issueState !== "open") {
    return stop(ACTIONS.STOP_CLOSED,
      "issue is not open — the task is already closed/complete; reporting truthfully instead of re-attempting it");
  }

  // 2. A PR for this branch is already merged → the work is delivered.
  if (prMerged) {
    return stop(ACTIONS.STOP_MERGED,
      "a pull request for this agent branch is already merged — the task is delivered; this run is a safe no-op, not a duplicate");
  }

  // 3. Remote branch + an OPEN/DRAFT PR → report it; never open a duplicate.
  if (remoteBranchExists && (prState === "open" || prState === "draft")) {
    return { action: ACTIONS.REPORT_EXISTING_PR, proceed: false, destructive: false, forcePush: false, existingPrExpected: true,
      reason: "an open draft PR already exists for this agent branch — reporting it instead of creating a duplicate (no second commit, no force-push)" };
  }

  // 4. Remote branch exists but NO PR → reuse the existing verified branch and
  //    open the draft PR. No re-implementation, no push, no force-push.
  if (remoteBranchExists) {
    return { action: ACTIONS.REUSE_BRANCH_OPEN_PR, proceed: false, destructive: false, forcePush: false, existingPrExpected: false,
      reason: "the agent branch exists without a PR — reusing the existing verified branch and opening the draft PR (no re-implementation, no force-push)" };
  }

  // 5. Clean slate → proceed with a fresh implementation.
  return { action: ACTIONS.PROCEED, proceed: true, destructive: true, forcePush: false, existingPrExpected: false,
    reason: "no existing agent branch or PR — proceeding with a fresh implementation" };
}

// ── CLI: classify observable state from env and emit GitHub outputs. ──────────
function isMain() {
  return (process.argv[1] || "").replace(/\\/g, "/").endsWith("scripts/build-os/rerun-guard.mjs");
}

if (isMain()) {
  const { appendFileSync } = await import("node:fs");
  const process = (await import("node:process")).default;
  const env = process.env;

  const decision = decideRerunAction({
    issueState: env.AF1_ISSUE_STATE,
    remoteBranchExists: env.AF1_REMOTE_BRANCH_EXISTS,
    prState: env.AF1_PR_STATE,
    prMerged: env.AF1_PR_MERGED,
  });

  const out = env.GITHUB_OUTPUT;
  if (out) {
    appendFileSync(out, `action=${decision.action}\n`);
    appendFileSync(out, `proceed=${decision.proceed}\n`);
    appendFileSync(out, `reason=${decision.reason}\n`);
  }
  console.log(`AF-1 rerun guard: action=${decision.action} proceed=${decision.proceed} (force-push=${decision.forcePush})`);
  console.log(`  reason: ${decision.reason}`);
}
