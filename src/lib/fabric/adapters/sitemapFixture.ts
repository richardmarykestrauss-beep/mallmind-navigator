/**
 * SitemapFixtureAdapter — parses a local XML sitemap fixture.
 *
 * Emits candidate product/category URLs. Performs NO live request; the XML is a
 * local fixture. Extraction produces URL candidates only (no prices).
 */

import type {
  SourceAdapter, SourceCandidate, CaptureResult, ExtractionCandidate, ExtractedField, ValidationResult,
} from "../types";
import { contentHash } from "../hash";
import { SITEMAP_FIXTURE } from "../fixtures/sitemap";

/** Minimal, dependency-free <loc> extraction (no XML lib, no network). */
function parseLocs(xml: string): string[] {
  const out: string[] = [];
  const re = /<loc>\s*([^<\s][^<]*?)\s*<\/loc>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) out.push(m[1].trim());
  return out;
}

export class SitemapFixtureAdapter implements SourceAdapter {
  readonly adapterId = "sitemap_fixture";
  readonly mode = "sitemap" as const;
  readonly version = "1.0.0";
  constructor(public sourceId: string, private fixture = SITEMAP_FIXTURE) {}

  async discover(): Promise<SourceCandidate[]> {
    return [{
      id: `cand_sitemap_${this.sourceId}`, sourceId: this.sourceId, url: this.fixture.sourceUrl, title: "Product sitemap",
      discoveredAt: "", discoveryMethod: "sitemap", metadata: { fixture: "sitemap" },
    }];
  }

  async capture(candidate: SourceCandidate): Promise<CaptureResult> {
    return {
      snapshotId: `snap_${candidate.id}`, sourceId: this.sourceId, capturedAt: "",
      contentType: "xml", contentHash: contentHash(this.fixture.xml), rawContentRef: `fixture://sitemap/${this.sourceId}`,
      metadata: { xml: this.fixture.xml },
    };
  }

  async extract(snapshot: CaptureResult): Promise<ExtractionCandidate[]> {
    const xml = (snapshot.metadata?.xml ?? "") as string;
    const locs = parseLocs(xml);
    return locs.map((loc, i) => {
      const isCategory = /\/category\//.test(loc);
      const fields: ExtractedField[] = [
        { field: "url", value: loc, confidence: 1, evidenceRef: snapshot.rawContentRef },
        { field: "kind", value: isCategory ? "category" : "product", confidence: 0.7 },
      ];
      return { id: `ext_${snapshot.snapshotId}_${i}`, snapshotId: snapshot.snapshotId, candidateType: isCategory ? "catalogue" : "product", fields, extractorId: "sitemap_locs", extractorVersion: this.version };
    });
  }

  async validate(candidate: ExtractionCandidate): Promise<ValidationResult> {
    const url = candidate.fields.find((x) => x.field === "url")?.value as string | undefined;
    const errors = url && /^https?:\/\//.test(url) ? [] : ["Sitemap candidate is missing a valid http(s) URL."];
    return { valid: errors.length === 0, errors, warnings: ["Sitemap only yields URLs — capture + extraction of each page still requires review."] };
  }
}
