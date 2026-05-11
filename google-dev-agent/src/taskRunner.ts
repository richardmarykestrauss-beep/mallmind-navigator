/**
 * taskRunner.ts
 *
 * Orchestrates the two-stage IMPLEMENT_TASK workflow.
 *
 * ─── Stage 1: Plan ────────────────────────────────────────────────────────────
 *   runPlanMode(taskFilePath, repoRoot)
 *   1. Load + validate task JSON
 *   2. Safety check (task_type, instruction)
 *   3. Validate allowed_write_paths (safety gates)
 *   4. Read all files in read_paths
 *   5. Call Gemini → produce StoredPlan
 *   6. Write plan.json + plan.md
 *   7. STOP — print approval instructions. No files touched.
 *
 * ─── Stage 2: Apply ───────────────────────────────────────────────────────────
 *   runApplyMode(planId, repoRoot)
 *   1. Load plan.json
 *   2. Re-run safety check
 *   3. Re-validate file paths
 *   4. Backup original files
 *   5. Apply edits (old_string verified before any write)
 *   6. Run build
 *   7. Run verify if task.run_verify
 *   8. Write change report
 *   9. STOP — print next steps. No git/deploy/SQL.
 *
 * ─── Abort: Rollback ──────────────────────────────────────────────────────────
 *   runAbortMode(planId, repoRoot)
 *   Restores all files from backup. Writes abort report.
 *
 * Safety boundary: this module never calls git, gcloud, supabase, or npm install.
 */

import { checkSafety, summariseSafetyResult, isFilePathAllowed } from "./safetyGuard.js";
import { loadTask, loadStoredPlan }                               from "./taskSchema.js";
import { readAll, summariseReads }                                from "./fileReader.js";
import { generatePlan }                                           from "./planner.js";
import { applyPlan, restoreBackup }                               from "./fileEditor.js";
import { runBuilds, allBuildsSucceeded, buildWasSkipped }         from "./buildRunner.js";
import {
  writePlanReport,
  writeChangeReport,
  writeAbortReport,
  getPlansDir,
  getBackupsDir,
} from "./changeReport.js";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

// ── Repo root ─────────────────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));

export function getRepoRoot(): string {
  // When compiled: dist/ → google-dev-agent/ → repo root
  // When ts-node:  src/  → google-dev-agent/ → repo root
  return resolve(__dirname, "..", "..");
}

// ── Stage 1: Plan ─────────────────────────────────────────────────────────────

export async function runPlanMode(taskFilePath: string): Promise<void> {
  const repoRoot = getRepoRoot();
  const cwd      = process.cwd();

  console.log(`\n📋 PLAN MODE`);
  console.log(`   Repo root : ${repoRoot}`);
  console.log(`   Task file : ${taskFilePath}`);
  console.log(``);

  // ── 1. Load + validate task ───────────────────────────────────────────────
  console.log(`🗂️  Loading task...`);
  let task;
  try {
    task = loadTask(taskFilePath, cwd);
  } catch (err) {
    console.error(`\n❌ ${String(err)}`);
    process.exit(1);
  }
  console.log(`   ✅ Task: ${task.task_id} — "${task.description}"`);
  console.log(`   📝 Read paths (${task.read_paths.length}): ${task.read_paths.join(", ")}`);
  console.log(`   ✏️  Write paths (${task.allowed_write_paths.length}): ${task.allowed_write_paths.join(", ")}`);
  console.log(``);

  // ── 2. Safety check ───────────────────────────────────────────────────────
  console.log(`🛡️  Running safety check...`);
  const safety = checkSafety(task.task_type, task.instruction);
  console.log(`   ${summariseSafetyResult(safety)}`);
  if (!safety.safe) {
    console.error(`\n🚫 Agent blocked. Reason: ${safety.reason}`);
    process.exit(1);
  }

  // ── 3. Validate write paths ───────────────────────────────────────────────
  console.log(`\n🔒 Validating write path permissions...`);
  let pathError = false;
  for (const p of task.allowed_write_paths) {
    const result = isFilePathAllowed(p);
    if (result.allowed) {
      console.log(`   ✅ ${p}`);
    } else {
      console.error(`   ❌ ${p} — ${result.reason}`);
      pathError = true;
    }
  }
  if (pathError) {
    console.error(`\n🚫 One or more write paths failed the safety check. Fix the task file.`);
    process.exit(1);
  }

  // ── 4. Read files ─────────────────────────────────────────────────────────
  console.log(`\n📂 Reading source files...`);
  const readResults   = readAll(task.read_paths, repoRoot);
  console.log(summariseReads(readResults));

  const fileContents  = new Map<string, string>();
  for (const r of readResults) {
    if (r.content !== null) fileContents.set(r.path, r.content);
  }

  // Check that all write paths were successfully read (Gemini needs their content)
  for (const wp of task.allowed_write_paths) {
    const norm = wp.replace(/\\/g, "/");
    if (!fileContents.has(norm)) {
      const skipped = readResults.find((r) => r.path === norm);
      console.error(
        `\n❌ Could not read write-target "${wp}": ${skipped?.skipReason ?? "file not found"}. ` +
          `Ensure the file exists and is in read_paths.`
      );
      process.exit(1);
    }
  }

  // ── 5. Generate plan ──────────────────────────────────────────────────────
  let plan;
  try {
    plan = await generatePlan(task, fileContents);
  } catch (err) {
    console.error(`\n❌ Plan generation failed: ${String(err)}`);
    process.exit(1);
  }

  if (plan.changes.length === 0) {
    console.log(`\nℹ️  Gemini reports no changes are needed:`);
    console.log(`   "${plan.summary}"`);
    console.log(`\nNo plan written. The task may already be complete.`);
    process.exit(0);
  }

  // ── 6. Write plan ─────────────────────────────────────────────────────────
  const { planJsonPath, planMdPath } = writePlanReport(plan);
  console.log(`\n📝 Plan written:`);
  console.log(`   JSON : ${planJsonPath}`);
  console.log(`   Report : ${planMdPath}`);

  // ── 7. Stop — print approval instructions ─────────────────────────────────
  console.log(`\n${"─".repeat(64)}`);
  console.log(`  PLAN READY — NO FILES HAVE BEEN CHANGED`);
  console.log(`${"─".repeat(64)}`);
  console.log(`  Plan ID    : ${plan.plan_id}`);
  console.log(`  Changes    : ${plan.changes.length}`);
  console.log(`  Summary    : ${plan.summary.slice(0, 100)}${plan.summary.length > 100 ? "…" : ""}`);
  console.log(`${"─".repeat(64)}`);
  console.log(``);
  console.log(`  📖 Review the plan report before approving:`);
  console.log(`     ${planMdPath}`);
  console.log(``);
  console.log(`  ✅ To apply:`);
  console.log(`     npm run build`);
  console.log(`     npm run apply -- --plan-id ${plan.plan_id}`);
  console.log(``);
  console.log(`  ❌ To discard:`);
  console.log(`     del reports\\dev-agent\\plans\\${plan.plan_id}.json`);
  console.log(`${"─".repeat(64)}\n`);
}

// ── Stage 2: Apply ────────────────────────────────────────────────────────────

export async function runApplyMode(planId: string): Promise<void> {
  const repoRoot  = getRepoRoot();
  const plansDir  = getPlansDir();
  const backupDir = getBackupsDir();

  console.log(`\n🔧 APPLY MODE`);
  console.log(`   Repo root : ${repoRoot}`);
  console.log(`   Plan ID   : ${planId}`);
  console.log(``);

  // ── 1. Load plan ──────────────────────────────────────────────────────────
  console.log(`🗂️  Loading plan...`);
  let plan;
  try {
    plan = loadStoredPlan(planId, plansDir);
  } catch (err) {
    console.error(`\n❌ ${String(err)}`);
    console.error(`   Run \`npm run plan\` to generate a new plan.`);
    process.exit(1);
  }
  console.log(`   ✅ Plan: ${plan.plan_id} for task ${plan.task.task_id}`);
  console.log(`   📝 ${plan.changes.length} change(s) to apply`);
  console.log(``);

  // ── 2. Re-run safety check ────────────────────────────────────────────────
  console.log(`🛡️  Re-running safety check...`);
  const safety = checkSafety(plan.task.task_type, plan.task.instruction);
  console.log(`   ${summariseSafetyResult(safety)}`);
  if (!safety.safe) {
    console.error(`\n🚫 Agent blocked. Reason: ${safety.reason}`);
    process.exit(1);
  }

  // ── 3. Re-validate write paths ────────────────────────────────────────────
  console.log(`\n🔒 Re-validating write path permissions...`);
  for (const change of plan.changes) {
    const result = isFilePathAllowed(change.file_path);
    if (!result.allowed) {
      console.error(`   ❌ "${change.file_path}" — ${result.reason}`);
      console.error(`\n🚫 A file in the plan failed the safety check. Re-generate the plan.`);
      process.exit(1);
    }
    console.log(`   ✅ ${change.file_path}`);
  }

  // ── 4 + 5. Apply edits (backup + write) ──────────────────────────────────
  console.log(`\n✏️  Applying ${plan.changes.length} edit(s)...`);
  const applyOutcome = applyPlan(plan, repoRoot, backupDir);

  if (!applyOutcome.disk_writes_attempted) {
    console.error(`\n❌ Pre-flight failed — no files were changed.`);
    console.error(`   ${applyOutcome.error}`);
    process.exit(1);
  }

  for (const r of applyOutcome.results) {
    if (r.success) {
      const delta = r.lines_added > 0 || r.lines_removed > 0
        ? ` (+${r.lines_added}/-${r.lines_removed})`
        : "";
      console.log(`   ✅ ${r.file_path}${delta} — ${r.description}`);
    } else {
      console.error(`   ❌ ${r.file_path} — ${r.error}`);
    }
  }

  if (!applyOutcome.success) {
    const failedFiles = applyOutcome.results.filter((r) => !r.success).map((r) => r.file_path);
    console.error(`\n❌ Some edits failed: ${failedFiles.join(", ")}`);
    console.error(`   Run: npm run abort -- --plan-id ${planId}`);
    process.exit(1);
  }

  // ── 6 + 7. Build ──────────────────────────────────────────────────────────
  console.log(`\n⚙️  Running build...`);
  const buildResults = await runBuilds(plan.task.build_target, repoRoot, plan.task.run_verify);

  const buildOk      = buildWasSkipped(buildResults) || allBuildsSucceeded(buildResults);

  // ── 8. Write change report ────────────────────────────────────────────────
  const reportPath = writeChangeReport(plan, applyOutcome.results, buildResults);

  // ── 9. Exit summary ───────────────────────────────────────────────────────
  const overallOk = applyOutcome.success && buildOk;

  console.log(`\n${"─".repeat(64)}`);
  console.log(`  ${overallOk ? "✅ APPLY SUCCEEDED" : "❌ APPLY COMPLETED WITH ERRORS"}`);
  console.log(`${"─".repeat(64)}`);
  console.log(`  Files changed : ${applyOutcome.results.filter((r) => r.success).length}`);
  console.log(`  Build         : ${buildWasSkipped(buildResults) ? "skipped" : (allBuildsSucceeded(buildResults) ? "PASSED" : "FAILED")}`);
  console.log(`  Change report : ${reportPath}`);
  console.log(`${"─".repeat(64)}`);
  console.log(``);

  if (!buildOk) {
    console.log(`  ⚠️  Build failed. Your source files have been edited but the build is broken.`);
    console.log(`     Review the change report and either fix the error manually or roll back:`);
    console.log(`     npm run abort -- --plan-id ${planId}`);
    console.log(``);
    process.exit(2);
  }

  console.log(`  ✅ Review the change report, then commit manually:`);
  console.log(`     ${reportPath}`);
  console.log(``);
  console.log(`  ⚠️  DO NOT run git commit or git push automatically.`);
  console.log(`     Review the diff in the report first.`);
  console.log(`${"─".repeat(64)}\n`);
}

// ── Abort: Rollback ───────────────────────────────────────────────────────────

export async function runAbortMode(planId: string): Promise<void> {
  const repoRoot  = getRepoRoot();
  const plansDir  = getPlansDir();
  const backupDir = getBackupsDir();

  console.log(`\n⏪ ABORT MODE`);
  console.log(`   Plan ID : ${planId}`);
  console.log(``);

  // Load plan to know which files to restore
  let plan;
  try {
    plan = loadStoredPlan(planId, plansDir);
  } catch (err) {
    console.error(`\n❌ Cannot load plan: ${String(err)}`);
    console.error(`   Cannot roll back without the plan file.`);
    process.exit(1);
  }

  console.log(`   Restoring ${[...new Set(plan.changes.map((c) => c.file_path))].length} file(s) from backup...`);

  const rollback    = restoreBackup(plan, repoRoot, backupDir);
  const reportPath  = writeAbortReport(planId, rollback.restored, rollback.errors);

  for (const f of rollback.restored) console.log(`   ✅ Restored: ${f}`);
  for (const e of rollback.errors)   console.error(`   ❌ Error: ${e}`);

  console.log(`\n${"─".repeat(64)}`);
  console.log(`  ${rollback.success ? "✅ ROLLBACK COMPLETE" : "⚠️  ROLLBACK PARTIAL"}`);
  console.log(`  Abort report: ${reportPath}`);
  console.log(`${"─".repeat(64)}\n`);

  if (!rollback.success) process.exit(1);
}
