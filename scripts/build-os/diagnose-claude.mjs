/**
 * MallMind Build OS — AF-1 Claude execution-trace diagnostic (SANITIZED).
 *
 * Reads the official action's `execution_file` (the Claude Code SDK message
 * stream) and emits ONLY sanitized metadata: which tools were invoked, the file
 * paths passed to Edit/Write, Bash command *categories* (binary names — never
 * arguments), whether git was attempted, working directories, isolated-workspace
 * paths, the result/completion reason, permission denials, and the action
 * branch_name. It also records read-only git state right after Claude.
 *
 * It NEVER prints: API keys, tokens, Authorization headers, full file contents,
 * full prompts, environment-variable values, or raw tool output. Bash arguments
 * and all free text are redacted; tool_result content is dropped entirely.
 *
 * This is a DIAGNOSTIC only: it changes no git lifecycle, gate, permission,
 * evidence verdict, or production boundary.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, appendFileSync, existsSync } from "node:fs";
import process from "node:process";

// ── Redaction ────────────────────────────────────────────────────────────────

export const SECRET_PATTERNS = [
  /sk-ant-[A-Za-z0-9_-]{6,}/g,
  /gh[pousr]_[A-Za-z0-9]{20,}/g,
  /github_pat_[A-Za-z0-9_]{20,}/g,
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{6,}(?:\.[A-Za-z0-9_-]{6,})?/g, // JWT-ish / Supabase
  /AKIA[0-9A-Z]{16}/g,
  /AIza[0-9A-Za-z_-]{20,}/g,
  /x-access-token:[^@\s/]+/gi,
  /Bearer\s+[A-Za-z0-9._-]{8,}/gi,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/g,
  /\b(?:authorization|token|secret|password|passwd|api[_-]?key)\b\s*[=:]\s*\S+/gi,
];

/** Replace any token-like / credential-like substrings with <REDACTED>. */
export function redact(value) {
  let out = String(value ?? "");
  for (const re of SECRET_PATTERNS) out = out.replace(re, "<REDACTED>");
  return out;
}

const SHELL_SPLIT = /\s*(?:\|\||&&|\||;|\n)\s*/;

/**
 * Reduce a Bash command to safe categories: leading binary of each segment and,
 * for git/gh, the subcommand. Arguments are NEVER returned (only a count).
 */
export function summarizeBash(command) {
  const redacted = redact(String(command ?? ""));
  const segments = redacted.split(SHELL_SPLIT).map((s) => s.trim()).filter(Boolean);
  const binaries = [];
  const subcommands = [];
  for (const seg of segments) {
    const toks = seg.split(/\s+/);
    let i = 0;
    while (i < toks.length && /=/.test(toks[i]) && !/^[./]/.test(toks[i])) i++; // skip VAR=val prefixes
    const bin = (toks[i] || "").replace(/^.*\//, "");
    if (!bin) continue;
    binaries.push(bin);
    if ((bin === "git" || bin === "gh") && toks[i + 1] && /^[a-z-]+$/.test(toks[i + 1])) {
      subcommands.push(`${bin} ${toks[i + 1]}`);
    }
  }
  const argCount = redacted.split(/\s+/).filter(Boolean).length - 1;
  return { binaries: [...new Set(binaries)], subcommands: [...new Set(subcommands)], argCount: Math.max(0, argCount) };
}

// ── Parsing ──────────────────────────────────────────────────────────────────

/** Parse a JSON array, JSONL, or concatenated-JSON execution file into events. */
export function parseExecution(text) {
  const t = String(text ?? "").trim();
  if (!t) return [];
  try {
    const j = JSON.parse(t);
    if (Array.isArray(j)) return j;
    if (j && Array.isArray(j.messages)) return j.messages;
    if (j && typeof j === "object") return [j];
  } catch { /* fall through to line-by-line */ }
  const events = [];
  for (const line of t.split("\n")) {
    const l = line.trim();
    if (!l) continue;
    try { events.push(JSON.parse(l)); } catch { /* skip non-JSON line */ }
  }
  return events;
}

const PATH_TOOLS = new Set(["Edit", "Write", "MultiEdit", "Read", "NotebookEdit", "Glob"]);

function extractToolUses(event) {
  // assistant message with content[]; or a flat tool_use event.
  const out = [];
  const content = event?.message?.content ?? event?.content;
  if (Array.isArray(content)) {
    for (const item of content) if (item?.type === "tool_use") out.push(item);
  } else if (event?.type === "tool_use" && event.name) {
    out.push(event);
  }
  return out;
}

function toolResultCount(event) {
  const content = event?.message?.content ?? event?.content;
  if (!Array.isArray(content)) return 0;
  return content.filter((i) => i?.type === "tool_result").length;
}

/**
 * Produce the sanitized report from parsed events + context.
 * @param {Array} events
 * @param {{workspace?:string,targetFile?:string,branchName?:string}} ctx
 */
export function analyze(events, ctx = {}) {
  const workspace = (ctx.workspace || "").replace(/\\/g, "/").replace(/\/+$/, "");
  const targetBase = (ctx.targetFile || "").split(/[\\/]/).pop() || "AF1_PILOT_NOTE.md";

  const report = {
    sufficient_metadata: false,
    result: { subtype: null, is_error: null, num_turns: null, permission_denials_count: null, duration_ms: null },
    completion_reason: null,
    tool_names_invoked: [],
    tool_call_sequence: [],
    tool_calls: [],
    edit_write_file_paths: [],
    references_target_file: false,
    bash_command_categories: [],
    git_operations_attempted: false,
    git_subcommands: [],
    tool_result_blocks: 0,
    working_directories: [],
    isolated_workspace_paths: [],
    permission_denials: null,
    branch_name: ctx.branchName || null,
    missing: [],
  };

  if (!Array.isArray(events) || events.length === 0) {
    report.missing.push("execution file empty or unparseable");
    return report;
  }

  const seq = [], names = new Set(), bins = new Set(), subs = new Set(), dirs = new Set(), isolated = new Set();
  let sawToolMeta = false;

  for (const ev of events) {
    if (ev?.type === "system" && ev?.subtype === "init") {
      if (ev.cwd) dirs.add(String(ev.cwd));
    }
    if (ev?.type === "result") {
      report.result.subtype = ev.subtype ?? null;
      report.result.is_error = ev.is_error ?? null;
      report.result.num_turns = ev.num_turns ?? null;
      report.result.permission_denials_count = ev.permission_denials_count ?? null;
      report.result.duration_ms = ev.duration_ms ?? null;
      report.completion_reason = ev.is_error ? "error" : (ev.subtype ?? null);
      report.permission_denials = ev.permission_denials_count ?? null;
    }
    report.tool_result_blocks += toolResultCount(ev);

    for (const tu of extractToolUses(ev)) {
      sawToolMeta = true;
      const name = String(tu.name || "unknown");
      seq.push(name); names.add(name);
      const call = { name };
      const input = tu.input || {};
      if (PATH_TOOLS.has(name)) {
        const p = input.file_path || input.path || input.notebook_path || input.pattern || null;
        if (p) {
          const safePath = redact(String(p));
          call.file_path = safePath;
          if (name === "Edit" || name === "Write" || name === "MultiEdit" || name === "NotebookEdit") {
            report.edit_write_file_paths.push(safePath);
          }
          if (safePath.includes(targetBase)) report.references_target_file = true;
          const abs = String(p).replace(/\\/g, "/");
          if (abs.startsWith("/") && workspace && !abs.startsWith(workspace)) isolated.add(abs);
        }
      } else if (name === "Bash") {
        const s = summarizeBash(input.command || "");
        call.bash_categories = s.binaries;
        call.bash_arg_count = s.argCount;
        s.binaries.forEach((b) => bins.add(b));
        s.subcommands.forEach((x) => subs.add(x));
        if (s.binaries.includes("git") || s.binaries.includes("gh")) report.git_operations_attempted = true;
      }
      // Note: tool INPUT content / old_string / new_string / results are deliberately NOT captured.
      report.tool_calls.push(call);
    }
  }

  report.tool_call_sequence = seq;
  report.tool_names_invoked = [...names];
  report.bash_command_categories = [...bins];
  report.git_subcommands = [...subs];
  report.working_directories = [...dirs];
  report.isolated_workspace_paths = [...isolated];
  report.sufficient_metadata = sawToolMeta || report.result.subtype != null;
  if (!sawToolMeta) report.missing.push("no tool_use blocks found in execution file");
  if (report.result.subtype == null) report.missing.push("no result event found");
  return report;
}

// ── CLI ──────────────────────────────────────────────────────────────────────
function isMain() {
  return (process.argv[1] || "").replace(/\\/g, "/").endsWith("scripts/build-os/diagnose-claude.mjs");
}

if (isMain()) {
  const env = process.env;
  const git = (args, fb = "") => { try { return execFileSync("git", args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }).trim(); } catch { return fb; } };
  const execFile = env.AF1_EXEC_FILE || "";
  const out = env.AF1_OUT || "af1-claude-trace.md";

  let report;
  if (!execFile || !existsSync(execFile)) {
    report = analyze([], { workspace: env.GITHUB_WORKSPACE, targetFile: env.AF1_TARGET_HINT, branchName: env.AF1_BRANCH_NAME });
    report.missing.push(execFile ? `execution file not found: ${redact(execFile)}` : "AF1_EXEC_FILE not provided by the action");
  } else {
    report = analyze(parseExecution(readFileSync(execFile, "utf8")), {
      workspace: env.GITHUB_WORKSPACE, targetFile: env.AF1_TARGET_HINT, branchName: env.AF1_BRANCH_NAME,
    });
  }

  // Read-only git state immediately after Claude (no secrets here).
  const ws = env.GITHUB_WORKSPACE || ".";
  const gitState = {
    current_branch: git(["rev-parse", "--abbrev-ref", "HEAD"], "(unknown)"),
    head: git(["rev-parse", "HEAD"], "(unknown)"),
    porcelain_count: (git(["status", "--porcelain"], "").split("\n").filter(Boolean)).length,
    target_file_exists: existsSync(`${ws}/${env.AF1_TARGET_HINT || "docs/AF1_PILOT_NOTE.md"}`),
    workspace_edited_flag: env.AF1_WORKSPACE_EDITED || "(unset)",
  };

  const json = { ...report, git_state: gitState };
  const md = `# AF-1 Claude Execution Trace (sanitized)

**Sufficient tool metadata in execution_file:** ${report.sufficient_metadata ? "YES" : "NO"}
${report.missing.length ? `**Missing:** ${report.missing.join("; ")}` : ""}

## Result
- completion reason: \`${report.completion_reason}\` (is_error=${report.result.is_error}, subtype=${report.result.subtype})
- turns: ${report.result.num_turns} · permission denials: ${report.permission_denials}
- action branch_name output: \`${report.branch_name ?? "(none)"}\`

## Tools invoked
- names: ${report.tool_names_invoked.length ? report.tool_names_invoked.join(", ") : "_none_"}
- sequence: ${report.tool_call_sequence.length ? report.tool_call_sequence.join(" → ") : "_none_"}
- Edit/Write paths: ${report.edit_write_file_paths.length ? report.edit_write_file_paths.map((p) => `\`${p}\``).join(", ") : "_none_"}
- references \`${(env.AF1_TARGET_HINT || "AF1_PILOT_NOTE.md")}\`: **${report.references_target_file}**

## Bash / git
- bash categories: ${report.bash_command_categories.length ? report.bash_command_categories.join(", ") : "_none_"}
- git attempted: **${report.git_operations_attempted}** ${report.git_subcommands.length ? `(${report.git_subcommands.join(", ")})` : ""}
- tool_result blocks (content dropped): ${report.tool_result_blocks}

## Workspace
- working dirs: ${report.working_directories.length ? report.working_directories.map((d) => `\`${redact(d)}\``).join(", ") : "_none_"}
- isolated paths (outside GITHUB_WORKSPACE): ${report.isolated_workspace_paths.length ? report.isolated_workspace_paths.map((p) => `\`${p}\``).join(", ") : "_none_"}

## Git state right after Claude
- current branch: \`${gitState.current_branch}\` · HEAD \`${gitState.head.slice(0, 12)}\`
- uncommitted changes: ${gitState.porcelain_count} · target file present in workspace: **${gitState.target_file_exists}**
- workflow edit-detection flag: \`${gitState.workspace_edited_flag}\`

> Sanitized diagnostic. No tokens, env values, file contents, or raw tool output are included.
`;

  writeFileSync(out, md, "utf8");
  writeFileSync(out.replace(/\.md$/, "") + ".json", JSON.stringify(json, null, 2), "utf8");
  if (env.GITHUB_STEP_SUMMARY) { try { appendFileSync(env.GITHUB_STEP_SUMMARY, md + "\n", "utf8"); } catch {} }
  console.log(md);
}
