/**
 * MallMind Build OS — AF-1 evidence/status-derivation + OIDC workflow contract tests.
 * Run: npm run test:evidence
 */

import { deriveStatus } from "./evidence.mjs";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import process from "node:process";

let passed = 0, failed = 0;
const assert = (c, label) => { if (c) { console.log(`  ✓ ${label}`); passed++; } else { console.error(`  ✗ ${label}`); failed++; } };

console.log("\nAF-1 evidence — cascading-failure semantics");

// 1. Claude action authentication failure → it is the PRIMARY blocker; downstream n/a.
{
  const r = deriveStatus({ claude: "failure", committed: "false", scope: "skipped", verify: "skipped", prExists: "false" });
  assert(r.gates.claude === "failed", "claude auth failure → claude=failed");
  assert(r.gates.commit === "not-applicable" && r.gates.scope === "not-applicable" && r.gates.verify === "not-applicable" && r.gates.pr === "not-applicable",
    "downstream stages marked not-applicable (not independent defects)");
  assert(/authentication\/OIDC/i.test(r.primary_blocker || r.primaryBlocker), "primary blocker names the Claude/OIDC failure");
  assert(r.pass === false && r.label === "agent:needs-human", "overall failure, label needs-human");
}

// 2. Claude step skipped (never ran) → claude=skipped, downstream n/a.
{
  const r = deriveStatus({ claude: "skipped", committed: "false" });
  assert(r.gates.claude === "skipped", "claude skipped → claude=skipped");
  assert(r.gates.scope === "not-applicable" && r.gates.verify === "not-applicable", "scope/verify not-applicable when claude skipped");
  assert(r.pass === false, "skipped claude → not pass");
}

// 3. No commit because nothing was produced (claude ok but no commit).
{
  const r = deriveStatus({ claude: "success", committed: "false", scope: "skipped", verify: "skipped", prExists: "false" });
  assert(r.gates.commit === "failed", "claude ok but no commit → commit=failed");
  assert(r.gates.scope === "not-applicable" && r.gates.verify === "not-applicable", "scope/verify n/a when no commit");
  assert(/no commit/i.test(r.primaryBlocker), "primary blocker = no commit");
}

// 4. Scope guard shown as skipped (not failed) when it did not run.
{
  const r = deriveStatus({ claude: "success", committed: "true", scope: "skipped", verify: "skipped", prExists: "true" });
  assert(r.gates.scope === "skipped", "scope shown skipped, not failed");
  assert(r.gates.verify === "skipped", "verify shown skipped, not failed");
  assert(r.pass === false, "skipped gates → not pass");
}

// 5. Real scope failure with a commit → scope=failed is the primary blocker.
{
  const r = deriveStatus({ claude: "success", committed: "true", scope: "failure", verify: "skipped", prExists: "true" });
  assert(r.gates.scope === "failed" && /scope guard failed/i.test(r.primaryBlocker), "genuine scope failure reported as failed");
}

// 6. Real verify failure (scope passed) → verify=failed primary.
{
  const r = deriveStatus({ claude: "success", committed: "true", scope: "success", verify: "failure", prExists: "true" });
  assert(r.gates.verify === "failed" && /verify:all failed/i.test(r.primaryBlocker), "genuine verify failure reported as failed");
}

// 7. Everything green → pass / agent:done / no blocker.
{
  const r = deriveStatus({ claude: "success", committed: "true", scope: "success", verify: "success", prExists: "true" });
  assert(r.pass === true && r.label === "agent:done" && r.primaryBlocker === null, "all stages pass → ready for approval");
}

// 8. Missing draft PR (everything else ok) → pr=failed, primary = no PR.
{
  const r = deriveStatus({ claude: "success", committed: "true", scope: "success", verify: "success", prExists: "false" });
  assert(r.gates.pr === "failed" && /no draft pull request/i.test(r.primaryBlocker) && r.pass === false, "missing draft PR blocks");
}

// ── OIDC + workflow contract ────────────────────────────────────────────────
console.log("\nAF-1 OIDC workflow contract");
{
  const here = path.dirname(fileURLToPath(import.meta.url));
  const wf = readFileSync(path.resolve(here, "..", "..", ".github", "workflows", "agent-build.yml"), "utf8");
  const has = (s, label) => assert(wf.includes(s), label);
  const hasRe = (re, label) => assert(re.test(wf), label);

  // id-token:write present, scoped to the build job (not global), exactly once.
  has("id-token: write", "build job grants id-token: write");
  assert((wf.match(/id-token:\s*write/g) || []).length === 1, "id-token: write appears exactly once (build job only)");
  hasRe(/build:[\s\S]*?permissions:[\s\S]*?id-token:\s*write/, "id-token: write is inside the build job permissions");
  hasRe(/^permissions:\s*\n\s*contents:\s*read\s*\n/m, "top-level permissions remain contents: read only");
  // Restrictions preserved: no contents:write / no workflow / deployments / environments / administration perms.
  assert(!/contents:\s*write/.test(wf), "no contents: write anywhere");
  assert(!/\b(deployments|environments|administration):\s*write/.test(wf), "no deployment/environment/administration write");

  // Truthful reporting wiring: states passed in; verdict read from evidence json.
  has("AF1_CLAUDE_STATE: ${{ steps.claude.outcome }}", "claude outcome passed to evidence");
  has("AF1_SCOPE_STATE: ${{ steps.scope.outcome }}", "scope outcome (state, not boolean) passed to evidence");
  has("AF1_VERIFY_STATE: ${{ steps.verify.outcome }}", "verify outcome (state) passed to evidence");
  has("af1-evidence.json", "finalize reads the evidence JSON verdict");
  assert(!wf.includes("reasons.push"), "old misleading reasons[] logic removed from finalize");
  has("primary_blocker", "finalize surfaces the primary blocker");

  // Still pinned to 40-hex SHAs.
  assert(wf.split("\n").filter((l) => /uses:/.test(l)).every((l) => /@[0-9a-f]{40}\b/.test(l)), "every action pinned to a 40-hex SHA");
}

console.log(`\n===== AF-1 EVIDENCE + OIDC CONTRACT: ${passed} passed, ${failed} failed =====`);
if (failed > 0) process.exit(1);
