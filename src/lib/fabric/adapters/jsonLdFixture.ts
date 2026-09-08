/**
 * JsonLdFixtureAdapter — parses local Schema.org Product/Offer JSON-LD fixtures.
 *
 * NO network request. Reads deterministic fixtures, extracts title/brand/sku/
 * model/price/currency/availability, preserves the raw JSON-LD as evidence, and
 * always requires review.
 */

import type {
  SourceAdapter, SourceCandidate, CaptureResult, ExtractionCandidate, ExtractedField, ValidationResult,
} from "../types";
import { contentHash } from "../hash";
import { JSONLD_FIXTURES, type JsonLdFixture } from "../fixtures/jsonld";

function availabilityLabel(schemaUrl: string | undefined): string {
  if (!schemaUrl) return "unknown";
  if (schemaUrl.includes("InStock")) return "known_available";
  if (schemaUrl.includes("LimitedAvailability")) return "inferred";
  if (schemaUrl.includes("OutOfStock") || schemaUrl.includes("SoldOut")) return "unavailable";
  return "unknown";
}

export class JsonLdFixtureAdapter implements SourceAdapter {
  readonly adapterId = "jsonld_fixture";
  readonly mode = "json_ld" as const;
  readonly version = "1.0.0";
  constructor(public sourceId: string, private fixtures: JsonLdFixture[] = JSONLD_FIXTURES) {}

  private find(id: string): JsonLdFixture | undefined {
    return this.fixtures.find((f) => f.candidateId === id);
  }

  async discover(): Promise<SourceCandidate[]> {
    return this.fixtures.map((f) => ({
      id: f.candidateId, sourceId: this.sourceId, url: f.sourceUrl, title: f.title,
      discoveredAt: "", discoveryMethod: "json_ld", metadata: { fixture: "jsonld" },
    }));
  }

  async capture(candidate: SourceCandidate): Promise<CaptureResult> {
    const fx = this.find(candidate.id);
    const raw = fx?.jsonLd ?? "";
    return {
      snapshotId: `snap_${candidate.id}`, sourceId: this.sourceId, capturedAt: "",
      contentType: "json", contentHash: contentHash(raw), rawContentRef: `fixture://jsonld/${candidate.id}`,
      metadata: { candidateId: candidate.id, sourceUrl: fx?.sourceUrl, raw },
    };
  }

  async extract(snapshot: CaptureResult): Promise<ExtractionCandidate[]> {
    const raw = (snapshot.metadata?.raw ?? "") as string;
    let doc: Record<string, unknown> = {};
    try { doc = JSON.parse(raw); } catch { doc = {}; }
    const brand = doc.brand as { name?: string } | string | undefined;
    const offers = (doc.offers ?? {}) as Record<string, unknown>;
    const excerpt = raw.slice(0, 240);
    const fields: ExtractedField[] = [];
    const push = (field: string, value: unknown, confidence: number) => {
      if (value !== undefined && value !== null && value !== "") fields.push({ field, value, confidence, evidenceRef: snapshot.rawContentRef, evidenceText: excerpt });
    };
    push("productTitle", doc.name, 0.9);
    push("brand", typeof brand === "string" ? brand : brand?.name, 0.9);
    push("model", doc.mpn ?? doc.sku, 0.85);
    push("sku", doc.sku, 0.85);
    push("gtin", doc.gtin13 ?? doc.gtin, 0.95);
    push("category", doc.category, 0.7);
    push("price", offers.price != null ? Number(offers.price) : undefined, 0.85);
    push("currency", offers.priceCurrency, 0.9);
    push("availability", availabilityLabel(offers.availability as string | undefined), 0.6);
    return [{ id: `ext_${snapshot.snapshotId}`, snapshotId: snapshot.snapshotId, candidateType: "offer", fields, extractorId: "schema_org_jsonld", extractorVersion: this.version }];
  }

  async validate(candidate: ExtractionCandidate): Promise<ValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = ["JSON-LD extraction requires human review before publishing."];
    const get = (name: string) => candidate.fields.find((x) => x.field === name)?.value;
    if (!get("productTitle")) errors.push("Missing product name in JSON-LD.");
    const price = get("price");
    if (price == null) errors.push("Missing offer price in JSON-LD.");
    else if (!(Number(price) > 0)) errors.push("Offer price is not positive.");
    if (!get("currency")) warnings.push("No priceCurrency — defaulting to ZAR downstream.");
    return { valid: errors.length === 0, errors, warnings };
  }
}
