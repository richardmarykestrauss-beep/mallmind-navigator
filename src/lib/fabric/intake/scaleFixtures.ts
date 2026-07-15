/**
 * Deterministic generated scale fixtures — "Generated scale fixture — no retailer
 * data." A LAZY async generator that yields a realistic mixture (valid,
 * duplicates, invalid prices, missing titles, expired, unsupported currencies,
 * conflicts, different malls/branches, online-only, malformed) WITHOUT ever
 * materializing the full array — so 50,000 records stay memory-bounded.
 *
 * No randomness (index-derived), so a given N always produces identical output.
 */

import type { RawRecord } from "./types";

export type ScaleCategory =
  | "valid" | "duplicate" | "conflict" | "expired" | "online_only"
  | "invalid_price" | "missing_title" | "bad_currency" | "malformed";

/** Assign each index to exactly one category (priority order → predictable counts). */
export function classifyIndex(i: number): ScaleCategory {
  if (i % 19 === 0) return "missing_title";
  if (i % 13 === 0) return "invalid_price";
  if (i % 23 === 0) return "bad_currency";
  if (i % 37 === 0) return "malformed";
  if (i % 17 === 0) return "duplicate";
  if (i % 29 === 0) return "conflict";
  if (i % 11 === 0) return "expired";
  if (i % 7 === 0) return "online_only";
  return "valid";
}

/** Count expected categories for N records (test reconciliation without materializing). */
export function expectedCounts(n: number): Record<ScaleCategory, number> {
  const c: Record<ScaleCategory, number> = { valid: 0, duplicate: 0, conflict: 0, expired: 0, online_only: 0, invalid_price: 0, missing_title: 0, bad_currency: 0, malformed: 0 };
  for (let i = 0; i < n; i++) c[classifyIndex(i)]++;
  return c;
}

const RETAILERS = ["Game", "Checkers", "Pick n Pay", "Makro", "HiFi Corp"];
const MALLS = ["Mall@Reds", "Centurion Mall", "Menlyn Park"];

function recordFor(i: number, baseIso: string): RawRecord | null {
  const cat = classifyIndex(i);
  const observed = new Date(Date.parse(baseIso) - (i % 24) * 3_600_000).toISOString();
  const retailer = RETAILERS[i % RETAILERS.length];
  const mall = MALLS[i % MALLS.length];
  const common = { retailer, mall, brand: "Hisense", currency: "ZAR", source_type: "retailer_product_page", observed_at: observed, availability_status: "inferred", source_url: `https://example.co.za/p/${i}` };

  switch (cat) {
    case "missing_title": return { ...common, price: "3999" }; // no product_title → rejected
    case "invalid_price": return { ...common, product_title: `TV ${i}`, model: `M${i}`, price: "-5" };
    case "bad_currency": return { ...common, product_title: `TV ${i}`, model: `M${i}`, price: "3999", currency: "XYZ" };
    case "malformed": { // too many fields → structural rejection
      const junk: RawRecord = { ...common, product_title: `TV ${i}`, price: "3999" };
      for (let k = 0; k < 140; k++) junk[`junk_${k}`] = k;
      return junk;
    }
    case "duplicate": return { retailer: "Game", mall: "Mall@Reds", brand: "Hisense", currency: "ZAR", source_type: "retailer_product_page", observed_at: baseIso, availability_status: "inferred", source_url: "https://example.co.za/dup", product_title: "Duplicate TV", model: "DUP1", price: "2999" };
    case "conflict": return { ...common, product_title: "Conflict TV", model: "CONF1", price: String(3000 + (i % 500)), source_type: "retailer_product_page" };
    case "expired": return { ...common, product_title: `TV ${i}`, model: `M${i}`, price: "3999", source_type: "retailer_specials_page", expires_at: new Date(Date.parse(baseIso) - 5 * 86_400_000).toISOString(), trust_label: "catalogue_special" };
    case "online_only": return { ...common, product_title: `TV ${i}`, model: `M${i}`, price: String(2500 + (i % 900)), source_type: "retailer_search_page" };
    default: return { ...common, product_title: `TV ${i}`, model: `M${i}`, price: String(2000 + (i % 2500)) };
  }
}

/** Lazily yield N deterministic records — never materializes the whole set. */
export async function* scaleRecords(n: number, baseIso: string): AsyncGenerator<RawRecord> {
  for (let i = 0; i < n; i++) {
    const r = recordFor(i, baseIso);
    if (r) yield r;
  }
}

export const SCALE_FIXTURE_LABEL = "Generated scale fixture — no retailer data.";
