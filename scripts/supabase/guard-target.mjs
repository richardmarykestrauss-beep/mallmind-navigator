#!/usr/bin/env node
/**
 * guard-target.mjs — fail-closed project targeting guard for Supabase CLI commands.
 *
 * WHY THIS EXISTS
 * ───────────────
 * The repository previously committed `supabase/.temp/linked-project.json`, which
 * pinned the CLI to the LIVE project. Any `supabase db push` / `db reset` run in the
 * repo would therefore have targeted production by default, with no `--project-ref`
 * required and no warning. That file is now untracked and git-ignored, and this
 * guard exists so a destructive command can never again resolve its target
 * implicitly.
 *
 * CONTRACT
 * ────────
 * A migration / deploy / secrets / functions command MUST name its target
 * explicitly. This guard REFUSES to pass when:
 *   - no target is supplied,
 *   - the target is ambiguous (dev and prod both plausible),
 *   - the resolved target is the production ref and prod was not deliberately
 *     enabled via MALLMIND_ALLOW_PROD=1 (a second, explicit opt-in).
 *
 * USAGE
 *   node scripts/supabase/guard-target.mjs --env dev
 *   node scripts/supabase/guard-target.mjs --env prod        # refuses unless MALLMIND_ALLOW_PROD=1
 *
 * Reads (never prints) these environment variables:
 *   SUPABASE_DEV_PROJECT_REF   — the mallmind-dev project ref
 *   SUPABASE_PROD_PROJECT_REF  — the existing live project ref
 *
 * It prints only REDACTED refs. It never prints tokens, keys, passwords or URLs.
 */

import process from "node:process";

const REDACT = (ref) => (ref ? `${ref.slice(0, 4)}********` : "<unset>");

function fail(message) {
  console.error(`\n✖ SUPABASE TARGET GUARD: ${message}\n`);
  process.exit(1);
}

const args = process.argv.slice(2);
const envIndex = args.indexOf("--env");
const target = envIndex >= 0 ? args[envIndex + 1] : undefined;

const DEV = process.env.SUPABASE_DEV_PROJECT_REF;
const PROD = process.env.SUPABASE_PROD_PROJECT_REF;

// 1. The target must be named explicitly. No inference, ever.
if (!target) {
  fail(
    "no target supplied. Pass --env dev or --env prod explicitly.\n" +
    "  This command refuses to infer a project from CLI link state.",
  );
}
if (target !== "dev" && target !== "prod") {
  fail(`unrecognised target "${target}". Use exactly 'dev' or 'prod'.`);
}

// 2. The chosen target must actually be configured.
const ref = target === "dev" ? DEV : PROD;
if (!ref) {
  fail(
    `target '${target}' selected but ${target === "dev" ? "SUPABASE_DEV_PROJECT_REF" : "SUPABASE_PROD_PROJECT_REF"} is not set.\n` +
    "  Set it in the current shell only — never in a tracked file.",
  );
}

// 3. Ambiguity is a hard failure: dev and prod must be distinguishable.
if (DEV && PROD && DEV === PROD) {
  fail(
    "SUPABASE_DEV_PROJECT_REF and SUPABASE_PROD_PROJECT_REF are IDENTICAL.\n" +
    "  Refusing to run: dev and prod must be separate projects.",
  );
}

// 4. Production requires a second, deliberate opt-in. Fails closed by default.
if (target === "prod" && process.env.MALLMIND_ALLOW_PROD !== "1") {
  fail(
    `refusing to target PRODUCTION (${REDACT(PROD)}).\n` +
    "  Production is disabled by default. To proceed deliberately, set MALLMIND_ALLOW_PROD=1\n" +
    "  for this single command and be certain you intend a production change.",
  );
}

// 5. Guard against the dev ref accidentally pointing at the known prod ref.
if (target === "dev" && PROD && ref === PROD) {
  fail(
    "the 'dev' target resolves to the PRODUCTION project ref. Refusing to run.",
  );
}

console.log(
  `✔ Supabase target guard passed — target=${target} ref=${REDACT(ref)}` +
  (target === "prod" ? "  (PRODUCTION, explicitly enabled)" : ""),
);
process.exit(0);
