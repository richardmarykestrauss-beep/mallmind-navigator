/**
 * changeReport.ts
 *
 * Writes two kinds of reports for the IMPLEMENT_TASK workflow:
 *
 *   writePlanReport()    — Stage 1. Written after plan generation, BEFORE any edits.
 *                          Outputs: plan-<id>.md  (human-readable)
 *                                   plans/<id>.json  (machine-readable, loaded by apply mode)
 *
 *   writeChangeReport()  — Stage 2. Written after edits are applied and build runs.
 *                          Outputs: change-<id>.md  (human-readable)
 *
 * Both reports live in REPORTS_DIR/dev-agent/ (default: reports/dev-agent/).
 */

import { mkdirSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import type { StoredPlan } from "./taskSchema.js";
import type { EditResult }  from "./fileEditor.js";
import type { BuildResult } from "./buildRunner.js";

// ── Path helpers ──────────────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));

function getReportsDir(): string {
  return resolve(
    __dirname,
    "..",
    process.env.REPORTS_DIR ?? "../reports/dev-agent"
  );
}

function getPlansDir(): string {
  return resolve(getReportsDir(), "plans");
}

function getBackupsDir(): string {
  return resolve(getReportsDir(), "backups");
}

export function getBackupsDirForPlan(planId: string): string {
  return resolve(getBackupsDir(), planId);
}

// ── Inline diff formatter ─────────────────────────────────────────────────────

function formatDiff(oldStr: string, newStr: string): string {
  const oldLines = oldStr.split("\n");
  const newLines = newStr.split("\n");
  const removed  = oldLines.map((l) => `- ${l}`).join("\n");
  const added    = newLines.map((l) => `+ ${l}`).join("\n");
  return `\`\`\`diff\n${removed}\n${added}\n\`\`\``;
}

// ── Build result summary ──────────────────────────────────────────────────────

function buildStatusIcon(r: BuildResult): string {
  if (r.timedOut)  return "⏱️ TIMED OUT";
  if (r.success)   return "✅ PASSED";
  return "❌ FAILED";
}

function formatBuildResults(results: BuildResult[]): string {
  if (results.length === 0) return "_Build skipped (build_target = \"none\")._";

  const lines = results.map((r) =>
    `| ${r.label} | ${buildStatusIcon(r)} | ${(r.durationMs / 1000).toFixed(1)}s |`
  );

  const rows = [
    "| Command | Status | Duration |",
    "|---------|--------|----------|",
    ...lines,
  ].join("\n");

  const failedOutput = results
    .filter((r) => !r.success)
    .map(
      (r) =>
        `**${r.label} — output tail:**\n\`\`\`\n${r.outputTail || "(no output)"}\n\`\`\``
    )
    .join("\n\n");

  return rows + (failedOutput ? "\n\n" + failedOutput : "");
}

// ── Timestamp ─────────────────────────────────────────────────────────────────

function timestamp(): string {
  return new Date()
    .toISOString()
    .replace(/[:.]/g, "-")
    .replace("T", "_")
    .slice(0, 19);
}

// ── Plan report ───────────────────────────────────────────────────────────────

export function writePlanReport(plan: StoredPlan): { planJsonPath: string; planMdPath: string } {
  const reportsDir = getReportsDir();
  const plansDir   = getPlansDir();
  mkdirSync(reportsDir, { recursive: true });
  mkdirSync(plansDir,   { recursive: true });

  // 1. Write machine-readable plan JSON
  const planJsonPath = resolve(plansDir, `${plan.plan_id}.json`);
  writeFileSync(planJsonPath, JSON.stringify(plan, null, 2), "utf-8");

  // 2. Write human-readable plan Markdown
  const changesSection = plan.changes.length === 0
    ? "_No changes proposed. The task may already be complete._"
    : plan.changes
        .map(
          (c, i) =>
            [
              `### Change ${i + 1} — \`${c.file_path}\``,
              ``,
              `**${c.description}**`,
              ``,
              formatDiff(c.old_string, c.new_string),
            ].join("\n")
        )
        .join("\n\n---\n\n");

  const buildCommandsSection = plan.build_commands.length === 0
    ? "_None (build_target = \"none\")._"
    : plan.build_commands.map((c) => `- \`${c}\``).join("\n");

  const commitBlock = plan.suggested_commit_message
    ? `\`\`\`\n${plan.suggested_commit_message}\n\`\`\``
    : "_No commit message generated._";

  const sections = [
    `# MallMind Dev Agent — Implementation Plan`,
    ``,
    `> **Plan ID:** \`${plan.plan_id}\``,
    `> **Task:** \`${plan.task.task_id}\` — ${plan.task.description}`,
    `> **Generated:** ${plan.created_at}`,
    `> **Files to change:** ${plan.changes.length}`,
    `> ⚠️  **No files have been modified yet. Review and approve before applying.**`,
    ``,
    `---`,
    ``,
    `## Summary`,
    ``,
    plan.summary,
    ``,
    `---`,
    ``,
    `## Proposed Changes`,
    ``,
    changesSection,
    ``,
    `---`,
    ``,
    `## Build Commands (run after apply)`,
    ``,
    buildCommandsSection,
    ``,
    `---`,
    ``,
    `## Suggested Commit Message`,
    ``,
    `Copy and paste this after you have reviewed and tested the changes:`,
    ``,
    commitBlock,
    ``,
    `---`,
    ``,
    `## To approve and apply this plan:`,
    ``,
    `\`\`\`bash`,
    `cd google-dev-agent`,
    `npm run build`,
    `npm run apply -- --plan-id ${plan.plan_id}`,
    `\`\`\``,
    ``,
    `## To discard this plan:`,
    ``,
    `\`\`\`bash`,
    `# Simply delete the plan file — no files have been changed:`,
    `del reports\\dev-agent\\plans\\${plan.plan_id}.json`,
    `\`\`\``,
    ``,
    `---`,
    ``,
    `_Generated by mallmind-dev-agent v0.2.0_`,
  ];

  const planMdPath = resolve(reportsDir, `plan-${timestamp()}.md`);
  writeFileSync(planMdPath, sections.join("\n"), "utf-8");

  return { planJsonPath, planMdPath };
}

// ── Change report ─────────────────────────────────────────────────────────────

export function writeChangeReport(
  plan:         StoredPlan,
  editResults:  EditResult[],
  buildResults: BuildResult[]
): string {
  const reportsDir = getReportsDir();
  mkdirSync(reportsDir, { recursive: true });

  const allEditsOk   = editResults.every((r) => r.success);
  const allBuildsOk  = buildResults.length === 0 || buildResults.every((r) => r.success);
  const overallOk    = allEditsOk && allBuildsOk;
  const overallIcon  = overallOk ? "✅ SUCCEEDED" : "❌ FAILED";

  // Files changed section
  const filesSection = editResults.length === 0
    ? "_No files were changed._"
    : editResults
        .map((r) => {
          const icon = r.success ? "✅" : "❌";
          const delta = r.lines_added > 0 || r.lines_removed > 0
            ? ` (+${r.lines_added} / -${r.lines_removed} lines)`
            : "";
          return [
            `### ${icon} \`${r.file_path}\`${delta}`,
            ``,
            r.success
              ? `**${r.description}**`
              : `**FAILED:** ${r.error ?? "Unknown error"}`,
          ].join("\n");
        })
        .join("\n\n");

  // Commit message block
  const commitBlock = plan.suggested_commit_message
    ? [
        `‼️  Copy and paste this — do not edit the Co-Authored-By line:`,
        ``,
        `${"─".repeat(60)}`,
        plan.suggested_commit_message,
        ``,
        `Co-Authored-By: MallMind Dev Agent v0.2.0`,
        `${"─".repeat(60)}`,
      ].join("\n")
    : "_No commit message available._";

  // Next steps checklist
  const touchedFiles = editResults.filter((r) => r.success).map((r) => r.file_path);
  const gitAddLines  = touchedFiles.map((f) => `- [ ] \`git add ${f}\``);

  const nextSteps = [
    `- [ ] Review the diff(s) above`,
    `- [ ] Run \`npm run dev\` and smoke-test the changes manually`,
    ...gitAddLines,
    `- [ ] \`git commit\` using the message above`,
    `- [ ] \`git push origin <your-branch>\``,
    ...(plan.task.run_verify ? [`- [ ] Check the verify:backend output above for regressions`] : []),
  ].join("\n");

  const rollbackNote = allEditsOk
    ? `Backups stored at: \`reports/dev-agent/backups/${plan.plan_id}/\`\n` +
      `To roll back: \`npm run abort -- --plan-id ${plan.plan_id}\``
    : `⚠️  Some writes failed. Run \`npm run abort -- --plan-id ${plan.plan_id}\` to restore originals.`;

  const sections = [
    `# MallMind Dev Agent — Change Report`,
    ``,
    `> **Plan ID:** \`${plan.plan_id}\``,
    `> **Task:** \`${plan.task.task_id}\` — ${plan.task.description}`,
    `> **Completed:** ${new Date().toISOString()}`,
    `> **Overall: ${overallIcon}**`,
    ``,
    `---`,
    ``,
    `## Files Changed`,
    ``,
    filesSection,
    ``,
    `---`,
    ``,
    `## Build Results`,
    ``,
    formatBuildResults(buildResults),
    ``,
    `---`,
    ``,
    `## Suggested Commit Message`,
    ``,
    commitBlock,
    ``,
    `---`,
    ``,
    `## What to Do Next`,
    ``,
    nextSteps,
    ``,
    `---`,
    ``,
    `## Rollback`,
    ``,
    rollbackNote,
    ``,
    `---`,
    ``,
    `_Generated by mallmind-dev-agent v0.2.0_`,
  ];

  const changeMdPath = resolve(reportsDir, `change-${timestamp()}.md`);
  writeFileSync(changeMdPath, sections.join("\n"), "utf-8");

  console.log(`✅ Change report written to: ${changeMdPath}`);
  return changeMdPath;
}

// ── Abort report ──────────────────────────────────────────────────────────────

export function writeAbortReport(planId: string, restored: string[], errors: string[]): string {
  const reportsDir = getReportsDir();
  mkdirSync(reportsDir, { recursive: true });

  const sections = [
    `# MallMind Dev Agent — Rollback Report`,
    ``,
    `> **Plan ID:** \`${planId}\``,
    `> **Rolled back:** ${new Date().toISOString()}`,
    `> **Status:** ${errors.length === 0 ? "✅ Complete" : "⚠️  Partial (see errors)"}`,
    ``,
    `## Restored Files`,
    ``,
    restored.length > 0
      ? restored.map((f) => `- ✅ \`${f}\``).join("\n")
      : "_No files were restored._",
    ``,
    ...(errors.length > 0
      ? [`## Errors`, ``, ...errors.map((e) => `- ❌ ${e}`), ``]
      : []),
    `---`,
    ``,
    `_Generated by mallmind-dev-agent v0.2.0_`,
  ];

  const path = resolve(reportsDir, `abort-${timestamp()}.md`);
  writeFileSync(path, sections.join("\n"), "utf-8");
  return path;
}

// Re-export dirs for taskRunner to use
export { getReportsDir, getPlansDir, getBackupsDir };
