#!/usr/bin/env node
// MallMind founder-demo smoke check (Sprint 20E).
//
// Read-only and safe by design:
//   - reads VITE_GOOGLE_BACKEND_URL from process.env or .env.local (never prints the value)
//   - never writes files, never touches the database, needs no secrets
//   - calls the live /assistant endpoint ONLY with --live, and only when configured
//     (that call sends no session_id, so the backend persists nothing)
//   - never fakes a PASS: anything it cannot verify is reported as BROWSER-ONLY
//
// Usage:
//   node scripts/assistant/demo-smoke-check.mjs
//   node scripts/assistant/demo-smoke-check.mjs --live
//
// See docs/assistant/demo-smoke-test.md for the full browser checklist.

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const live = process.argv.includes("--live");
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const MALL_REDS_ID = "f4a2c1b3-8d7e-4f6a-9b0c-1d2e3f4a5b6c"; // Mall@Reds (Centurion)
const DEMO_QUERY = "I need a TV under R4000";

const INTERNAL_TOKENS = [
  "manual_fact_entry", "csv_manual", "needs_review", "manually_verified",
  "live_feed", "data_quality_status", "retail_observation", "manual_seed",
];

let failures = 0;
let warnings = 0;

const pass = (msg) => console.log(`  PASS  ${msg}`);
const warn = (msg) => { warnings++; console.log(`  WARN  ${msg}`); };
const fail = (msg) => { failures++; console.log(`  FAIL  ${msg}`); };
const note = (msg) => console.log(`  ----  ${msg}`);

function readEnvLocalVar(name) {
  const envPath = join(repoRoot, ".env.local");
  if (!existsSync(envPath)) return null;
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = /^\s*([A-Z_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (match && match[1] === name && match[2]) return match[2];
  }
  return null;
}

console.log("===== MALLMIND FOUNDER DEMO SMOKE CHECK =====");
console.log(`mode: ${live ? "env + live backend probe" : "env only (add --live to probe the backend)"}`);
console.log("");

// ── 1. Environment ────────────────────────────────────────────────────────────
console.log("[1] Environment");

const backendUrl =
  process.env.VITE_GOOGLE_BACKEND_URL || readEnvLocalVar("VITE_GOOGLE_BACKEND_URL") || null;

if (backendUrl) {
  let host = "(unparseable)";
  try { host = new URL(backendUrl).host; } catch { /* keep placeholder */ }
  pass(`VITE_GOOGLE_BACKEND_URL is configured (host: ${host} — value not printed)`);
} else {
  fail("VITE_GOOGLE_BACKEND_URL is NOT set in env or .env.local.");
  note("Without it the app uses the legacy edge path and the Shopping Answer Card cannot appear.");
  note("The /assistant page will show the amber 'Demo backend not connected' guardrail.");
}

if (readEnvLocalVar("VITE_SUPABASE_URL") || process.env.VITE_SUPABASE_URL) {
  pass("VITE_SUPABASE_URL is configured");
} else {
  warn("VITE_SUPABASE_URL not found — the app may not boot at all.");
}

// ── 2. Live backend probe (opt-in) ────────────────────────────────────────────
if (live && backendUrl) {
  console.log("");
  console.log("[2] Live backend probe (read-only: no session_id, nothing is persisted)");
  try {
    const res = await fetch(`${backendUrl.replace(/\/$/, "")}/assistant`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [{ role: "user", content: DEMO_QUERY }],
        mall_id: MALL_REDS_ID,
        mall_name: "Mall@Reds",
      }),
    });

    if (res.status === 429 || res.status === 500) {
      const body = await res.text();
      if (/RESOURCE_EXHAUSTED|429/.test(body)) {
        warn(`Backend returned ${res.status} with a Vertex AI quota error (known failure mode).`);
        note("Wait and retry. Plain 'Take me to Game' still works during quota exhaustion.");
      } else {
        fail(`Backend returned HTTP ${res.status}: ${body.slice(0, 200)}`);
      }
    } else if (!res.ok) {
      fail(`Backend returned HTTP ${res.status}.`);
    } else {
      const data = await res.json();
      const sa = data.shopping_answer;

      if (!sa) {
        fail("Response has no shopping_answer — the premium card would not render.");
      } else {
        pass("shopping_answer present");

        const best = sa.bestOption;
        if (best?.productName?.includes("Hisense 43") && best?.shopName === "Game" && best?.price === 3499) {
          pass(`bestOption: ${best.productName} · ${best.shopName} · R${best.price}`);
        } else {
          warn(`bestOption differs from the canonical demo data: ${JSON.stringify({ name: best?.productName, shop: best?.shopName, price: best?.price })}`);
        }

        if (best?.trustLabel === "Verified option") {
          pass("trustLabel: 'Verified option'");
        } else {
          fail(`trustLabel is '${best?.trustLabel}' — expected 'Verified option'.`);
        }

        if (sa.backupOption) pass(`backupOption present (${sa.backupOption.productName})`);
        else warn("No backupOption in this response.");

        if (Array.isArray(data.products) && data.products.length > 0) {
          pass(`products list present (${data.products.length} rows) — supports the evidence list`);
        } else {
          warn("No products array — the supporting product list would be empty.");
        }

        const shopperText = [
          sa.shopperMessage,
          ...(sa.warnings ?? []),
          best?.trustLabel ?? "",
          best?.reason ?? "",
          sa.backupOption?.trustLabel ?? "",
        ].join(" | ").toLowerCase();
        const leaks = INTERNAL_TOKENS.filter((t) => new RegExp(`\\b${t}\\b`).test(shopperText));
        if (leaks.length === 0) pass("no internal tokens in shopper-facing answer text");
        else fail(`internal tokens leaked into shopper text: ${leaks.join(", ")}`);

        if (sa.nextAction?.type === "navigate") {
          pass(`nextAction is 'navigate' — the card itself offers 'Take me there'`);
        } else {
          pass(`nextAction is '${sa.nextAction?.type}' — the route handoff hint should appear in the UI instead`);
        }
      }
    }
  } catch (err) {
    fail(`Could not reach the backend: ${err?.message ?? err}`);
  }
} else if (live && !backendUrl) {
  console.log("");
  console.log("[2] Live backend probe skipped — backend URL not configured.");
}

// ── 3. Browser-only steps ─────────────────────────────────────────────────────
console.log("");
console.log("[3] BROWSER-ONLY — cannot be verified from the CLI. Follow these steps:");
[
  "Open /assistant — no amber 'Demo backend not connected' warning should show.",
  "If no mall is selected: 'Choose a Mall First' + demo tip naming Mall@Reds (Centurion).",
  "Select Mall@Reds, then tap the featured chip 'I need a TV under R4000'.",
  "Shopping Answer Card renders FIRST: BEST PICK + 'Verified option' badge,",
  "  Hisense 43\" FHD LED TV · Game · R3 499, backup Samsung R2 999 ('Example/demo data'),",
  "  warning 'Backup option is not confirmed yet.', Gemini text demoted below the card.",
  "Product list 'LIVE MALL PRICES' appears below as evidence.",
  "Route handoff hint appears when the card action is not 'navigate':",
  "  'Want to go there? Tap Take me to Game below, or ask \"Take me to Game.\"'",
  "Tap 'Take me to Game' → route panel: 'Route ready' · 1 stop · ~1 min walk ·",
  "  'Preview route ready…' helper line · Start Navigation button.",
  "Tap Start Navigation → the Navigate screen (/navigate) opens, also for",
  "  anonymous sessions (21B fix).",
  "Navigate screen honesty: 'Prototype route preview' badge, map chip says",
  "  'Preview' (NOT 'GPS'), and below the map: 'Follow these steps on the mall",
  "  map. Live indoor positioning is not active in this demo.'",
  "Route steps/stops, map preview and stats bar still render; no fake GPS,",
  "  blue-dot, tracking or live-positioning claims anywhere.",
  "Deals path (21C): open /deals → tap 'Navigate There' on a Game deal →",
  "  /navigate opens with the Game stop loaded and the same honesty copy.",
  "Scan the page: no internal status/source tokens anywhere.",
].forEach((s) => console.log(`  • ${s}`));
console.log("");
console.log("Full checklist: docs/assistant/demo-smoke-test.md");

// ── Result ────────────────────────────────────────────────────────────────────
console.log("");
console.log(`===== RESULT: ${failures} FAIL · ${warnings} WARN =====`);
if (failures > 0) process.exit(1);
