/**
 * MallMind Retail Intelligence Fabric — Sprint 2C: bulk intake engine types.
 *
 * A durable, resumable, chunk-streaming intake model shaped for a future
 * Supabase/Postgres + Cloud Run worker deployment. PROTOTYPE — local persisted
 * data / in-memory processing. Nothing here scrapes, deploys, writes production
 * data, or publishes directly from import.
 */

import type { OfferDraft, EvidenceRecord, FabricEvent, PublicationDecision } from "../types";

// ── Jobs ─────────────────────────────────────────────────────────────────────

export type IntakeJobStatus =
  | "queued" | "validating" | "processing" | "paused" | "needs_review"
  | "completed" | "completed_with_errors" | "failed" | "cancelled";

export type IntakeMode =
  | "csv" | "json" | "jsonl" | "catalogue_extraction" | "partner_feed" | "manual_batch" | "fixture_load_test";

export interface IntakeCheckpoint {
  chunkIndex: number;
  rowOffset: number;
  lastRecordHash?: string;
  parserState?: Record<string, unknown>;
  updatedAt: string;
}

export interface IntakeJob {
  id: string;
  sourceId: string;
  adapterId?: string;
  mode: IntakeMode;
  status: IntakeJobStatus;
  inputRef: string;
  inputHash: string;
  requestedBy: string;
  totalBytes?: number;
  estimatedRows?: number;
  processedRows: number;
  validRows: number;
  rejectedRows: number;
  duplicateRows: number;
  conflictRows: number;
  stagedDrafts: number;
  evidenceCreated: number;
  retryCount: number;
  cursor?: string;
  checkpoint?: IntakeCheckpoint;
  startedAt?: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
}

// ── Row results ──────────────────────────────────────────────────────────────

export type IntakeRecordResult =
  | { status: "staged"; recordHash: string; evidenceIds: string[]; draftId: string; warnings: string[] }
  | { status: "duplicate"; recordHash: string; existingReference: string; warnings: string[] }
  | { status: "conflict"; recordHash: string; conflictGroupId: string; evidenceIds: string[]; draftId?: string; warnings: string[] }
  | { status: "rejected"; recordHash?: string; errors: string[]; warnings: string[] };

/** A raw inbound record (already parsed from CSV/JSON/JSONL into a flat object). */
export type RawRecord = Record<string, unknown>;

// ── Quarantine ───────────────────────────────────────────────────────────────

export type QuarantineErrorClass =
  | "structural" | "validation" | "policy" | "identity" | "evidence" | "conflict" | "storage" | "transient" | "internal";

export type QuarantineDisposition = "quarantined" | "permanently_rejected" | "manual_correction_requested";

export interface QuarantineRecord {
  id: string;
  jobId: string;
  recordIndex: number;
  sourceRef: string;
  /** Sanitized, length-capped excerpt OR just the record hash — never unbounded raw content. */
  excerpt: string;
  recordHash?: string;
  errorClass: QuarantineErrorClass;
  errorCodes: string[];
  warnings: string[];
  retryable: boolean;
  disposition: QuarantineDisposition;
  attempts: number;
  createdAt: string;
}

// ── Chunk + metrics ──────────────────────────────────────────────────────────

export interface ChunkSummary {
  chunkIndex: number;
  rows: number;
  staged: number;
  duplicates: number;
  conflicts: number;
  rejected: number;
  evidenceCreated: number;
  durationMs: number;
}

export interface IntakeMetrics {
  rowsPerSecond: number;
  bytesPerSecond: number;
  chunkDurationMsAvg: number;
  validationFailureRate: number;
  duplicateRate: number;
  conflictRate: number;
  evidenceCreationRate: number;
  draftCreationRate: number;
  quarantineRate: number;
  retryRate: number;
  checkpointCount: number;
  estimatedRemainingSeconds: number | null;
  peakHeapBytes: number | null;
}

// ── Intake events (design maps to future Pub/Sub) ────────────────────────────

export type IntakeEventType =
  | "intake.job_created" | "intake.job_started" | "intake.chunk_started" | "intake.chunk_completed"
  | "intake.record_quarantined" | "intake.checkpoint_saved" | "intake.job_paused" | "intake.job_resumed"
  | "intake.job_completed" | "intake.job_failed" | "review.batch_created" | "publication.plan_created";

// ── Engine state + result ────────────────────────────────────────────────────

/** In-progress engine state. Drafts/evidence are the durable output; input is never mutated. */
export interface IntakeState {
  job: IntakeJob;
  drafts: OfferDraft[];
  evidence: EvidenceRecord[];
  quarantine: QuarantineRecord[];
  events: FabricEvent[];
  chunkSummaries: ChunkSummary[];
  checkpoints: IntakeCheckpoint[];
  metrics: IntakeMetrics;
  /** Dedup index (record hashes seen) + product/source index (for conflict detection). */
  seen: Record<string, string>;             // recordHash → draftId reference
  productIndex: Record<string, { price: number; draftId: string }>; // identityKey::sourceCategory → first seen
}

export interface IntakeRunResult {
  state: IntakeState;
  job: IntakeJob;
  /** A bounded sample of per-row results (never the full 50k) for observability. */
  sample: IntakeRecordResult[];
}

// ── Input store abstraction ──────────────────────────────────────────────────

export interface IntakeInputRef { ref: string; }
export interface IntakeInputMetadata { ref: string; contentType: string; sizeBytes: number; metadata: Record<string, string>; }

export interface IntakeInputStore {
  put(input: { content: Uint8Array | string; contentType: string; metadata?: Record<string, string> }): Promise<IntakeInputRef>;
  open(ref: string): Promise<AsyncIterable<Uint8Array | string>>;
  stat(ref: string): Promise<IntakeInputMetadata>;
  delete?(ref: string): Promise<void>;
}

// ── Review batches ───────────────────────────────────────────────────────────

export interface ReviewBatch {
  id: string;
  intakeJobId: string;
  status: "open" | "partially_reviewed" | "completed" | "cancelled";
  draftIds: string[];
  approvedCount: number;
  rejectedCount: number;
  changesRequestedCount: number;
  conflictCount: number;
  createdAt: string;
  updatedAt: string;
}

// ── Publication planning ─────────────────────────────────────────────────────

export interface PublicationPlanEntry {
  draftId: string;
  offerId: string | null;
  decision: PublicationDecision;
}

export interface PublicationPlan {
  id: string;
  intakeJobId: string;
  mode: "dry_run" | "apply";
  eligible: string[];   // draftIds
  blocked: { draftId: string; blockers: string[] }[];
  applied: number;
  createdAt: string;
}
