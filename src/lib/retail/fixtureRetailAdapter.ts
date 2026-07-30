/**
 * fixtureRetailAdapter.ts — Sprint 2I
 *
 * A REALISTIC fixture adapter implementing the two-method RetailAdapter contract.
 * It proves the schema + pipeline can carry the ten hard cases live retail data
 * throws at us — WITHOUT any real source, network, or rights decision. A fixture
 * proves the code/contract; it is NOT a substitute for a real permissioned sample
 * (that is the first live adapter, swapped in behind an approved source).
 */

import {
  type RetailAdapter, type AcquisitionInput, type SnapshotReference,
  type RawRetailCandidate, contentHash,
} from "./retailAdapter";

const OBSERVED_AT = "2026-07-29T00:00:00.000Z";
const VALID_TO = "2026-09-01T00:00:00.000Z";

/** The ten hard cases, as raw candidates. */
export const FIXTURE_CANDIDATES: RawRetailCandidate[] = [
  // 1. standard price
  { sourceProductId: "SP-100", productName: "Sunlight Dishwashing Liquid 750ml", category: "Household",
    price: 34.99, priceScope: "online_national", availabilityScope: "online", priceCondition: "standard",
    barcode: "6001087001234", observedAt: OBSERVED_AT, validTo: VALID_TO },
  // 2. loyalty price
  { sourceProductId: "SP-101", productName: "Panado Tablets 24s", category: "Health",
    price: 19.99, priceScope: "online_national", availabilityScope: "online", priceCondition: "loyalty",
    loyaltyProgram: "ClubCard", priceConditionLabel: "ClubCard price", barcode: "6009510800017",
    observedAt: OBSERVED_AT, validTo: VALID_TO },
  // 3. promotional price
  { sourceProductId: "SP-102", productName: "Coca-Cola 2L", category: "Beverages",
    price: 24.99, originalPrice: 32.99, priceScope: "online_national", availabilityScope: "online",
    priceCondition: "promotional", promotionText: "Save R8", barcode: "5449000000996",
    observedAt: OBSERVED_AT, validTo: VALID_TO },
  // 4. bulk offer
  { sourceProductId: "SP-103", productName: "Lucky Star Pilchards 400g", category: "Groceries",
    price: 100, priceScope: "online_national", availabilityScope: "online", priceCondition: "bulk",
    minimumQuantity: 3, priceConditionLabel: "Buy 3 for R100", barcode: "6001275000019",
    observedAt: OBSERVED_AT, validTo: VALID_TO },
  // 5. online-only price
  { sourceProductId: "SP-104", productName: "Hisense 43\" FHD LED TV", category: "Electronics",
    price: 4999, priceScope: "online_national", availabilityScope: "online", priceCondition: "online_only",
    barcode: "6942223500010", observedAt: OBSERVED_AT, validTo: VALID_TO },
  // 6. unknown stock (availability not observed)
  { sourceProductId: "SP-105", productName: "Nescafe Classic 200g", category: "Beverages",
    price: 89.99, priceScope: "catalogue_national", availabilityScope: "unknown", priceCondition: "standard",
    barcode: "7613036000018", observedAt: OBSERVED_AT, validTo: VALID_TO },
  // 7. click-and-collect availability
  { sourceProductId: "SP-106", productName: "Bostik Prestik 100g", category: "Stationery",
    price: 29.99, priceScope: "online_national", availabilityScope: "click_collect", priceCondition: "standard",
    barcode: "6009690600011", observedAt: OBSERVED_AT, validTo: VALID_TO },
  // 8. branch-confirmed availability (identity resolved downstream by the pipeline)
  { sourceProductId: "SP-107", productName: "Albany Superior White Bread 700g", category: "Bakery",
    price: 18.99, priceScope: "branch_specific", availabilityScope: "branch_confirmed", priceCondition: "standard",
    barcode: "6001056431019", observedAt: OBSERVED_AT, validTo: VALID_TO },
  // 9. expired promotion (validTo already past — freshness must reject downstream)
  { sourceProductId: "SP-108", productName: "Ariel Washing Powder 2kg", category: "Household",
    price: 79.99, originalPrice: 99.99, priceScope: "online_national", availabilityScope: "online",
    priceCondition: "promotional", promotionText: "Was R99.99", barcode: "8001090000019",
    observedAt: "2026-06-01T00:00:00.000Z", validTo: "2026-06-15T00:00:00.000Z" },
  // 10. ambiguous product match (no stable id, unknown category → NULL, not invented)
  { productName: "Generic 2L Cola", category: null, price: 15.99, priceScope: "unknown",
    availabilityScope: "unknown", priceCondition: "unknown", observedAt: OBSERVED_AT, validTo: VALID_TO },
  // (bonus) a REFRESH of case 1 — same sourceProductId, newer price → must dedupe to one listing
  { sourceProductId: "SP-100", productName: "Sunlight Dishwashing Liquid 750ml", category: "Household",
    price: 32.99, priceScope: "online_national", availabilityScope: "online", priceCondition: "standard",
    barcode: "6001087001234", observedAt: "2026-07-30T00:00:00.000Z", validTo: VALID_TO },
];

export class FixtureRetailAdapter implements RetailAdapter {
  readonly adapterName = "fixture";
  readonly adapterVersion = "1.0.0";
  private readonly blobs = new Map<string, string>();

  constructor(readonly sourceId: string) {}

  async acquire(input: AcquisitionInput): Promise<SnapshotReference> {
    if (input.sourceId !== this.sourceId) {
      throw new Error("fixture adapter: sourceId mismatch");
    }
    const payload = JSON.stringify(FIXTURE_CANDIDATES);
    const hash = contentHash(payload);
    this.blobs.set(hash, payload);
    return {
      sourceId: this.sourceId,
      capturedAt: OBSERVED_AT,
      contentHash: hash,
      mediaType: "application/json",
      byteSize: payload.length,
      sourceUrl: null,
    };
  }

  async parse(snapshot: SnapshotReference): Promise<RawRetailCandidate[]> {
    const payload = this.blobs.get(snapshot.contentHash);
    if (!payload) throw new Error("fixture adapter: unknown snapshot");
    return JSON.parse(payload) as RawRetailCandidate[];
  }
}
