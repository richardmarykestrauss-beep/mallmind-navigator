import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
/* eslint-disable @typescript-eslint/no-explicit-any */
// @ts-expect-error ESM .mjs
import { readJsonFeed, validateFeedEnvelope } from "./jsonFeedReader.mjs";
// @ts-expect-error
import { mapKingdomFeed } from "./kingdomAdapter.mjs";
// @ts-expect-error
import { importFeed, observationIdentity } from "./feedImporter.mjs";
// @ts-expect-error
import { parseCsv } from "./csvParse.mjs";
// @ts-expect-error
import { mapRows, unrecognisedColumns } from "./exampleRetailerAdapter.mjs";
// @ts-expect-error
import { createLocationResolver, makeResolveBranch, validateMapping, RESOLUTION_CODES, MAPPING_STATUSES } from "./locationMapping.mjs";
// @ts-expect-error
import { OUTCOMES, FEED_CONTRACT_VERSION } from "./feedContract.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const D = (f: string) => resolve(HERE, "../../../../docs/sprint-2l-a/" + f);
const jsonText = readFileSync(D("example-retailer-json-feed.json"), "utf8");
const mappingsDoc = JSON.parse(readFileSync(D("example-location-mappings.json"), "utf8"));
const NOW = "2026-07-31T12:00:00Z";
const resolver = createLocationResolver(mappingsDoc.mappings, { now: NOW });
const resolveBranch = makeResolveBranch(resolver);

const read = readJsonFeed(jsonText);
const kingdomRecords = mapKingdomFeed(read.envelope, read.products, "example-retailer-json-feed.json");
const run = importFeed(kingdomRecords, { sourceFileName: "example-retailer-json-feed.json", resolveBranch });
const byRow = (n: number) => run.results.find((r: any) => r.source_row_number === n);

const MODULES = ["jsonFeedReader.mjs", "kingdomAdapter.mjs", "locationMapping.mjs", "feedImporter.mjs"]
  .map((f) => readFileSync(resolve(HERE, f), "utf8")).join("\n")
  .replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("2L-A · JSON feed reader (1-12)", () => {
  it("1. valid JSON feed parses; 11. array position retained", () => {
    expect(read.ok).toBe(true);
    expect(read.products.length).toBe(20);
    expect(read.products[0].source_row_number).toBe(1);
  });
  it("2. invalid JSON fails cleanly", () => {
    const r = readJsonFeed("{ not json ");
    expect(r.ok).toBe(false); expect(r.error).toBe("INVALID_JSON");
  });
  it("3. invalid feed shape fails", () => {
    expect(readJsonFeed("[]").ok).toBe(false);
    expect(readJsonFeed('{"nope":1}').ok).toBe(false);
  });
  it("4. feed contract version is checked", () => {
    expect(validateFeedEnvelope({ retailer_source_id: "x", feed_contract_version: "2.0" }).length).toBeGreaterThan(0);
    expect(validateFeedEnvelope({ retailer_source_id: "x", feed_contract_version: "1.0" })).toEqual([]);
  });
  it("5. leading zeros remain strings", () => {
    const r = byRow(3);
    expect(typeof r.record.source_product_id).toBe("string");
    expect(r.record.source_product_id).toBe("000123");
  });
  it("6. missing optional properties become null", () => {
    const r = byRow(13); // minimal item
    expect(r.record.brand).toBeNull();
    expect(r.record.pack_size).toBeNull();
    expect(r.record.gtin).toBeNull();
  });
  it("7. integer-cent prices exact (JSON number)", () => {
    expect(byRow(1).record.current_price_cents).toBe(34999);
    expect(byRow(2).record.original_price_cents).toBe(119999);
  });
  it("8. malformed / float-ambiguous price quarantines (12.999)", () => {
    expect(byRow(15).outcome).toBe(OUTCOMES.QUARANTINED);
    expect(byRow(15).rejection_codes).toContain("INVALID_PRICE");
  });
  it("9. invalid timestamp quarantines", () => {
    expect(byRow(16).outcome).toBe(OUTCOMES.QUARANTINED);
    expect(byRow(16).rejection_codes).toContain("INVALID_TIMESTAMP");
  });
  it("10. unknown JSON properties retained in raw_source_reference", () => {
    expect(byRow(1).record.raw_source_reference.extras).toBeTruthy();
  });
  it("12. no network request occurs (reader is pure)", () => {
    const spy = vi.fn();
    const orig = (globalThis as any).fetch;
    (globalThis as any).fetch = spy;
    readJsonFeed(jsonText); mapKingdomFeed(read.envelope, read.products);
    (globalThis as any).fetch = orig;
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("2L-A · adapter neutrality + CSV/JSON parity (13-21)", () => {
  const PARITY_META = { feed_contract_version: FEED_CONTRACT_VERSION, retailer_source_id: "parity-pilot", retailer_name: "Parity Pilot", source_type: "csv", source_reference: "parity-subset.csv", rights_review_state: "under_review", legal_status: "partner_licensed" };
  const parityResolver = createLocationResolver([{ mapping_id: "par-1", retailer_source_id: "parity-pilot", external_branch_id: "PAR-BR-1", status: "approved", internal_shop_id: "bbbb0000-0000-4000-8000-0000000000pa", internal_mall_id: "cccc0000-0000-4000-8000-000000000001", internal_retailer_id: "aaaa0000-0000-4000-8000-000000000001", source_reference: "parity-agreement", valid_from: "2026-01-01T00:00:00Z", valid_until: "2026-12-31T23:59:59Z" }], { now: NOW });
  const parityResolve = makeResolveBranch(parityResolver);
  const csv = parseCsv(readFileSync(D("parity-subset.csv"), "utf8"));
  const csvRun = importFeed(mapRows(csv.headers, csv.rows, PARITY_META, "parity-subset.csv"), { resolveBranch: parityResolve, unrecognisedColumns: unrecognisedColumns(csv.headers) });
  const pj = readJsonFeed(readFileSync(D("parity-subset.json"), "utf8"));
  const jsonRun = importFeed(mapKingdomFeed(pj.envelope, pj.products, "parity-subset.json"), { resolveBranch: parityResolve });
  const pick = (runx: any, id: string) => runx.results.find((r: any) => r.record && r.record.source_product_id === id).record;
  const FIELDS = ["source_product_id", "retailer_source_id", "product_name", "brand", "pack_size", "currency", "current_price_cents", "original_price_cents", "promotion_indicator", "price_condition", "price_scope", "availability_scope", "branch_external_id", "observed_at"];

  it("13/14. second adapter maps into the canonical contract and passes the SAME validation", () => {
    expect(kingdomRecords.length).toBe(20);
    expect(run.summary.contract_version).toBe("1.0.0"); // used importFeed, not a private pipeline
  });
  it("15/16/17/18. CSV and JSON equivalent products yield equal canonical meaning", () => {
    for (const id of ["PAR-1", "PAR-2", "PAR-3"]) {
      const c = pick(csvRun, id), j = pick(jsonRun, id);
      for (const f of FIELDS) expect({ id, f, v: j[f] }).toEqual({ id, f, v: c[f] });
    }
  });
  it("19/20/21. observation identity is deterministic, replay=dup, changed price differs", () => {
    for (const id of ["PAR-1", "PAR-2", "PAR-3"])
      expect(observationIdentity(pick(jsonRun, id))).toBe(observationIdentity(pick(csvRun, id)));
    // replay duplicate in the JSON feed (row 14 duplicates row 1)
    expect(byRow(14).outcome).toBe(OUTCOMES.DUPLICATE);
    const rec = pick(jsonRun, "PAR-1");
    expect(observationIdentity({ ...rec, current_price_cents: 111 })).not.toBe(observationIdentity(rec));
  });
});

describe("2L-A · mapping governance (22-42)", () => {
  const at = "2026-07-31T10:00:00Z";
  const R = (branch: string, rsid = "kingdom-home-tech", name?: string) => resolver.resolve({ retailer_source_id: rsid, external_branch_id: branch, external_branch_name: name, at });
  it("22. approved current mapping resolves and yields internal ids from the mapping", () => {
    const r = R("KH-APPROVED");
    expect(r.outcome).toBe(RESOLUTION_CODES.RESOLVED);
    expect(r.internal_shop_id).toBe("bbbb0000-0000-4000-8000-000000000001");
    expect(r.internal_mall_id).toBe("cccc0000-0000-4000-8000-000000000001");
  });
  it("23/24/25/26/27/28. non-usable statuses do not resolve", () => {
    expect(R("KH-DRAFT").outcome).toBe(RESOLUTION_CODES.MAPPING_UNAPPROVED);
    expect(R("KH-PENDING").outcome).toBe(RESOLUTION_CODES.MAPPING_UNAPPROVED);
    expect(R("KH-REJECTED").outcome).toBe(RESOLUTION_CODES.MAPPING_REJECTED);
    expect(R("KH-STATUS-EXPIRED").outcome).toBe(RESOLUTION_CODES.MAPPING_EXPIRED);
    expect(R("KH-DATE-EXPIRED").outcome).toBe(RESOLUTION_CODES.MAPPING_EXPIRED);
    expect(R("KH-SUPERSEDED").outcome).toBe(RESOLUTION_CODES.MAPPING_SUPERSEDED);
    expect(R("KH-FUTURE").outcome).toBe(RESOLUTION_CODES.MAPPING_NOT_YET_VALID);
  });
  it("29. retailer mismatch does not resolve", () => {
    expect(R("KH-MISMATCH").outcome).toBe(RESOLUTION_CODES.RETAILER_MISMATCH);
  });
  it("30/31. missing internal ids / provenance do not resolve", () => {
    expect(R("KH-NOIDS").outcome).toBe(RESOLUTION_CODES.INVALID_MAPPING);
    expect(R("KH-NOPROV").outcome).toBe(RESOLUTION_CODES.INVALID_MAPPING);
  });
  it("32/33/34. ambiguous and colliding do not resolve; resolver never picks the first", () => {
    expect(R("KH-COLLIDE").outcome).toBe(RESOLUTION_CODES.MAPPING_COLLISION);
    expect(resolver.resolve({ retailer_source_id: "kingdom-home-tech", external_branch_name: "Kingdom Reds", at }).outcome).toBe(RESOLUTION_CODES.AMBIGUOUS);
    // collision returns no internal id (never auto-picks a candidate)
    expect(R("KH-COLLIDE").internal_shop_id).toBeUndefined();
  });
  it("35/36. unmapped branch retains external id; internal ids null", () => {
    const r = byRow(7); // KH-UNKNOWN branch_confirmed → quarantined
    expect(r.outcome).toBe(OUTCOMES.QUARANTINED);
    // a non-branch unknown external branch keeps the id + null internal (checked via a crafted record)
    const rec = { retailer_source_id: "kingdom-home-tech", source_product_id: "X-1", branch_external_id: "KH-UNKNOWN", availability_scope: "online", observed_at: at, product_name: "x", current_price: "10", currency: "ZAR", source_row_number: 1, source_content_hash: "h" };
    const one = importFeed([rec], { resolveBranch });
    expect(one.results[0].record.branch_external_id).toBe("KH-UNKNOWN");
    expect(one.results[0].record.internal_shop_id).toBeNull();
  });
  it("37. resolved mapping uses internal ids only from the approved mapping (feed row 4)", () => {
    const r = byRow(4); // KH-APPROVED branch_confirmed
    expect(r.outcome).toBe(OUTCOMES.ACCEPTED);
    expect(r.record.internal_shop_id).toBe("bbbb0000-0000-4000-8000-000000000001");
    expect(r.record.branch_mapping_status).toBe("resolved");
  });
  it("38/39/40/41. mapping implies identity only — not stock/price/permission/publication", () => {
    const r = byRow(4).record;
    expect(r.stock_status).toBe("in_stock");        // stock came from the FEED, not the mapping
    expect(r.current_price_cents).toBe(64900);        // price from the feed
    expect(r.rights_review_state).toBe("under_review"); // permission not granted by mapping
    expect(r.review_status).toBe("not_ingested");     // never publication-eligible from import
  });
  it("42. online availability does not become branch availability after mapping (feed row 10)", () => {
    const r = byRow(10);
    expect(r.outcome).toBe(OUTCOMES.ACCEPTED);
    expect(r.record.branch_mapping_status).toBe("resolved"); // identity resolved
    expect(r.record.availability_scope).toBe("online");      // but availability stays online
  });
  it("mapping structural validation is clean for the fixture; statuses are the governed set", () => {
    for (const m of mappingsDoc.mappings) expect(validateMapping(m)).toEqual([]);
    expect(MAPPING_STATUSES).toEqual(["draft", "pending_review", "approved", "rejected", "expired", "superseded"]);
  });
});

describe("2L-A · safety + regression static scans (43-48)", () => {
  it("43. no database client referenced", () => { expect(/@supabase|supabase-js|createClient|from ['\"]pg['\"]/i.test(MODULES)).toBe(false); });
  it("44. no publication function referenced", () => { expect(/publish_verified_observation|publishApprovedObservation/i.test(MODULES)).toBe(false); });
  it("45/46. no worker / Cloud Run referenced", () => { expect(/runDurableJob|K_REVISION|\/internal\/intake|run\.app/i.test(MODULES)).toBe(false); });
  it("47. no network primitive referenced; runtime fetch not called", () => {
    expect(/\bfetch\s*\(|node:https?|XMLHttpRequest|axios/i.test(MODULES)).toBe(false);
    const spy = vi.fn(); const orig = (globalThis as any).fetch; (globalThis as any).fetch = spy;
    importFeed(kingdomRecords, { resolveBranch }); (globalThis as any).fetch = orig;
    expect(spy).not.toHaveBeenCalled();
  });
  it("48. summary proves no publication/db/network activity", () => {
    expect(run.summary.publication_occurred).toBe(false);
    expect(run.summary.database_write_occurred).toBe(false);
    expect(run.summary.network_call_occurred).toBe(false);
  });
});
