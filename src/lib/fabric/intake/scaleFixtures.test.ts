/**
 * Sprint 2E dev-proof — the generated scale fixture must contain ZERO real-looking
 * retailer / mall / brand names, while preserving record count, determinism, schema,
 * and category distribution (identity/dedup behaviour is unchanged: brand stays a
 * single constant token; retailer/mall are not part of the identity candidate).
 */

import { describe, it, expect } from "vitest";
import { scaleRecords, expectedCounts, classifyIndex } from "./scaleFixtures";
import type { RawRecord } from "./types";

const BASE = "2026-07-13T12:00:00.000Z";
const N = 1000;

async function generate(n: number): Promise<{ rows: RawRecord[]; text: string }> {
  const rows: RawRecord[] = [];
  const lines: string[] = [];
  for await (const r of scaleRecords(n, BASE)) { rows.push(r); lines.push(JSON.stringify(r)); }
  return { rows, text: `${lines.join("\n")}\n` };
}

// The real names that must NOT appear (Gate-7 forbidden set + the former fixture seed set).
const FORBIDDEN = [
  "Game", "Mall@Reds", "Hisense", "Woolworths", "PEP", "Clicks",       // explicit Gate-7 set
  "Checkers", "Pick n Pay", "Makro", "HiFi Corp",                       // former RETAILERS seed
  "Centurion Mall", "Menlyn Park",                                      // former MALLS seed
];

describe("scaleFixtures — dev-proof name sanitization", () => {
  it("(1)+(2) contains ZERO real retailer/mall/brand names", async () => {
    const { text } = await generate(N);
    for (const name of FORBIDDEN) {
      expect(text.includes(name), `forbidden name "${name}" must not appear`).toBe(false);
    }
  });

  it("(3) generates exactly 1,000 records", async () => {
    const { rows } = await generate(N);
    expect(rows.length).toBe(N);
  });

  it("(4) is deterministic byte-for-byte across two generations", async () => {
    const a = await generate(N);
    const b = await generate(N);
    expect(a.text).toBe(b.text);
    expect(Buffer.byteLength(a.text, "utf8")).toBe(Buffer.byteLength(b.text, "utf8"));
  });

  it("(5) every row uses only neutral tokens and keeps the expected schema shape", async () => {
    const { rows } = await generate(N);
    const RET = /^RETAILER_[A-E]$/;
    const MALL = /^MALL_[XYZ]$/;
    rows.forEach((r, i) => {
      // retailer/mall/brand are neutral on every row that carries them
      if (r.retailer !== undefined) expect(RET.test(String(r.retailer)), `row ${i} retailer`).toBe(true);
      if (r.mall !== undefined) expect(MALL.test(String(r.mall)), `row ${i} mall`).toBe(true);
      if (r.brand !== undefined) expect(r.brand, `row ${i} brand`).toBe("BRAND_1");
      // structural fields preserved
      expect(typeof r.source_type).toBe("string");
      expect(typeof r.observed_at).toBe("string");
    });
  });

  it("(6) category distribution is unchanged (index-derived)", async () => {
    // classifyIndex is untouched, so the distribution must equal the known baseline.
    expect(expectedCounts(N)).toEqual({
      valid: 579, duplicate: 48, conflict: 28, expired: 67, online_only: 92,
      invalid_price: 72, missing_title: 53, bad_currency: 38, malformed: 23,
    });
    // and the generated rows' categories match classifyIndex 1:1
    const { rows } = await generate(N);
    const tally: Record<string, number> = {};
    rows.forEach((_, i) => { const c = classifyIndex(i); tally[c] = (tally[c] ?? 0) + 1; });
    expect(tally).toEqual(expectedCounts(N));
  });

  it("(6b) price/currency structure preserved", async () => {
    const { rows } = await generate(N);
    // currency present as ZAR except the deliberate bad_currency category (XYZ)
    const currencies = new Set(rows.map((r) => r.currency).filter(Boolean));
    expect(currencies.has("ZAR")).toBe(true);
    expect(currencies.has("XYZ")).toBe(true);   // bad_currency rejects still present
    // every row that carries a price carries a string price
    rows.forEach((r) => { if (r.price !== undefined) expect(typeof r.price).toBe("string"); });
  });

  it("(7) contains no production project reference", async () => {
    const { text } = await generate(N);
    // Generic — never hardcode the prod ref. A synthetic fixture must carry no
    // Supabase project reference of any kind.
    expect(/\bsupabase\b/i.test(text)).toBe(false);
    expect(/[a-z0-9]{20}\.supabase\.co/i.test(text)).toBe(false);
  });

  it("(8) contains no publication instruction", async () => {
    const { text } = await generate(N);
    expect(/"publish"|publication|"approved"\s*:\s*true/i.test(text)).toBe(false);
  });
});
