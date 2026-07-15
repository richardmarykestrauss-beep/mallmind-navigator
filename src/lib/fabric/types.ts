/**
 * MallMind Retail Intelligence Fabric — Sprint 1 typed contract.
 *
 * The common Source Adapter SDK + Evidence Vault that sits ON TOP of the existing
 * ingestion primitives (Source, SourceSnapshot, ProductOffer, trust labels,
 * conflict/stale detection). It does NOT replace them.
 *
 * PROTOTYPE — LOCAL PERSISTED DATA. No live web extraction, no network requests,
 * no external services. Adapters run against deterministic local fixtures only.
 *
 * DOCTRINE: no source adapter may publish offers directly. Every capture produces
 * evidence; publishing only ever happens through the existing human review queue.
 */

import type { PriceTrustLabel } from "@/lib/ingestion/model";

// ── Adapter modes + lifecycle ────────────────────────────────────────────────

/** How a source is accessed. Distinct from the offer-level `SourceType`. */
export type AdapterMode =
  | "partner_api"
  | "merchant_feed"
  | "json_ld"
  | "sitemap"
  | "catalogue"
  | "newsletter"
  | "browser_observation"
  | "manual";

export const ADAPTER_MODES: AdapterMode[] = [
  "partner_api", "merchant_feed", "json_ld", "sitemap", "catalogue", "newsletter", "browser_observation", "manual",
];

/** The required evidence lifecycle. Ordered; transitions are enforced. */
export type AdapterLifecycleState =
  | "discovered"
  | "captured"
  | "extracted"
  | "normalized"
  | "validated"
  | "conflict_checked"
  | "reviewed"
  | "approved"
  | "published"
  | "stale"
  | "withdrawn"
  | "failed";

export type ContentType = "html" | "json" | "xml" | "pdf" | "image" | "email" | "manual";

// ── Adapter I/O contract (section 1) ─────────────────────────────────────────

export interface SourceCandidate {
  id: string;
  sourceId: string;
  url?: string;
  title?: string;
  discoveredAt: string;
  discoveryMethod: AdapterMode;
  metadata?: Record<string, unknown>;
}

export interface CaptureResult {
  snapshotId: string;
  sourceId: string;
  capturedAt: string;
  contentType: ContentType;
  contentHash: string;
  /** Reference/placeholder for raw content — NEVER a large inline blob. */
  rawContentRef?: string;
  screenshotRef?: string;
  documentRef?: string;
  metadata?: Record<string, unknown>;
}

export interface ExtractedField<T = unknown> {
  field: string;
  value: T;
  confidence: number; // 0..1
  evidenceRef?: string;
  evidenceText?: string;
}

export type CandidateType = "product" | "offer" | "store" | "mall" | "catalogue" | "retailer";

export interface ExtractionCandidate {
  id: string;
  snapshotId: string;
  candidateType: CandidateType;
  fields: ExtractedField[];
  extractorId: string;
  extractorVersion: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * The common adapter contract. Implementations are PURE + deterministic in this
 * sprint: `discover`/`capture`/`extract`/`validate` read local fixtures/inputs
 * and never perform network I/O. They return data; they never publish.
 */
export interface SourceAdapter {
  adapterId: string;
  sourceId: string;
  mode: AdapterMode;
  version: string;
  discover(input?: unknown): Promise<SourceCandidate[]>;
  capture(candidate: SourceCandidate): Promise<CaptureResult>;
  extract(snapshot: CaptureResult): Promise<ExtractionCandidate[]>;
  validate(candidate: ExtractionCandidate): Promise<ValidationResult>;
}

// ── Registry (section 2) ─────────────────────────────────────────────────────

export interface AdapterCapabilities {
  supportsDiscovery: boolean;
  supportsCapture: boolean;
  supportsExtraction: boolean;
  supportsValidation: boolean;
  requiresAuthorization: boolean;
  automatedAccessAllowed: boolean;
  humanReviewRequired: boolean;
  supportsScheduling: boolean;
  supportsWebhooks: boolean;
}

export type AdapterStatus = "prototype" | "manual" | "approved" | "disabled";

export interface AdapterRegistration {
  adapter: SourceAdapter;
  name: string;
  status: AdapterStatus;
  enabled: boolean;
  capabilities: AdapterCapabilities;
  description: string;
  /** Populated by runs; not authoritative. */
  lastRunAt?: string | null;
  lastRunId?: string | null;
}

// ── Source policy engine (section 3) ─────────────────────────────────────────

export type AutomationStatus =
  | "manual_only"
  | "approved_public_observation"
  | "authorized_feed"
  | "authorized_api"
  | "blocked";

export interface SourceAccessPolicy {
  sourceId: string;
  automationStatus: AutomationStatus;
  allowedModes: AdapterMode[];
  prohibitedPaths?: string[];
  requiresHumanReview: boolean;
  maxFrequencyMinutes?: number;
  legalRisk: "low" | "medium" | "high";
  termsUrl?: string;
  robotsUrl?: string;
  ownerNotes?: string;
  approvedAt?: string;
  approvedBy?: string;
}

export interface PolicyDecision {
  allowed: boolean;
  /** Machine reason code, e.g. "no_policy", "mode_not_allowed", "source_blocked". */
  reason: string;
  message: string;
  requiresHumanReview: boolean;
}

// ── Field-level confidence (section 6) ───────────────────────────────────────

export interface ConfidenceDimensions {
  identityConfidence: number;
  priceConfidence: number;
  availabilityConfidence: number;
  locationConfidence: number;
  freshnessConfidence: number;
  sourceAuthority: number;
}

/** A non-binding recommendation; NEVER auto-applied or auto-published. */
export interface TrustSuggestion {
  suggested: PriceTrustLabel;
  rationale: string;
  confidence: ConfidenceDimensions;
}

// ── Evidence vault (section 4) ───────────────────────────────────────────────

export type ReviewerStatus = "unreviewed" | "in_review" | "accepted" | "rejected" | "superseded";

export interface BoundingBox {
  x: number; y: number; width: number; height: number;
}

/**
 * An immutable-in-meaning evidence record. Corrections create a NEW revision
 * (see `revisionOf` / `revision`); the original is never silently overwritten.
 */
export interface EvidenceRecord {
  id: string;
  sourceId: string;
  sourceUrl: string | null;
  sourceOwner: string | null;
  adapterId: string;
  adapterVersion: string;
  lifecycleState: AdapterLifecycleState;
  capturedAt: string;
  observedAt: string | null;
  contentType: ContentType;
  contentHash: string;
  /** Typed references/placeholders — no large binaries in localStorage. */
  rawContentRef: string | null;
  screenshotRef: string | null;
  documentRef: string | null;
  pageNumber: number | null;
  boundingBox: BoundingBox | null;
  extractedText: string | null;
  structuredData: Record<string, unknown> | null;
  extractorId: string | null;
  extractorVersion: string | null;
  fieldConfidence: ConfidenceDimensions | null;
  reviewerStatus: ReviewerStatus;
  reviewerNotes: string | null;
  /** Immutability chain. */
  revision: number;
  revisionOf: string | null;
  supersededBy: string | null;
  createdAt: string;
  updatedAt: string;
}

// ── Provenance links (section 5) ─────────────────────────────────────────────

export type ProvenanceEntityType =
  | "product_offer"
  | "source_snapshot"
  | "ingestion_run"
  | "conflict_alert"
  | "review_decision";

export interface ProvenanceLink {
  id: string;
  entityType: ProvenanceEntityType;
  entityId: string;
  evidenceId: string;
  /** Why this evidence supports the entity, e.g. "product_page", "phone_confirmation". */
  relation: string;
  createdAt: string;
}

// ── Product identity (section 8) ─────────────────────────────────────────────

export interface IdentityCandidate {
  gtin: string | null;
  manufacturerModel: string | null;
  retailerSku: string | null;
  retailerId: string | null;
  brand: string;
  normalizedBrand: string;
  productTitle: string;
  normalizedTitle: string;
  category: string | null;
  technicalAttributes: Record<string, string>;
  sourceIdentifiers: Record<string, string>;
}

export type MatchTier =
  | "exact_gtin"
  | "exact_manufacturer_model"
  | "exact_retailer_sku"
  | "brand_and_model"
  | "normalized_title"
  | "human_review";

export interface MergeCandidate {
  productId: string;
  tier: MatchTier;
  confidence: number;
  explanation: string;
}

// ── Event model (section 10) ─────────────────────────────────────────────────

export type FabricEventType =
  | "source.candidate_discovered"
  | "source.capture_created"
  | "extraction.completed"
  | "extraction.failed"
  | "validation.completed"
  | "conflict.detected"
  | "review.required"
  | "review.approved"
  | "offer.published"
  | "offer.marked_stale"
  | "source.policy_blocked";

export interface FabricEvent {
  id: string;
  type: FabricEventType;
  sourceId: string | null;
  adapterId: string | null;
  /** Loose payload — maps cleanly to a future Pub/Sub message body. */
  payload: Record<string, unknown>;
  occurredAt: string;
}

// ── Adapter runs (section 9D) ────────────────────────────────────────────────

export interface AdapterRun {
  id: string;
  adapterId: string;
  sourceId: string;
  mode: AdapterMode;
  lifecycleStage: AdapterLifecycleState;
  candidatesDiscovered: number;
  captures: number;
  extractedCandidates: number;
  validationFailures: number;
  warnings: number;
  evidenceIds: string[];
  eventIds: string[];
  status: "completed" | "blocked" | "failed" | "needs_review";
  policyDecision: PolicyDecision | null;
  startedAt: string;
  completedAt: string | null;
  notes: string;
}

// ── Fabric database (local prototype persistence) ────────────────────────────

export interface FabricDatabase {
  version: number;
  policies: SourceAccessPolicy[];
  evidence: EvidenceRecord[];
  provenance: ProvenanceLink[];
  runs: AdapterRun[];
  events: FabricEvent[];
}
