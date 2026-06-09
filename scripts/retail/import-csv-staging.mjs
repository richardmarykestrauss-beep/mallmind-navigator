#!/usr/bin/env node
import { createClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const fileArgIndex = args.findIndex((arg) => arg === "--file");
const filePath = fileArgIndex >= 0 ? args[fileArgIndex + 1] : "scripts/retail/mallreds_seed_starter.csv";

const requiredHeaders = [
  "mall_id",
  "shop_id",
  "product_name",
  "brand",
  "model",
  "category",
  "price",
  "original_price",
  "is_on_special",
  "special_description",
  "in_stock",
  "trust_state",
  "verification_method",
  "valid_to",
  "source_note",
];

const allowedTrustStates = new Set([
  "verified",
  "retailer_submitted",
  "live_feed",
  "flyer_extracted",
  "user_submitted",
  "web_observed",
  "manual_fact_entry",
  "disputed",
  "needs_review",
  "expired",
  "stale",
]);

const allowedVerificationMethods = new Set([
  "phone",
  "website",
  "flyer",
  "receipt",
  "store_visit",
  "retailer_confirmation",
  "csv_manual",
  "affiliate_feed",
  "partner_feed",
  "user_submission",
  "",
]);

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (ch === '"' && inQuotes && next === '"') {
      cell += '"';
      i++;
      continue;
    }

    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (ch === "," && !inQuotes) {
      row.push(cell);
      cell = "";
      continue;
    }

    if ((ch === "\n" || ch === "\r") && !inQuotes) {
      if (ch === "\r" && next === "\n") i++;
      row.push(cell);
      if (row.some((value) => value.trim() !== "")) rows.push(row);
      row = [];
      cell = "";
      continue;
    }

    cell += ch;
  }

  if (cell.length || row.length) {
    row.push(cell);
    if (row.some((value) => value.trim() !== "")) rows.push(row);
  }

  return rows;
}

function toBool(value, fieldName, rowNumber) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  throw new Error(`Row ${rowNumber}: ${fieldName} must be true or false`);
}

function toNullableNumber(value, fieldName, rowNumber) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Row ${rowNumber}: ${fieldName} must be a positive number`);
  }
  return parsed;
}

function sanitizeCsvText(value) {
  const raw = String(value ?? "").trim();
  if (/^[=+\-@]/.test(raw)) {
    return `'${raw}`;
  }
  return raw;
}

function normHashPart(value) {
  return String(value ?? "").trim().toLowerCase();
}

function observationHash(row) {
  const key = [
    row.mall_id,
    row.shop_id,
    normHashPart(row.product_name),
    normHashPart(row.brand),
    normHashPart(row.model),
    normHashPart(row.category),
    row.price,
    row.original_price ?? "",
    row.valid_to ?? "",
  ].join("|");

  return createHash("sha256").update(key).digest("hex");
}

function validateAndNormalize(csvText) {
  const parsed = parseCsv(csvText);
  if (parsed.length < 2) throw new Error("CSV has no data rows.");

  const headers = parsed[0].map((h) => h.trim());
  const missing = requiredHeaders.filter((h) => !headers.includes(h));
  if (missing.length) throw new Error(`CSV missing headers: ${missing.join(", ")}`);

  const headerIndex = Object.fromEntries(headers.map((h, i) => [h, i]));
  const normalized = [];

  for (let i = 1; i < parsed.length; i++) {
    const rowNumber = i + 1;
    const row = parsed[i];

    const get = (key) => sanitizeCsvText(row[headerIndex[key]] ?? "");

    const trustState = get("trust_state") || "needs_review";
    const verificationMethod = get("verification_method");

    if (!allowedTrustStates.has(trustState)) {
      throw new Error(`Row ${rowNumber}: invalid trust_state "${trustState}"`);
    }

    if (!allowedVerificationMethods.has(verificationMethod)) {
      throw new Error(`Row ${rowNumber}: invalid verification_method "${verificationMethod}"`);
    }

    const item = {
      mall_id: get("mall_id"),
      shop_id: get("shop_id"),
      product_name: get("product_name"),
      brand: get("brand") || null,
      model: get("model") || null,
      category: get("category") || null,
      price: toNullableNumber(get("price"), "price", rowNumber),
      original_price: toNullableNumber(get("original_price"), "original_price", rowNumber),
      is_on_special: toBool(get("is_on_special"), "is_on_special", rowNumber),
      special_description: get("special_description") || null,
      in_stock: toBool(get("in_stock"), "in_stock", rowNumber),
      trust_state: trustState,
      verification_method: verificationMethod || null,
      valid_to: get("valid_to") || null,
      source_note: get("source_note") || null,
    };

    if (!item.mall_id) throw new Error(`Row ${rowNumber}: mall_id is required`);
    if (!item.shop_id) throw new Error(`Row ${rowNumber}: shop_id is required`);
    if (!item.product_name) throw new Error(`Row ${rowNumber}: product_name is required`);
    if (item.price == null) throw new Error(`Row ${rowNumber}: price is required`);

    item.observation_hash = observationHash(item);
    normalized.push(item);
  }

  return normalized;
}

async function main() {
  const resolved = resolve(filePath);
  const csvText = readFileSync(resolved, "utf8");
  const sha256 = createHash("sha256").update(csvText).digest("hex");
  const rows = validateAndNormalize(csvText);

  console.log("===== RETAIL CSV IMPORTER =====");
  console.log("mode:", apply ? "APPLY" : "DRY RUN");
  console.log("file:", resolved);
  console.log("sha256:", sha256);
  console.log("rows:", rows.length);

  const categoryCounts = rows.reduce((acc, row) => {
    acc[row.category || "Uncategorized"] = (acc[row.category || "Uncategorized"] ?? 0) + 1;
    return acc;
  }, {});
  console.log("categoryCounts:", categoryCounts);

  if (!apply) {
    console.log("Dry run only. Re-run with --apply to stage rows.");
    return;
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for --apply.");
  }

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const first = rows[0];

  const { data: source, error: sourceErr } = await supabase
    .from("retail_data_sources")
    .insert({
      source_type: "csv",
      name: `Mall@Reds starter CSV — ${basename(resolved)}`,
      retailer_name: "Mixed Mall@Reds retailers",
      mall_id: first.mall_id,
      base_trust: 0.75,
      legal_status: "manual_fact_entry",
      license_note: "Manual MallMind fact-entry seed. No copied product images or copyrighted descriptions.",
      attribution_required: false,
      is_active: true,
    })
    .select("id")
    .single();

  if (sourceErr) throw new Error(`Failed to create retail_data_sources row: ${sourceErr.message}`);

  const { data: snapshot, error: snapshotErr } = await supabase
    .from("retail_source_snapshots")
    .insert({
      source_id: source.id,
      snapshot_type: "csv",
      ref_label: basename(resolved),
      content_sha256: sha256,
      captured_by: "scripts/retail/import-csv-staging.mjs",
      notes: "Mall@Reds starter CSV staged into retail_price_observations.",
    })
    .select("id")
    .single();

  if (snapshotErr) throw new Error(`Failed to create retail_source_snapshots row: ${snapshotErr.message}`);

  const { data: batch, error: batchErr } = await supabase
    .from("retail_import_batches")
    .insert({
      source_id: source.id,
      snapshot_id: snapshot.id,
      mall_id: first.mall_id,
      status: "processing",
      source_file: basename(resolved),
      total_rows: rows.length,
      staged_rows: 0,
      created_by: "scripts/retail/import-csv-staging.mjs",
    })
    .select("id")
    .single();

  if (batchErr) throw new Error(`Failed to create retail_import_batches row: ${batchErr.message}`);

  const hashes = rows.map((row) => row.observation_hash);
  const { data: existing, error: existingErr } = await supabase
    .from("retail_price_observations")
    .select("observation_hash")
    .in("observation_hash", hashes);

  if (existingErr) throw new Error(`Failed to check existing observation hashes: ${existingErr.message}`);

  const existingHashes = new Set((existing ?? []).map((row) => row.observation_hash));
  const newRows = rows.filter((row) => !existingHashes.has(row.observation_hash));

  const observationRows = newRows.map((row) => ({
    import_batch_id: batch.id,
    source_id: source.id,
    snapshot_id: snapshot.id,
    mall_id: row.mall_id,
    shop_id: row.shop_id,
    product_name: row.product_name,
    brand: row.brand,
    model: row.model,
    category: row.category,
    price: row.price,
    original_price: row.original_price,
    is_on_special: row.is_on_special,
    special_description: row.special_description,
    in_stock: row.in_stock,
    valid_to: row.valid_to,
    trust_state: row.trust_state,
    verification_method: row.verification_method,
    confidence: row.trust_state === "verified" ? 0.9 : 0.7,
    review_status: "pending",
    review_note: row.source_note,
    observation_hash: row.observation_hash,
  }));

  if (observationRows.length) {
    const { error: insertErr } = await supabase
      .from("retail_price_observations")
      .insert(observationRows);

    if (insertErr) throw new Error(`Failed to insert observations: ${insertErr.message}`);
  }

  const { error: updateBatchErr } = await supabase
    .from("retail_import_batches")
    .update({
      status: "staged",
      staged_rows: observationRows.length,
    })
    .eq("id", batch.id);

  if (updateBatchErr) throw new Error(`Failed to update batch: ${updateBatchErr.message}`);

  console.log("source_id:", source.id);
  console.log("snapshot_id:", snapshot.id);
  console.log("batch_id:", batch.id);
  console.log("staged_rows:", observationRows.length);
  console.log("skipped_existing_hashes:", rows.length - observationRows.length);
}

main().catch((err) => {
  console.error("IMPORT FAILED:", err);
  process.exit(1);
});
