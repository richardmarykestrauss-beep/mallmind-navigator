/**
 * buildRunner.ts
 *
 * Runs hardcoded npm build commands via child_process.spawn.
 *
 * Safety:
 *   - Only a fixed set of commands can be executed (ALLOWED_COMMANDS).
 *   - Any command string not in the allowlist is rejected before spawn.
 *   - Never runs: npm install, git, gcloud, supabase, rm, or any shell expansion.
 *   - All commands run with a hard timeout (kills the process if exceeded).
 *   - stdout and stderr are captured in full and returned to the caller.
 *
 * Command tokens (internal identifiers, not shell strings):
 *   "npm:frontend-build"  → npm run build           (in repoRoot)
 *   "npm:backend-lint"    → npm run lint             (in google-cloud-backend)
 *   "npm:agent-lint"      → npm run lint             (in google-dev-agent)
 *   "npm:verify-backend"  → npm run verify:backend   (in repoRoot)
 */

import { spawn } from "child_process";
import { resolve } from "path";
import type { AgentTask } from "./taskSchema.js";

// ── Constants ─────────────────────────────────────────────────────────────────

const TIMEOUTS_MS: Record<string, number> = {
  "npm:frontend-build":  180_000,  // 3 min — Vite build can be slow
  "npm:backend-lint":     60_000,  // 1 min — tsc --noEmit
  "npm:agent-lint":       30_000,  // 30 s
  "npm:verify-backend":  120_000,  // 2 min — smoke tests
};

// Each token maps to { args, subdirectory }
// subdirectory is relative to repoRoot. "" means repoRoot itself.
const COMMAND_MAP: Record<string, { args: string[]; subdir: string }> = {
  "npm:frontend-build":  { args: ["run", "build"],          subdir: "" },
  "npm:backend-lint":    { args: ["run", "lint"],            subdir: "google-cloud-backend" },
  "npm:agent-lint":      { args: ["run", "lint"],            subdir: "google-dev-agent" },
  "npm:verify-backend":  { args: ["run", "verify:backend"],  subdir: "" },
};

// ── Types ─────────────────────────────────────────────────────────────────────

export interface BuildResult {
  /** Internal command token e.g. "npm:frontend-build" */
  command: string;
  /** Human-readable label for reports */
  label: string;
  success: boolean;
  exitCode: number | null;
  /** Combined stdout + stderr, trimmed */
  output: string;
  /** Last N lines of output (for report previews) */
  outputTail: string;
  durationMs: number;
  timedOut: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function commandLabel(token: string): string {
  const map: Record<string, string> = {
    "npm:frontend-build":  "npm run build (frontend)",
    "npm:backend-lint":    "npm run lint (google-cloud-backend)",
    "npm:agent-lint":      "npm run lint (google-dev-agent)",
    "npm:verify-backend":  "npm run verify:backend",
  };
  return map[token] ?? token;
}

function tailLines(text: string, n = 40): string {
  const lines = text.split("\n");
  return lines.length <= n ? text : lines.slice(-n).join("\n");
}

// ── Runner ────────────────────────────────────────────────────────────────────

function runCommand(token: string, repoRoot: string): Promise<BuildResult> {
  return new Promise((resolvePromise) => {
    const config = COMMAND_MAP[token];
    if (!config) {
      resolvePromise({
        command:    token,
        label:      commandLabel(token),
        success:    false,
        exitCode:   null,
        output:     `Unknown command token: "${token}". This is a bug in the agent.`,
        outputTail: "",
        durationMs: 0,
        timedOut:   false,
      });
      return;
    }

    const cwd       = resolve(repoRoot, config.subdir);
    const timeoutMs = TIMEOUTS_MS[token] ?? 60_000;
    const startedAt = Date.now();
    const chunks:   string[] = [];

    // Use "npm" on all platforms; on Windows, spawn needs shell:true for npm.cmd
    const isWindows = process.platform === "win32";
    const child = spawn(isWindows ? "npm.cmd" : "npm", config.args, {
      cwd,
      shell: false,
      env: { ...process.env },
    });

    child.stdout?.on("data", (data: Buffer) => chunks.push(data.toString()));
    child.stderr?.on("data", (data: Buffer) => chunks.push(data.toString()));

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      const output = chunks.join("");
      resolvePromise({
        command:    token,
        label:      commandLabel(token),
        success:    false,
        exitCode:   null,
        output,
        outputTail: tailLines(output),
        durationMs: Date.now() - startedAt,
        timedOut:   true,
      });
    }, timeoutMs);

    child.on("close", (code) => {
      clearTimeout(timer);
      const output    = chunks.join("").trim();
      const durationMs = Date.now() - startedAt;
      resolvePromise({
        command:    token,
        label:      commandLabel(token),
        success:    code === 0,
        exitCode:   code,
        output,
        outputTail: tailLines(output),
        durationMs,
        timedOut:   false,
      });
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      const output = `spawn error: ${String(err)}\n` + chunks.join("");
      resolvePromise({
        command:    token,
        label:      commandLabel(token),
        success:    false,
        exitCode:   null,
        output,
        outputTail: tailLines(output),
        durationMs: Date.now() - startedAt,
        timedOut:   false,
      });
    });
  });
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Run all build commands for the given build_target.
 * Stops after the first failure — subsequent commands are skipped.
 */
export async function runBuilds(
  buildTarget: AgentTask["build_target"],
  repoRoot: string,
  runVerify = false
): Promise<BuildResult[]> {
  const tokens: string[] = [];

  switch (buildTarget) {
    case "frontend": tokens.push("npm:frontend-build"); break;
    case "backend":  tokens.push("npm:backend-lint");   break;
    case "both":     tokens.push("npm:backend-lint", "npm:frontend-build"); break;
    case "none":     /* nothing */ break;
  }

  if (runVerify) tokens.push("npm:verify-backend");

  const results: BuildResult[] = [];
  for (const token of tokens) {
    console.log(`  ⚙️  Running: ${commandLabel(token)}...`);
    const result = await runCommand(token, repoRoot);
    results.push(result);
    const icon = result.success ? "✅" : result.timedOut ? "⏱️" : "❌";
    console.log(`  ${icon} ${result.label} — ${result.durationMs}ms`);
    if (!result.success) {
      console.log(`\n  Build output (tail):\n${result.outputTail}\n`);
      break; // stop on first failure
    }
  }

  return results;
}

/** Returns true only if all results are successful. */
export function allBuildsSucceeded(results: BuildResult[]): boolean {
  return results.length > 0 && results.every((r) => r.success);
}

/** Returns true if there were no build commands to run (build_target = "none"). */
export function buildWasSkipped(results: BuildResult[]): boolean {
  return results.length === 0;
}
