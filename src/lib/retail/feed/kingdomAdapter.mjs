/**
 * kingdomAdapter.mjs — second synthetic retailer adapter (Sprint 2L-A).
 *
 * "Kingdom Home & Tech Pilot" — a fictional retailer whose JSON structure is
 * deliberately DIFFERENT from the Sprint 2K CSV adapter: nested `pricing` (with a nested
 * `promo`), a nested `availability` object (channel/scope/branchCode/branchName/mallCode/
 * stock), different identifiers (`itemRef`), feed-level currency, and JSON numeric prices.
 * It maps all of that into the SAME RetailerFeedContractV1 canonical record — no second
 * candidate model, no bypass of importFeed validation. Pure + deterministic.
 */

import { djb2 } from "./feedImporter.mjs";
import { FEED_CONTRACT_VERSION } from "./feedContract.mjs";

const strOrNull = (v) => (v === undefined || v === null || String(v).trim() === "" ? null : String(v).trim());
/** JSON numbers and strings both accepted; the importer's decimal-safe parser validates. */
const priceStr = (v) => (v === undefined || v === null || v === "" ? null : String(v));

export function feedMetaFrom(envelope, sourceFileName) {
  return {
    feed_contract_version: FEED_CONTRACT_VERSION,
    feed_id: strOrNull(envelope.feed_id),
    feed_generated_at: strOrNull(envelope.feed_generated_at),
    retailer_name: strOrNull(envelope.retailer_name) ?? "Kingdom Home & Tech Pilot",
    retailer_source_id: strOrNull(envelope.retailer_source_id) ?? "kingdom-home-tech",
    source_type: "json",
    source_reference: sourceFileName ?? "example-retailer-json-feed.json",
    rights_review_state: strOrNull(envelope.rights_review_state) ?? "under_review",
    legal_status: strOrNull(envelope.legal_status) ?? "partner_licensed",
  };
}

/**
 * @param {object} envelope  the JSON feed root
 * @param {Array<{source_row_number:number, product:any}>} products
 * @param {string} [sourceFileName]
 * @returns {Array<Object>} canonical (unvalidated) records
 */
export function mapKingdomFeed(envelope, products, sourceFileName = "example-retailer-json-feed.json") {
  const feedMeta = feedMetaFrom(envelope, sourceFileName);
  const feedCurrency = strOrNull(envelope.currency);

  return products.map(({ source_row_number, product }) => {
    const p = product ?? {};
    const pricing = p.pricing ?? {};
    const promo = pricing.promo ?? {};
    const avail = p.availability ?? {};
    const promoActive = promo.active === true;
    const channel = strOrNull(avail.channel);

    const price_scope = strOrNull(avail.priceScope)
      ?? (channel === "branch" ? "branch_specific" : channel === "online" ? "online_national" : "unknown");
    const availability_scope = strOrNull(avail.availabilityScope)
      ?? (channel === "branch" ? "branch_confirmed" : channel === "online" ? "online" : "unknown");

    const rec = {
      ...feedMeta,
      source_row_number,
      source_file_name: feedMeta.source_reference,
      raw_source_reference: p,
      parse_warnings: [],
      // identity (strings — leading zeros preserved)
      source_product_id: strOrNull(p.itemRef),
      retailer_sku: strOrNull(p.sku),
      gtin: strOrNull(p.gtin),
      barcode: strOrNull(p.gtin),
      product_name: strOrNull(p.title),
      brand: strOrNull(p.brandName),
      variant: strOrNull(p.variantName),
      pack_size: strOrNull(p.size),
      category: strOrNull(p.department),
      subcategory: strOrNull(p.subDepartment),
      // commercial (nested pricing → flat canonical; numbers or strings accepted)
      currency: strOrNull(p.currency) ?? feedCurrency,
      current_price: priceStr(pricing.sell),
      original_price: priceStr(pricing.was),
      promotion_indicator: promoActive,
      promotion_type: strOrNull(promo.type),
      price_condition: promoActive ? "promotional" : "standard",
      price_condition_label: strOrNull(promo.label),
      promotion_start_at: strOrNull(promo.start),
      promotion_end_at: strOrNull(promo.end),
      // scope + availability (nested availability object → flat)
      price_scope,
      availability_scope,
      branch_external_id: strOrNull(avail.branchCode),
      external_branch_name: strOrNull(avail.branchName),
      shop_external_id: strOrNull(avail.branchCode),
      mall_external_id: strOrNull(avail.mallCode),
      stock_status: strOrNull(avail.stock),
      stock_quantity: avail.stockQty ?? null,
      stock_observed_at: strOrNull(avail.stockSeenAt),
      // evidence
      canonical_source_url: strOrNull(p.url),
      observed_at: strOrNull(p.observedAt),
      source_updated_at: strOrNull(p.updatedAt),
    };
    rec.source_content_hash = djb2(JSON.stringify(p));
    return rec;
  });
}

export const kingdomAdapter = { adapterName: "kingdom-home-tech-pilot", adapterVersion: "1.0.0", mapKingdomFeed, feedMetaFrom };
