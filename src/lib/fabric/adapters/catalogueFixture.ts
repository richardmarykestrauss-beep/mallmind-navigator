/**
 * CatalogueFixtureAdapter — parses a deterministic catalogue fixture.
 *
 * Represents extracted catalogue blocks (title, price, original price, validity
 * dates, page number, bounding-box metadata). NO OCR and NO API call are made —
 * the blocks are local fixture data. Always requires review.
 */

import type {
  SourceAdapter, SourceCandidate, CaptureResult, ExtractionCandidate, ExtractedField, ValidationResult,
} from "../types";
import { contentHash } from "../hash";
import { CATALOGUE_FIXTURE, type CatalogueBlock } from "../fixtures/catalogue";

export class CatalogueFixtureAdapter implements SourceAdapter {
  readonly adapterId = "catalogue_fixture";
  readonly mode = "catalogue" as const;
  readonly version = "1.0.0";
  constructor(public sourceId: string, private fixture = CATALOGUE_FIXTURE) {}

  private find(id: string): CatalogueBlock | undefined {
    return this.fixture.blocks.find((b) => b.blockId === id);
  }

  async discover(): Promise<SourceCandidate[]> {
    return this.fixture.blocks.map((b) => ({
      id: b.blockId, sourceId: this.sourceId, url: this.fixture.sourceUrl, title: b.productTitle,
      discoveredAt: "", discoveryMethod: "catalogue",
      metadata: { catalogueId: this.fixture.catalogueId, page: b.pageNumber, owner: this.fixture.owner },
    }));
  }

  async capture(candidate: SourceCandidate): Promise<CaptureResult> {
    const block = this.find(candidate.id);
    return {
      snapshotId: `snap_${candidate.id}`, sourceId: this.sourceId, capturedAt: "",
      contentType: "pdf", contentHash: contentHash(block?.rawText ?? ""),
      documentRef: `fixture://catalogue/${this.fixture.catalogueId}#p${block?.pageNumber ?? 0}`,
      metadata: { block, page: block?.pageNumber, boundingBox: block?.boundingBox, owner: this.fixture.owner, sourceUrl: this.fixture.sourceUrl },
    };
  }

  async extract(snapshot: CaptureResult): Promise<ExtractionCandidate[]> {
    const block = snapshot.metadata?.block as CatalogueBlock | undefined;
    if (!block) return [];
    const ev = { evidenceText: block.rawText, evidenceRef: snapshot.documentRef };
    const fields: ExtractedField[] = [
      { field: "productTitle", value: block.productTitle, confidence: 0.85, ...ev },
      { field: "brand", value: block.brand, confidence: 0.85, ...ev },
      { field: "price", value: block.price, confidence: 0.9, ...ev },
      { field: "originalPrice", value: block.originalPrice, confidence: block.originalPrice != null ? 0.8 : 0, ...ev },
      { field: "currency", value: block.currency, confidence: 0.9, ...ev },
      { field: "validFrom", value: block.validFrom, confidence: 0.85, ...ev },
      { field: "validTo", value: block.validTo, confidence: 0.85, ...ev },
      { field: "pageNumber", value: block.pageNumber, confidence: 1, ...ev },
    ];
    return [{ id: `ext_${snapshot.snapshotId}`, snapshotId: snapshot.snapshotId, candidateType: "catalogue", fields, extractorId: "catalogue_blocks", extractorVersion: this.version }];
  }

  async validate(candidate: ExtractionCandidate): Promise<ValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = ["Catalogue extraction requires human review before publishing."];
    const get = (name: string) => candidate.fields.find((x) => x.field === name)?.value;
    const price = get("price");
    if (price == null || !(Number(price) > 0)) errors.push("Catalogue block is missing a valid price.");
    if (!get("validTo")) warnings.push("No validity end date — cannot mark catalogue_special reliably.");
    return { valid: errors.length === 0, errors, warnings };
  }
}
