#!/usr/bin/env node
/**
 * validate-mallreds-tenant-import.mjs — Sprint 2G
 *
 * Deterministically derives a REVIEWABLE tenant-import preview from the verified
 * Mall@Reds register and proves it is safe to (later) import. This script does
 * NOT touch any database, network, or Supabase client — it is pure fs read +
 * (optionally) write of the preview JSON. Importing is a SEPARATE, human-gated
 * step that this sprint deliberately does NOT perform.
 *
 * Usage:
 *   node scripts/retail/validate-mallreds-tenant-import.mjs          # validate
 *   node scripts/retail/validate-mallreds-tenant-import.mjs --emit   # (re)write preview
 *
 * Validate mode: re-derives the import rows from the register, asserts the
 * committed preview matches byte-for-byte, runs every invariant, prints a report,
 * and exits non-zero on any failure.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, "..", "..");
const REGISTER_PATH = resolve(REPO, "docs/sprint-2f/mallreds-verified-tenant-register.json");
const PREVIEW_PATH = resolve(REPO, "docs/sprint-2g/mallreds-tenant-import-preview.json");

// Store numbers that legitimately appear on two DISTINCT listings in the official
// directory. Any OTHER duplicate store number is an error, not a shared unit.
const DOCUMENTED_SHARED_STORE_NUMBERS = new Set(["88", "80A"]);

const fail = (msg) => { throw new Error(msg); };

/** Map one register tenant → one deterministic import-preview row. */
function toImportRow(t) {
  return {
    canonical_store_id: t.canonical_store_id,
    retailer_name: t.retailer_name,
    branch_name: t.branch_name,
    store_number: t.store_number,
    floor: t.floor,                      // NULL unless directly evidenced (none are)
    zone: t.zone,                        // NULL (directory publishes none)
    phone: t.phone ?? null,
    website: t.website ?? null,
    branch_status: t.branch_status,
    verification_status: t.verification_status,
    confidence: t.confidence_score,
    source_reference: {
      primary_source_url: t.primary_source_url,
      source_owner: t.source_owner,
      supporting_source_urls: t.supporting_source_urls ?? [],
    },
    observed_at: t.observed_at,
    last_verified_at: t.last_verified_at,
    unknown_fields: t.unknown_fields ?? [],
    proposed_db_mapping: {
      target_table: "public.shops",
      requires_migration: "035_mall_directory_truth_fields.sql",
      // canonical_store_id has NO shops column (shops.id is a generated uuid); it
      // is the import idempotency key. Reconcile on (mall_id, store_number, name).
      natural_key: ["mall_id", "store_number", "name"],
      columns: {
        name: t.retailer_name,
        store_number: t.store_number,
        floor: t.floor,                 // -> shops.floor (nullable; no 'G' default after 035)
        zone: t.zone,
        phone: t.phone ?? null,
        website: t.website ?? null,
        category: t.category,           // -> shops.category (NULL = unknown after 035; DO NOT invent)
        branch_status: t.branch_status,
        verification_status: t.verification_status,
        confidence_score: t.confidence_score,
        observed_at: t.observed_at,
        last_verified_at: t.last_verified_at,
        primary_source_url: t.primary_source_url,
        source_owner: t.source_owner,
        contradiction_notes: t.contradiction_notes ?? null,
        normalized_retailer_name: t.normalized_retailer_name ?? null,
        opening_time: null,             // per-store hours unknown -> NULL (no invented 09:00)
        closing_time: null,
      },
      notes: [
        t.category === null
          ? "category is NULL (not published per-store by the directory). shops.category is nullable after 035; capture before promotion — never invent."
          : "category captured from source.",
        t.floor === null
          ? "floor is NULL (directory publishes no floors). Must stay NULL until a verified graph location exists; routing must not fabricate a location."
          : "floor directly evidenced.",
      ],
    },
  };
}

function buildPreview(register) {
  const rows = register.tenants.map(toImportRow);
  return {
    artifact: "mallreds-tenant-import-preview",
    sprint: "2G",
    generated_from: "docs/sprint-2f/mallreds-verified-tenant-register.json",
    generated_by: "scripts/retail/validate-mallreds-tenant-import.mjs (deterministic; no DB/network)",
    import_status: "PREVIEW_ONLY — not imported, not published, no DB mutation",
    target_table: "public.shops",
    requires_migration: "035_mall_directory_truth_fields.sql (NOT applied remotely by this sprint)",
    excluded_pending: register.excluded_pending ?? [],
    counts: {
      rows: rows.length,
      with_store_number: rows.filter((r) => r.store_number).length,
      with_floor: rows.filter((r) => r.floor !== null).length,
      with_category: rows.filter((r) => r.proposed_db_mapping.columns.category !== null).length,
      documented_shared_store_numbers: [...DOCUMENTED_SHARED_STORE_NUMBERS],
    },
    rows,
  };
}

/** Every safety invariant. Throws on the first violation. */
function assertInvariants(register, preview) {
  const rows = preview.rows;
  const checks = [];
  const ok = (name) => checks.push({ name, pass: true });

  // 1. No duplicate canonical store IDs.
  const ids = rows.map((r) => r.canonical_store_id);
  const dupIds = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (dupIds.length) fail(`Duplicate canonical_store_id: ${[...new Set(dupIds)].join(", ")}`);
  ok(`no duplicate canonical_store_id (${ids.length} unique)`);

  // 2. No duplicate (retailer_name + store_number) identity unless documented shared number.
  const byNum = {};
  for (const r of rows) (byNum[r.store_number] ||= []).push(r.retailer_name);
  const undocumentedShared = Object.entries(byNum)
    .filter(([, names]) => names.length > 1)
    .filter(([num]) => !DOCUMENTED_SHARED_STORE_NUMBERS.has(num));
  if (undocumentedShared.length)
    fail(`Undocumented duplicate store numbers: ${undocumentedShared.map(([n, v]) => `#${n} (${v.join(", ")})`).join("; ")}`);
  const identity = rows.map((r) => `${r.retailer_name}::${r.store_number}`);
  const dupIdentity = identity.filter((k, i) => identity.indexOf(k) !== i);
  if (dupIdentity.length) fail(`Duplicate tenant/store-number identity: ${[...new Set(dupIdentity)].join(", ")}`);
  ok(`no duplicate tenant/store-number identity (shared numbers documented: ${[...DOCUMENTED_SHARED_STORE_NUMBERS].join(", ")})`);

  // 3. Every store number has direct source evidence.
  const noEvidence = rows.filter(
    (r) => !r.store_number || !r.source_reference.primary_source_url || r.verification_status !== "official_directory",
  );
  if (noEvidence.length) fail(`${noEvidence.length} rows lack directly-evidenced store numbers`);
  ok(`all ${rows.length} store numbers directly evidenced (official_directory + source URL)`);

  // 4. All floors NULL unless directly evidenced (none are evidenced → all NULL).
  const evidencedFloor = rows.filter((r) => r.floor !== null);
  if (evidencedFloor.length) fail(`${evidencedFloor.length} rows carry a non-NULL floor without directory floor evidence`);
  ok(`all floors NULL (directory publishes none; nothing invented)`);

  // 5. Game excluded unless NEW current official evidence proves otherwise.
  const gameRows = rows.filter((r) => /\bgame\b/i.test(r.retailer_name));
  if (gameRows.length) fail(`"Game" present in import without new current official evidence`);
  const gameExcluded = (register.excluded_pending ?? []).some((e) => /\bgame\b/i.test(e.retailer_name || ""));
  if (!gameExcluded) fail(`"Game" is not recorded in register.excluded_pending`);
  ok(`Game excluded (not in import; recorded in excluded_pending)`);

  // 6. Every tenant has provenance.
  const noProv = rows.filter(
    (r) => !r.source_reference.primary_source_url || !r.source_reference.source_owner || !r.observed_at,
  );
  if (noProv.length) fail(`${noProv.length} rows missing provenance (source URL / owner / observed_at)`);
  ok(`all ${rows.length} rows carry provenance (source URL + owner + observed_at)`);

  // 7. No product or price records exist in the import.
  const PRODUCT_KEYS = ["price", "original_price", "product", "products", "sku", "offer", "discount", "in_stock", "special"];
  const productLeak = rows.filter((r) => {
    const blob = JSON.stringify(r).toLowerCase();
    return PRODUCT_KEYS.some((k) => new RegExp(`"[^"]*${k}[^"]*"\\s*:`).test(blob));
  });
  if (productLeak.length) fail(`${productLeak.length} rows contain product/price fields`);
  ok(`no product or price records in the import`);

  // 8. No publication action exists (status is preview-only, register not ingested/published).
  if (!/PREVIEW_ONLY/.test(preview.import_status)) fail(`preview.import_status is not PREVIEW_ONLY`);
  const published = (register.tenants ?? []).filter(
    (t) => t.ingestion_status && t.ingestion_status !== "not_ingested",
  );
  if (published.length) fail(`${published.length} register tenants are marked ingested/published`);
  ok(`no publication action (preview-only; register ingestion_status = not_ingested)`);

  return checks;
}

// ── Run ───────────────────────────────────────────────────────────────────────
const emit = process.argv.includes("--emit") || process.argv.includes("--write");
const register = JSON.parse(readFileSync(REGISTER_PATH, "utf8"));
const derived = buildPreview(register);
const derivedJson = JSON.stringify(derived, null, 2) + "\n";

if (emit) {
  writeFileSync(PREVIEW_PATH, derivedJson);
  console.log(`Wrote ${PREVIEW_PATH} (${derived.rows.length} rows).`);
}

// Validate committed preview matches the deterministic derivation (unless we just emitted).
let committed;
try {
  committed = readFileSync(PREVIEW_PATH, "utf8");
} catch {
  fail(`Preview not found at ${PREVIEW_PATH}. Run with --emit first.`);
}
if (committed !== derivedJson) {
  fail("Committed preview does NOT match the deterministic derivation from the register. Re-run with --emit and review the diff.");
}

const checks = assertInvariants(register, JSON.parse(committed));

console.log("Mall@Reds tenant-import validation — Sprint 2G");
console.log("=".repeat(64));
console.log(`register : docs/sprint-2f/mallreds-verified-tenant-register.json (${register.tenants.length} tenants)`);
console.log(`preview  : docs/sprint-2g/mallreds-tenant-import-preview.json (${derived.rows.length} rows)`);
console.log(`migration: 035_mall_directory_truth_fields.sql (NOT applied remotely)`);
console.log("-".repeat(64));
for (const c of checks) console.log(`  PASS  ${c.name}`);
console.log("-".repeat(64));
console.log(`ALL ${checks.length} INVARIANTS PASS — preview is deterministic and import-safe.`);
console.log("NO DB mutation, NO product data, NO publication performed by this script.");
