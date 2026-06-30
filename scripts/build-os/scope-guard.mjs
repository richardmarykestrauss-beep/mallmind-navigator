/**
 * MallMind Build OS — AF-1 Scope Guard
 *
 * Deterministic, dependency-free gate that compares an agent branch against its
 * base and FAILS (exit 1) when the change set violates AF-1 scope rules. This is
 * the authoritative safety check: the agent's prose never decides pass/fail — the
 * exit code of this script (and `npm run verify:all`) does.
 *
 * The rule engine is a PURE function (`evaluateScope`) so it can be unit-tested
 * with synthetic change sets and no git. The CLI wrapper gathers the real diff
 * from git and calls it.
 *
 * Usage (CLI):
 *   node scripts/build-os/scope-guard.mjs \
 *     --base origin/claude-premium-nav-test --head HEAD \
 *     --allowed "<comma-separated globs>" --max-lines 400 [--allow-lockfiles] [--allow-buildos]
 *
 * Env fallbacks: AF1_BASE, AF1_HEAD, AF1_ALLOWED_FILES, AF1_MAX_DIFF_LINES.
 * Exit 0 = within scope. Exit 1 = violation(s). Exit 2 = usage/internal error.
 */

import { execFileSync } from "node:child_process";
import process from "node:process";

// ── Rule data (transparent + testable) ──────────────────────────────────────

/** Paths an ordinary AF-1 agent task may NEVER touch (independent of allowed_files). */
export const FORBIDDEN_GLOBS = [
  { glob: ".github/**", rule: "ci_workflow", detail: "CI / workflow files are off-limits to agent tasks" },
  { glob: "supabase/migrations/**", rule: "migrations", detail: "database migrations are not permitted in AF-1" },
  { glob: "supabase/config.toml", rule: "supabase_config", detail: "Supabase config is protected" },
  // Deployment / production configuration
  { glob: "**/Dockerfile", rule: "deploy_config", detail: "container/deploy config is protected" },
  { glob: "Dockerfile", rule: "deploy_config", detail: "container/deploy config is protected" },
  { glob: "**/cloudbuild*.yml", rule: "deploy_config", detail: "Cloud Build config is protected" },
  { glob: "**/cloudbuild*.yaml", rule: "deploy_config", detail: "Cloud Build config is protected" },
  { glob: "**/app.yaml", rule: "deploy_config", detail: "App Engine/Cloud Run config is protected" },
  { glob: "**/service.yaml", rule: "deploy_config", detail: "Cloud Run service config is protected" },
  { glob: "deploy/**", rule: "deploy_config", detail: "deploy/ directory is protected" },
  { glob: ".gcloudignore", rule: "deploy_config", detail: "gcloud deploy config is protected" },
  { glob: "**/*.tf", rule: "deploy_config", detail: "Terraform/IaC is protected" },
  { glob: "**/*.tfvars", rule: "deploy_config", detail: "Terraform vars are protected" },
];

/** Build OS authority/governance files — only mutable with explicit --allow-buildos. */
export const BUILDOS_PROTECTED_GLOBS = [
  { glob: "docs/build-os/**", rule: "buildos_authority", detail: "Build OS authority docs are protected" },
  { glob: "scripts/build-os/**", rule: "buildos_authority", detail: "Build OS scripts are protected" },
];

/** Lockfiles — only mutable with explicit --allow-lockfiles. */
export const LOCKFILE_GLOBS = [
  "**/package-lock.json", "package-lock.json",
  "**/yarn.lock", "yarn.lock",
  "**/pnpm-lock.yaml", "pnpm-lock.yaml",
  "**/bun.lock", "bun.lock", "**/bun.lockb", "bun.lockb",
];

/** Non-".env" secret/key material by path. (".env" handled specially below.) */
export const SECRET_FILE_GLOBS = [
  "**/*.pem", "**/*.key", "**/*.p12", "**/*.pfx", "**/*.keystore",
  "**/id_rsa", "**/id_rsa.*",
  "**/*service-account*.json", "**/*serviceaccount*.json", "**/credentials*.json",
];

/** Content patterns that must never appear in ADDED lines. */
export const SECRET_CONTENT_PATTERNS = [
  /sk-ant-[A-Za-z0-9]/,
  /AIza[0-9A-Za-z_\-]{10}/,
  /ghp_[A-Za-z0-9]{20}/,
  /github_pat_[A-Za-z0-9_]{20}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /eyJ[A-Za-z0-9_\-]{20,}\.[A-Za-z0-9_\-]{10,}\./, // JWT-ish (Supabase keys)
  /postgres(?:ql)?:\/\/[^\s:@]+:[^\s@]+@/,         // db URL with embedded password
];

const ASSERTION_RE = /\b(assert|expect|it|test|describe|toBe|toEqual)\s*\(/;
const DEFAULT_ASSERTION_DROP_THRESHOLD = 3;

// ── Glob matching (no dependencies) ──────────────────────────────────────────

/** Convert a restricted glob (supports **, *, ?) to an anchored RegExp. */
export function globToRegExp(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        // ** (optionally followed by /) → match across path segments
        if (glob[i + 2] === "/") { re += "(?:.*/)?"; i += 2; }
        else { re += ".*"; i += 1; }
      } else {
        re += "[^/]*";
      }
    } else if (c === "?") {
      re += "[^/]";
    } else if ("\\^$+.()|[]{}".includes(c)) {
      re += "\\" + c;
    } else {
      re += c;
    }
  }
  return new RegExp("^" + re + "$");
}

export function matchesAny(path, globs) {
  return globs.some((g) => globToRegExp(g).test(path));
}

function isTestFile(path) {
  return (
    /(^|\/)__tests__\//.test(path) ||
    /\.(test|spec)\.[jt]sx?$/.test(path) ||
    /Harness\.[jt]s$/.test(path) ||
    /(^|\/)e2e\//.test(path)
  );
}

function isEnvSecretFile(path) {
  const base = path.split("/").pop() ?? "";
  if (base === ".env") return true;
  if (base.startsWith(".env.") && !base.endsWith(".example")) return true;
  return false;
}

// ── Pure rule engine ─────────────────────────────────────────────────────────

/**
 * @param {Array<{path,status,added,deleted,assertionsAdded?,assertionsRemoved?,secretHit?}>} changes
 * @param {{allowedGlobs?:string[],maxLines?:number,allowLockfiles?:boolean,
 *          allowBuildOs?:boolean,assertionDropThreshold?:number}} options
 * @returns {{ok:boolean,violations:Array,summary:object}}
 */
export function evaluateScope(changes, options = {}) {
  const {
    allowedGlobs = [],
    maxLines = 400,
    allowLockfiles = false,
    allowBuildOs = false,
    assertionDropThreshold = DEFAULT_ASSERTION_DROP_THRESHOLD,
  } = options;

  const violations = [];
  let added = 0;
  let deleted = 0;

  for (const c of changes) {
    const path = c.path;
    added += c.added || 0;
    deleted += c.deleted || 0;

    // 1. Hard-forbidden paths (CI, migrations, supabase config, deploy/IaC).
    const forbidden = FORBIDDEN_GLOBS.find((f) => globToRegExp(f.glob).test(path));
    if (forbidden) violations.push({ rule: forbidden.rule, path, detail: forbidden.detail });

    // 2. Build OS authority/governance files (unless explicitly authorized).
    if (!allowBuildOs) {
      const bos = BUILDOS_PROTECTED_GLOBS.find((f) => globToRegExp(f.glob).test(path));
      if (bos) violations.push({ rule: bos.rule, path, detail: bos.detail });
    }

    // 3. Secret / key files and .env*.
    if (isEnvSecretFile(path)) {
      violations.push({ rule: "secret_file", path, detail: ".env files must never be added/changed" });
    } else if (matchesAny(path, SECRET_FILE_GLOBS)) {
      violations.push({ rule: "secret_file", path, detail: "credential/key material must never be added" });
    }

    // 4. Secret-looking content in added lines.
    if (c.secretHit) {
      violations.push({ rule: "secret_content", path, detail: "added content matches a secret pattern" });
    }

    // 5. Lockfiles (unless allowed).
    if (!allowLockfiles && matchesAny(path, LOCKFILE_GLOBS)) {
      violations.push({ rule: "lockfile", path, detail: "lockfile changes require explicit allowance" });
    }

    // 6. Test deletion / assertion reduction.
    if (isTestFile(path)) {
      if (c.status === "D") {
        violations.push({ rule: "test_deletion", path, detail: "deleting a test file is not allowed" });
      } else {
        const drop = (c.assertionsRemoved || 0) - (c.assertionsAdded || 0);
        if (drop >= assertionDropThreshold) {
          violations.push({
            rule: "assertion_reduction",
            path,
            detail: `removes ${drop} more assertions than it adds (threshold ${assertionDropThreshold})`,
          });
        }
      }
    }

    // 7. Outside allowed_files. (Empty allow-list = deny everything = safe default.)
    const allowedHere =
      allowedGlobs.length > 0 && allowedGlobs.some((g) => globToRegExp(g).test(path));
    if (!allowedHere) {
      violations.push({
        rule: "out_of_scope",
        path,
        detail:
          allowedGlobs.length === 0
            ? "no allowed_files were specified"
            : "path is outside the task's allowed_files globs",
      });
    }
  }

  // 8. Total diff size.
  const total = added + deleted;
  if (maxLines != null && total > maxLines) {
    violations.push({
      rule: "max_lines",
      path: null,
      detail: `changed ${total} lines exceeds max_diff_lines ${maxLines}`,
    });
  }

  return {
    ok: violations.length === 0,
    violations,
    summary: { files: changes.length, added, deleted, total, maxLines },
  };
}

// ── git CLI helpers (only used when run as a CLI) ────────────────────────────

function git(args) {
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

function collectChangesFromGit(base, head, staged = false) {
  // staged=true evaluates the index (Claude's edits BEFORE commit) vs base:
  //   git diff --cached <base> ...   (else: git diff <base>...<head>)
  const dargs = (extra) => (staged ? ["diff", "--cached", ...extra, base] : ["diff", ...extra, `${base}...${head}`]);
  const numstat = git(dargs(["--numstat"])).trim();
  const nameStatus = git(dargs(["--name-status"])).trim();

  const statusByPath = new Map();
  for (const line of nameStatus ? nameStatus.split("\n") : []) {
    const parts = line.split("\t");
    const code = parts[0][0]; // A/M/D/R/C
    const path = code === "R" || code === "C" ? parts[2] : parts[1];
    statusByPath.set(path, code);
  }

  const changes = [];
  for (const line of numstat ? numstat.split("\n") : []) {
    const [a, d, ...rest] = line.split("\t");
    let path = rest.join("\t");
    // Rename numstat form: "{old => new}" or "old\t=>\tnew" — normalise to new path.
    if (path.includes("=>")) path = path.replace(/.*=>\s*/, "").replace(/[{}]/g, "").trim();
    const added = a === "-" ? 0 : Number.parseInt(a, 10) || 0;
    const deleted = d === "-" ? 0 : Number.parseInt(d, 10) || 0;

    let assertionsAdded = 0;
    let assertionsRemoved = 0;
    let secretHit = false;
    try {
      const fileDiff = git([...dargs([]), "--", path]);
      for (const dl of fileDiff.split("\n")) {
        if (dl.startsWith("+") && !dl.startsWith("+++")) {
          if (ASSERTION_RE.test(dl)) assertionsAdded++;
          if (SECRET_CONTENT_PATTERNS.some((re) => re.test(dl))) secretHit = true;
        } else if (dl.startsWith("-") && !dl.startsWith("---")) {
          if (ASSERTION_RE.test(dl)) assertionsRemoved++;
        }
      }
    } catch {
      /* binary or unreadable diff — counts stay 0 */
    }

    changes.push({
      path,
      status: statusByPath.get(path) || "M",
      added,
      deleted,
      assertionsAdded,
      assertionsRemoved,
      secretHit,
    });
  }
  return changes;
}

// ── CLI ──────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = { flags: new Set(), opts: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--allow-lockfiles" || a === "--allow-buildos" || a === "--staged") out.flags.add(a);
    else if (a.startsWith("--")) out.opts[a.slice(2)] = argv[++i];
  }
  return out;
}

function splitGlobs(value) {
  if (!value) return [];
  return value
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function isMain() {
  const invoked = process.argv[1] || "";
  return invoked.replace(/\\/g, "/").endsWith("scripts/build-os/scope-guard.mjs");
}

if (isMain()) {
  try {
    const { flags, opts } = parseArgs(process.argv.slice(2));
    const base = opts.base || process.env.AF1_BASE || "origin/claude-premium-nav-test";
    const head = opts.head || process.env.AF1_HEAD || "HEAD";
    const allowedGlobs = splitGlobs(opts.allowed || process.env.AF1_ALLOWED_FILES || "");
    const maxLines = Number.parseInt(opts["max-lines"] || process.env.AF1_MAX_DIFF_LINES || "400", 10);
    const allowLockfiles = flags.has("--allow-lockfiles");
    const allowBuildOs = flags.has("--allow-buildos");
    const staged = flags.has("--staged");

    const changes = collectChangesFromGit(base, head, staged);
    const result = evaluateScope(changes, { allowedGlobs, maxLines, allowLockfiles, allowBuildOs });

    console.log(`MallMind AF-1 Scope Guard`);
    console.log(`base=${base} head=${staged ? "(staged index)" : head} files=${result.summary.files} lines=${result.summary.total}/${maxLines}`);
    if (result.ok) {
      console.log("RESULT: PASS — change set is within AF-1 scope.");
      if (process.env.GITHUB_OUTPUT) {
        execFileSync("bash", ["-c", `echo "scope_ok=true" >> "$GITHUB_OUTPUT"`]);
      }
      process.exit(0);
    }
    console.error(`RESULT: FAIL — ${result.violations.length} violation(s):`);
    for (const v of result.violations) {
      console.error(`  ✖ [${v.rule}] ${v.path ?? "(diff)"} — ${v.detail}`);
    }
    if (process.env.GITHUB_OUTPUT) {
      execFileSync("bash", ["-c", `echo "scope_ok=false" >> "$GITHUB_OUTPUT"`]);
    }
    process.exit(1);
  } catch (err) {
    console.error("Scope guard internal error:", err?.message ?? err);
    process.exit(2);
  }
}
