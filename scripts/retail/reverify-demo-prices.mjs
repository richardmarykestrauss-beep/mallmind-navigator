#!/usr/bin/env node
// ⚠️  LEGACY / DEMO-ONLY (deprecated by Sprint 20A.8) ⚠️
// ---------------------------------------------------------------------------
// This script directly refreshes products.price_verified_at to keep the
// founder-demo "Verified option" from expiring. That is NOT the long-term
// freshness mechanism and must not be treated as one.
//
// LONG-TERM PATH (Sprint 20A.8 — evidence-backed verification):
//   1. Capture real evidence (phone note / store photo / receipt) as a
//      retail_source_snapshot under a retail_data_source.
//   2. Create + approve a retail_price_observation (review_status='approved')
//      with the verification_method and observed_at/valid_to.
//   3. Publish it via POST /admin/verify-product-price { observation_id }, which
//      validates through the shared verification policy and the atomic
//      publish_verified_observation RPC. Freshness then derives from the
//      observation's validity (products.price_valid_until), not a manual touch.
//
// See docs/retail/evidence-backed-verification-unification.md.
// This helper remains ONLY as a demo stopgap; prefer the observation flow.
// ---------------------------------------------------------------------------
//
// Founder-demo price re-verification helper (Sprint 22B).
//
// WHY: priceTrust expires manual verification after 7 days. The Mall@Reds
// demo's "Verified option" (Hisense 43" at Game, phone-verified 2026-06-09)
// silently degrades to "Verification expired" unless a HUMAN re-verifies the
// price and refreshes price_verified_at.
//
// SAFETY DESIGN:
//   - Dry-run by default; writes require BOTH --apply and --verified-by.
//   - Targets ONLY the two founder-demo verified products via explicit
//     identifiers + strict guards (mall, shop, quality tier, Hisense price).
//   - Refuses any row that is not already data_quality_status='manually_verified'.
//   - Refuses if a target matches more than one row. Hard cap: 2 rows total.
//   - On apply, updates ONLY price_verified_at + verified_by. Never name,
//     price, shop, data_source, or data_quality_status.
//   - Dry-run can read with the anon key; --apply requires the service role.
//   - Never prints key values.
//
// Usage:
//   node scripts/retail/reverify-demo-prices.mjs
//   node scripts/retail/reverify-demo-prices.mjs --apply --verified-by "Richard phone recheck 2026-06-12"
//
// ONLY run --apply after a REAL phone/website/store verification.
// Do not use this to fake freshness.

import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const verifiedByIdx = args.findIndex((a) => a === "--verified-by");
const verifiedBy = verifiedByIdx >= 0 ? (args[verifiedByIdx + 1] ?? "").trim() : "";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const MALL_REDS_ID = "f4a2c1b3-8d7e-4f6a-9b0c-1d2e3f4a5b6c"; // Mall@Reds (Centurion)
const GAME_SHOP_ID = "a1b2c3d4-0001-4000-8000-100000000001"; // Game, Floor G

// The ONLY rows this script may ever touch. Identified explicitly; each has
// strict expectation guards checked against the live row before any write.
const DEMO_TARGETS = [
  {
    key: "hisense",
    label: 'Hisense 43" FHD LED TV @ Game (primary demo product)',
    select: { product_id: "b1b2c3d4-0001-4000-8000-200000000001" },
    expect: {
      nameIncludes: "Hisense 43",
      mall_id: MALL_REDS_ID,
      shop_id: GAME_SHOP_ID,
      price: 3499, // guard: if the price changed, a re-verify-only touch is wrong
      data_quality_status: "manually_verified",
    },
  },
  {
    key: "yoghurt",
    label: "Woolworths Greek Yoghurt 500g (secondary verified demo product)",
    select: { mall_id: MALL_REDS_ID, nameIlike: "Woolworths Greek Yoghurt%" },
    expect: {
      nameIncludes: "Woolworths Greek Yoghurt",
      mall_id: MALL_REDS_ID,
      data_quality_status: "manually_verified",
    },
  },
];

function readEnvLocalVar(name) {
  const envPath = join(repoRoot, ".env.local");
  if (!existsSync(envPath)) return null;
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && m[1] === name && m[2]) return m[2];
  }
  return null;
}

const url =
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || readEnvLocalVar("VITE_SUPABASE_URL");
const serviceKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || null;
const anonKey =
  process.env.VITE_SUPABASE_ANON_KEY || readEnvLocalVar("VITE_SUPABASE_ANON_KEY") || null;

console.log("===== FOUNDER DEMO PRICE RE-VERIFICATION =====");
console.log("mode:", apply ? "APPLY (write)" : "DRY RUN (read-only preview)");
console.log("");
console.log("REMINDER: Only run --apply after a real phone/website/store");
console.log("verification. Do not use this to fake freshness.");
console.log("");

if (!url) {
  console.error("FAIL: SUPABASE_URL / VITE_SUPABASE_URL not found in env or .env.local.");
  process.exit(1);
}

if (apply) {
  if (!verifiedBy) {
    console.error("FAIL: --apply requires --verified-by \"<who verified, how, when>\".");
    console.error('Example: --verified-by "Richard phone recheck 2026-06-12"');
    process.exit(1);
  }
  if (!serviceKey) {
    console.error("FAIL: --apply requires SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SERVICE_KEY) in env.");
    console.error("(Key value is never printed.)");
    process.exit(1);
  }
}

const key = serviceKey ?? anonKey;
if (!key) {
  console.error("FAIL: no Supabase key found (service role for --apply, or anon key for dry-run reads).");
  process.exit(1);
}
console.log(`auth: ${serviceKey ? "service role" : "anon (read-only dry-run)"} — value not printed`);
if (verifiedBy) console.log(`verified_by (proposed): ${verifiedBy}`);
console.log("");

const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const nowIso = new Date().toISOString();
let failures = 0;
const writable = [];

for (const target of DEMO_TARGETS) {
  console.log(`--- ${target.label}`);

  let query = supabase
    .from("products")
    .select("id, name, price, mall_id, shop_id, data_quality_status, price_verified_at, verified_by, data_source")
    .is("deleted_at", null);

  if (target.select.product_id) query = query.eq("id", target.select.product_id);
  if (target.select.mall_id) query = query.eq("mall_id", target.select.mall_id);
  if (target.select.nameIlike) query = query.ilike("name", target.select.nameIlike);

  const { data: rows, error } = await query;

  if (error) {
    console.error(`  FAIL: query error: ${error.message}`);
    failures++;
    continue;
  }
  if (!rows?.length) {
    console.error("  FAIL: no matching row found.");
    failures++;
    continue;
  }
  if (rows.length > 1) {
    console.error(`  FAIL: ${rows.length} rows matched — refusing ambiguous target.`);
    failures++;
    continue;
  }

  const row = rows[0];
  const exp = target.expect;
  const guardErrors = [];
  if (exp.nameIncludes && !row.name?.includes(exp.nameIncludes)) {
    guardErrors.push(`name '${row.name}' does not include '${exp.nameIncludes}'`);
  }
  if (exp.mall_id && row.mall_id !== exp.mall_id) guardErrors.push("mall_id mismatch");
  if (exp.shop_id && row.shop_id !== exp.shop_id) guardErrors.push("shop_id mismatch");
  if (exp.price != null && Number(row.price) !== exp.price) {
    guardErrors.push(`price R${row.price} != expected R${exp.price} — price changed; re-verification alone is wrong, re-stage via the observation pipeline instead`);
  }
  if (row.data_quality_status !== exp.data_quality_status) {
    guardErrors.push(`data_quality_status '${row.data_quality_status}' is not '${exp.data_quality_status}' — this script only refreshes already-verified rows`);
  }

  const ageDays = row.price_verified_at
    ? Math.floor((Date.now() - new Date(row.price_verified_at).getTime()) / 86_400_000)
    : null;

  console.log(`  product_id:          ${row.id}`);
  console.log(`  name:                ${row.name}`);
  console.log(`  shop_id:             ${row.shop_id}`);
  console.log(`  mall_id:             ${row.mall_id}`);
  console.log(`  current price:       R${row.price}`);
  console.log(`  data_quality_status: ${row.data_quality_status}`);
  console.log(`  price_verified_at:   ${row.price_verified_at ?? "(never)"}${ageDays != null ? ` (${ageDays} day(s) ago${ageDays > 7 ? " — EXPIRED in shopper trust" : ageDays >= 6 ? " — expiring soon" : ""})` : ""}`);
  console.log(`  verified_by:         ${row.verified_by ?? "(none)"}`);

  if (guardErrors.length) {
    console.error(`  REFUSED: ${guardErrors.join("; ")}`);
    failures++;
    continue;
  }

  console.log(`  proposed price_verified_at: ${nowIso}`);
  console.log(`  proposed verified_by:       ${verifiedBy || "(provide via --verified-by)"}`);
  writable.push(row);
}

console.log("");

if (!apply) {
  console.log(`Dry run only — ${writable.length} row(s) eligible, ${failures} refused/failed.`);
  console.log('To write after a REAL re-verification:');
  console.log('  node scripts/retail/reverify-demo-prices.mjs --apply --verified-by "<who/how/when>"');
  process.exit(failures > 0 ? 1 : 0);
}

if (failures > 0) {
  console.error("APPLY ABORTED: one or more targets failed guards. Nothing was written.");
  process.exit(1);
}
if (writable.length === 0 || writable.length > DEMO_TARGETS.length) {
  console.error("APPLY ABORTED: unexpected eligible-row count. Nothing was written.");
  process.exit(1);
}

let updated = 0;
for (const row of writable) {
  // Freshness/audit fields ONLY. Never name/price/shop/source/quality.
  const { error: updateErr } = await supabase
    .from("products")
    .update({ price_verified_at: nowIso, verified_by: verifiedBy })
    .eq("id", row.id)
    .eq("data_quality_status", "manually_verified"); // re-checked at write time

  if (updateErr) {
    console.error(`FAIL: update for ${row.name}: ${updateErr.message}`);
    process.exit(1);
  }
  console.log(`UPDATED: ${row.name} → price_verified_at=${nowIso}, verified_by="${verifiedBy}"`);
  updated++;
}

console.log("");
console.log(`Done. ${updated} row(s) re-verified. Shopper trust shows "Verified price" for the next 7 days.`);
