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

import type { PriceTrustLabel, AvailabilityStatus, ReviewStatus, GeographicScope } from "@/lib/ingestion/model";

export type { GeographicScope };

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
  | "source.policy_blocked"
  // Sprint 2C — bulk intake events (design maps to future Pub/Sub / Eventarc).
  | "intake.job_created"
  | "intake.job_started"
  | "intake.chunk_started"
  | "intake.chunk_completed"
  | "intake.record_quarantined"
  | "intake.checkpoint_saved"
  | "intake.job_paused"
  | "intake.job_resumed"
  | "intake.job_completed"
  | "intake.job_failed"
  | "review.batch_created"
  | "publication.plan_created";

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

// ── Sprint 2A: evidence → offer bridge ───────────────────────────────────────

export const GEOGRAPHIC_SCOPES: GeographicScope[] = ["online_only", "national", "province", "mall", "branch", "unknown"];

export type ConflictState = "none" | "conflict_detected" | "resolved";

/**
 * A normalized offer candidate derived from one or more extraction candidates.
 * It is NOT an offer — it is the reviewable bridge between evidence and a staged
 * ProductOffer. Mall/branch availability is never inferred from retailer presence.
 */
export interface OfferDraft {
  id: string;
  sourceId: string;
  retailerId: string | null;
  retailerName: string | null;
  mallId: string | null;
  storeId: string | null;
  productIdentityCandidateId: string | null;
  productTitle: string;
  brand: string | null;
  manufacturerModel: string | null;
  retailerSku: string | null;
  gtin: string | null;
  category: string | null;
  price: number;
  currency: string;
  originalPrice: number | null;
  promoText: string | null;
  promoStart: string | null;
  promoEnd: string | null;
  availabilityStatus: AvailabilityStatus;
  geographicScope: GeographicScope;
  sellerName: string | null;
  observedAt: string;
  expiresAt: string | null;
  suggestedTrustLabel: PriceTrustLabel;
  finalTrustLabel: PriceTrustLabel | null;
  reviewStatus: ReviewStatus;
  evidenceIds: string[];
  confidence: ConfidenceDimensions;
  warnings: string[];
  conflictState: ConflictState;
  /** Idempotent identity: same candidate + normalizer version → same hash. */
  draftHash: string;
  normalizerVersion: string;
  adapterId: string | null;
  extractorId: string | null;
  createdAt: string;
  updatedAt: string;
}

export type ReviewDecisionType = "approve" | "reject" | "request_changes" | "archive";

/** An explicit reviewer correction — visible as a patch, never a silent overwrite. */
export interface FieldPatch {
  field: string;
  from: unknown;
  to: unknown;
}

/** An auditable, append-only review decision over a draft. */
export interface ReviewDecision {
  id: string;
  draftId: string;
  evidenceIds: string[];
  reviewerId: string;
  decision: ReviewDecisionType;
  finalTrustLabel: PriceTrustLabel | null;
  approvedAvailabilityStatus: AvailabilityStatus | null;
  approvedGeographicScope: GeographicScope | null;
  correctedFields: FieldPatch[];
  reasoning: string;
  decidedAt: string;
  previousDecisionId: string | null;
  decisionVersion: number;
}

/** Deterministic publication gate. Blockers never silently become warnings. */
export interface PublicationDecision {
  eligible: boolean;
  blockers: string[];
  warnings: string[];
}

// ── Fabric database (local prototype persistence) ────────────────────────────

export interface FabricDatabase {
  version: number;
  policies: SourceAccessPolicy[];
  evidence: EvidenceRecord[];
  provenance: ProvenanceLink[];
  runs: AdapterRun[];
  events: FabricEvent[];
  drafts: OfferDraft[];
  decisions: ReviewDecision[];
}
