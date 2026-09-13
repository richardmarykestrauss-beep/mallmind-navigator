/**
 * types.ts — the Venue Pack Factory data model (schema 1).
 *
 * The factory turns RAW EVIDENCE into a publishable Venue Pack through explicit, inspectable
 * stages: source manifest → candidate extraction → evidence ledger → human review → deterministic
 * compile → publish gate. Every artifact is plain JSON on disk under venue-factory/jobs/<job_id>/.
 *
 * Truth rules encoded here:
 *   • a fact enters the ledger as `proposed`; ONLY an explicit human review moves it to `accepted`
 *     (or `rejected` / `superseded`) — AI or manual inference can never promote itself;
 *   • rejected facts are never erased: the ledger is append-only with status transitions;
 *   • the compiler consumes ACCEPTED facts only and fails loudly on anything unresolved;
 *   • the output is the SAME Venue Pack contract the app validates (src/venue/contract.ts) —
 *     there is no second data model.
 */

import type { VenuePolicies, DeploymentState, DistanceUnit } from "../contract";

export const FACTORY_SCHEMA_VERSION = 1 as const;

// ── Job ──────────────────────────────────────────────────────────────────────
export type JobStatus =
  | "created" | "sources_registered" | "extracting" | "draft_ready" | "validation_failed"
  | "awaiting_review" | "approved" | "rejected" | "published";
export const JOB_STATUSES: readonly JobStatus[] = [
  "created", "sources_registered", "extracting", "draft_ready", "validation_failed", "awaiting_review", "approved", "rejected", "published",
];

/** Venue facts the operator states when opening a job (identity + policy; never geometry). */
export interface JobVenueConfig {
  id: string;
  name: string;
  short_name?: string;
  city?: string;
  country?: string;
  deployment: { state: DeploymentState; official: boolean; label?: string };
  /** Graph unit the compiled pack must use. "m" requires an accepted measurement for EVERY edge. */
  distance_unit: DistanceUnit;
  policies: VenuePolicies;
  notes?: string;
}

export interface JobHistoryEntry { at: string; status: JobStatus; note: string }

export interface ApprovalState {
  decision: "approve" | "reject";
  reviewer: string;
  at: string;
  reason: string;
  /** sha256 of the draft pack JSON that was approved — publish refuses a draft that changed since. */
  draft_sha256: string;
}

export interface ValidationSummary {
  at: string;
  status: "ok" | "failed";
  errors: Array<{ path: string; message: string }>;
  warnings: string[];
}

export interface IngestionJob {
  schema_version: typeof FACTORY_SCHEMA_VERSION;
  job_id: string;
  venue_id: string;
  created_at: string;
  status: JobStatus;
  venue: JobVenueConfig;
  /** Version the next publish produces. Starts at 1, or previous published + 1 for a revision job. */
  pack_version: number;
  /** Plain-text description of this revision (goes into venue.revision_note). */
  revision_note: string;
  /** Job-relative file paths of every artifact (all inside the job directory). */
  sources: string | null;              // sources.json
  extraction_outputs: string[];        // extractions/NN-<name>.json
  evidence_ledger: string;             // ledger.json
  reviews: string[];                   // reviews/NN.json
  draft_pack: string | null;           // draft/<venue_id>.draft.venue.json
  validation_result: ValidationSummary | null;
  approval_state: ApprovalState | null;
  published_pack_version: number | null;
  published_pack: string | null;       // published/<venue_id>.v<N>.venue.json
  /** Pack this job revises (job-relative path of a copy), for venue:diff and version continuity. */
  base_pack: string | null;
  history: JobHistoryEntry[];
}

// ── Source manifest ──────────────────────────────────────────────────────────
export type SourceType =
  | "official_webpage" | "official_directory" | "official_map_image" | "official_pdf" | "operator_provided_plan"
  | "field_photo" | "field_measurement" | "secondary_reference" | "manual_note";
export const SOURCE_TYPES: readonly SourceType[] = [
  "official_webpage", "official_directory", "official_map_image", "official_pdf", "operator_provided_plan",
  "field_photo", "field_measurement", "secondary_reference", "manual_note",
];
export type SourceParty = "first_party" | "secondary" | "operator" | "field" | "derived";
export const SOURCE_PARTIES: readonly SourceParty[] = ["first_party", "secondary", "operator", "field", "derived"];
export type RightsStatus = "permitted" | "public_no_reuse" | "unknown" | "restricted";
export const RIGHTS_STATUSES: readonly RightsStatus[] = ["permitted", "public_no_reuse", "unknown", "restricted"];

/**
 * Pixel coordinate system of an ingested plan image (origin top-left, x right, y down) and how its
 * pixels map onto the 1000:620 MallMind plane: "stretch" normalises each axis 0..1 independently;
 * "pad-to-plane" letterboxes the image (centred) inside the plane aspect so shapes are preserved.
 */
export interface ImageCoordinateSystem { width_px: number; height_px: number; origin: "top-left"; x_axis: "right"; y_axis: "down"; fit: "stretch" | "pad-to-plane" }

export interface SourceEntry {
  source_id: string;
  type: SourceType;
  title: string;
  /** URL or file reference. Stored as TEXT: the factory never fetches, opens or renders it. */
  origin: string;
  acquired_at: string;
  party: SourceParty;
  /** Public availability is NOT reuse permission; say what is known. */
  rights: { status: RightsStatus; note: string };
  /** sha256 hex of the captured bytes (required when a file is in the job's raw/ folder). */
  checksum?: string;
  /** Job-relative path under raw/ when the artifact is stored with the job (never outside it). */
  file?: string;
  /** Declared for image sources; verified against the PNG header on registration. */
  image?: ImageCoordinateSystem;
  notes?: string;
}

export interface SourceManifest {
  schema_version: typeof FACTORY_SCHEMA_VERSION;
  job_id?: string;
  sources: SourceEntry[];
}

// ── Evidence ledger ──────────────────────────────────────────────────────────
export type EvidenceClass =
  | "explicit_first_party" | "visual_first_party" | "operator_supplied" | "field_verified"
  | "secondary_corroboration" | "ai_inference" | "manual_inference";
export const EVIDENCE_CLASSES: readonly EvidenceClass[] = [
  "explicit_first_party", "visual_first_party", "operator_supplied", "field_verified", "secondary_corroboration", "ai_inference", "manual_inference",
];
/** Classes that are inference: they can never be accepted without a human decision AND are the weakest geometry tier. */
export const INFERENCE_CLASSES: readonly EvidenceClass[] = ["ai_inference", "manual_inference"];

export type FactStatus = "proposed" | "accepted" | "rejected" | "superseded";
export const FACT_STATUSES: readonly FactStatus[] = ["proposed", "accepted", "rejected", "superseded"];

export type FactValue = string | number | boolean | null | Record<string, string | number | boolean | null> | Array<Record<string, string | number | boolean | null>>;

export interface EvidenceFact {
  fact_id: string;
  /** What the fact is about: "venue" | "floor:<id>" | "node:<id>" | "edge:<id>" | "destination:<id>" | "anchor:<id>" | "amenity:<id>" | "instruction:<id>" | free text subject. */
  subject: string;
  predicate: string;
  value: FactValue;
  source_id: string;
  evidence_class: EvidenceClass;
  confidence: number;
  status: FactStatus;
  /** Which extraction (job-relative path) proposed it; "review" for facts created by an override; "field-import" for field data. */
  proposed_by: string;
  manual_review_required: boolean;
  notes?: string;
  /** Set by the review that changed the status. */
  decision?: { by: string; at: string; action: "accept" | "reject" | "override" | "unresolved"; reason: string };
  /** For overrides: the fact this one supersedes / the fact that superseded this one. */
  supersedes?: string;
  superseded_by?: string;
}

export interface EvidenceLedger {
  schema_version: typeof FACTORY_SCHEMA_VERSION;
  job_id: string;
  facts: EvidenceFact[];
}

// ── Candidate extraction ─────────────────────────────────────────────────────
export type ExtractionWorkerKind = "manual" | "file" | "ai";
export interface ExtractionWorkerInfo { kind: ExtractionWorkerKind; name: string; version?: string; model?: string }

/** A point on the MallMind plane (0..100) or on a registered source image (pixels, normalized on ingest). */
export type CandidatePoint =
  | { x_percent: number; y_percent: number }
  | { image: string; px_x: number; px_y: number };

interface CandidateBase {
  id: string;
  source_id: string;
  evidence_class: EvidenceClass;
  confidence: number;
  manual_review_required: boolean;
  notes?: string;
}
export interface CandidateFloor extends CandidateBase { label: string; order: number; aliases?: string[] }
export interface CandidateNode extends CandidateBase {
  name: string;
  kind: "entrance" | "corridor" | "junction" | "arrival" | "amenity" | "landmark" | "vertical";
  floor: string;
  at: CandidatePoint;
}
export interface CandidatePolygon extends CandidateBase { floor: string; label?: string; points: CandidatePoint[] }
export interface CandidateStoreLabel extends CandidateBase { text: string; floor: string; at: CandidatePoint; unit?: string }
export interface CandidateCenterline extends CandidateBase { floor: string; points: CandidatePoint[] }
export interface CandidateEdge extends CandidateBase {
  from: string; to: string; bidirectional?: boolean; floor_change?: boolean;
  vertical_kind?: "lift" | "escalator" | "stairs" | "ramp";
  /** Pixel length on the traced source (px packs). Omitted → derived from plane coordinates and flagged. */
  length_px?: number;
}
export interface CandidateInstruction extends CandidateBase { edge: string; direction: "forward" | "reverse"; text: string }
export interface CandidateDestination extends CandidateBase {
  name: string; kind: "store" | "service" | "food" | "entertainment" | "landmark"; category?: string;
  arrival_node: string; unit?: string | null; aliases?: string[];
}
export interface CandidateAnchor extends CandidateBase {
  node: string; label: string; kind: "entrance" | "landmark" | "kiosk" | "parking_interface" | "amenity";
  start_permitted: boolean; qr_eligible?: boolean;
}
export interface CandidateAmenity extends CandidateBase {
  kind: string; name: string; node: string; routable: boolean; aliases?: string[];
}
/** A free-standing fact (e.g. "Clicks is Store 37") the extraction asserts without a candidate object. */
export interface CandidateFact extends CandidateBase { subject: string; predicate: string; value: FactValue }

export interface CandidateExtraction {
  schema_version: typeof FACTORY_SCHEMA_VERSION;
  job_id?: string;
  worker: ExtractionWorkerInfo;
  source_ids: string[];
  floors: CandidateFloor[];
  nodes: CandidateNode[];
  unit_polygons: CandidatePolygon[];
  store_labels: CandidateStoreLabel[];
  corridor_centerlines: CandidateCenterline[];
  edges: CandidateEdge[];
  instructions: CandidateInstruction[];
  destinations: CandidateDestination[];
  anchors: CandidateAnchor[];
  amenities: CandidateAmenity[];
  facts: CandidateFact[];
}

// ── Review ───────────────────────────────────────────────────────────────────
export interface ReviewOverride { fact_id: string; value: FactValue; reason: string; evidence_class?: EvidenceClass; source_id?: string }
export interface ReviewDecision { fact_id: string; reason?: string }
export interface ReviewInput {
  schema_version: typeof FACTORY_SCHEMA_VERSION;
  job_id?: string;
  reviewer: string;
  reviewed_at: string;
  accept: ReviewDecision[];
  reject: ReviewDecision[];
  override: ReviewOverride[];
  unresolved: ReviewDecision[];
  /** Bulk-accept every proposed fact of these classes (never an inference class). */
  accept_all_of_class?: EvidenceClass[];
  /** Job-level decision, only meaningful once a validated draft exists. */
  decision?: { action: "approve" | "reject"; reason: string };
}

// ── Field verification import ───────────────────────────────────────────────
export interface FieldImport {
  schema_version: typeof FACTORY_SCHEMA_VERSION;
  job_id?: string;
  observer: string;
  observed_at: string;
  /** A source of type field_measurement / field_photo registered in the manifest. */
  source_id: string;
  measurements: Array<{ id: string; edge: string; distance_m: number; method: string; notes?: string }>;
  node_confirmations: Array<{ id: string; node: string; at?: CandidatePoint; notes?: string }>;
  door_confirmations: Array<{ id: string; destination: string; notes?: string }>;
  accessibility: Array<{ id: string; subject: string; step_free: boolean; notes?: string }>;
}

// ── Diff ─────────────────────────────────────────────────────────────────────
export interface PackDiff {
  from: { id: string; pack_version: number } | null;
  to: { id: string; pack_version: number };
  floors: { added: string[]; removed: string[]; relabelled: string[] };
  nodes: { added: string[]; removed: string[]; moved: Array<{ id: string; from: [number, number]; to: [number, number] }>; renamed: string[]; evidence_changed: Array<{ id: string; from: string; to: string }>; floor_changed: string[] };
  edges: { added: string[]; removed: string[]; measured: Array<{ id: string; distance_m: number }>; unmeasured: string[]; instruction_changed: Array<{ id: string; direction: "forward" | "reverse" }>; topology_changed: string[] };
  destinations: { added: string[]; removed: string[]; arrival_changed: Array<{ id: string; from: string; to: string }>; identity_changed: Array<{ id: string; from: string; to: string }>; renamed: string[] };
  anchors: { added: string[]; removed: string[]; changed: string[] };
  amenities: { added: string[]; removed: string[]; changed: string[] };
  venue: { evidence_changed: Array<{ concern: string; from: string; to: string }>; unit_changed: { from: string; to: string } | null; policies_changed: boolean };
  summary: string[];
}

export const JOB_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const SOURCE_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
export const FACT_ID_PATTERN = /^[a-z0-9][a-z0-9_:.~-]{0,127}$/;
export const CANDIDATE_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,127}$/;
