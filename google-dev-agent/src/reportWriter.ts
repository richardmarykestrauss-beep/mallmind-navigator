/**
 * reportWriter.ts
 *
 * Uses Gemini 2.5 Flash to write an intelligent markdown smoke-test report.
 * If Gemini is unavailable (no credentials), falls back to a structured
 * template-based report so the agent always produces output.
 *
 * Output: a markdown file written to REPORTS_DIR.
 */

import { GoogleGenAI } from "@google/genai";
import { mkdirSync, writeFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import type { SmokeTestSuite, SmokeTestResult, EndpointStatus } from "./smokeTests.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));

function statusIcon(status: EndpointStatus): string {
  switch (status) {
    case "REAL":           return "✅ REAL";
    case "VERIFIED_DATA":  return "🟢 VERIFIED_DATA";
    case "DEMO_DATA":      return "🟡 DEMO_DATA";
    case "PARTIAL":        return "⚠️  PARTIAL";
    case "BROKEN":         return "❌ BROKEN";
    case "BLOCKED":        return "⛔ BLOCKED";
  }
}

function overallIcon(status: SmokeTestSuite["overallStatus"]): string {
  switch (status) {
    case "ALL_PASSED":  return "✅ ALL PASSED";
    case "SOME_FAILED": return "⚠️  SOME ISSUES";
    case "ALL_FAILED":  return "❌ ALL FAILED";
  }
}

function formatDuration(startedAt: string, completedAt: string): string {
  const ms = new Date(completedAt).getTime() - new Date(startedAt).getTime();
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

// ── Status legend ─────────────────────────────────────────────────────────────

const STATUS_LEGEND = `
| Status | Meaning | Safe for |
|--------|---------|----------|
| ✅ REAL | \`data_quality_status = live_feed\` — prices from retailer API or scraper | Production |
| 🟢 VERIFIED_DATA | \`data_quality_status = manually_verified\` + \`price_verified_at\` set — price confirmed by phone, website, flyer, receipt, store visit, or retailer | Demo / Pilot |
| 🟡 DEMO_DATA | \`data_quality_status = demo\` — seeded test data, price not independently confirmed | Tech testing only |
| ⚠️ PARTIAL | Mixed \`data_quality_status\` values, or endpoint responds with empty/incomplete results | Not safe |
| ❌ BROKEN | HTTP error, timeout, or unexpected response format | — |
| ⛔ BLOCKED | Not tested — missing credentials or blocked by safety rules | — |
`.trim();

// ── Results table ─────────────────────────────────────────────────────────────

function buildResultsTable(results: SmokeTestResult[]): string {
  const rows = results.map((r) =>
    `| ${r.testName} | \`${r.method} ${r.endpoint}\` | ${statusIcon(r.status)} | ${r.httpStatus ?? "—"} | ${r.responseTimeMs}ms |`
  );
  return [
    "| Test | Endpoint | Status | HTTP | Time |",
    "|------|----------|--------|------|------|",
    ...rows,
  ].join("\n");
}

function buildCountsLine(suite: SmokeTestSuite): string {
  const parts = [
    suite.passCount         > 0 ? `✅ REAL: **${suite.passCount}**`                 : null,
    suite.verifiedDataCount > 0 ? `🟢 VERIFIED_DATA: **${suite.verifiedDataCount}**` : null,
    suite.demoDataCount     > 0 ? `🟡 DEMO_DATA: **${suite.demoDataCount}**`         : null,
    suite.partialCount      > 0 ? `⚠️ PARTIAL: **${suite.partialCount}**`            : null,
    suite.brokenCount       > 0 ? `❌ BROKEN: **${suite.brokenCount}**`              : null,
    suite.blockedCount      > 0 ? `⛔ BLOCKED: **${suite.blockedCount}**`            : null,
  ].filter(Boolean);
  return parts.join(" · ");
}

// ── Per-endpoint detail ───────────────────────────────────────────────────────

function buildEndpointDetail(result: SmokeTestResult): string {
  const lines = [
    `### ${statusIcon(result.status)} ${result.testName}`,
    ``,
    `- **Endpoint:** \`${result.method} ${result.endpoint}\``,
    `- **HTTP status:** ${result.httpStatus ?? "no response"}`,
    `- **Response time:** ${result.responseTimeMs}ms`,
    `- **Summary:** ${result.summary}`,
  ];

  if (result.error) {
    lines.push(`- **Error:** \`${result.error}\``);
  }

  if (result.responsePreview) {
    lines.push(``, `**Response preview:**`, `\`\`\`json`, result.responsePreview, `\`\`\``);
  }

  return lines.join("\n");
}

// ── Gemini-powered analysis ───────────────────────────────────────────────────

async function generateGeminiAnalysis(suite: SmokeTestSuite): Promise<string> {
  const project = process.env.GOOGLE_CLOUD_PROJECT;
  if (!project) {
    return "_Gemini analysis skipped — GOOGLE_CLOUD_PROJECT not set._";
  }

  try {
    const ai = new GoogleGenAI({
      vertexai: true,
      project,
      location: process.env.VERTEX_AI_LOCATION ?? "us-central1",
    });

    const prompt = `
You are a senior software engineer reviewing a smoke test report for MallMind, a South African mall shopping assistant.

Here are the smoke test results in JSON:
${JSON.stringify(suite.results.map((r) => ({
  test: r.testName,
  endpoint: `${r.method} ${r.endpoint}`,
  status: r.status,
  httpStatus: r.httpStatus,
  responseTimeMs: r.responseTimeMs,
  summary: r.summary,
})), null, 2)}

Overall status: ${suite.overallStatus}
REAL: ${suite.passCount}, VERIFIED_DATA: ${suite.verifiedDataCount}, DEMO_DATA: ${suite.demoDataCount}, PARTIAL: ${suite.partialCount}, BROKEN: ${suite.brokenCount}, BLOCKED: ${suite.blockedCount}

Status meanings (driven by data_quality_status field on products):
- REAL: data_quality_status=live_feed — prices from retailer API or automated scraper. Safe for production.
- VERIFIED_DATA: data_quality_status=manually_verified AND price_verified_at set — price confirmed by a human against a real source (phone, website, flyer, receipt, store visit). Safe for demo/pilot.
- DEMO_DATA: data_quality_status=demo — seeded test data, price never independently confirmed. Safe for tech testing only.
- PARTIAL: mixed data_quality_status values across products, or endpoint returns empty results. Needs attention.
- BROKEN: HTTP error or crash

Write a concise technical analysis (200-350 words) covering:
1. What is working and production-ready
2. What needs attention before a real user demo
3. The single most important issue to fix first
4. One specific next action for the developer

Be direct and specific. Reference endpoint names. Do not use bullet points — write in short paragraphs.
Do not mention AI, Gemini, or that you generated this text.
    `.trim();

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
    });

    return response.text?.trim() ?? "_Gemini analysis returned empty response._";
  } catch (err) {
    const msg = String(err);
    const isAdcError = msg.includes("default credentials") || msg.includes("ADC");
    const hint = isAdcError
      ? " Run `gcloud auth application-default login` to enable Gemini analysis locally."
      : "";
    return `_Gemini analysis failed: ${msg}.${hint}_`;
  }
}

// ── Template fallback (no Gemini) ─────────────────────────────────────────────

function generateTemplateAnalysis(suite: SmokeTestSuite): string {
  const broken       = suite.results.filter((r) => r.status === "BROKEN");
  const partial      = suite.results.filter((r) => r.status === "PARTIAL");
  const blocked      = suite.results.filter((r) => r.status === "BLOCKED");
  const verified     = suite.results.filter((r) => r.status === "VERIFIED_DATA");
  const demoOnly     = suite.results.filter((r) => r.status === "DEMO_DATA");
  const real         = suite.results.filter((r) => r.status === "REAL");

  const lines: string[] = [];

  if (real.length > 0) {
    lines.push(
      `**Production-ready (${real.length}):** ${real.map((r) => r.testName).join(", ")}. ` +
      `These endpoints are operating on live data with no known issues.`
    );
  }

  if (verified.length > 0) {
    lines.push(
      `**Verified data (${verified.length}):** ${verified.map((r) => r.testName).join(", ")}. ` +
      `These endpoints use seeded IDs but prices have been manually confirmed against real ` +
      `store prices at Mall@Reds. Demo-ready. To promote to REAL, replace seeded UUIDs with ` +
      `live retailer feed data.`
    );
  }

  if (demoOnly.length > 0) {
    lines.push(
      `**Unverified seed data (${demoOnly.length}):** ${demoOnly.map((r) => r.testName).join(", ")}. ` +
      `The tech is working but prices have not been confirmed against real store prices. ` +
      `Run migration 007_price_verified_at.sql to promote to VERIFIED_DATA.`
    );
  }

  if (partial.length > 0) {
    lines.push(
      `**Partial endpoints (${partial.length}):** ${partial.map((r) => r.testName).join(", ")}. ` +
      `These respond but return incomplete results. Check the per-endpoint details below for specific fix instructions.`
    );
  }

  if (broken.length > 0) {
    lines.push(
      `**Broken endpoints (${broken.length}):** ${broken.map((r) => r.testName).join(", ")}. ` +
      `These are not functioning. Check Cloud Run logs for errors.`
    );
  }

  if (blocked.length > 0) {
    lines.push(
      `**Blocked tests (${blocked.length}):** ${blocked.map((r) => r.testName).join(", ")}. ` +
      `Set the required environment variables and re-run to enable these tests.`
    );
  }

  if (lines.length === 0) {
    lines.push("No results to analyse.");
  }

  return lines.join("\n\n");
}

// ── Report builder ────────────────────────────────────────────────────────────

async function buildReport(suite: SmokeTestSuite): Promise<string> {
  const analysis = process.env.GOOGLE_CLOUD_PROJECT
    ? await generateGeminiAnalysis(suite)
    : generateTemplateAnalysis(suite);

  const duration = formatDuration(suite.startedAt, suite.completedAt);

  const sections = [
    `# MallMind Dev Agent — Backend Smoke Test Report`,
    ``,
    `> **Run ID:** \`${suite.runId}\``,
    `> **Target:** \`${suite.baseUrl}\``,
    `> **Started:** ${suite.startedAt}`,
    `> **Duration:** ${duration}`,
    `> **Overall:** ${overallIcon(suite.overallStatus)}`,
    `> **Counts:** ${buildCountsLine(suite)}`,
    ``,
    `---`,
    ``,
    `## Summary`,
    ``,
    buildResultsTable(suite.results),
    ``,
    `---`,
    ``,
    `## Analysis`,
    ``,
    analysis,
    ``,
    `---`,
    ``,
    `## Status Legend`,
    ``,
    STATUS_LEGEND,
    ``,
    `---`,
    ``,
    `## Endpoint Details`,
    ``,
    suite.results.map(buildEndpointDetail).join("\n\n---\n\n"),
    ``,
    `---`,
    ``,
    `## Agent Constraints`,
    ``,
    `This report was generated by the MallMind Dev Agent (MVP — read/test/report only).`,
    ``,
    `The agent in this version **cannot**:`,
    `- Edit code automatically`,
    `- Push branches or open PRs`,
    `- Deploy to Cloud Run`,
    `- Run database migrations`,
    `- Touch wallet, payment, or P2P files`,
    ``,
    `To action any findings in this report, a human developer must make the changes manually.`,
    ``,
    `_Generated by mallmind-dev-agent v0.1.0_`,
  ];

  return sections.join("\n");
}

// ── File writer ───────────────────────────────────────────────────────────────

export async function writeReport(suite: SmokeTestSuite): Promise<string> {
  const reportsDir = resolve(
    __dirname,
    "..",
    process.env.REPORTS_DIR ?? "../reports/dev-agent"
  );

  const timestamp = new Date()
    .toISOString()
    .replace(/[:.]/g, "-")
    .replace("T", "_")
    .slice(0, 19);

  const filename = `backend-smoke-test-${timestamp}.md`;
  const filePath = resolve(reportsDir, filename);

  console.log(`\n📝 Writing report...`);
  const content = await buildReport(suite);

  mkdirSync(reportsDir, { recursive: true });
  writeFileSync(filePath, content, "utf-8");

  console.log(`✅ Report written to: ${filePath}`);
  return filePath;
}
