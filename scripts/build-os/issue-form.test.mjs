/**
 * MallMind Build OS — Issue Form parser + preflight regression tests.
 * Run: npm run test:issue-form
 */

import { parseIssueForm, extractTask, validateTask, slugFromTitle } from "./issue-form.mjs";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import process from "node:process";

let passed = 0, failed = 0;
const assert = (c, label) => { if (c) { console.log(`  ✓ ${label}`); passed++; } else { console.error(`  ✗ ${label}`); failed++; } };

// Exact rendered body of issue #5 (fetched from GitHub; LF).
const ISSUE_5 = [
  "### Task type", "", "docs", "",
  "### Priority", "", "P1", "",
  "### Objective", "",
  "Add a short documentation note confirming that AF-1 has completed its first autonomous pilot run. Do not change application code, workflows, migrations, or configuration.", "",
  "### Allowed file globs", "", "docs/build-os/AF1_PILOT_NOTE.md", "",
  "### Acceptance criteria", "",
  "- Create docs/build-os/AF1_PILOT_NOTE.md",
  "- State that this file exists only to validate the AF-1 autonomous loop",
  "- Mention that no deployment, production database change, or application behaviour change is part of the task",
  "- Keep the file concise", "",
  "### Required gates", "", "verify:all", "",
  "### Maximum diff lines", "", "80", "",
  "### Additional context", "",
  "This is the first controlled AF-1 pilot. The task must remain documentation-only and must stop if any forbidden path or broader scope is required.",
].join("\n");

console.log("\nAF-1 issue-form parser");

// 1. Real issue #5 body → task_type=docs and all 8 fields.
{
  const t = extractTask(ISSUE_5);
  assert(t.task_type === "docs", "issue #5: task_type=docs (regression for the empty-type bug)");
  assert(t.priority === "P1", "issue #5: priority=P1");
  assert(t.objective.startsWith("Add a short documentation note"), "issue #5: objective captured");
  assert(t.allowed_files === "docs/build-os/AF1_PILOT_NOTE.md", "issue #5: allowed_files captured");
  assert(/Create docs\/build-os\/AF1_PILOT_NOTE\.md/.test(t.acceptance) && /Keep the file concise/.test(t.acceptance), "issue #5: multiline acceptance captured");
  assert(t.required_gates === "verify:all", "issue #5: required_gates=verify:all");
  assert(t.max_diff_lines === 80, "issue #5: max_diff_lines=80");
  assert(t.additional_context.startsWith("This is the first controlled"), "issue #5: additional_context captured");
  assert(validateTask(t).ok === true, "issue #5: validates as eligible");
}

// 2. CRLF and LF parity.
{
  const crlf = ISSUE_5.replace(/\n/g, "\r\n");
  assert(extractTask(crlf).task_type === "docs", "CRLF body parses task_type=docs");
  assert(JSON.stringify(extractTask(crlf)) === JSON.stringify(extractTask(ISSUE_5)), "CRLF and LF produce identical extraction");
}

// 3. Extra blank lines + surrounding whitespace + heading capitalization.
{
  const body = "###   Task Type  \n\n\n   docs   \n\n###  Objective\n\ndo a thing\n\n### Allowed file globs\n\nsrc/**\n";
  const t = extractTask(body);
  assert(t.task_type === "docs", "messy whitespace + caps still yields docs");
  assert(t.objective === "do a thing" && t.allowed_files === "src/**", "messy body extracts other fields");
}

// 4. Missing task type → '' → ineligible.
{
  const body = "### Objective\n\nx\n\n### Allowed file globs\n\nsrc/**\n";
  const t = extractTask(body);
  assert(t.task_type === "", "missing task type → empty");
  assert(validateTask(t).ok === false, "missing task type → ineligible");
}

// 5. Unsupported task type → ineligible.
{
  const t = extractTask("### Task type\n\ndatabase\n\n### Objective\n\nx\n\n### Allowed file globs\n\nsrc/**\n");
  const v = validateTask(t);
  assert(!v.ok && /not one of/.test(v.reason), "unsupported task type rejected");
}

// 5b. Forbidden task type → ineligible with forbidden message.
{
  const t = extractTask("### Task type\n\ndb\n\n### Objective\n\nx\n\n### Allowed file globs\n\nsrc/**\n");
  const v = validateTask(t);
  assert(!v.ok && /forbidden/.test(v.reason), "forbidden task type (db) rejected");
}

// 6. Valid docs task → eligible.
{
  const t = extractTask("### Task type\n\nfrontend\n\n### Objective\n\nbuild\n\n### Allowed file globs\n\nsrc/**\n");
  assert(validateTask(t).ok === true, "valid frontend task eligible");
}

// 7. First-occurrence wins (a later field cannot inject a fake heading).
{
  const body = "### Task type\n\ndocs\n\n### Additional context\n\n### Task type\n\nproduction\n";
  assert(extractTask(body).task_type === "docs", "injected later '### Task type' is ignored (first wins)");
}

// 8. slug helper.
assert(slugFromTitle("[AF-1] Pilot docs note!") === "pilot-docs-note", "slug strips prefix and sanitizes");

// ── Workflow contract: failure semantics cannot return overall success ───────
console.log("\nAF-1 preflight workflow contract");
{
  const here = path.dirname(fileURLToPath(import.meta.url));
  const wf = readFileSync(path.resolve(here, "..", "..", ".github", "workflows", "agent-build.yml"), "utf8");
  const has = (s, label) => assert(wf.includes(s), label);
  const hasRe = (re, label) => assert(re.test(wf), label);

  // Permission fix: preflight can write issues; build PR perm tightened to read.
  hasRe(/preflight:[\s\S]*?permissions:[\s\S]*?issues:\s*write/, "preflight job has issues: write");
  // False-success fix: the gate fails deterministically on ineligibility.
  has("core.setFailed", "gate calls core.setFailed on ineligibility");
  hasRe(/if:\s*needs\.preflight\.outputs\.eligible\s*==\s*'true'/, "build is gated on eligible == 'true'");
  // Failure label state.
  has("agent:needs-human", "failure path applies agent:needs-human");
  // Node24 action SHAs; the node20 github-script@v7 SHA must be gone.
  has("actions/github-script@ed597411d8f924073f98dfc5c65a23a2325f34cd", "github-script pinned to v8 (node24) SHA");
  has("actions/upload-artifact@b7c566a772e6b6bfb58ed0dc250532a479d7789f", "upload-artifact pinned to v6 (node24) SHA");
  assert(!wf.includes("f28e40c7f34bde8b3046d885e986cb6290c5673b"), "old node20 github-script@v7 SHA removed");
  assert(!wf.includes("ea165f8d65b6e75b540449e92b4886f43607fa02"), "old node20 upload-artifact@v4 SHA removed");
  // Robust parser is used (not the fragile inline split).
  has("issue-form.mjs", "preflight imports the tested issue-form parser");
  assert(!wf.includes("split(/\\n###"), "fragile inline `split(/\\n###/)` parser removed");
  // Every action still pinned to a 40-hex SHA.
  const usesLines = wf.split("\n").filter((l) => /uses:/.test(l));
  assert(usesLines.every((l) => /@[0-9a-f]{40}\b/.test(l)), "every action pinned to a full 40-hex SHA");
}

console.log(`\n===== AF-1 ISSUE-FORM + PREFLIGHT: ${passed} passed, ${failed} failed =====`);
if (failed > 0) process.exit(1);
