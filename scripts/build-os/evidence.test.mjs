/**
 * MallMind Build OS — AF-1 evidence (Model B) + workflow-ownership contract tests.
 * Run: npm run test:evidence
 */

import { deriveStatus } from "./evidence.mjs";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import process from "node:process";

let passed = 0, failed = 0;
const assert = (c, label) => { if (c) { console.log(`  ✓ ${label}`); passed++; } else { console.error(`  ✗ ${label}`); failed++; } };

const ok = { claude: "success", edited: "true", scope: "success", verify: "success", committed: "true", appToken: "present", pushed: "true", prCreated: "true" };

console.log("\nAF-1 evidence — Model B stage semantics");

// 1. Claude action failure → primary blocker; all downstream not-applicable.
{
  const r = deriveStatus({ ...ok, claude: "failure", edited: "false", scope: "skipped", verify: "skipped", committed: "false", appToken: "absent", pushed: "false", prCreated: "false" });
  assert(r.gates.claude === "failed", "claude failure → claude=failed");
  assert(["edits","scope","verify","commit","push","pr"].every(k => r.gates[k] === "not-applicable"), "all downstream stages not-applicable");
  assert(/authentication\/OIDC/i.test(r.primaryBlocker) && !r.pass && r.label === "agent:needs-human", "primary=Claude/OIDC; needs-human");
}

// 2. Claude made no edits → distinct blocker; gates after edits n/a.
{
  const r = deriveStatus({ ...ok, edited: "false", scope: "skipped", verify: "skipped", committed: "false", pushed: "false", prCreated: "false" });
  assert(r.gates.edits === "failed" && /made no file changes/i.test(r.primaryBlocker), "no edits → 'Claude made no file changes'");
  assert(r.gates.scope === "not-applicable" && r.gates.commit === "not-applicable", "scope/commit n/a when no edits");
}

// 3. Scope guard failed → distinct blocker; verify/commit/push/pr n/a.
{
  const r = deriveStatus({ ...ok, scope: "failure", verify: "skipped", committed: "false", pushed: "false", prCreated: "false" });
  assert(r.gates.scope === "failed" && /scope guard failed/i.test(r.primaryBlocker), "scope failure distinct");
  assert(r.gates.verify === "not-applicable" && r.gates.push === "not-applicable", "downstream n/a after scope fail");
}

// 4. Verify failed → distinct blocker.
{
  const r = deriveStatus({ ...ok, verify: "failure", committed: "false", pushed: "false", prCreated: "false" });
  assert(r.gates.verify === "failed" && /verify:all failed/i.test(r.primaryBlocker), "verify failure distinct");
}

// 5. App token unavailable (scope+verify pass) → distinct blocker.
{
  const r = deriveStatus({ ...ok, appToken: "absent", committed: "false", pushed: "false", prCreated: "false" });
  assert(/App token was unavailable/i.test(r.primaryBlocker) && !r.pass, "app-token-absent distinct blocker");
}

// 6. Commit failed → distinct blocker.
{
  const r = deriveStatus({ ...ok, committed: "false", pushed: "false", prCreated: "false" });
  assert(r.gates.commit === "failed" && /commit failed/i.test(r.primaryBlocker), "commit failure distinct");
}

// 7. Push failed → distinct blocker.
{
  const r = deriveStatus({ ...ok, pushed: "false", prCreated: "false" });
  assert(r.gates.push === "failed" && /push of the agent branch failed/i.test(r.primaryBlocker), "push failure distinct");
}

// 8. Draft-PR creation failed → distinct blocker.
{
  const r = deriveStatus({ ...ok, prCreated: "false" });
  assert(r.gates.pr === "failed" && /draft pull request creation failed/i.test(r.primaryBlocker), "PR-creation failure distinct");
}

// 9. Full success → pass / agent:done / no blocker.
{
  const r = deriveStatus(ok);
  assert(r.pass === true && r.label === "agent:done" && r.primaryBlocker === null, "success path reaches agent:done");
  assert(["claude","edits","scope","verify","commit","push","pr"].every(k => r.gates[k] === "passed"), "all seven stages passed");
}

// ── Model B workflow-ownership contract ─────────────────────────────────────
console.log("\nAF-1 Model B workflow contract");
{
  const here = path.dirname(fileURLToPath(import.meta.url));
  const wf = readFileSync(path.resolve(here, "..", "..", ".github", "workflows", "agent-build.yml"), "utf8");
  const has = (s, label) => assert(wf.includes(s), label);
  const hasRe = (re, label) => assert(re.test(wf), label);

  // Workflow owns branch creation + identity.
  hasRe(/git checkout -B "\$AGENT_BRANCH" "origin\/\$BASE_BRANCH"/, "workflow creates the agent/* branch");
  has('git config user.name "mallmind-af1[bot]"', "workflow sets a bot git identity");

  // Claude prompt forbids all git/PR operations.
  has("YOU OWN FILE EDITS ONLY", "prompt: Claude owns edits only");
  has("Do NOT run `git checkout`", "prompt forbids git checkout/branch");
  has("Do NOT commit. Do NOT push. Do NOT open a pull request", "prompt forbids commit/push/PR");

  // Gate order: scope (pre-commit) -> verify (pre-push) -> commit -> push -> PR.
  has("scope-guard.mjs --staged", "scope guard runs pre-commit on the staged index");
  hasRe(/id: scope[\s\S]*?if: steps\.post_claude\.outputs\.edited == 'true'/, "scope runs only if Claude edited");
  hasRe(/id: verify[\s\S]*?if: steps\.scope\.outcome == 'success'/, "verify runs only after scope passes");
  hasRe(/id: commit[\s\S]*?if: steps\.verify\.outcome == 'success'/, "commit runs only after verify passes");
  hasRe(/id: push[\s\S]*?if: steps\.commit\.outcome == 'success' && steps\.post_claude\.outputs\.app_token == 'present'/, "push runs only after commit AND when App token present");
  hasRe(/id: pr[\s\S]*?if: steps\.push\.outcome == 'success'/, "draft PR runs only after push succeeds");

  // Push + PR use the Claude App token output (never GITHUB_TOKEN).
  has("APP_TOKEN: ${{ steps.claude.outputs.github_token }}", "push uses steps.claude.outputs.github_token");
  has("GH_TOKEN: ${{ steps.claude.outputs.github_token }}", "gh pr create uses the App token");
  has("gh pr create --draft", "PR is created as a draft");
  has("x-access-token:${APP_TOKEN}", "push authenticates with the App token");
  assert(!/git push[^\n]*GITHUB_TOKEN/.test(wf), "push never uses GITHUB_TOKEN");

  // Commit message format + issue link.
  has("agent(issue-${AF1_ISSUE}): ", "deterministic commit message format");
  has("Closes #${AF1_ISSUE}", "draft PR links the source issue");

  // No production/deployment permissions added; minimal token retained.
  assert((wf.match(/id-token:\s*write/g) || []).length === 1, "id-token: write appears once (build job)");
  assert(!/contents:\s*write/.test(wf), "no contents: write for GITHUB_TOKEN");
  assert(!/pull-requests:\s*write/.test(wf), "no pull-requests: write for GITHUB_TOKEN");
  assert(!/\b(deployments|environments|administration):\s*write/.test(wf), "no deployment/environment/administration write");
  assert(wf.split("\n").filter(l => /uses:/.test(l)).every(l => /@[0-9a-f]{40}\b/.test(l)), "all actions pinned to 40-hex SHAs");

  // Evidence wiring: the new stage states are passed in.
  for (const v of ["AF1_EDITED", "AF1_APP_TOKEN", "AF1_PUSHED", "AF1_PR_CREATED"])
    has(v + ":", `evidence receives ${v}`);
  has("af1-evidence.json", "finalize reads the evidence JSON verdict");
}

console.log(`\n===== AF-1 EVIDENCE + MODEL B CONTRACT: ${passed} passed, ${failed} failed =====`);
if (failed > 0) process.exit(1);
