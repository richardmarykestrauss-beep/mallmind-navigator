/**
 * exampleRetailerAdapter.mjs — Sprint 2K
 *
 * One example retailer-SPECIFIC adapter. It maps the (fictional) "Example Retailer
 * Pilot" CSV column names into RetailerFeedContractV1 canonical records. It carries NO
 * Clicks assumptions and knows nothing about MallMind internal ids. Pure + deterministic.
 *
 * Responsibilities (contract §"Retailer adapter example"): map external columns →
 * canonical; preserve original row number; preserve leading zeros; keep blanks as null;
 * retain unknown columns in an auditable raw_source_reference AND report them; emit
 * warnings for ambiguous-but-usable rows; never assign internal mall/shop/branch ids.
 * Price/timestamp validity + coded quarantine is the importer's job.
 */

import { rowToObject } from "./csvParse.mjs";
import { djb2 } from "./feedImporter.mjs";
import { WARNING_CODES, FEED_CONTRACT_VERSION } from "./feedContract.mjs";

/** External column → canonical field. Any header not here is "unrecognised". */
export const COLUMN_MAP = Object.freeze({
  ProductCode: "source_product_id",
  SKU: "retailer_sku",
  Barcode: "gtin",
  Title: "product_name",
  Brand: "brand",
  Variant: "variant",
  Size: "pack_size",
  Dept: "category",
  SubDept: "subcategory",
  Currency: "currency",
  SellPrice: "current_price",
  WasPrice: "original_price",
  OnPromo: "promotion_indicator",
  PromoType: "promotion_type",
  PriceType: "price_condition",
  PromoLabel: "price_condition_label",
  PromoStart: "promotion_start_at",
  PromoEnd: "promotion_end_at",
  PriceScope: "price_scope",
  AvailScope: "availability_scope",
  BranchCode: "branch_external_id",
  StoreRef: "shop_external_id",
  MallCode: "mall_external_id",
  Stock: "stock_status",
  StockQty: "stock_quantity",
  StockSeen: "stock_observed_at",
  ProductUrl: "canonical_source_url",
  ObservedAt: "observed_at",
  Updated: "source_updated_at",
  RowId: "__row_id",   // retailer's own row id — kept in raw ref, not a canonical field
});

/** Default feed-level metadata for the synthetic pilot (a real feed supplies its own). */
export const EXAMPLE_FEED_META = Object.freeze({
  feed_contract_version: FEED_CONTRACT_VERSION,
  feed_id: "example-retailer-pilot-2026-07",
  feed_generated_at: "2026-07-30T06:00:00Z",
  retailer_name: "Example Retailer Pilot",
  retailer_source_id: "example-retailer-pilot",
  source_type: "csv",
  source_reference: "example-retailer-authorised-feed.csv",
  // MallMind's review state of THIS source — a pilot under review, never auto-approved.
  rights_review_state: "under_review",
  legal_status: "partner_licensed",
});

const blankToNull = (v) => (v === undefined || v === null || String(v).trim() === "" ? null : String(v).trim());
const toBool = (v) => {
  const t = blankToNull(v);
  if (t === null) return null;
  if (/^(y|yes|true|1)$/i.test(t)) return true;
  if (/^(n|no|false|0)$/i.test(t)) return false;
  return t; // unrecognised → passed through; importer flags via promotion coherence
};

/**
 * @param {string[]} headers
 * @param {Array<{source_row_number:number, cells:string[]}>} rows
 * @param {object} [feedMeta]
 * @param {string} [sourceFileName]
 * @returns {Array<Object>} canonical records (unvalidated)
 */
/** Headers this adapter does not map (retained in raw_source_reference; reported feed-level). */
export function unrecognisedColumns(headers) {
  return headers.filter((h) => h !== "" && !(h in COLUMN_MAP));
}

export function mapRows(headers, rows, feedMeta = EXAMPLE_FEED_META, sourceFileName = EXAMPLE_FEED_META.source_reference) {
  return rows.map(({ source_row_number, cells }) => {
    const raw = rowToObject(headers, cells);
    const rec = { ...feedMeta, source_row_number, source_file_name: sourceFileName, raw_source_reference: raw, parse_warnings: [] };

    for (const [ext, val] of Object.entries(raw)) {
      const canonical = COLUMN_MAP[ext];
      if (!canonical || canonical.startsWith("__")) continue; // unrecognised or retailer-private → stays only in raw ref
      if (canonical === "promotion_indicator") rec[canonical] = toBool(val);
      // Identifiers preserved verbatim as STRINGS so leading zeros survive.
      else if (["source_product_id", "retailer_sku", "gtin", "barcode"].includes(canonical)) {
        const t = blankToNull(val); rec[canonical] = t === null ? null : String(t);
      }
      else rec[canonical] = blankToNull(val);
    }

    // gtin also serves as barcode when a separate barcode column is absent.
    if (rec.gtin && !rec.barcode) rec.barcode = rec.gtin;

    // Ambiguous-but-usable promotion flag value.
    if (rec.promotion_indicator !== null && rec.promotion_indicator !== undefined
        && typeof rec.promotion_indicator !== "boolean") {
      rec.parse_warnings.push({
        code: WARNING_CODES.AMBIGUOUS_PROMOTION_LABEL,
        message: `OnPromo value '${rec.promotion_indicator}' is ambiguous; not treated as a promotion`,
      });
      rec.promotion_indicator = false;
    }

    // Deterministic source content hash over the raw row (provenance).
    rec.source_content_hash = djb2(JSON.stringify(raw));
    return rec;
  });
}

export const exampleRetailerAdapter = { adapterName: "example-retailer-pilot", adapterVersion: "1.0.0", mapRows, COLUMN_MAP, feedMeta: EXAMPLE_FEED_META };
