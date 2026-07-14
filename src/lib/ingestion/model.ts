/**
 * MallMind Data Ingestion — Sprint 1 data model.
 *
 * Trustworthy ingestion foundation for the AI shopping assistant: canonical
 * products, retailer offers, physical store mappings, source evidence, freshness
 * and trust labels, and honest availability status.
 *
 * PROTOTYPE — LOCAL PERSISTED DATA. This sprint deliberately does NOT add a
 * remote Supabase schema or backend routes (that would duplicate the existing
 * retail_* ingestion tables and cannot be verified locally without Docker). The
 * shapes below mirror the target relational model 1:1 so a future migration can
 * adopt them directly. All seeded content is CURATED DEMONSTRATION DATA — never
 * "verified live".
 */

// ── Enumerations ────────────────────────────────────────────────────────────

/** Exact price-trust labels (RC1). */
export type PriceTrustLabel =
  | "verified_live"
  | "recently_observed"
  | "catalogue_special"
  | "manual_admin"
  | "partner_feed"
  | "user_submitted"
  | "stale"
  | "unavailable"
  | "conflict_detected";

/** Exact availability labels required by the sprint. */
export type AvailabilityLabel =
  | "branch_stock_confirmed"
  | "collection_available"
  | "online_stock_only"
  | "retailer_range_observed"
  | "store_presence_confirmed"
  | "availability_unknown"
  | "inferred_not_confirmed"
  | "out_of_stock"
  | "no_longer_listed";

/** RC1 review lifecycle. */
export type ReviewStatus = "staged" | "needs_review" | "approved" | "rejected" | "archived";

/** Coarse availability confidence (RC1 offer field). */
export type AvailabilityStatus = "known_available" | "unknown" | "inferred" | "unavailable";

/** Where an offer's price/availability applies. Never inferred from retailer presence. */
export type GeographicScope = "online_only" | "national" | "province" | "mall" | "branch" | "unknown";

/** Source-registry lifecycle status. */
export type SourceRegistryStatus = "candidate" | "approved" | "blocked" | "needs_review" | "deprecated";

/** Legal/operational risk level for a tracked source. */
export type RiskLevel = "low" | "medium" | "high";

/** Ingestion-run type. `future_agent_research` is reserved (not executed in RC1). */
export type IngestionRunType = "manual_csv" | "manual_entry" | "source_snapshot" | "future_agent_research";

export type OfferChannel = "in_store" | "online" | "marketplace" | "click_and_collect" | "catalogue";

export type SourceType =
  | "retailer_product_page"
  | "retailer_search_page"
  | "retailer_specials_page"
  | "retailer_catalogue"
  | "catalogue_pdf"
  | "catalogue_image"
  | "mall_directory"
  | "marketplace_listing"
  | "partner_feed"
  | "admin_csv"
  | "manual_entry"
  | "manual_admin"
  | "user_submission"
  | "aggregator_reference"
  | "csv_import"
  | "phone_confirmation"
  | "in_store_photo";

export type RetailerType = "physical" | "online_only" | "marketplace" | "hybrid";

export type VerificationStatus = "verified" | "unverified" | "needs_review";

export type EntityStatus = "active" | "inactive" | "pending";

export type NormalizationStatus = "normalized" | "pending" | "needs_review";

export type ObservationAvailability =
  | "in_stock"
  | "low_stock"
  | "out_of_stock"
  | "unknown";

export type EvidenceType =
  | "retailer_product_page"
  | "retailer_catalogue"
  | "phone_confirmation"
  | "in_store_photo"
  | "staff_confirmation"
  | "user_report";

export type ReviewEntityType =
  | "product"
  | "product_offer"
  | "store"
  | "store_offer_observation"
  | "source_snapshot";

export type ReviewSeverity = "info" | "warning" | "error";

export type SnapshotStatus = "captured" | "parsed" | "failed";

export type IngestionRunStatus = "staged" | "started" | "validating" | "completed" | "failed" | "needs_review" | "cancelled";

export type LegalReviewStatus = "not_reviewed" | "in_review" | "cleared" | "blocked";

// ── Entities ────────────────────────────────────────────────────────────────

export interface Mall {
  id: string;
  name: string;
  slug: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
  officialWebsiteUrl: string | null;
  sourceUrl: string | null;
  lastVerifiedAt: string | null;
  status: EntityStatus;
}

export interface Retailer {
  id: string;
  name: string;
  slug: string;
  websiteUrl: string | null;
  retailerType: RetailerType;
  marketplaceEnabled: boolean;
  physicalRetailer: boolean;
  status: EntityStatus;
}

export interface Store {
  id: string;
  retailerId: string;
  mallId: string;
  tradingName: string;
  shopNumber: string | null;
  floorLabel: string | null;
  telephone: string | null;
  storeUrl: string | null;
  verificationStatus: VerificationStatus;
  lastVerifiedAt: string | null;
}

export interface Product {
  id: string;
  canonicalName: string;
  brand: string;
  modelNumber: string;
  category: string;
  descriptionSummary: string;
  gtin?: string | null;
  manufacturerSku?: string | null;
  normalizationStatus: NormalizationStatus;
}

export interface ProductOffer {
  id: string;
  productId: string;
  retailerId: string;
  sellerName?: string | null;
  channel: OfferChannel;
  currency: string;
  currentPrice: number;
  previousPrice?: number | null;
  promotionLabel?: string | null;
  sourceUrl: string;
  sourceType: SourceType;
  sourceObservedAt: string;
  expiresAt?: string | null;
  validFrom?: string | null;
  validUntil?: string | null;
  /** Coarse availability confidence (RC1). Never "known_available" without supporting evidence. */
  availabilityStatus: AvailabilityStatus;
  /** Detailed availability scope (never derived from website+store presence alone). */
  availabilityScope: AvailabilityLabel;
  priceTrustLabel: PriceTrustLabel;
  /** Optional link to the stored source snapshot / evidence. */
  snapshotId?: string | null;
  /** Short cited evidence text (e.g. the price line seen at source). */
  evidenceText?: string | null;
  /** Optional content hash of the evidence/source snapshot. */
  evidenceHash?: string | null;
  /** Set when this offer participates in a detected price conflict. */
  conflictGroupId?: string | null;
  reviewStatus: ReviewStatus;
  published: boolean;
  createdAt: string;
  updatedAt: string;
  /** Curated-demo marker; true unless real evidence exists. */
  demonstrationData?: boolean;
  // ── Sprint 2A: evidence → offer lineage (additive, optional) ──
  /** Where the price/availability applies (never inferred from retailer presence). */
  geographicScope?: GeographicScope;
  /** The fabric source this offer's evidence came from (for policy resolution). */
  sourceId?: string | null;
  /** The OfferDraft this offer was created from. */
  draftId?: string | null;
  /** The ReviewDecision that approved this offer. */
  reviewDecisionId?: string | null;
  /** Evidence records backing this offer (retained through the bridge). */
  evidenceIds?: string[];
  /** Lineage of how the offer was produced. */
  normalizerVersion?: string | null;
  adapterId?: string | null;
  extractorId?: string | null;
  /** Bumped when a revised decision updates the offer. */
  offerRevision?: number;
}

export interface StoreOfferObservation {
  id: string;
  productOfferId: string;
  storeId: string;
  availabilityStatus: ObservationAvailability;
  evidenceType: EvidenceType;
  observedAt: string;
  expiresAt?: string | null;
  sourceUrl: string | null;
  confidenceScore: number; // 0..1
  reviewStatus: ReviewStatus;
}

export interface SourceSnapshot {
  id: string;
  sourceUrl: string;
  sourceType: SourceType;
  retrievedAt: string;
  contentHash: string;
  evidenceExcerpt: string;
  evidenceMetadata: Record<string, unknown>;
  parserVersion: string;
  ingestionRunId: string | null;
  status: SnapshotStatus;
  /** Optional retailer/mall the snapshot pertains to. */
  retailerId?: string | null;
  mallId?: string | null;
  /** Review lifecycle + reviewer for the snapshot's evidence. */
  reviewStatus?: ReviewStatus;
  reviewedBy?: string | null;
  notes?: string | null;
}

export interface IngestionRun {
  id: string;
  runType: IngestionRunType;
  sourceType: SourceType | "csv_import";
  filename: string | null;
  /** Evidence/source URL for the run, where applicable. */
  evidenceUrl?: string | null;
  startedAt: string;
  completedAt: string | null;
  status: IngestionRunStatus;
  totalRows: number;
  acceptedRows: number;
  rejectedRows: number;
  warningRows: number;
  conflictsDetected: number;
  /** Count of items detected as stale/expired during the run. */
  staleItemsDetected: number;
  initiatedBy: string;
  notes: string | null;
}

/**
 * Source registry entry — a public source MallMind has snapshotted or is
 * tracking. This is a registry only; RC1 performs NO automated fetching.
 */
export interface Source {
  id: string;
  name: string;
  sourceUrl: string;
  sourceType: SourceType;
  retailerId: string | null;
  mallId: string | null;
  status: SourceRegistryStatus;
  /** Legal/operational risk level. */
  riskLevel: RiskLevel;
  legalRiskNote: string | null;
  lastCheckedAt: string | null;
  ownerNotes: string | null;
  createdAt: string;
}

export interface ReviewQueueItem {
  id: string;
  entityType: ReviewEntityType;
  entityId: string;
  reason: string;
  severity: ReviewSeverity;
  status: ReviewStatus;
  createdAt: string;
  reviewedAt: string | null;
  reviewedBy: string | null;
  decisionNotes: string | null;
}

/**
 * Source-policy gate (placeholder, functional but intentionally not overbuilt).
 * Lets a retailer's ingestion legality be tracked before any future automation.
 */
export interface SourcePolicy {
  id: string;
  retailerId: string | null;
  termsReviewed: boolean;
  robotsReviewed: boolean;
  automationApproved: boolean;
  ingestionFrequency: string; // e.g. "manual" | "daily" | "weekly"
  permittedFields: string[];
  imageUsagePermission: boolean;
  legalReviewStatus: LegalReviewStatus;
  updatedAt: string;
}

/** Provenance of the whole dataset — always honest about being a prototype. */
export interface DatasetMeta {
  isPrototype: true;
  dataOrigin: "curated_demonstration";
  label: "Curated demonstration data";
  createdAt: string;
  version: number;
}

/** The full in-memory / locally-persisted ingestion database. */
export interface IngestionDatabase {
  meta: DatasetMeta;
  malls: Mall[];
  retailers: Retailer[];
  stores: Store[];
  products: Product[];
  offers: ProductOffer[];
  observations: StoreOfferObservation[];
  snapshots: SourceSnapshot[];
  sources: Source[];
  runs: IngestionRun[];
  reviewQueue: ReviewQueueItem[];
  policies: SourcePolicy[];
}

export function emptyDatabase(now: string): IngestionDatabase {
  return {
    meta: { isPrototype: true, dataOrigin: "curated_demonstration", label: "Curated demonstration data", createdAt: now, version: 2 },
    malls: [], retailers: [], stores: [], products: [], offers: [],
    observations: [], snapshots: [], sources: [], runs: [], reviewQueue: [], policies: [],
  };
}
