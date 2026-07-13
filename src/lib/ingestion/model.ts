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

/** Exact price-trust labels required by the sprint. */
export type PriceTrustLabel =
  | "verified_live"
  | "recently_observed"
  | "catalogue_special"
  | "manual_admin"
  | "user_submitted"
  | "stale"
  | "unavailable";

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

export type ReviewStatus = "pending" | "approved" | "rejected" | "needs_correction";

export type OfferChannel = "in_store" | "online" | "marketplace" | "click_and_collect" | "catalogue";

export type SourceType =
  | "retailer_product_page"
  | "retailer_catalogue"
  | "marketplace_listing"
  | "manual_admin"
  | "user_submission"
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

export type IngestionRunStatus = "started" | "validating" | "completed" | "failed" | "cancelled";

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
  validFrom?: string | null;
  validUntil?: string | null;
  /** Availability trust for this offer (never derived from website+store presence alone). */
  availabilityScope: AvailabilityLabel;
  priceTrustLabel: PriceTrustLabel;
  reviewStatus: ReviewStatus;
  published: boolean;
  createdAt: string;
  updatedAt: string;
  /** Curated-demo marker; true unless real evidence exists. */
  demonstrationData?: boolean;
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
}

export interface IngestionRun {
  id: string;
  sourceType: SourceType | "csv_import";
  filename: string | null;
  startedAt: string;
  completedAt: string | null;
  status: IngestionRunStatus;
  totalRows: number;
  acceptedRows: number;
  rejectedRows: number;
  warningRows: number;
  initiatedBy: string;
  notes: string | null;
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
  runs: IngestionRun[];
  reviewQueue: ReviewQueueItem[];
  policies: SourcePolicy[];
}

export function emptyDatabase(now: string): IngestionDatabase {
  return {
    meta: { isPrototype: true, dataOrigin: "curated_demonstration", label: "Curated demonstration data", createdAt: now, version: 1 },
    malls: [], retailers: [], stores: [], products: [], offers: [],
    observations: [], snapshots: [], runs: [], reviewQueue: [], policies: [],
  };
}
