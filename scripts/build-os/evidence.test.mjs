/**
 * MallMind Build OS — AF-1 evidence (direct-CLI) + workflow-ownership contract tests.
 * Run: npm run test:evidence
 */

import { deriveStatus } from "./evidence.mjs";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import process from "node:process";

let passed = 0, failed = 0;
const assert = (c, label) => { if (c) { console.log(`  ✓ ${label}`); passed++; } else { console.error(`  ✗ ${label}`); failed++; } };

const ok = {
  cliInstall: "success", cliExec: "success", cliAuth: "ok", edited: "true",
  scope: "success", verify: "success", committed: "true", appToken: "present", pushed: "true", prCreated: "true",
};

console.log("\nAF-1 evidence — direct-CLI stage semantics");

// 1. CLI install failed → primary; everything downstream not-applicable.
{
  const r = deriveStatus({ ...ok, cliInstall: "failure", cliExec: "skipped", edited: "false", committed: "false", appToken: "absent", pushed: "false", prCreated: "false" });
  assert(r.gates.cli_install === "failed", "cli install failure → cli_install=failed");
  assert(["cli_exec","edits","scope","verify","commit","push","pr"].every(k => r.gates[k] === "not-applicable"), "downstream not-applicable on install failure");
  assert(/CLI install failed/i.test(r.primaryBlocker) && !r.pass, "primary = CLI install failed");
}

// 2. CLI exec failed + auth failed → auth blocker (distinct from execution).
{
  const r = deriveStatus({ ...ok, cliExec: "failure", cliAuth: "failed", edited: "false", committed: "false", appToken: "absent", pushed: "false", prCreated: "false" });
  assert(r.gates.cli_exec === "failed" && /CLI authentication failed/i.test(r.primaryBlocker), "CLI auth failure distinct");
}

// 3. CLI exec failed + auth ok → execution blocker.
{
  const r = deriveStatus({ ...ok, cliExec: "failure", cliAuth: "ok", edited: "false", committed: "false", appToken: "absent", pushed: "false", prCreated: "false" });
  assert(/CLI execution failed/i.test(r.primaryBlocker), "CLI execution failure distinct from auth");
}

// 4. No edits → distinct blocker; gates after edits n/a.
{
  const r = deriveStatus({ ...ok, edited: "false", scope: "skipped", verify: "skipped", committed: "false", pushed: "false", prCreated: "false" });
  assert(r.gates.edits === "failed" && /made no file changes/i.test(r.primaryBlocker), "no edits → 'Claude made no file changes'");
  assert(r.gates.scope === "not-applicable", "scope n/a when no edits");
}

// 5/6. Scope / verify failures distinct.
{
  const sc = deriveStatus({ ...ok, scope: "failure", verify: "skipped", committed: "false", pushed: "false", prCreated: "false" });
  assert(sc.gates.scope === "failed" && /scope guard failed/i.test(sc.primaryBlocker), "scope failure distinct");
  const vf = deriveStatus({ ...ok, verify: "failure", committed: "false", pushed: "false", prCreated: "false" });
  assert(vf.gates.verify === "failed" && /verify:all failed/i.test(vf.primaryBlocker), "verify failure distinct");
}

// 7. App/PAT token unavailable.
{
  const r = deriveStatus({ ...ok, appToken: "absent", committed: "false", pushed: "false", prCreated: "false" });
  assert(/App\/PAT token was unavailable/i.test(r.primaryBlocker) && !r.pass, "app/PAT token absent distinct");
}

// 8/9/10. Commit / push / PR failures distinct.
{
  assert(/commit failed/i.test(deriveStatus({ ...ok, committed: "false", pushed: "false", prCreated: "false" }).primaryBlocker), "commit failure distinct");
  assert(/push of the agent branch failed/i.test(deriveStatus({ ...ok, pushed: "false", prCreated: "false" }).primaryBlocker), "push failure distinct");
  assert(/draft pull request creation failed/i.test(deriveStatus({ ...ok, prCreated: "false" }).primaryBlocker), "PR-creation failure distinct");
}

// 11. Full success → pass / agent:done / all 8 stages passed.
{
  const r = deriveStatus(ok);
  assert(r.pass === true && r.label === "agent:done" && r.primaryBlocker === null, "success → ready for approval");
  assert(["cli_install","cli_exec","edits","scope","verify","commit","push","pr"].every(k => r.gates[k] === "passed"), "all eight stages passed");
}

// ── Direct-CLI workflow-ownership contract ──────────────────────────────────
console.log("\nAF-1 direct-CLI workflow contract");
{
  const here = path.dirname(fileURLToPath(import.meta.url));
  const wf = readFileSync(path.resolve(here, "..", "..", ".github", "workflows", "agent-build.yml"), "utf8");
  const has = (s, label) => assert(wf.includes(s), label);
  const hasRe = (re, label) => assert(re.test(wf), label);

  // The official Claude action is GONE from the implementation path.
  assert(!wf.includes("anthropics/claude-code-action"), "official claude-code-action is absent");

  // Direct CLI: pinned install + verified invocation in the workspace.
  has("npm install -g @anthropic-ai/claude-code@2.1.196", "installs the pinned Claude CLI");
  has("working-directory: ${{ github.workspace }}", "CLI runs in $GITHUB_WORKSPACE");
  has('claude -p "$AF1_PROMPT"', "uses claude -p (non-interactive)");
  has('--allowedTools "Read Edit Write Glob Grep"', "restricts tools to file ops (no Bash/Web)");
  has("--permission-mode acceptEdits", "auto-accepts edits non-interactively");
  has("--output-format json", "captures structured CLI output");
  has("ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}", "CLI authenticates via ANTHROPIC_API_KEY");

  // Prompt forbids all git/PR operations.
  has("YOU OWN FILE EDITS ONLY", "prompt: Claude owns edits only");
  has("Do NOT create or switch git branches", "prompt forbids branch ops");
  has("Do NOT run `git add`. Do NOT commit. Do NOT push", "prompt forbids add/commit/push");

  // Direct edits are detected by the workflow via git status.
  has("git status --porcelain", "workflow detects edits via git status");
  has("scope-guard.mjs --staged", "scope guard runs pre-commit on the staged index");
  hasRe(/id: verify[\s\S]*?if: steps\.scope\.outcome == 'success'/, "verify runs only after scope passes");
  hasRe(/id: commit[\s\S]*?if: steps\.verify\.outcome == 'success'/, "commit runs only after verify passes");

  // Push + PR use ONLY the dedicated GitHub App token (create-github-app-token).
  has("actions/create-github-app-token@bcd2ba49218906704ab6c1aa796996da409d3eb1", "mints the App token via the official action (pinned SHA)");
  // Client ID migration: deprecated app-id removed; non-sensitive client-id from a repo VARIABLE.
  assert(!wf.includes("app-id:"), "deprecated app-id input is no longer used");
  assert(!wf.includes("secrets.AF1_APP_ID"), "no longer references the AF1_APP_ID secret");
  has("client-id: ${{ vars.AF1_APP_CLIENT_ID }}", "uses the supported client-id input from a repo variable");
  has("private-key: ${{ secrets.AF1_APP_PRIVATE_KEY }}", "App private key remains secret-backed");
  has("APP_TOKEN: ${{ steps.apptoken.outputs.token }}", "push uses the App-token output");
  has("GH_TOKEN: ${{ steps.apptoken.outputs.token }}", "gh pr create uses the App-token output");
  assert(!wf.includes("steps.claude.outputs.github_token"), "no longer relies on the action github_token output");
  has("gh pr create --draft", "PR is created as a draft");
  assert(!/git push[^\n]*GITHUB_TOKEN/.test(wf), "push never uses GITHUB_TOKEN");

  // Push-auth fix: clear checkout's persisted github-actions[bot] header so the
  // App-token URL is honored. Must be inside the push step, after the App-token
  // step, and immediately before the App-token push.
  has("git config --local --unset-all http.https://github.com/.extraheader", "clears the persisted checkout extraheader");
  hasRe(/id: push[\s\S]*?--unset-all http\.https:\/\/github\.com\/\.extraheader[\s\S]*?git push "https:\/\/x-access-token:\$\{APP_TOKEN\}/,
    "extraheader is cleared inside the push step, before the App-token push");
  assert(
    wf.indexOf("id: apptoken") < wf.indexOf("--unset-all http.https://github.com/.extraheader"),
    "the clear happens after App-token creation (apptoken step precedes it)");
  assert(
    wf.indexOf("--unset-all http.https://github.com/.extraheader") < wf.indexOf('git push "https://x-access-token:${APP_TOKEN}'),
    "the clear happens before the git push");

  // Integration-warning fix: the nonessential PR-comment mirror is removed
  // (it needed pull-requests: write). Evidence still posts on the issue.
  assert(!wf.includes("issue_number: prNumber"), "no PR-comment mirror (the integration-warning operation is removed)");
  has("github.rest.issues.createComment({ owner, repo, issue_number: n, body })", "evidence still posted on the source issue");

  // No production/deployment permissions introduced; obsolete ones removed.
  assert(!/id-token:\s*write/.test(wf), "id-token: write removed (no longer needed)");
  assert(!/contents:\s*write/.test(wf), "no contents: write for GITHUB_TOKEN");
  assert(!/pull-requests:\s*write/.test(wf), "no pull-requests: write for GITHUB_TOKEN");
  assert(!/\b(deployments|environments|administration|packages):\s*write/.test(wf), "no deployment/environment/admin/packages write");
  assert(wf.split("\n").filter(l => /uses:/.test(l)).every(l => /@[0-9a-f]{40}\b/.test(l)), "all actions pinned to 40-hex SHAs");

  // Evidence wiring: the new CLI stage states are passed in.
  for (const v of ["AF1_CLI_INSTALL_STATE", "AF1_CLI_EXEC_STATE", "AF1_CLI_AUTH", "AF1_EDITED", "AF1_APP_TOKEN", "AF1_PUSHED", "AF1_PR_CREATED"])
    has(v + ":", `evidence receives ${v}`);
  has("af1-evidence.json", "finalize reads the evidence JSON verdict");
}

console.log(`\n===== AF-1 EVIDENCE + DIRECT-CLI CONTRACT: ${passed} passed, ${failed} failed =====`);
if (failed > 0) process.exit(1);
