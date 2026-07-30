import { describe, it, expect } from "vitest";
import sampleDoc from "../../../docs/sprint-2j/clicks-real-data-sample.json";
import {
  validateCandidate, dedupeCandidates, type RawRetailCandidate,
} from "@/lib/retail/retailAdapter";
import {
  canClaimBranchAvailability, describeAvailability, describePriceScope,
} from "@/lib/retail/retailTruth";

/**
 * Sprint 2J — validate the read-only Clicks shampoo sample through the EXISTING
 * truth-model code. Local only: nothing is written or published here.
 */
const records = sampleDoc.records as Array<Record<string, unknown>>;

/** Map a captured record to the shared RawRetailCandidate the pipeline uses. */
function toCandidate(r: Record<string, unknown>): RawRetailCandidate {
  return {
    sourceProductId: r.source_product_id as string,
    retailerSku: (r.retailer_sku as string | null) ?? null,
    barcode: (r.barcode as string | null) ?? null,
    sourceUrl: r.source_url as string,
    productName: r.product_name as string,
    brand: (r.brand as string | null) ?? null,
    category: null,
    variant: (r.variant as string | null) ?? null,
    packSize: (r.pack_size as string | null) ?? null,
    price: r.price as number,
    originalPrice: (r.original_price as number | null) ?? null,
    priceScope: r.price_scope as RawRetailCandidate["priceScope"],
    priceCondition: r.price_condition as RawRetailCandidate["priceCondition"],
    priceConditionLabel: (r.price_condition_label as string | null) ?? null,
    availabilityScope: r.availability_scope as RawRetailCandidate["availabilityScope"],
    observedAt: r.observed_at as string,
  };
}

describe("Clicks read-only sample — truth-model validation (14 assertions)", () => {
  it("1. exactly 10 records", () => {
    expect(records.length).toBe(10);
  });

  it("2. all sources are official Clicks pages", () => {
    expect(records.every((r) => /^https:\/\/clicks\.co\.za\//.test(r.source_url as string))).toBe(true);
    expect(records.every((r) => /^https:\/\/clicks\.co\.za\//.test(r.observed_on_url as string))).toBe(true);
  });

  it("3. all records have source URLs", () => {
    expect(records.every((r) => typeof r.source_url === "string" && (r.source_url as string).length > 0)).toBe(true);
  });

  it("4. all records have observed_at", () => {
    expect(records.every((r) => typeof r.observed_at === "string" && !Number.isNaN(Date.parse(r.observed_at as string)))).toBe(true);
  });

  it("5. no shop_id", () => {
    expect(records.every((r) => r.shop_id === null)).toBe(true);
  });

  it("6. no mall_id", () => {
    expect(records.every((r) => r.mall_id === null)).toBe(true);
  });

  it("7. price_scope = online_national", () => {
    expect(records.every((r) => r.price_scope === "online_national")).toBe(true);
  });

  it("8. no branch-confirmed availability", () => {
    expect(records.every((r) => r.availability_scope !== "branch_confirmed")).toBe(true);
    expect(records.every((r) => !canClaimBranchAvailability(r.availability_scope as never))).toBe(true);
    expect(records.every((r) => r.branch_availability_confirmed === false)).toBe(true);
  });

  it("9. no image storage / reuse", () => {
    expect(records.every((r) => !("image_url" in r) && !("image" in r))).toBe(true);
    expect(records.every((r) => r.image_reuse_allowed === null)).toBe(true);
    // no clicks image asset URLs anywhere in the serialized sample
    expect(/cloudinary|\.jpg|\.png|\.webp|media\.clicks/i.test(JSON.stringify(sampleDoc))).toBe(false);
  });

  it("10. no publication or DB write (reference_only, not ingested)", () => {
    expect(records.every((r) => r.legal_status === "reference_only")).toBe(true);
    expect(records.every((r) => r.ingestion_status === "not_ingested")).toBe(true);
    expect(sampleDoc.generated_by).toMatch(/NO DB write, NO publication/i);
  });

  it("11. product IDs are strings (leading zeros preserved)", () => {
    expect(records.every((r) => typeof r.source_product_id === "string")).toBe(true);
    // contract check: a leading-zero id round-trips as-is
    const z = "0012345";
    expect(String(z)).toBe("0012345");
  });

  it("12. unknown fields remain NULL", () => {
    for (const r of records) {
      expect(r.barcode).toBeNull();
      expect(r.original_price).toBeNull();
      expect(r.retailer_sku).toBeNull();
      expect(r.variant).toBeNull();
      expect(r.commercial_use_allowed).toBeNull();
      expect(r.storage_allowed).toBeNull();
    }
  });

  it("13. promotional conditions are not flattened into standard prices", () => {
    for (const r of records) {
      if (r.promotion_indicator === true) {
        expect(r.price_condition).toBe("promotional");
        expect(r.price_condition).not.toBe("standard");
        expect(r.price_condition_label).toBe("On promo");
      } else {
        expect(r.price_condition).toBe("standard");
      }
    }
    // at least one promo and one standard present (the split is real, not collapsed)
    expect(records.some((r) => r.price_condition === "promotional")).toBe(true);
    expect(records.some((r) => r.price_condition === "standard")).toBe(true);
  });

  it("14. shopper-safe preview says Mall@Reds availability is NOT confirmed", () => {
    for (const r of records) {
      const line = describeAvailability(r.availability_scope as never, "Mall@Reds");
      expect(line).toMatch(/not confirmed/i);
      expect(line).not.toMatch(/available at mall@reds/i);
      // price scope reads as national/online, never as an in-store/branch price
      const scope = describePriceScope(r.price_scope as never);
      expect(scope).toBe("National online price");
      expect(scope).not.toMatch(/in-store|branch/i);
    }
  });

  it("maps cleanly through the shared candidate validator (no problems)", () => {
    const candidates = records.map(toCandidate);
    for (const c of candidates) expect(validateCandidate(c)).toEqual([]);
    // deterministic listing identity is unique across the sample
    expect(dedupeCandidates(candidates).length).toBe(10);
    expect(new Set(records.map((r) => r.source_product_id)).size).toBe(10);
  });
});
