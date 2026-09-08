#!/usr/bin/env node
// Controlled retail observation publisher (19C.3 gate + Retail Intelligence Core).
//
// Trust rules enforced here:
//   - review_status='approved' is the ONLY publish gate.
//   - Dry-run by default; writes happen only with --apply.
//   - Ambiguous product matches are never published.
//
// Matching/trust/planning logic is shared with the admin publish preview via
// the Retail Intelligence Core (google-cloud-backend/src/services/retail/),
// consumed here from its compiled output.

import { createClient } from "@supabase/supabase-js";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const approvePending = args.includes("--approve-pending");

if (approvePending) {
  console.error("ERROR: --approve-pending is no longer allowed.");
  console.error("Retail observations must be reviewed in Admin → Retail Review before publishing.");
  console.error("Use review_status='approved' as the publishing gate.");
  process.exit(1);
}

const mallArgIndex = args.findIndex((arg) => arg === "--mall-id");
const mallId =
  mallArgIndex >= 0
    ? args[mallArgIndex + 1]
    : "f4a2c1b3-8d7e-4f6a-9b0c-1d2e3f4a5b6c";

const CORE_DIST_URL = new URL(
  "../../google-cloud-backend/dist/services/retail/index.js",
  import.meta.url
);

let core;
try {
  core = await import(CORE_DIST_URL.href);
} catch (err) {
  console.error("ERROR: Retail Intelligence Core build not found.");
  console.error("Run `npm run build` inside google-cloud-backend first, then re-run this script.");
  console.error(`(Tried to load: ${CORE_DIST_URL.pathname})`);
  console.error(`Underlying error: ${err?.message ?? err}`);
  process.exit(1);
}

const { buildPublishPlan } = core;

async function main() {
  console.log("===== RETAIL STAGED OBSERVATION PUBLISHER =====");
  console.log("mode:", apply ? "APPLY" : "DRY RUN");
  console.log("mall_id:", mallId);
  console.log("publishing gate: review_status=approved only");
  console.log("matching: shared Retail Intelligence Core (product_id → shop/name → insert_new; ambiguous rows are skipped)");

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
  }

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const statuses = ["approved"];

  const { data: observations, error: obsErr } = await supabase
    .from("retail_price_observations")
    .select(`
      *,
      retail_data_sources:source_id (
        id,
        source_type,
        name,
        legal_status
      ),
      retail_source_snapshots:snapshot_id (
        id,
        ref_label,
        content_sha256
      )
    `)
    .eq("mall_id", mallId)
    .in("review_status", statuses)
    .order("created_at", { ascending: true });

  if (obsErr) throw new Error(`Failed to load observations: ${obsErr.message}`);

  const rows = observations ?? [];
  console.log("publishable observations:", rows.length);

  if (!rows.length) {
    console.log("Nothing to publish.");
    return;
  }

  const { data: existingProducts, error: productsErr } = await supabase
    .from("products")
    .select("id, mall_id, shop_id, name, price, data_quality_status")
    .eq("mall_id", mallId)
    .is("deleted_at", null);

  if (productsErr) throw new Error(`Failed to load products: ${productsErr.message}`);

  const plan = buildPublishPlan(rows, existingProducts ?? [], {
    nowIso: new Date().toISOString(),
    verifiedBy: "scripts/retail/publish-staged-observations.mjs",
  });

  console.table(
    plan.map((item) => ({
      action: item.action,
      product_name: item.product_name,
      category: item.category,
      price: item.price,
      trust_state: item.trust_state,
      product_quality: item.projected_product_quality,
      match_strategy: item.match_strategy,
      existing_product_id: item.existing_product_id,
    }))
  );

  const ambiguousItems = plan.filter((item) => item.action === "skip_ambiguous");
  if (ambiguousItems.length) {
    console.warn("");
    console.warn(`WARNING: ${ambiguousItems.length} ambiguous row(s) will NOT be published:`);
    for (const item of ambiguousItems) {
      console.warn(
        `  - ${item.product_name} (observation ${item.observation_id}): ${item.match_reason}`
      );
    }
    console.warn("Resolve ambiguity by linking product_id explicitly, then re-run.");
  }

  if (!apply) {
    console.log("Dry run only. Re-run with --apply to publish.");
    return;
  }

  let inserted = 0;
  let updated = 0;
  let skippedAmbiguous = 0;
  let markedPublished = 0;
  const touchedBatchIds = new Set();

  for (const item of plan) {
    if (item.action === "skip_ambiguous") {
      skippedAmbiguous++;
      continue;
    }

    let productId = item.existing_product_id;

    if (item.action === "update") {
      const { error: updateErr } = await supabase
        .from("products")
        .update(item.payload)
        .eq("id", productId);

      if (updateErr) throw new Error(`Failed to update product ${productId}: ${updateErr.message}`);
      updated++;
    } else {
      const { data: insertedProduct, error: insertErr } = await supabase
        .from("products")
        .insert(item.payload)
        .select("id")
        .single();

      if (insertErr) throw new Error(`Failed to insert product "${item.product_name}": ${insertErr.message}`);
      productId = insertedProduct.id;
      inserted++;
    }

    const { error: obsUpdateErr } = await supabase
      .from("retail_price_observations")
      .update({
        product_id: productId,
        published_product_id: productId,
        review_status: "published",
        reviewed_by: "scripts/retail/publish-staged-observations.mjs",
        reviewed_at: new Date().toISOString(),
        review_note: "Published by approved-only 19C.3 publisher after admin review.",
        published_at: new Date().toISOString(),
      })
      .eq("id", item.observation_id);

    if (obsUpdateErr) {
      throw new Error(`Failed to mark observation ${item.observation_id} published: ${obsUpdateErr.message}`);
    }

    markedPublished++;

    const obs = rows.find((row) => row.id === item.observation_id);
    if (obs?.import_batch_id) touchedBatchIds.add(obs.import_batch_id);
  }

  for (const batchId of touchedBatchIds) {
    const { count: remainingPending } = await supabase
      .from("retail_price_observations")
      .select("id", { count: "exact", head: true })
      .eq("import_batch_id", batchId)
      .in("review_status", ["pending", "approved", "needs_more_info"]);

    const { count: publishedCount } = await supabase
      .from("retail_price_observations")
      .select("id", { count: "exact", head: true })
      .eq("import_batch_id", batchId)
      .eq("review_status", "published");

    const { error: batchUpdateErr } = await supabase
      .from("retail_import_batches")
      .update({
        status: remainingPending ? "staged" : "approved",
        approved_rows: publishedCount ?? 0,
      })
      .eq("id", batchId);

    if (batchUpdateErr) {
      throw new Error(`Failed to update batch ${batchId}: ${batchUpdateErr.message}`);
    }
  }

  console.log("updated:", updated);
  console.log("inserted:", inserted);
  console.log("skipped_ambiguous:", skippedAmbiguous);
  console.log("markedPublished:", markedPublished);
}

main().catch((err) => {
  console.error("PUBLISH FAILED:", err);
  process.exit(1);
});
