/**
 * MallMind Dev Agent — Entry Point
 *
 * Version: 0.2.0
 *
 * Phase 1 (v0.1.0): VERIFY_BACKEND_DEV — smoke tests + Gemini report
 * Phase 2 (v0.2.0): IMPLEMENT_TASK — controlled builder (plan → approve → apply)
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * VERIFY_BACKEND_DEV (unchanged from v0.1.0):
 *   node dist/index.js --task VERIFY_BACKEND_DEV
 *   npm run verify
 *
 * IMPLEMENT_TASK — Stage 1 (generate plan, stop for human review):
 *   node dist/index.js --task-file tasks/my-task.json
 *   npm run plan -- --task-file tasks/my-task.json
 *
 * IMPLEMENT_TASK — Stage 2 (apply approved plan):
 *   node dist/index.js --approve --plan-id plan-20260511-143022
 *   npm run apply -- --plan-id plan-20260511-143022
 *
 * Rollback (restore files from backup):
 *   node dist/index.js --abort --plan-id plan-20260511-143022
 *   npm run abort -- --plan-id plan-20260511-143022
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * This agent will NEVER automatically:
 *   ❌ Run git commit or git push
 *   ❌ Deploy to Cloud Run
 *   ❌ Execute Supabase SQL
 *   ❌ Change IAM or secrets
 *   ❌ Run npm install
 *   ❌ Touch wallet/payment/P2P/financial files
 */

import "dotenv/config";
import { checkSafety, summariseSafetyResult } from "./safetyGuard.js";
import { runSmokeTests }                       from "./smokeTests.js";
import { writeReport }                         from "./reportWriter.js";
import { runPlanMode, runApplyMode, runAbortMode } from "./taskRunner.js";

// ── Banner ────────────────────────────────────────────────────────────────────

const BANNER = `
╔══════════════════════════════════════════════════════╗
║         MallMind Dev Agent  v0.2.0                   ║
║         Plan / Apply / Verify — never auto-deploy    ║
║         No git. No SQL. No gcloud. You approve.      ║
╚══════════════════════════════════════════════════════╝
`.trim();

// ── Argument parsing ──────────────────────────────────────────────────────────

function getArg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  if (idx !== -1 && process.argv[idx + 1] && !process.argv[idx + 1].startsWith("--")) {
    return process.argv[idx + 1];
  }
  return undefined;
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

function getTaskType(): string {
  const argIndex = process.argv.indexOf("--task");
  if (argIndex !== -1 && process.argv[argIndex + 1]) {
    return process.argv[argIndex + 1];
  }
  if (process.env.TASK) return process.env.TASK;
  return "VERIFY_BACKEND_DEV";
}

function getInstruction(): string | undefined {
  return getArg("--instruction") ?? process.env.AGENT_INSTRUCTION;
}

function getBaseUrl(): string {
  return (
    process.env.CLOUD_RUN_DEV_URL ??
    "https://mallmind-backend-dev-1017902775578.africa-south1.run.app"
  );
}

// ── Blocked report (no Gemini needed) ────────────────────────────────────────

function writeBlockedReport(taskType: string, reason: string): void {
  console.error(`\n🚫 Agent blocked at safety check.`);
  console.error(`   Task: ${taskType}`);
  console.error(`   Reason: ${reason}`);
  console.error(`\n   No report written. No action taken.`);
  console.error(`   Timestamp: ${new Date().toISOString()}`);
  process.exit(1);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(`\n${BANNER}\n`);

  // ── Route: --abort --plan-id <id> ─────────────────────────────────────────
  if (hasFlag("--abort")) {
    const planId = getArg("--plan-id");
    if (!planId) {
      console.error(`❌ --abort requires --plan-id <plan-id>`);
      console.error(`   Example: npm run abort -- --plan-id plan-20260511-143022`);
      process.exit(1);
    }
    await runAbortMode(planId);
    return;
  }

  // ── Route: --approve --plan-id <id> ──────────────────────────────────────
  if (hasFlag("--approve")) {
    const planId = getArg("--plan-id");
    if (!planId) {
      console.error(`❌ --approve requires --plan-id <plan-id>`);
      console.error(`   Example: npm run apply -- --plan-id plan-20260511-143022`);
      process.exit(1);
    }
    await runApplyMode(planId);
    return;
  }

  // ── Route: --task-file <path> (plan mode) ─────────────────────────────────
  const taskFile = getArg("--task-file");
  if (taskFile) {
    await runPlanMode(taskFile);
    return;
  }

  // ── Route: VERIFY_BACKEND_DEV (v0.1.0 smoke tests — unchanged) ───────────
  const taskType   = getTaskType();
  const instruction = getInstruction();
  const baseUrl    = getBaseUrl();

  console.log(`📋 Task type : ${taskType}`);
  console.log(`🌐 Target URL: ${baseUrl}`);
  if (instruction) console.log(`📝 Instruction: ${instruction}`);
  console.log(``);

  console.log(`🛡️  Running safety check...`);
  const safety = checkSafety(taskType, instruction);
  console.log(`   ${summariseSafetyResult(safety)}`);

  if (!safety.safe) {
    writeBlockedReport(taskType, safety.reason ?? "Unknown reason");
    return;
  }

  const suite      = await runSmokeTests(baseUrl);
  const reportPath = await writeReport(suite);

  console.log(`\n${"─".repeat(60)}`);
  console.log(`  OVERALL: ${suite.overallStatus}`);
  console.log(`  ✅ REAL:           ${suite.passCount}`);
  console.log(`  🟢 VERIFIED_DATA:  ${suite.verifiedDataCount}`);
  console.log(`  🟡 DEMO_DATA:      ${suite.demoDataCount}`);
  console.log(`  ⚠️  PARTIAL:        ${suite.partialCount}`);
  console.log(`  ❌ BROKEN:         ${suite.brokenCount}`);
  console.log(`  ⛔ BLOCKED:        ${suite.blockedCount}`);
  console.log(`${"─".repeat(60)}`);
  console.log(`  Report: ${reportPath}`);
  console.log(`${"─".repeat(60)}\n`);

  if (suite.brokenCount > 0) process.exit(2);
}

main().catch((err) => {
  console.error(`\n💥 Unhandled error in agent:`, err);
  process.exit(1);
});
