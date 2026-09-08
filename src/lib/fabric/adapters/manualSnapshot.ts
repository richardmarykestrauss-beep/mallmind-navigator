/**
 * ManualSnapshotAdapter — human-supplied capture.
 *
 * Accepts a manually supplied URL/text/metadata payload, creates a capture +
 * evidence, and extracts only the values the admin supplied. It performs NO
 * network request and ALWAYS requires human review.
 */

import type {
  SourceAdapter, SourceCandidate, CaptureResult, ExtractionCandidate, ExtractedField, ValidationResult,
} from "../types";
import { contentHash } from "../hash";

export interface ManualPayload {
  url?: string;
  title?: string;
  contentText: string;
  fields: {
    productTitle: string;
    brand?: string;
    price?: number;
    currency?: string;
    availability?: string;
    model?: string;
  };
  metadata?: Record<string, unknown>;
}

export class ManualSnapshotAdapter implements SourceAdapter {
  readonly adapterId = "manual_snapshot";
  readonly mode = "manual" as const;
  readonly version = "1.0.0";
  constructor(public sourceId: string) {}

  async discover(input?: unknown): Promise<SourceCandidate[]> {
    const payload = input as ManualPayload | undefined;
    if (!payload) return [];
    return [{
      id: `cand_manual_${this.sourceId}`,
      sourceId: this.sourceId,
      url: payload.url,
      title: payload.title ?? payload.fields.productTitle,
      discoveredAt: "",
      discoveryMethod: "manual",
      metadata: { payload },
    }];
  }

  async capture(candidate: SourceCandidate): Promise<CaptureResult> {
    const payload = (candidate.metadata?.payload ?? {}) as ManualPayload;
    return {
      snapshotId: `snap_${candidate.id}`,
      sourceId: this.sourceId,
      capturedAt: "",
      contentType: "manual",
      contentHash: contentHash(payload.contentText ?? ""),
      rawContentRef: `fixture://manual/${candidate.id}`,
      metadata: { payload },
    };
  }

  async extract(snapshot: CaptureResult): Promise<ExtractionCandidate[]> {
    const payload = (snapshot.metadata?.payload ?? {}) as ManualPayload;
    const f = payload.fields ?? { productTitle: "" };
    const fields: ExtractedField[] = [];
    const push = (field: string, value: unknown, confidence: number) => {
      if (value !== undefined && value !== null && value !== "") fields.push({ field, value, confidence, evidenceText: payload.contentText?.slice(0, 200) });
    };
    // Manual entries are admin-asserted → high identity/price confidence, but still reviewed.
    push("productTitle", f.productTitle, 0.9);
    push("brand", f.brand, 0.85);
    push("model", f.model, 0.85);
    push("price", f.price, 0.9);
    push("currency", f.currency ?? "ZAR", 0.9);
    push("availability", f.availability, 0.5);
    return [{
      id: `ext_${snapshot.snapshotId}`,
      snapshotId: snapshot.snapshotId,
      candidateType: "offer",
      fields,
      extractorId: "manual_fields",
      extractorVersion: this.version,
    }];
  }

  async validate(candidate: ExtractionCandidate): Promise<ValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = ["Manual snapshot always requires human review before publishing."];
    const has = (name: string) => candidate.fields.some((x) => x.field === name && x.value !== "" && x.value != null);
    if (!has("productTitle")) errors.push("productTitle is required.");
    const price = candidate.fields.find((x) => x.field === "price")?.value;
    if (price != null && !(Number(price) > 0)) errors.push("price must be positive.");
    if (!has("availability")) warnings.push("No availability supplied — will be treated as unknown.");
    return { valid: errors.length === 0, errors, warnings };
  }
}
