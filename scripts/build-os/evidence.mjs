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
 * Direct-CLI ownership: the Claude CLI edits files only; the WORKFLOW owns
 * branch/commit/push/PR. The eight stages below mirror that pipeline.
 *
 * Inputs (env, all strings):
 *   AF1_ISSUE, AF1_TASK_TITLE, AF1_TASK_TYPE, AF1_BRANCH, AF1_BASE, AF1_HEAD
 *   AF1_CLI_INSTALL_STATE ("success" | "failure" | "skipped" | "")
 *   AF1_CLI_EXEC_STATE    ("success" | "failure" | "skipped" | "")
 *   AF1_CLI_AUTH          ("ok" | "failed" | "")  best-effort CLI auth classification
 *   AF1_EDITED            ("true" | "false")
 *   AF1_SCOPE_STATE       ("success" | "failure" | "skipped" | "")
 *   AF1_VERIFY_STATE      ("success" | "failure" | "skipped" | "")
 *   AF1_COMMITTED         ("true" | "false")
 *   AF1_APP_TOKEN         ("present" | "absent")
 *   AF1_PUSHED            ("true" | "false")
 *   AF1_PR_CREATED        ("true" | "false")
 *   AF1_PR_URL
 *   AF1_OUT  (markdown output path, default "af1-evidence.md"; JSON sibling "<base>.json")
 */

import { execFileSync } from "node:child_process";
import { writeFileSync, appendFileSync } from "node:fs";
import process from "node:process";

const PASSED = "passed", FAILED = "failed", SKIPPED = "skipped", NA = "not-applicable";

/**
 * Pure status derivation for the direct-CLI pipeline. Returns the eight stage
 * states plus the single earliest primary blocker. Downstream stages after the
 * first problem are not-applicable, never misleading failures.
 */
export function deriveStatus(s = {}) {
  const cliInstall = String(s.cliInstall || "").toLowerCase();
  const cliExec = String(s.cliExec || "").toLowerCase();
  const cliAuth = String(s.cliAuth || "").toLowerCase();
  const edited = String(s.edited || "").toLowerCase() === "true";
  const scopeState = String(s.scope || "").toLowerCase();
  const verifyState = String(s.verify || "").toLowerCase();
  const committed = String(s.committed || "").toLowerCase() === "true";
  const appToken = String(s.appToken || "").toLowerCase() === "present";
  const pushed = String(s.pushed || "").toLowerCase() === "true";
  const prCreated = String(s.prCreated || "").toLowerCase() === "true";

  const mapStep = (st) => (st === "success" ? PASSED : st === "failure" ? FAILED : SKIPPED);
  const gates = { cli_install: SKIPPED, cli_exec: NA, edits: NA, scope: NA, verify: NA, commit: NA, push: NA, pr: NA };

  let primaryBlocker = null;

  gates.cli_install = cliInstall === "success" ? PASSED : (cliInstall === "failure" ? FAILED : SKIPPED);

  if (gates.cli_install !== PASSED) {
    primaryBlocker = "Claude CLI install failed";
  } else {
    gates.cli_exec = cliExec === "success" ? PASSED : (cliExec === "failure" ? FAILED : SKIPPED);
    if (gates.cli_exec !== PASSED) {
      primaryBlocker = cliAuth === "failed" ? "Claude CLI authentication failed" : "Claude CLI execution failed";
    } else if (!edited) {
      gates.edits = FAILED;
      primaryBlocker = "Claude made no file changes";
    } else {
      gates.edits = PASSED;
      gates.scope = mapStep(scopeState);
      if (gates.scope !== PASSED) {
        primaryBlocker = gates.scope === FAILED ? "scope guard failed" : "scope guard did not run";
      } else {
        gates.verify = mapStep(verifyState);
        if (gates.verify !== PASSED) {
          primaryBlocker = gates.verify === FAILED ? "npm run verify:all failed" : "npm run verify:all did not run";
        } else if (!appToken) {
          gates.commit = committed ? PASSED : FAILED;
          primaryBlocker = "GitHub App/PAT token was unavailable — cannot push or open a PR";
        } else {
          gates.commit = committed ? PASSED : FAILED;
          if (!committed) primaryBlocker = "commit failed";
          else {
            gates.push = pushed ? PASSED : FAILED;
            if (!pushed) primaryBlocker = "push of the agent branch failed";
            else {
              gates.pr = prCreated ? PASSED : FAILED;
              if (!prCreated) primaryBlocker = "draft pull request creation failed";
            }
          }
        }
      }
    }
  }

  const pass = gates.cli_install === PASSED && gates.cli_exec === PASSED && edited
    && gates.scope === PASSED && gates.verify === PASSED && appToken && committed && pushed && prCreated;
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
    cliInstall: env.AF1_CLI_INSTALL_STATE,
    cliExec: env.AF1_CLI_EXEC_STATE,
    cliAuth: env.AF1_CLI_AUTH,
    edited: env.AF1_EDITED,
    scope: env.AF1_SCOPE_STATE,
    verify: env.AF1_VERIFY_STATE,
    committed: env.AF1_COMMITTED,
    appToken: env.AF1_APP_TOKEN,
    pushed: env.AF1_PUSHED,
    prCreated: env.AF1_PR_CREATED,
  });

  // Diff vs base: use the committed range when a commit exists, else the staged index.
  const committed = String(env.AF1_COMMITTED || "").toLowerCase() === "true";
  const diffstat = committed ? git(["diff", "--stat", `${base}...${head}`], "(diff unavailable)") : git(["diff", "--cached", "--stat", base], "(no commit)");
  const nameStatus = committed ? git(["diff", "--name-status", `${base}...${head}`], "") : git(["diff", "--cached", "--name-status", base], "");
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
| Execution bound | job timeout-minutes (Claude CLI 2.1.196 has no --max-turns; bounded by the job) |

## Stage results (direct-CLI pipeline; authoritative; failed != skipped != not-applicable)

| # | Stage (owner) | Result |
|---|---|---|
| 1 | Claude CLI installed (workflow) | ${icon(st.gates.cli_install)} |
| 2 | Claude CLI executed — edits only (Claude) | ${icon(st.gates.cli_exec)} |
| 3 | Edits produced (Claude) | ${icon(st.gates.edits)} |
| 4 | Scope guard, pre-commit (workflow) | ${icon(st.gates.scope)} |
| 5 | \`npm run verify:all\`, pre-push (workflow) | ${icon(st.gates.verify)} |
| 6 | Commit created (workflow) | ${icon(st.gates.commit)} |
| 7 | Branch pushed via GitHub App token (workflow) | ${icon(st.gates.push)} |
| 8 | Draft PR created via GitHub App token (workflow) | ${icon(st.gates.pr)} |

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
- Claude ran via the CLI with ANTHROPIC_API_KEY only; push/PR used a dedicated least-privilege GitHub App token (Contents/PR/Issues write, Metadata read) — no cloud/production/deployment access.
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
