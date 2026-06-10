#!/usr/bin/env node
import { createClient } from "@supabase/supabase-js";

const args = process.argv.slice(2);
const apply = process.env.APPROVE_LINK === "1" || args.includes("--apply");

const mallArgIndex = args.findIndex((arg) => arg === "--mall-id");
const mallId =
  mallArgIndex >= 0
    ? args[mallArgIndex + 1]
    : "f4a2c1b3-8d7e-4f6a-9b0c-1d2e3f4a5b6c";

function normalizeName(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function statusRank(status) {
  switch (status) {
    case "published":
      return 5;
    case "approved":
      return 4;
    case "pending":
      return 3;
    case "needs_more_info":
      return 2;
    case "rejected":
      return 1;
    default:
      return 0;
  }
}

async function main() {
  console.log("===== RETAIL OBSERVATION PRODUCT LINKER =====");
  console.log("mode:", apply ? "APPLY" : "DRY RUN");
  console.log("mall_id:", mallId);
  console.log("matching rule: mall_id + shop_id + normalized product_name");
  console.log("writes: retail_price_observations.product_id only");
  console.log("does not publish products, does not change review_status");

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
  }

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: observations, error: obsErr } = await supabase
    .from("retail_price_observations")
    .select(`
      id,
      product_name,
      shop_id,
      mall_id,
      product_id,
      published_product_id,
      review_status,
      trust_state,
      verification_method,
      price,
      published_at,
      created_at
    `)
    .eq("mall_id", mallId)
    .is("published_at", null)
    .is("product_id", null)
    .order("created_at", { ascending: true });

  if (obsErr) throw new Error(`Failed to load observations: ${obsErr.message}`);

  const { data: products, error: productsErr } = await supabase
    .from("products")
    .select("id, shop_id, mall_id, name, price, data_quality_status, verified, data_source, deleted_at")
    .eq("mall_id", mallId)
    .is("deleted_at", null);

  if (productsErr) throw new Error(`Failed to load products: ${productsErr.message}`);

  const productBuckets = new Map();

  for (const product of products ?? []) {
    const key = `${product.shop_id}|${normalizeName(product.name)}`;
    const existing = productBuckets.get(key) ?? [];
    existing.push(product);
    productBuckets.set(key, existing);
  }

  const plan = [];

  for (const obs of observations ?? []) {
    const matchKey = `${obs.shop_id}|${normalizeName(obs.product_name)}`;
    const candidates = productBuckets.get(matchKey) ?? [];

    let decision = "no_match";
    let matchedProduct = null;
    let reason = "No product with same shop_id and normalized name.";

    if (candidates.length === 1) {
      decision = "link";
      matchedProduct = candidates[0];
      reason = "Exactly one product matched by shop_id + normalized name.";
    } else if (candidates.length > 1) {
      decision = "ambiguous";
      reason = `${candidates.length} products matched; manual review required.`;
    }

    plan.push({
      observation_id: obs.id,
      product_name: obs.product_name,
      review_status: obs.review_status,
      trust_state: obs.trust_state,
      verification_method: obs.verification_method,
      observation_price: obs.price,
      decision,
      matched_product_id: matchedProduct?.id ?? null,
      matched_product_name: matchedProduct?.name ?? null,
      matched_product_price: matchedProduct?.price ?? null,
      matched_product_quality: matchedProduct?.data_quality_status ?? null,
      matched_product_verified: matchedProduct?.verified ?? null,
      matched_product_source: matchedProduct?.data_source ?? null,
      reason,
    });
  }

  const summary = plan.reduce((acc, item) => {
    acc[item.decision] = (acc[item.decision] ?? 0) + 1;
    return acc;
  }, {});

  console.log("");
  console.log("observations_loaded:", observations?.length ?? 0);
  console.log("products_loaded:", products?.length ?? 0);

  console.log("");
  console.log("===== LINK PLAN SUMMARY =====");
  console.table(summary);

  console.log("");
  console.log("===== LINK PLAN =====");
  console.table(plan.map((item) => ({
    decision: item.decision,
    observation: item.product_name,
    review_status: item.review_status,
    matched_product: item.matched_product_name,
    matched_quality: item.matched_product_quality,
    matched_source: item.matched_product_source,
    reason: item.reason,
  })));

  const linkable = plan.filter((item) => item.decision === "link");

  if (!apply) {
    console.log("");
    console.log("Dry run only. Re-run with APPROVE_LINK=1 to write product_id links.");
    console.log("linkable_count:", linkable.length);
    return;
  }

  let linked = 0;

  for (const item of linkable) {
    const { error: updateErr } = await supabase
      .from("retail_price_observations")
      .update({
        product_id: item.matched_product_id,
        review_note:
          "Product linked by scripts/retail/link-observations-to-products.mjs using exact shop_id + normalized product name match.",
      })
      .eq("id", item.observation_id)
      .is("product_id", null)
      .is("published_at", null);

    if (updateErr) {
      throw new Error(`Failed to link observation ${item.observation_id}: ${updateErr.message}`);
    }

    linked++;
  }

  console.log("");
  console.log("linked:", linked);
  console.log("skipped:", plan.length - linked);
}

main().catch((err) => {
  console.error("LINK FAILED:", err);
  process.exit(1);
});
