/**
 * MallMind Dev Agent — MVP Entry Point
 *
 * Version: 0.1.0
 * Scope: VERIFY_BACKEND_DEV only
 *
 * This agent can:
 *   ✅ Receive a task via CLI argument or environment variable
 *   ✅ Run safety checks (hardcoded, not AI-decided)
 *   ✅ Run smoke tests against the live Cloud Run dev backend
 *   ✅ Write a structured Markdown report with Gemini-powered analysis
 *
 * This agent cannot (by design):
 *   ❌ Edit code automatically
 *   ❌ Push branches or open PRs
 *   ❌ Deploy to Cloud Run
 *   ❌ Change IAM or secrets
 *   ❌ Run database migrations
 *   ❌ Touch wallet/payment/P2P files
 *   ❌ Access production services
 *
 * Usage:
 *   node dist/index.js --task VERIFY_BACKEND_DEV
 *   TASK=VERIFY_BACKEND_DEV node dist/index.js
 */

import "dotenv/config";
import { checkSafety, summariseSafetyResult } from "./safetyGuard.js";
import { runSmokeTests } from "./smokeTests.js";
import { writeReport } from "./reportWriter.js";

// ── Config ────────────────────────────────────────────────────────────────────

const BANNER = `
╔══════════════════════════════════════════════════════╗
║         MallMind Dev Agent  v0.1.0 (MVP)             ║
║         Read / Test / Report only                    ║
║         No code edits. No deployments.               ║
╚══════════════════════════════════════════════════════╝
`.trim();

// ── Argument parsing ──────────────────────────────────────────────────────────

function getTaskType(): string {
  // 1. Check --task flag in argv
  const argIndex = process.argv.indexOf("--task");
  if (argIndex !== -1 && process.argv[argIndex + 1]) {
    return process.argv[argIndex + 1];
  }
  // 2. Check TASK environment variable
  if (process.env.TASK) return process.env.TASK;

  // 3. Default for MVP
  return "VERIFY_BACKEND_DEV";
}

function getInstruction(): string | undefined {
  const argIndex = process.argv.indexOf("--instruction");
  if (argIndex !== -1 && process.argv[argIndex + 1]) {
    return process.argv[argIndex + 1];
  }
  return process.env.AGENT_INSTRUCTION;
}

function getBaseUrl(): string {
  return (
    process.env.CLOUD_RUN_DEV_URL ??
    "https://mallmind-backend-dev-1017902775578.africa-south1.run.app"
  );
}

// ── Blocked report writer (no Gemini needed) ──────────────────────────────────

function writeBlockedReport(taskType: string, reason: string): void {
  const timestamp = new Date().toISOString();
  console.error(`\n🚫 Agent blocked at safety check.`);
  console.error(`   Task: ${taskType}`);
  console.error(`   Reason: ${reason}`);
  console.error(`\n   No report written. No action taken.`);
  console.error(`   Timestamp: ${timestamp}`);
  process.exit(1);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(`\n${BANNER}\n`);

  const taskType = getTaskType();
  const instruction = getInstruction();
  const baseUrl = getBaseUrl();

  console.log(`📋 Task type : ${taskType}`);
  console.log(`🌐 Target URL: ${baseUrl}`);
  if (instruction) console.log(`📝 Instruction: ${instruction}`);
  console.log(``);

  // ── Step 1: Safety check ──────────────────────────────────────────────────
  console.log(`🛡️  Running safety check...`);
  const safety = checkSafety(taskType, instruction);
  console.log(`   ${summariseSafetyResult(safety)}`);

  if (!safety.safe) {
    writeBlockedReport(taskType, safety.reason ?? "Unknown reason");
    return;
  }

  // ── Step 2: Run smoke tests ───────────────────────────────────────────────
  const suite = await runSmokeTests(baseUrl);

  // ── Step 3: Write report ──────────────────────────────────────────────────
  const reportPath = await writeReport(suite);

  // ── Step 4: Exit summary ──────────────────────────────────────────────────
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

  // Exit with non-zero if any endpoints are broken
  if (suite.brokenCount > 0) {
    process.exit(2); // 2 = smoke tests have failures (not a crash)
  }
}

main().catch((err) => {
  console.error(`\n💥 Unhandled error in agent:`, err);
  process.exit(1);
});
