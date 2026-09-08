/**
 * Evidence Vault — typed provenance model + helpers.
 *
 * Evidence is immutable in MEANING: corrections create a NEW revision that points
 * back at the original via `revisionOf`, and the original is marked
 * `supersededBy` rather than overwritten. Large binaries are never stored inline —
 * only typed references/placeholders compatible with future Cloud Storage.
 */

import type {
  AdapterLifecycleState, ConfidenceDimensions, ContentType, EvidenceRecord,
  ProvenanceEntityType, ProvenanceLink, TrustSuggestion, AdapterMode,
} from "./types";

let seq = 0;
function id(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return `${prefix}_${crypto.randomUUID()}`;
  seq += 1;
  return `${prefix}_seq${seq}`;
}

// ── Confidence dimensions (section 6) ────────────────────────────────────────

export const ZERO_CONFIDENCE: ConfidenceDimensions = {
  identityConfidence: 0, priceConfidence: 0, availabilityConfidence: 0,
  locationConfidence: 0, freshnessConfidence: 0, sourceAuthority: 0,
};

export function makeConfidence(partial: Partial<ConfidenceDimensions>): ConfidenceDimensions {
  return { ...ZERO_CONFIDENCE, ...partial };
}

const DIMS: (keyof ConfidenceDimensions)[] = [
  "identityConfidence", "priceConfidence", "availabilityConfidence", "locationConfidence", "freshnessConfidence", "sourceAuthority",
];

/** Every dimension must be a finite number in [0,1]. */
export function isValidConfidence(c: ConfidenceDimensions): boolean {
  return DIMS.every((d) => Number.isFinite(c[d]) && c[d] >= 0 && c[d] <= 1);
}

// ── Suggested trust label (section 6) — advisory only, never auto-applied ─────

export interface TrustSuggestionInput {
  mode: AdapterMode;
  hasConflict: boolean;
  ageHours: number | null;
  hasValidityDates: boolean;
  branchAvailabilityConfirmed: boolean;
  confidence: ConfidenceDimensions;
}

/**
 * Recommend a user-facing trust label from evidence. This NEVER auto-publishes or
 * mutates an offer — it is a hint for the human reviewer. Trust labels remain the
 * existing user-facing system; confidence dimensions only support adjudication.
 */
export function suggestTrustLabel(input: TrustSuggestionInput): TrustSuggestion {
  const { mode, hasConflict, ageHours, hasValidityDates, branchAvailabilityConfirmed, confidence } = input;
  const recent = ageHours != null && ageHours <= 24;

  if (hasConflict) {
    return { suggested: "conflict_detected", rationale: "Conflicting evidence exists for this product/source category — must be reviewed, never presented as verified.", confidence };
  }
  if ((mode === "partner_api" || mode === "merchant_feed") && recent && branchAvailabilityConfirmed) {
    return { suggested: "verified_live", rationale: "Authorized feed/API, recently observed, with confirmed branch availability.", confidence };
  }
  if (mode === "partner_api" || mode === "merchant_feed") {
    return { suggested: "partner_feed", rationale: "Supplied by an authorized partner feed/API (not independently branch-verified).", confidence };
  }
  if (mode === "catalogue" && hasValidityDates) {
    return { suggested: "catalogue_special", rationale: "Official catalogue with explicit validity dates.", confidence };
  }
  if (mode === "manual") {
    return { suggested: "manual_admin", rationale: "Manually captured by an admin from a cited source.", confidence };
  }
  if ((mode === "json_ld" || mode === "browser_observation" || mode === "sitemap") && recent) {
    return { suggested: "recently_observed", rationale: "Observed from a public product page recently.", confidence };
  }
  return { suggested: "recently_observed", rationale: "Public observation; treat as recently observed pending review.", confidence };
}

// ── Evidence records (section 4) ─────────────────────────────────────────────

export interface EvidenceInput {
  sourceId: string;
  sourceUrl?: string | null;
  sourceOwner?: string | null;
  adapterId: string;
  adapterVersion: string;
  lifecycleState?: AdapterLifecycleState;
  capturedAt: string;
  observedAt?: string | null;
  contentType: ContentType;
  contentHash: string;
  rawContentRef?: string | null;
  screenshotRef?: string | null;
  documentRef?: string | null;
  pageNumber?: number | null;
  boundingBox?: EvidenceRecord["boundingBox"];
  extractedText?: string | null;
  structuredData?: Record<string, unknown> | null;
  extractorId?: string | null;
  extractorVersion?: string | null;
  fieldConfidence?: ConfidenceDimensions | null;
  reviewerNotes?: string | null;
}

export function createEvidence(input: EvidenceInput, nowIso: string): EvidenceRecord {
  return {
    id: id("ev"),
    sourceId: input.sourceId,
    sourceUrl: input.sourceUrl ?? null,
    sourceOwner: input.sourceOwner ?? null,
    adapterId: input.adapterId,
    adapterVersion: input.adapterVersion,
    lifecycleState: input.lifecycleState ?? "captured",
    capturedAt: input.capturedAt,
    observedAt: input.observedAt ?? null,
    contentType: input.contentType,
    contentHash: input.contentHash,
    rawContentRef: input.rawContentRef ?? null,
    screenshotRef: input.screenshotRef ?? null,
    documentRef: input.documentRef ?? null,
    pageNumber: input.pageNumber ?? null,
    boundingBox: input.boundingBox ?? null,
    extractedText: input.extractedText ?? null,
    structuredData: input.structuredData ?? null,
    extractorId: input.extractorId ?? null,
    extractorVersion: input.extractorVersion ?? null,
    fieldConfidence: input.fieldConfidence ?? null,
    reviewerStatus: "unreviewed",
    reviewerNotes: input.reviewerNotes ?? null,
    revision: 1,
    revisionOf: null,
    supersededBy: null,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}

/**
 * Create a corrected REVISION of an existing evidence record. Returns both the
 * new revision and a copy of the original marked `supersededBy` — the original's
 * meaning is preserved, never overwritten. The store persists both.
 */
export function reviseEvidence(
  original: EvidenceRecord,
  changes: Partial<Omit<EvidenceRecord, "id" | "revision" | "revisionOf" | "supersededBy" | "createdAt">>,
  nowIso: string,
): { revised: EvidenceRecord; supersededOriginal: EvidenceRecord } {
  const revised: EvidenceRecord = {
    ...original,
    ...changes,
    id: id("ev"),
    revision: original.revision + 1,
    revisionOf: original.id,
    supersededBy: null,
    reviewerStatus: changes.reviewerStatus ?? "unreviewed",
    createdAt: nowIso,
    updatedAt: nowIso,
  };
  const supersededOriginal: EvidenceRecord = { ...original, supersededBy: revised.id, reviewerStatus: "superseded", updatedAt: nowIso };
  return { revised, supersededOriginal };
}

// ── Provenance links (section 5) ─────────────────────────────────────────────

export function linkProvenance(entityType: ProvenanceEntityType, entityId: string, evidenceId: string, relation: string, nowIso: string): ProvenanceLink {
  return { id: id("prov"), entityType, entityId, evidenceId, relation, createdAt: nowIso };
}

/** All evidence ids linked to a given entity. */
export function evidenceForEntity(links: ProvenanceLink[], entityType: ProvenanceEntityType, entityId: string): string[] {
  return links.filter((l) => l.entityType === entityType && l.entityId === entityId).map((l) => l.evidenceId);
}
