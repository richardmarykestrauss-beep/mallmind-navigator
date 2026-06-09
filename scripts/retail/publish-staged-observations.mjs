#!/usr/bin/env node
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

const validProductVerificationMethods = new Set([
  "phone",
  "website",
  "flyer",
  "receipt",
  "store_visit",
  "retailer_confirmation",
  "scraper",
  "retailer_api",
  "user_submission",
]);

function normalizeName(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function mapTrustStateToProductQuality(trustState) {
  switch (trustState) {
    case "verified":
    case "retailer_submitted":
    case "flyer_extracted":
    case "web_observed":
    case "manual_fact_entry":
      return "manually_verified";
    case "live_feed":
      return "live_feed";
    case "user_submitted":
      return "user_submitted";
    case "expired":
    case "stale":
      return "stale";
    case "disputed":
    case "needs_review":
    default:
      return "needs_review";
  }
}

function mapVerificationMethod(method) {
  if (!method) return null;
  if (validProductVerificationMethods.has(method)) return method;

  // product.price_verification_method currently does not allow csv_manual,
  // affiliate_feed, or partner_feed. Keep product column valid and preserve the
  // original method in products.data_source instead.
  if (method === "affiliate_feed" || method === "partner_feed") return "retailer_api";
  return null;
}

function buildProductPayload(obs, source, snapshot) {
  const productQuality = mapTrustStateToProductQuality(obs.trust_state);
  const mappedMethod = mapVerificationMethod(obs.verification_method);

  const dataSourceParts = [
    "retail_observation",
    source?.source_type ? `source:${source.source_type}` : null,
    obs.trust_state ? `trust:${obs.trust_state}` : null,
    obs.verification_method ? `method:${obs.verification_method}` : null,
    source?.id ? `source_id:${source.id}` : null,
    snapshot?.id ? `snapshot_id:${snapshot.id}` : null,
  ].filter(Boolean);

  return {
    shop_id: obs.shop_id,
    mall_id: obs.mall_id,
    name: obs.product_name,
    category: obs.category,
    brand: obs.brand,
    model: obs.model,
    price: obs.price,
    original_price: obs.original_price,
    is_on_special: obs.is_on_special,
    special_description: obs.special_description,
    image_url: null,
    in_stock: obs.in_stock,
    verified: productQuality === "manually_verified" || productQuality === "live_feed",
    price_verified_at: new Date().toISOString(),
    data_quality_status: productQuality,
    price_verification_method: mappedMethod,
    data_source: dataSourceParts.join("|"),
    verified_by: "scripts/retail/publish-staged-observations.mjs",
    deleted_at: null,
  };
}

async function main() {
  console.log("===== RETAIL STAGED OBSERVATION PUBLISHER =====");
  console.log("mode:", apply ? "APPLY" : "DRY RUN");
  console.log("mall_id:", mallId);
  console.log("publishing gate: review_status=approved only");

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

  const productMap = new Map();
  for (const product of existingProducts ?? []) {
    const key = `${product.shop_id}|${normalizeName(product.name)}`;
    productMap.set(key, product);
  }

  const plan = [];

  for (const obs of rows) {
    const source = obs.retail_data_sources ?? null;
    const snapshot = obs.retail_source_snapshots ?? null;
    const payload = buildProductPayload(obs, source, snapshot);
    const matchKey = `${obs.shop_id}|${normalizeName(obs.product_name)}`;
    const existing = productMap.get(matchKey);

    plan.push({
      observation_id: obs.id,
      action: existing ? "update" : "insert",
      existing_product_id: existing?.id ?? null,
      product_name: obs.product_name,
      shop_id: obs.shop_id,
      category: obs.category,
      price: obs.price,
      trust_state: obs.trust_state,
      product_quality: payload.data_quality_status,
      payload,
    });
  }

  console.table(
    plan.map((item) => ({
      action: item.action,
      product_name: item.product_name,
      category: item.category,
      price: item.price,
      trust_state: item.trust_state,
      product_quality: item.product_quality,
      existing_product_id: item.existing_product_id,
    }))
  );

  if (!apply) {
    console.log("Dry run only. Re-run with --apply to publish.");
    return;
  }

  let inserted = 0;
  let updated = 0;
  let markedPublished = 0;
  const touchedBatchIds = new Set();

  for (const item of plan) {
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
  console.log("markedPublished:", markedPublished);
}

main().catch((err) => {
  console.error("PUBLISH FAILED:", err);
  process.exit(1);
});
