#!/usr/bin/env node
/**
 * staging-guard.mjs — Sprint 2L-B disposable-DB preflight guard (CLI).
 *
 * Runs BEFORE any staging-bridge database work. It aborts if the environment points at a
 * HOSTED database, and prints the resolved LOCAL target host so the operator can see exactly
 * where work will land. Exit 0 = safe local target; exit 3 = refused (hosted / unrecognised).
 *
 * Checks, in order:
 *   1. MALLMIND_ALLOW_PROD must be unset/false (any truthy value is a hard refusal).
 *   2. Any of DATABASE_URL / SUPABASE_DB_URL / SUPABASE_DB_HOST / PGHOST, if set, must be LOCAL.
 *   3. When nothing is set, default to the local disposable stack host (127.0.0.1) — the same
 *      loopback the bundled `supabase start` Postgres container is published on.
 *
 * Prints hosts only — never connection strings, passwords, keys, or refs.
 */

import { assertLocalDatabaseTarget, isHostedTarget } from "../../src/lib/retail/feed/hostedGuard.mjs";

const DEFAULT_LOCAL_HOST = "127.0.0.1"; // supabase local stack loopback

function fail(msg) {
  process.stderr.write(`\n✗ STAGING GUARD REFUSED\n  ${msg}\n\n`);
  process.exit(3);
}

const allowProd = String(process.env.MALLMIND_ALLOW_PROD ?? "").trim().toLowerCase();
if (allowProd && !["", "0", "false", "no", "off"].includes(allowProd)) {
  fail("MALLMIND_ALLOW_PROD is set — the disposable staging bridge never runs against production.");
}

const candidates = [
  ["DATABASE_URL", process.env.DATABASE_URL],
  ["SUPABASE_DB_URL", process.env.SUPABASE_DB_URL],
  ["SUPABASE_DB_HOST", process.env.SUPABASE_DB_HOST],
  ["PGHOST", process.env.PGHOST],
].filter(([, v]) => v != null && String(v).trim() !== "");

if (candidates.length === 0) {
  process.stdout.write(`✓ staging guard OK\n  no DB env overrides set — defaulting to LOCAL disposable stack host '${DEFAULT_LOCAL_HOST}'\n`);
  process.exit(0);
}

for (const [name, value] of candidates) {
  if (isHostedTarget(value)) fail(`${name} points at a HOSTED database. Unset it before running the disposable staging bridge.`);
  try {
    const host = assertLocalDatabaseTarget(value);
    process.stdout.write(`✓ staging guard OK\n  ${name} → LOCAL target host '${host}'\n`);
  } catch (err) {
    fail(`${name}: ${err.message}`);
  }
}

process.exit(0);
