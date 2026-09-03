import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { parseCsv } from "./csvParse.mjs";
import { mapRows, unrecognisedColumns, EXAMPLE_FEED_META } from "./exampleRetailerAdapter.mjs";
import { importFeed, observationIdentity, djb2 } from "./feedImporter.mjs";
import { FEED_CONTRACT_VERSION, PRICE_SCOPES, AVAILABILITY_SCOPES, PRICE_CONDITIONS, OUTCOMES } from "./feedContract.mjs";
import { validateCandidate, contentHash, type RawRetailCandidate } from "@/lib/retail/retailAdapter";
import { canClaimBranchAvailability } from "@/lib/retail/retailTruth";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = resolve(HERE, "../../../../docs/sprint-2k/example-retailer-authorised-feed.csv");
const csvText = readFileSync(FIXTURE, "utf8");
const { headers, rows } = parseCsv(csvText);
const records = mapRows(headers, rows, EXAMPLE_FEED_META, "example-retailer-authorised-feed.csv");
const run = importFeed(records, { branchMapping: {}, sourceFileName: "example-retailer-authorised-feed.csv", unrecognisedColumns: unrecognisedColumns(headers) });
const byRow = (n: number) => run.results.find((r: any) => r.source_row_number === n);

// Module sources for negative static scans.
// Strip comments so prose in doc-comments (e.g. "invokes the Cloud Run worker") can't
// trip a forbidden-token scan — only EXECUTABLE code is scanned.
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const MODULES = stripComments(["feedContract.mjs", "csvParse.mjs", "priceParse.mjs", "feedImporter.mjs", "exampleRetailerAdapter.mjs"]
  .map((f) => readFileSync(resolve(HERE, f), "utf8")).join("\n"));
const CLI_SRC = stripComments(readFileSync(resolve(HERE, "../../../../scripts/retail/feed-dry-run.mjs"), "utf8"));

describe("RetailerFeedContractV1 importer — 30 deterministic assertions", () => {
  it("1. contract version is stamped and consistent", () => {
    expect(FEED_CONTRACT_VERSION).toBe("1.0.0");
    expect(run.summary.contract_version).toBe("1.0.0");
    expect(run.results.filter(Boolean).every((r: any) => r.record === null || r.record.feed_contract_version === "1.0.0")).toBe(true);
  });
  it("2. fixture has at least 15 rows", () => { expect(run.results.length).toBeGreaterThanOrEqual(15); });
  it("3. leading-zero identifiers remain strings", () => {
    const r = byRow(3);
    expect(typeof r.record.source_product_id).toBe("string");
    expect(r.record.source_product_id).toBe("0012345");
  });
  it("4. blank optional values become null", () => {
    expect(byRow(1).record.original_price_cents).toBeNull();
    expect(byRow(6).record.retailer_sku).toBeNull();   // R6 SKU column blank
    expect(byRow(6).record.variant).toBeNull();        // R6 Variant column blank
    expect(byRow(3).record.barcode).toBeNull();
  });
  it("5. current prices parse exactly (decimal-safe cents; thousands ok)", () => {
    expect(byRow(1).record.current_price_cents).toBe(7999);
    expect(byRow(17).record.current_price_cents).toBe(129900); // "1 299.00"
    expect(byRow(5).record.current_price_cents).toBe(7250);
  });
  it("6. original prices stay separate from current", () => {
    expect(byRow(2).record.current_price_cents).toBe(5999);
    expect(byRow(2).record.original_price_cents).toBe(8999);
  });
  it("7. promotional conditions stay promotional (never flattened)", () => {
    expect(byRow(2).record.price_condition).toBe("promotional");
    expect(byRow(2).record.promotion_indicator).toBe(true);
    expect(byRow(16).record.price_condition).toBe("promotional");
  });
  it("8. conflicting promotion fields are detected", () => {
    expect(byRow(13).warning_codes).toContain("PROMOTION_CONFLICT");
  });
  it("9. malformed prices are quarantined", () => {
    expect(byRow(8).outcome).toBe(OUTCOMES.QUARANTINED);
    expect(byRow(8).rejection_codes).toContain("INVALID_PRICE");
  });
  it("10. invalid timestamps are quarantined", () => {
    expect(byRow(9).outcome).toBe(OUTCOMES.QUARANTINED);
    expect(byRow(9).rejection_codes).toContain("INVALID_TIMESTAMP");
  });
  it("11. missing product identity is quarantined", () => {
    expect(byRow(10).outcome).toBe(OUTCOMES.QUARANTINED);
    expect(byRow(10).rejection_codes).toContain("MISSING_PRODUCT_IDENTITY");
  });
  it("12. unknown currency is quarantined", () => {
    expect(byRow(11).rejection_codes).toContain("UNKNOWN_CURRENCY");
  });
  it("13. unknown external branch is not assigned an internal id", () => {
    const r = byRow(14);
    expect(r.record.branch_external_id).toBe("BR-UNKNOWN-99");
    expect(r.record.branch_mapping_status).toBe("unrecognised");
    expect(r.record.internal_shop_id).toBeNull();
    expect(r.warning_codes).toContain("UNKNOWN_BRANCH_MAPPING");
  });
  it("14. recognised branch mapping works ONLY when an explicit mapping is supplied", () => {
    // Without mapping → the branch_confirmed row is quarantined.
    expect(byRow(4).outcome).toBe(OUTCOMES.QUARANTINED);
    expect(byRow(4).rejection_codes).toContain("UNSUPPORTED_SCOPE");
    // With an explicit mapping fixture → the same row is accepted.
    const mapped = importFeed(records, { branchMapping: { "BR-REDS-01": { mall_external_id: "MALL-REDS", shop_external_id: "STORE-REDS" } }, unrecognisedColumns: unrecognisedColumns(headers) });
    const r4 = mapped.results.find((r: any) => r.source_row_number === 4);
    expect([OUTCOMES.ACCEPTED, OUTCOMES.ACCEPTED_WITH_WARNINGS]).toContain(r4.outcome);
    expect(r4.record.branch_mapping_status).toBe("recognised");
  });
  it("15. internal mall/shop/branch ids remain null without mapping", () => {
    for (const r of run.results) {
      if (r.record) {
        expect(r.record.internal_mall_id).toBeNull();
        expect(r.record.internal_shop_id).toBeNull();
        expect(r.record.internal_branch_id).toBeNull();
      }
    }
  });
  it("16. branch stock is never inferred from online availability", () => {
    const online = run.results.filter((r: any) => r.record && r.record.availability_scope === "online");
    expect(online.length).toBeGreaterThan(0);
    for (const r of online) {
      expect(r.record.availability_scope).not.toBe("branch_confirmed");
      expect(canClaimBranchAvailability(r.record.availability_scope)).toBe(false);
    }
  });
  it("17. duplicate rows are detected deterministically", () => {
    expect(byRow(7).outcome).toBe(OUTCOMES.DUPLICATE);
    expect(byRow(7).warning_codes).toContain("DUPLICATE_OBSERVATION");
    // deterministic: a second run yields the same distribution
    const run2 = importFeed(records, { branchMapping: {}, unrecognisedColumns: unrecognisedColumns(headers) });
    expect(run2.summary).toMatchObject({ accepted: run.summary.accepted, quarantined: run.summary.quarantined, duplicates: run.summary.duplicates });
  });
  it("18. identical replay produces the same observation identity", () => {
    const rec = byRow(1).record;
    expect(observationIdentity(rec)).toBe(observationIdentity({ ...rec }));
  });
  it("19. a changed price produces a different observation identity", () => {
    const rec = byRow(1).record;
    expect(observationIdentity({ ...rec, current_price_cents: 6999 })).not.toBe(observationIdentity(rec));
  });
  it("20. unrecognised columns are reported (feed-level)", () => {
    expect(unrecognisedColumns(headers)).toContain("InternalNotes");
    expect(run.summary.warning_counts.UNRECOGNISED_COLUMN).toBeGreaterThanOrEqual(1);
    expect(run.summary.feed_warnings.some((w: any) => w.code === "UNRECOGNISED_COLUMN")).toBe(true);
  });
  it("21. source row numbers are retained", () => {
    expect(run.results.map((r: any) => r.source_row_number)).toEqual(rows.map((r: any) => r.source_row_number));
  });
  it("22. source file provenance is retained", () => {
    for (const r of run.results) if (r.record) expect(r.record.source_file_name).toBe("example-retailer-authorised-feed.csv");
    expect(byRow(1).provenance_reference).toMatch(/example-retailer-authorised-feed\.csv#row1:/);
  });
  it("23. content hashes are deterministic", () => {
    expect(djb2("abc")).toBe(djb2("abc"));
    expect(djb2("abc")).not.toBe(djb2("abd"));
    expect(byRow(1).record.source_content_hash).toBe(mapRows(headers, rows, EXAMPLE_FEED_META, "example-retailer-authorised-feed.csv")[0].source_content_hash);
  });
  it("24. no image data is imported", () => {
    expect(/image|img_url|image_url/i.test(JSON.stringify(run.results))).toBe(false);
  });
  it("25. no long marketing description is required or carried", () => {
    // contract has no 'description' canonical field; records carry none
    for (const r of run.results) if (r.record) expect("description" in r.record).toBe(false);
  });
  it("26. no database client is referenced by the feed modules", () => {
    expect(/@supabase|supabase-js|createClient|from ['\"]pg['\"]|postgres/i.test(MODULES)).toBe(false);
  });
  it("27. no Cloud Run worker is referenced", () => {
    expect(/cloud run|K_REVISION|worker\.ts|\/internal\/intake|run\.app/i.test(MODULES)).toBe(false);
  });
  it("28. no publication function is referenced", () => {
    expect(/publish_verified_observation|publishApprovedObservation|insert into public\.products/i.test(MODULES + CLI_SRC)).toBe(false);
  });
  it("29. no network primitive is referenced by the feed modules", () => {
    expect(/\bfetch\s*\(|node:https?|require\(['\"]https?['\"]\)|XMLHttpRequest|axios/i.test(MODULES)).toBe(false);
  });
  it("30. accepted feed records reuse the truth-model validator (validateCandidate passes)", () => {
    // Reuse, not duplication: an accepted record maps to a RawRetailCandidate that the
    // real migration-036-aligned validator accepts.
    const accepted = run.results.filter((r: any) => r.record && r.outcome !== OUTCOMES.QUARANTINED);
    expect(accepted.length).toBeGreaterThan(0);
    for (const r of accepted) {
      const rec = r.record;
      const cand: RawRetailCandidate = {
        sourceProductId: rec.source_product_id, retailerSku: rec.retailer_sku, barcode: rec.barcode,
        sourceUrl: rec.canonical_source_url, productName: rec.product_name, brand: rec.brand,
        category: rec.category, variant: rec.variant, packSize: rec.pack_size,
        price: rec.current_price_cents / 100, originalPrice: rec.original_price_cents == null ? null : rec.original_price_cents / 100,
        priceScope: rec.price_scope, priceCondition: rec.price_condition, priceConditionLabel: rec.price_condition_label,
        availabilityScope: rec.availability_scope, observedAt: rec.observed_at,
      };
      expect(validateCandidate(cand)).toEqual([]);
    }
  });
  it("bonus: feed enums match the truth-model TS enums (parity, not a fork)", () => {
    // contentHash (TS) and djb2 (mjs) agree — same algorithm, reused not duplicated.
    expect(djb2("mallmind")).toBe(contentHash("mallmind"));
    // scope/condition vocabularies match migration-036-aligned retailAdapter enums.
    expect(PRICE_SCOPES).toEqual(expect.arrayContaining(["online_national", "branch_specific", "unknown"]));
    expect(AVAILABILITY_SCOPES).toContain("branch_confirmed");
    expect(PRICE_CONDITIONS).toEqual(expect.arrayContaining(["standard", "promotional", "loyalty", "bulk"]));
  });
});
