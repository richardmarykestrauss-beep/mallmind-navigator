/**
 * Durable intake row model + store contract.
 *
 * These shapes mirror the additive Postgres tables in
 * `supabase/migrations/033_retail_intake_durable.sql` 1:1 so the in-memory
 * reference store and a real Supabase-backed store expose the SAME semantics
 * (atomic chunk commit, unique constraints, optimistic version, leases).
 *
 * PROTOTYPE — the reference store is in-memory; no service-role key or Postgres
 * runs on this machine. Nothing publishes; import only ever stages drafts.
 */

import type { IntakeMode, QuarantineRecord } from "../types";

export type DurableJobStatus =
  | "queued" | "claimed" | "validating" | "processing" | "paused"
  | "needs_review" | "completed" | "completed_with_errors" | "failed" | "cancelled";

export interface DurableJobRow {
  id: string;
  sourceId: string;
  adapterId: string | null;
  inputRef: string;              // e.g. gs://bucket/path#generation — a REFERENCE, never the payload
  inputHash: string;
  inputContentType: string;
  mode: IntakeMode;
  status: DurableJobStatus;
  requestedBy: string;
  priority: number;
  totalBytes: number | null;
  estimatedRows: number | null;
  processedRows: number;
  validRows: number;
  rejectedRows: number;
  duplicateRows: number;
  conflictRows: number;
  stagedDrafts: number;
  evidenceCreated: number;
  retryCount: number;
  maxRetries: number;
  currentChunkIndex: number;
  currentRowOffset: number;
  lastRecordHash: string | null;
  cancellationRequestedAt: string | null;
  pausedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  failedAt: string | null;
  failureCode: string | null;
  failureMessageSanitized: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;               // optimistic concurrency guard
}

export interface WorkerLeaseRow {
  jobId: string;
  workerId: string;
  claimedAt: string;
  leaseExpiresAt: string;
  heartbeatAt: string;
}

export interface ChunkRow {
  jobId: string;
  chunkIndex: number;
  chunkHash: string;
  rowOffsetStart: number;
  rowOffsetEnd: number;
  staged: number;
  duplicates: number;
  conflicts: number;
  rejected: number;
  evidenceCreated: number;
  durationMs: number;
  workerId: string;
  committedAt: string;
}

export interface CheckpointRow {
  jobId: string;
  chunkIndex: number;
  rowOffset: number;
  lastRecordHash: string | null;
  inputCursor: string | null;
  committedAt: string;
  workerId: string;
  jobVersion: number;
}

export interface DedupKeyRow {
  scope: string;                 // dedup scope (source-level) — same record never multiplies
  recordHash: string;
  draftRef: string;
  createdAt: string;
}

export type DurableEventType =
  | "intake.job_created" | "intake.job_claimed" | "intake.job_started" | "intake.input_validated"
  | "intake.chunk_started" | "intake.chunk_committed" | "intake.checkpoint_saved" | "intake.record_quarantined"
  | "intake.lease_renewed" | "intake.lease_expired" | "intake.job_paused" | "intake.job_resumed"
  | "intake.job_cancelled" | "intake.job_completed" | "intake.job_failed";

export interface DurableEventRow {
  eventId: string;
  jobId: string;
  workerId: string | null;
  eventType: DurableEventType;
  chunkIndex: number | null;
  countsDelta: Record<string, number> | null;
  traceId: string;
  createdAt: string;
  metadata: Record<string, unknown>;   // bounded; NEVER raw retail payloads
}

/** A bounded, atomic chunk-commit payload (never a whole-job payload). */
export interface ChunkCommit {
  jobId: string;
  workerId: string;
  jobVersion: number;
  chunkIndex: number;
  chunkHash: string;
  rowOffsetStart: number;
  rowOffsetEnd: number;
  counters: { staged: number; duplicates: number; conflicts: number; rejected: number; evidenceCreated: number };
  dedupScope: string;
  dedupKeys: string[];           // new record hashes
  /** New first-seen (product,source-category) keys → price, for durable conflict detection. */
  productKeys: { key: string; price: number; draftRef: string }[];
  draftRefs: { draftRef: string; recordHash: string; conflictState: string }[];
  evidenceRefs: { evidenceRef: string; recordHash: string }[];
  quarantine: QuarantineRecord[];
  checkpoint: { rowOffset: number; lastRecordHash: string | null; inputCursor: string | null };
  events: DurableEventRow[];
  durationMs: number;
}

export interface CommitResult { committed: boolean; alreadyCommitted: boolean; jobVersion: number; }

export interface CreateJobInputDurable {
  id: string;
  sourceId: string;
  adapterId?: string | null;
  inputRef: string;
  inputHash: string;
  inputContentType: string;
  mode: IntakeMode;
  requestedBy: string;
  priority?: number;
  totalBytes?: number | null;
  estimatedRows?: number | null;
  maxRetries?: number;
  /** Generated-fixture marker. The deployed dev worker REFUSES anything else. */
  isFixture?: boolean;
  traceId?: string | null;
}

export class StaleWorkerError extends Error {
  constructor(message: string) { super(message); this.name = "StaleWorkerError"; }
}
export class IntegrityError extends Error {
  constructor(message: string) { super(message); this.name = "IntegrityError"; }
}

/** A value that may be returned synchronously (in-memory store) or awaited (Postgres store). */
export type Awaitable<T> = T | Promise<T>;

/**
 * The durable store contract. The in-memory reference store (synchronous) and the
 * real `PostgresDurableIntakeStore` (async, Supabase RPCs) implement this
 * identically — callers `await` every method. Only `service_role` may call the
 * Supabase RPCs behind these methods (never the browser).
 */
export interface DurableIntakeStore {
  createJob(input: CreateJobInputDurable, nowIso: string): Awaitable<DurableJobRow>;
  getJob(jobId: string): Awaitable<DurableJobRow | undefined>;
  listJobs(): Awaitable<DurableJobRow[]>;

  /** Atomically claim the next queued/expired job (FOR UPDATE SKIP LOCKED semantics). */
  claimNextJob(workerId: string, leaseSeconds: number, nowIso: string): Awaitable<DurableJobRow | null>;
  /** Claim/renew a specific job's lease; throws StaleWorkerError if not the owner or version stale. */
  claimJob(jobId: string, workerId: string, leaseSeconds: number, nowIso: string): Awaitable<DurableJobRow>;
  renewLease(jobId: string, workerId: string, leaseSeconds: number, jobVersion: number, nowIso: string): Awaitable<WorkerLeaseRow>;
  getLease(jobId: string): Awaitable<WorkerLeaseRow | undefined>;

  loadCheckpoint(jobId: string): Awaitable<CheckpointRow | undefined>;
  loadDedupScope(scope: string): Awaitable<Set<string>>;
  /** Durable (product,source-category)→price index for cross-chunk/resume conflict detection. */
  loadProductIndex(scope: string): Awaitable<Record<string, { price: number; draftRef: string }>>;

  /** Atomic chunk commit: all-or-nothing. Idempotent on (jobId, chunkIndex). */
  commitChunk(commit: ChunkCommit, nowIso: string): Awaitable<CommitResult>;

  requestPause(jobId: string, nowIso: string): Awaitable<DurableJobRow>;
  requestResume(jobId: string, nowIso: string): Awaitable<DurableJobRow>;
  requestCancel(jobId: string, nowIso: string): Awaitable<DurableJobRow>;
  markFailed(jobId: string, workerId: string, jobVersion: number, code: string, messageSanitized: string, nowIso: string): Awaitable<DurableJobRow>;
  finalize(jobId: string, workerId: string, jobVersion: number, status: DurableJobStatus, nowIso: string): Awaitable<DurableJobRow>;

  listChunks(jobId: string): Awaitable<ChunkRow[]>;
  listQuarantine(jobId: string): Awaitable<QuarantineRecord[]>;
  listEvents(jobId: string): Awaitable<DurableEventRow[]>;
  listDrafts(jobId: string): Awaitable<{ draftRef: string; recordHash: string; conflictState: string }[]>;
}

/** Counter reconciliation summary (durable source of truth). */
export interface ReconciliationSummary {
  jobId: string;
  processedRows: number;
  validRows: number;
  rejectedRows: number;
  duplicateRows: number;
  conflictRows: number;
  stagedDrafts: number;
  evidenceCreated: number;
  committedChunks: number;
  quarantineRows: number;
  dedupKeys: number;
  checkpointRowOffset: number | null;
  reconciles: boolean;
}
