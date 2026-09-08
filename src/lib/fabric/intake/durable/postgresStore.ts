/**
 * PostgresDurableIntakeStore — the real durable store.
 *
 * Implements the SAME `DurableIntakeStore` contract as the in-memory reference
 * store, backed by the service-role-only RPCs in migrations 033 + 034 and bounded
 * table reads. The in-memory store stays the fast reference implementation; this
 * one is the production shape.
 *
 * Design rules this file exists to honour:
 *   - Multi-step atomic behaviour is NEVER emulated here. Chunk commit, claim,
 *     finalize and fail are single RPCs so Postgres owns the transaction.
 *   - It talks to an injected `PostgresGateway`, not to `@supabase/supabase-js`.
 *     That keeps this module pure (no network client, no process.env, no secrets),
 *     unit-testable against a fake gateway with no database, and it means the
 *     service-role key only ever exists in the backend adapter that constructs it.
 *   - Reads are bounded and paged; a job never loads an unbounded result set.
 *   - Errors are classified (transient vs permanent vs stale-worker) and sanitized
 *     before they leave this module — no SQL text, no connection strings, no keys.
 *
 * NEVER constructed in browser code: it requires service-role credentials.
 */

import type { QuarantineRecord } from "../types";
import type {
  DurableIntakeStore, DurableJobRow, DurableJobStatus, WorkerLeaseRow, ChunkRow, CheckpointRow,
  ChunkCommit, CommitResult, CreateJobInputDurable, DurableEventRow, ReconciliationSummary,
} from "./durableTypes";
import { StaleWorkerError, IntegrityError } from "./durableTypes";

// ── Gateway ──────────────────────────────────────────────────────────────────

export type DbFilter = Record<string, string | number | boolean | null>;
export interface DbSelectOptions { orderBy?: string; ascending?: boolean; limit?: number; offset?: number; }

/**
 * The narrow database surface this store needs. The backend adapter implements it
 * over a service-role Supabase client; tests implement it with an in-memory fake.
 */
export interface PostgresGateway {
  /** Call a service-role-only RPC. Must reject with the raw driver error. */
  rpc(fn: string, args: Record<string, unknown>): Promise<unknown>;
  /** Bounded table read. Must reject with the raw driver error. */
  selectRows(table: string, filter: DbFilter, options?: DbSelectOptions): Promise<Record<string, unknown>[]>;
}

// ── Errors ───────────────────────────────────────────────────────────────────

/** A classified, sanitized database failure. `retryable` drives bounded worker retry. */
export class DbError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  constructor(code: string, message: string, retryable: boolean) {
    super(message); this.name = "DbError"; this.code = code; this.retryable = retryable;
  }
}

/** Postgres/PostgREST classes that are worth retrying — everything else is permanent. */
const TRANSIENT_SQLSTATE_PREFIXES = ["08", "40", "53", "57", "58"]; // connection, serialization/deadlock, resource, operator intervention, system
const TRANSIENT_TEXT = /(timeout|timed out|econnreset|econnrefused|etimedout|socket hang up|fetch failed|network|temporarily unavailable|too many connections|deadlock|could not serialize)/i;

/** Strip anything that could carry SQL text, payloads, URLs or secrets out of an error. */
function sanitizeDbMessage(raw: string): string {
  return raw
    .replace(/https?:\/\/\S+/gi, "[url]")
    .replace(/gs:\/\/\S+/gi, "[gs-ref]")
    .replace(/eyJ[A-Za-z0-9._-]{10,}/g, "[token]")   // JWT-shaped (service-role keys are JWTs)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

/**
 * Classify a driver error. `stale_worker:` is raised by our own RPCs when another
 * worker owns the lease or the version moved — the worker must abort, not retry.
 */
export function classifyDbError(err: unknown): DbError | StaleWorkerError | IntegrityError {
  const e = (err ?? {}) as { message?: string; code?: string; details?: string };
  const raw = String(e.message ?? err ?? "unknown database error");
  const code = String(e.code ?? "");

  if (/stale_worker/i.test(raw)) return new StaleWorkerError(sanitizeDbMessage(raw));
  if (/Durable worker is currently restricted to generated development fixtures/i.test(raw)) {
    return new DbError("fixture_only", "Durable worker is currently restricted to generated development fixtures.", false);
  }
  if (/unknown job/i.test(raw)) return new DbError("unknown_job", "Unknown job.", false);
  if (/chunk too large/i.test(raw)) return new IntegrityError("Chunk payload exceeded the bounded commit size.");

  const transient = TRANSIENT_SQLSTATE_PREFIXES.some((p) => code.startsWith(p)) || TRANSIENT_TEXT.test(raw);
  return new DbError(code || (transient ? "transient" : "permanent"), sanitizeDbMessage(raw), transient);
}

// ── Validation ───────────────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const WORKER_RE = /^[A-Za-z0-9_-]{1,80}$/;

function assertUuid(value: string, name: string): string {
  if (!UUID_RE.test(value)) throw new DbError("invalid_id", `Invalid ${name}.`, false);
  return value;
}
function assertWorker(workerId: string): string {
  if (!WORKER_RE.test(workerId)) throw new DbError("invalid_worker", "Invalid worker id.", false);
  return workerId;
}

/** Page size for every scope read. A job never issues an unbounded select. */
export const DURABLE_PAGE_SIZE = 1000;
/** Hard ceiling on a single scope read, so a poisoned scope cannot exhaust memory. */
export const DURABLE_MAX_SCOPE_ROWS = 500_000;

// ── Row mapping (snake_case → the shared camelCase contract) ──────────────────

const s = (v: unknown): string => String(v ?? "");
const sn = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const n = (v: unknown): number => Number(v ?? 0);
const nn = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

function toJobRow(r: Record<string, unknown>): DurableJobRow {
  return {
    id: s(r.id), sourceId: s(r.source_id), adapterId: sn(r.adapter_id),
    inputRef: s(r.input_ref), inputHash: s(r.input_hash), inputContentType: s(r.input_content_type),
    mode: s(r.mode) as DurableJobRow["mode"], status: s(r.status) as DurableJobStatus,
    requestedBy: s(r.requested_by), priority: n(r.priority),
    totalBytes: nn(r.total_bytes), estimatedRows: nn(r.estimated_rows),
    processedRows: n(r.processed_rows), validRows: n(r.valid_rows), rejectedRows: n(r.rejected_rows),
    duplicateRows: n(r.duplicate_rows), conflictRows: n(r.conflict_rows),
    stagedDrafts: n(r.staged_drafts), evidenceCreated: n(r.evidence_created),
    retryCount: n(r.retry_count), maxRetries: n(r.max_retries),
    currentChunkIndex: n(r.current_chunk_index), currentRowOffset: n(r.current_row_offset),
    lastRecordHash: sn(r.last_record_hash),
    cancellationRequestedAt: sn(r.cancellation_requested_at), pausedAt: sn(r.paused_at),
    startedAt: sn(r.started_at), completedAt: sn(r.completed_at), failedAt: sn(r.failed_at),
    failureCode: sn(r.failure_code), failureMessageSanitized: sn(r.failure_message_sanitized),
    createdAt: s(r.created_at), updatedAt: s(r.updated_at), version: n(r.version),
  };
}

function toLeaseRow(r: Record<string, unknown>): WorkerLeaseRow {
  return { jobId: s(r.job_id), workerId: s(r.worker_id), claimedAt: s(r.claimed_at), leaseExpiresAt: s(r.lease_expires_at), heartbeatAt: s(r.heartbeat_at) };
}
function toChunkRow(r: Record<string, unknown>): ChunkRow {
  return {
    jobId: s(r.job_id), chunkIndex: n(r.chunk_index), chunkHash: s(r.chunk_hash),
    rowOffsetStart: n(r.row_offset_start), rowOffsetEnd: n(r.row_offset_end),
    staged: n(r.staged), duplicates: n(r.duplicates), conflicts: n(r.conflicts), rejected: n(r.rejected),
    evidenceCreated: n(r.evidence_created), durationMs: n(r.duration_ms), workerId: s(r.worker_id), committedAt: s(r.committed_at),
  };
}
function toCheckpointRow(r: Record<string, unknown>): CheckpointRow {
  return {
    jobId: s(r.job_id), chunkIndex: n(r.chunk_index), rowOffset: n(r.row_offset),
    lastRecordHash: sn(r.last_record_hash), inputCursor: sn(r.input_cursor),
    committedAt: s(r.committed_at), workerId: s(r.worker_id), jobVersion: n(r.job_version),
  };
}
function toEventRow(r: Record<string, unknown>): DurableEventRow {
  return {
    eventId: s(r.event_id), jobId: s(r.job_id), workerId: sn(r.worker_id),
    eventType: s(r.event_type) as DurableEventRow["eventType"], chunkIndex: nn(r.chunk_index),
    countsDelta: (r.counts_delta as Record<string, number> | null) ?? null,
    traceId: s(r.trace_id), createdAt: s(r.created_at),
    metadata: (r.metadata as Record<string, unknown>) ?? {},
  };
}
function toQuarantineRecord(r: Record<string, unknown>): QuarantineRecord {
  return {
    id: s(r.id), jobId: s(r.job_id), recordIndex: n(r.record_index), sourceRef: s(r.source_ref),
    excerpt: s(r.excerpt), recordHash: sn(r.record_hash) ?? undefined,
    errorClass: s(r.error_class) as QuarantineRecord["errorClass"],
    errorCodes: (r.error_codes as string[]) ?? [], warnings: [],
    retryable: Boolean(r.retryable), disposition: s(r.disposition) as QuarantineRecord["disposition"],
    attempts: 0, createdAt: s(r.created_at),
  } as QuarantineRecord;
}

// ── Store ────────────────────────────────────────────────────────────────────

export interface PostgresStoreOptions {
  gateway: PostgresGateway;
  /** When true, `createJob` refuses any job not marked as a generated fixture. */
  fixtureOnlyMode: boolean;
}

export class PostgresDurableIntakeStore implements DurableIntakeStore {
  private readonly db: PostgresGateway;
  private readonly fixtureOnlyMode: boolean;

  constructor(opts: PostgresStoreOptions) {
    this.db = opts.gateway;
    this.fixtureOnlyMode = opts.fixtureOnlyMode;
  }

  /** Every database call funnels through here so no raw driver error ever escapes. */
  private async call<T>(fn: () => Promise<T>): Promise<T> {
    try { return await fn(); } catch (err) { throw classifyDbError(err); }
  }

  private async rpcRow(fn: string, args: Record<string, unknown>): Promise<Record<string, unknown> | null> {
    const data = await this.call(() => this.db.rpc(fn, args));
    if (data === null || data === undefined) return null;
    const row = Array.isArray(data) ? data[0] : data;
    return (row ?? null) as Record<string, unknown> | null;
  }

  /** Page through a scope-wide read with a hard ceiling. */
  private async selectAll(table: string, filter: DbFilter, orderBy: string): Promise<Record<string, unknown>[]> {
    const out: Record<string, unknown>[] = [];
    for (let offset = 0; offset < DURABLE_MAX_SCOPE_ROWS; offset += DURABLE_PAGE_SIZE) {
      const page = await this.call(() => this.db.selectRows(table, filter, { orderBy, ascending: true, limit: DURABLE_PAGE_SIZE, offset }));
      out.push(...page);
      if (page.length < DURABLE_PAGE_SIZE) return out;
    }
    throw new IntegrityError(`${table} scope exceeded ${DURABLE_MAX_SCOPE_ROWS} rows.`);
  }

  // — Job lifecycle —

  async createJob(input: CreateJobInputDurable, _nowIso: string): Promise<DurableJobRow> {
    assertUuid(input.sourceId, "sourceId");
    // The fixture guard is enforced in the RPC (the database is the boundary), and
    // again here so a misconfigured caller fails before it ever reaches the wire.
    if (this.fixtureOnlyMode && input.isFixture !== true) {
      throw new DbError("fixture_only", "Durable worker is currently restricted to generated development fixtures.", false);
    }
    const row = await this.rpcRow("create_intake_job", {
      p_source_id: input.sourceId,
      p_input_ref: input.inputRef,
      p_input_hash: input.inputHash,
      p_input_content_type: input.inputContentType,
      p_mode: input.mode,
      p_requested_by: input.requestedBy,
      p_estimated_rows: input.estimatedRows ?? null,
      p_total_bytes: input.totalBytes ?? null,
      p_max_retries: input.maxRetries ?? 3,
      p_priority: input.priority ?? 0,
      p_is_fixture: input.isFixture === true,
      p_trace_id: input.traceId ?? null,
      p_fixture_only_mode: this.fixtureOnlyMode,
    });
    if (!row) throw new DbError("create_failed", "Job creation returned no row.", false);
    return toJobRow(row);
  }

  async getJob(jobId: string): Promise<DurableJobRow | undefined> {
    assertUuid(jobId, "jobId");
    const rows = await this.call(() => this.db.selectRows("retail_intake_jobs", { id: jobId }, { limit: 1 }));
    return rows[0] ? toJobRow(rows[0]) : undefined;
  }

  async listJobs(): Promise<DurableJobRow[]> {
    const rows = await this.call(() => this.db.selectRows("retail_intake_jobs", {}, { orderBy: "created_at", ascending: false, limit: 200 }));
    return rows.map(toJobRow);
  }

  async claimNextJob(workerId: string, leaseSeconds: number, _nowIso: string): Promise<DurableJobRow | null> {
    assertWorker(workerId);
    const row = await this.rpcRow("claim_next_intake_job", { p_worker_id: workerId, p_lease_seconds: leaseSeconds });
    return row && row.id ? toJobRow(row) : null;   // no eligible job → null, not an error
  }

  async claimJob(jobId: string, workerId: string, leaseSeconds: number, _nowIso: string): Promise<DurableJobRow> {
    assertUuid(jobId, "jobId"); assertWorker(workerId);
    const row = await this.rpcRow("claim_intake_job", { p_job_id: jobId, p_worker_id: workerId, p_lease_seconds: leaseSeconds });
    if (!row) throw new DbError("claim_failed", "Claim returned no row.", false);
    return toJobRow(row);
  }

  async renewLease(jobId: string, workerId: string, leaseSeconds: number, jobVersion: number, _nowIso: string): Promise<WorkerLeaseRow> {
    assertUuid(jobId, "jobId"); assertWorker(workerId);
    // Throws StaleWorkerError (via classify) when the lease or version moved on.
    await this.call(() => this.db.rpc("renew_intake_lease", { p_job_id: jobId, p_worker_id: workerId, p_lease_seconds: leaseSeconds, p_job_version: jobVersion }));
    const lease = await this.getLease(jobId);
    if (!lease) throw new IntegrityError("Lease renewed but no lease row exists.");
    return lease;
  }

  async getLease(jobId: string): Promise<WorkerLeaseRow | undefined> {
    assertUuid(jobId, "jobId");
    const rows = await this.call(() => this.db.selectRows("retail_intake_worker_leases", { job_id: jobId }, { limit: 1 }));
    return rows[0] ? toLeaseRow(rows[0]) : undefined;
  }

  // — Resume state —

  async loadCheckpoint(jobId: string): Promise<CheckpointRow | undefined> {
    assertUuid(jobId, "jobId");
    const rows = await this.call(() => this.db.selectRows("retail_intake_checkpoints", { job_id: jobId }, { limit: 1 }));
    return rows[0] ? toCheckpointRow(rows[0]) : undefined;
  }

  async loadDedupScope(scope: string): Promise<Set<string>> {
    const rows = await this.selectAll("retail_intake_dedup_keys", { scope }, "record_hash");
    return new Set(rows.map((r) => s(r.record_hash)));
  }

  async loadProductIndex(scope: string): Promise<Record<string, { price: number; draftRef: string }>> {
    const rows = await this.selectAll("retail_intake_product_index", { scope }, "product_key");
    const out: Record<string, { price: number; draftRef: string }> = {};
    for (const r of rows) out[s(r.product_key)] = { price: Number(r.price), draftRef: s(r.draft_ref) };
    return out;
  }

  // — Atomic chunk commit —

  /**
   * One RPC, one transaction. The commit payload is remapped to the RPC's bounded
   * jsonb shape; quarantine excerpts are already sanitized upstream and are further
   * truncated by the RPC. Idempotent on (jobId, chunkIndex) — a replayed chunk
   * returns `alreadyCommitted` rather than double-counting.
   */
  async commitChunk(commit: ChunkCommit, _nowIso: string): Promise<CommitResult> {
    assertUuid(commit.jobId, "jobId"); assertWorker(commit.workerId);
    const payload = {
      chunkIndex: commit.chunkIndex,
      chunkHash: commit.chunkHash,
      rowOffsetStart: commit.rowOffsetStart,
      rowOffsetEnd: commit.rowOffsetEnd,
      durationMs: commit.durationMs,
      counters: commit.counters,
      dedupScope: commit.dedupScope,
      dedupRefs: commit.dedupKeys.map((h) => ({
        record_hash: h,
        draft_ref: commit.draftRefs.find((d) => d.recordHash === h)?.draftRef ?? `q_${commit.jobId}_${h.slice(0, 12)}`,
      })),
      productKeys: commit.productKeys.map((p) => ({ key: p.key, price: p.price, draft_ref: p.draftRef })),
      draftRefs: commit.draftRefs.map((d) => ({ draft_ref: d.draftRef, record_hash: d.recordHash, conflict_state: d.conflictState })),
      quarantine: commit.quarantine.map((q) => ({
        record_index: q.recordIndex, source_ref: q.sourceRef, excerpt: q.excerpt,
        record_hash: q.recordHash ?? null, error_class: q.errorClass,
        error_codes: q.errorCodes ?? [], retryable: q.retryable,
      })),
      checkpoint: commit.checkpoint,
    };

    const data = await this.call(() => this.db.rpc("commit_intake_chunk", {
      p_job_id: commit.jobId, p_worker_id: commit.workerId, p_job_version: commit.jobVersion, p_chunk: payload,
    })) as { committed?: boolean; already_committed?: boolean; job_version?: number } | null;

    if (!data) throw new IntegrityError("Chunk commit returned no result.");
    return {
      committed: data.committed === true,
      alreadyCommitted: data.already_committed === true,
      jobVersion: Number(data.job_version ?? commit.jobVersion),
    };
  }

  // — Control —

  private async control(jobId: string, action: "pause" | "resume" | "cancel"): Promise<DurableJobRow> {
    assertUuid(jobId, "jobId");
    const row = await this.rpcRow("set_intake_job_control", { p_job_id: jobId, p_action: action });
    if (!row) throw new DbError("unknown_job", "Unknown job.", false);
    return toJobRow(row);
  }
  requestPause(jobId: string, _nowIso: string): Promise<DurableJobRow> { return this.control(jobId, "pause"); }
  requestResume(jobId: string, _nowIso: string): Promise<DurableJobRow> { return this.control(jobId, "resume"); }
  requestCancel(jobId: string, _nowIso: string): Promise<DurableJobRow> { return this.control(jobId, "cancel"); }

  async markFailed(jobId: string, workerId: string, jobVersion: number, code: string, messageSanitized: string, _nowIso: string): Promise<DurableJobRow> {
    assertUuid(jobId, "jobId"); assertWorker(workerId);
    const row = await this.rpcRow("fail_intake_job", {
      p_job_id: jobId, p_worker_id: workerId, p_job_version: jobVersion,
      p_code: code.slice(0, 80), p_message_sanitized: sanitizeDbMessage(messageSanitized),
    });
    if (!row) throw new DbError("unknown_job", "Unknown job.", false);
    return toJobRow(row);
  }

  async finalize(jobId: string, workerId: string, jobVersion: number, status: DurableJobStatus, _nowIso: string): Promise<DurableJobRow> {
    assertUuid(jobId, "jobId"); assertWorker(workerId);
    const row = await this.rpcRow("finalize_intake_job", { p_job_id: jobId, p_worker_id: workerId, p_job_version: jobVersion, p_status: status });
    if (!row) throw new DbError("unknown_job", "Unknown job.", false);
    return toJobRow(row);
  }

  // — Bounded reads —

  async listChunks(jobId: string): Promise<ChunkRow[]> {
    assertUuid(jobId, "jobId");
    const rows = await this.selectAll("retail_intake_job_chunks", { job_id: jobId }, "chunk_index");
    return rows.map(toChunkRow);
  }
  async listQuarantine(jobId: string): Promise<QuarantineRecord[]> {
    assertUuid(jobId, "jobId");
    const rows = await this.call(() => this.db.selectRows("retail_intake_quarantine", { job_id: jobId }, { orderBy: "record_index", ascending: true, limit: DURABLE_PAGE_SIZE }));
    return rows.map(toQuarantineRecord);
  }
  async listEvents(jobId: string): Promise<DurableEventRow[]> {
    assertUuid(jobId, "jobId");
    const rows = await this.call(() => this.db.selectRows("retail_intake_events", { job_id: jobId }, { orderBy: "created_at", ascending: true, limit: DURABLE_PAGE_SIZE }));
    return rows.map(toEventRow);
  }
  async listDrafts(jobId: string): Promise<{ draftRef: string; recordHash: string; conflictState: string }[]> {
    assertUuid(jobId, "jobId");
    const rows = await this.selectAll("retail_intake_job_drafts", { job_id: jobId }, "draft_ref");
    return rows.map((r) => ({ draftRef: s(r.draft_ref), recordHash: s(r.record_hash), conflictState: s(r.conflict_state) }));
  }

  /**
   * Durable counter reconciliation — the database, not the worker's memory, is the
   * source of truth. `reconciles: false` is a BLOCKER, never a warning.
   */
  async reconcile(jobId: string): Promise<ReconciliationSummary> {
    assertUuid(jobId, "jobId");
    const data = await this.call(() => this.db.rpc("intake_job_reconciliation", { p_job_id: jobId })) as Record<string, unknown> | null;
    if (!data) throw new DbError("unknown_job", "Unknown job.", false);
    return {
      jobId: s(data.jobId), processedRows: n(data.processedRows), validRows: n(data.validRows),
      rejectedRows: n(data.rejectedRows), duplicateRows: n(data.duplicateRows), conflictRows: n(data.conflictRows),
      stagedDrafts: n(data.stagedDrafts), evidenceCreated: n(data.evidenceCreated),
      committedChunks: n(data.committedChunks), quarantineRows: n(data.quarantineRows), dedupKeys: n(data.dedupKeys),
      checkpointRowOffset: nn(data.checkpointRowOffset), reconciles: data.reconciles === true,
    };
  }
}
