#!/usr/bin/env node
// Retail CSV staging importer (legacy CLI; Sprint 20A.9 refactor).
//
// Parsing / validation / sanitisation / normalisation / hashing now come from
// the SHARED pure intake core (google-cloud-backend/dist/services/retail/
// retailCsvIntake.js) — the SAME logic the admin API endpoint uses. This script
// no longer duplicates those business rules.
//
//   Build first:   (cd google-cloud-backend && npm run build)
//   Dry run:       node scripts/retail/import-csv-staging.mjs --file path.csv
//   Apply:         node scripts/retail/import-csv-staging.mjs --file path.csv --apply
//
// The preferred path for new imports is the admin API
// (POST /admin/retail-observations/import-csv), which stages atomically via the
// stage_retail_csv_import RPC. This CLI remains for local/seed staging and runs
// as service-role.

import { createClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const fileArgIndex = args.findIndex((arg) => arg === "--file");
const filePath = fileArgIndex >= 0 ? args[fileArgIndex + 1] : "scripts/retail/mallreds_seed_starter.csv";

// ── Shared compiled intake core (no duplicated logic) ───────────────────────
const CORE_DIST_URL = new URL(
  "../../google-cloud-backend/dist/services/retail/index.js",
  import.meta.url,
);
let core;
try {
  core = await import(CORE_DIST_URL.href);
} catch (err) {
  console.error("ERROR: Retail Intelligence Core build not found.");
  console.error("Run `npm run build` inside google-cloud-backend first, then re-run this script.");
  console.error(`Underlying error: ${err?.message ?? err}`);
  process.exit(1);
}
const { intakeRetailCsv } = core;

async function main() {
  const resolved = resolve(filePath);
  const csvText = readFileSync(resolved, "utf8");
  const fileSha = createHash("sha256").update(csvText).digest("hex");

  const result = intakeRetailCsv(csvText);

  console.log("===== RETAIL CSV IMPORTER =====");
  console.log("mode:", apply ? "APPLY" : "DRY RUN");
  console.log("file:", resolved);
  console.log("file_sha256:", fileSha);

  if (!result.ok) {
    console.error("STRUCTURAL ERROR:", result.structural_error);
    process.exit(1);
  }

  // Summary aligned with the API response.
  console.log("total_rows:", result.total_rows);
  console.log("valid_rows:", result.valid_rows);
  console.log("blocked_rows:", result.blocked_rows);
  console.log("duplicate_rows_in_file:", result.duplicate_rows_in_file);
  console.log("category_counts:", result.category_counts);
  for (const r of result.rows) {
    if (r.status === "blocked") console.warn(`  row ${r.row_number} BLOCKED: ${r.blockers.join("; ")}`);
    else if (r.warnings.length) console.warn(`  row ${r.row_number} WARN: ${r.warnings.join("; ")}`);
  }

  if (!apply) {
    console.log("Dry run only. Re-run with --apply to stage rows.");
    return;
  }

  if (!result.candidates.length) {
    console.error("No stageable rows (all blocked or duplicate). Aborting apply.");
    process.exit(1);
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for --apply.");
  }
  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const mallId = result.candidates[0].mall_id;
  if (!result.candidates.every((c) => c.mall_id === mallId)) {
    throw new Error("All rows must belong to a single mall for one import.");
  }

  const { data: source, error: sourceErr } = await supabase
    .from("retail_data_sources")
    .insert({
      source_type: "csv",
      name: `Mall@Reds starter CSV — ${basename(resolved)}`,
      retailer_name: "Mixed Mall@Reds retailers",
      mall_id: mallId,
      base_trust: 0.75,
      legal_status: "manual_fact_entry",
      license_note: "Manual MallMind fact-entry seed. No copied product images or copyrighted descriptions.",
      attribution_required: false,
      is_active: true,
    })
    .select("id")
    .single();
  if (sourceErr) throw new Error(`Failed to create retail_data_sources row: ${sourceErr.message}`);

  // Reuse snapshot by (source_id, content_sha256) — idempotent re-import.
  let snapshotId;
  const { data: existingSnap } = await supabase
    .from("retail_source_snapshots")
    .select("id")
    .eq("source_id", source.id)
    .eq("content_sha256", fileSha)
    .maybeSingle();
  if (existingSnap) {
    snapshotId = existingSnap.id;
  } else {
    const { data: snapshot, error: snapshotErr } = await supabase
      .from("retail_source_snapshots")
      .insert({
        source_id: source.id,
        snapshot_type: "csv",
        ref_label: basename(resolved),
        content_sha256: fileSha,
        captured_by: "scripts/retail/import-csv-staging.mjs",
        notes: "Staged into retail_price_observations via the CLI importer.",
      })
      .select("id")
      .single();
    if (snapshotErr) throw new Error(`Failed to create retail_source_snapshots row: ${snapshotErr.message}`);
    snapshotId = snapshot.id;
  }

  const { data: batch, error: batchErr } = await supabase
    .from("retail_import_batches")
    .insert({
      source_id: source.id,
      snapshot_id: snapshotId,
      mall_id: mallId,
      status: "processing",
      source_file: basename(resolved),
      total_rows: result.total_rows,
      staged_rows: 0,
      created_by: "scripts/retail/import-csv-staging.mjs",
    })
    .select("id")
    .single();
  if (batchErr) throw new Error(`Failed to create retail_import_batches row: ${batchErr.message}`);

  // Dedup against existing observation hashes.
  const hashes = result.candidates.map((c) => c.observation_hash);
  const { data: existing, error: existingErr } = await supabase
    .from("retail_price_observations")
    .select("observation_hash")
    .in("observation_hash", hashes);
  if (existingErr) throw new Error(`Failed to check existing observation hashes: ${existingErr.message}`);
  const existingHashes = new Set((existing ?? []).map((row) => row.observation_hash));

  const observationRows = result.candidates
    .filter((c) => !existingHashes.has(c.observation_hash))
    .map((c) => ({
      import_batch_id: batch.id,
      source_id: source.id,
      snapshot_id: snapshotId,
      mall_id: c.mall_id,
      shop_id: c.shop_id,
      product_id: c.product_id,
      product_name: c.product_name,
      brand: c.brand,
      model: c.model,
      category: c.category,
      price: c.price,
      original_price: c.original_price,
      is_on_special: c.is_on_special,
      special_description: c.special_description,
      in_stock: c.in_stock,
      observed_at: c.observed_at,
      valid_from: c.valid_from,
      valid_to: c.valid_to,
      trust_state: c.trust_state, // already downgraded by the shared core
      verification_method: c.verification_method,
      confidence: c.confidence,
      review_status: "pending",
      review_note: c.source_note,
      observation_hash: c.observation_hash,
    }));

  if (observationRows.length) {
    const { error: insertErr } = await supabase.from("retail_price_observations").insert(observationRows);
    if (insertErr) throw new Error(`Failed to insert observations: ${insertErr.message}`);
  }

  const { error: updateBatchErr } = await supabase
    .from("retail_import_batches")
    .update({ status: "staged", staged_rows: observationRows.length })
    .eq("id", batch.id);
  if (updateBatchErr) throw new Error(`Failed to update batch: ${updateBatchErr.message}`);

  console.log("source_id:", source.id);
  console.log("snapshot_id:", snapshotId);
  console.log("batch_id:", batch.id);
  console.log("staged_rows:", observationRows.length);
  console.log("skipped_existing_hashes:", result.candidates.length - observationRows.length);
  console.log("review_status: pending");
}

main().catch((err) => {
  console.error("IMPORT FAILED:", err);
  process.exit(1);
});
