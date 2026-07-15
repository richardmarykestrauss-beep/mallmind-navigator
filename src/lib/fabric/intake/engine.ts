/**
 * Bulk intake streaming engine.
 *
 * Consumes an async iterable of records in BOUNDED chunks (never a giant in-memory
 * array), applies the controlled per-record pipeline with bounded concurrency,
 * checkpoints after each committed chunk, emits events + metrics, and resumes from
 * the last checkpoint. Nothing here publishes — output is staged drafts + evidence.
 *
 * Designed to run in a Cloud Run worker; the browser only ever drives bounded sizes.
 */

import type {
  IntakeJob, IntakeState, IntakeRunResult, IntakeRecordResult, RawRecord, ChunkSummary, QuarantineRecord, IntakeCheckpoint,
} from "./types";
import type { SourceAccessPolicy, FabricEvent } from "../types";
import { processIntakeRecord, type RecordContext } from "./recordPipeline";
import { isRetryable } from "./retry";
import { sanitizeExcerpt, INTAKE_LIMITS } from "./security";
import { makeEvent } from "../events";

export interface IntakeRunOptions {
  job: IntakeJob;
  records: AsyncIterable<RawRecord>;
  policy: SourceAccessPolicy | undefined;
  nowIso: string;
  chunkSize?: number;
  concurrency?: number;
  state?: IntakeState;                 // resume: continue an existing state
  signal?: { cancelled: boolean };     // cooperative cancellation
  sampleLimit?: number;                // bounded per-row result sample
  onResult?: (r: IntakeRecordResult, index: number) => void;
}

function emptyState(job: IntakeJob): IntakeState {
  return {
    job, drafts: [], evidence: [], quarantine: [], events: [], chunkSummaries: [], checkpoints: [],
    metrics: { rowsPerSecond: 0, bytesPerSecond: 0, chunkDurationMsAvg: 0, validationFailureRate: 0, duplicateRate: 0, conflictRate: 0, evidenceCreationRate: 0, draftCreationRate: 0, quarantineRate: 0, retryRate: 0, checkpointCount: 0, estimatedRemainingSeconds: null, peakHeapBytes: null },
    seen: {}, productIndex: {},
  };
}

function heapUsed(): number | null {
  const p = (globalThis as { process?: { memoryUsage?: () => { heapUsed: number } } }).process;
  return p?.memoryUsage ? p.memoryUsage().heapUsed : null;
}

/** Process items with a bounded number in flight, preserving input order in the output. */
async function mapBounded<T, R>(items: T[], concurrency: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = new Array(Math.max(1, Math.min(concurrency, items.length))).fill(0).map(async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) break;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

/** Chunk an async iterable into arrays of at most `size`, skipping the first `skip` records (resume). */
async function* chunked(records: AsyncIterable<RawRecord>, size: number, skip: number): AsyncGenerator<RawRecord[]> {
  let buf: RawRecord[] = [];
  let index = 0;
  for await (const r of records) {
    if (index++ < skip) continue;
    buf.push(r);
    if (buf.length >= size) { yield buf; buf = []; }
  }
  if (buf.length) yield buf;
}

export async function processIntakeStream(opts: IntakeRunOptions): Promise<IntakeRunResult> {
  const chunkSize = Math.max(1, opts.chunkSize ?? 500);
  const concurrency = Math.max(1, opts.concurrency ?? 4);
  const sampleLimit = opts.sampleLimit ?? 50;
  const state = opts.state ?? emptyState(structuredCloneJob(opts.job));
  const job = state.job;
  const startWall = Date.now();
  const sample: IntakeRecordResult[] = [];
  const emit = (e: FabricEvent) => state.events.push(e);

  const resuming = !!(opts.state && job.checkpoint);
  let chunkIndex = job.checkpoint?.chunkIndex ?? 0;
  let rowOffset = job.checkpoint?.rowOffset ?? 0;

  job.status = "processing";
  job.startedAt ??= opts.nowIso;
  job.updatedAt = opts.nowIso;
  emit(makeEvent({ type: resuming ? "intake.job_resumed" : "intake.job_started", occurredAt: opts.nowIso, sourceId: job.sourceId, payload: { jobId: job.id, resumeFrom: rowOffset } }));

  let cancelled = false;
  const chunkDurations: number[] = [];

  for await (const chunk of chunked(opts.records, chunkSize, rowOffset)) {
    if (opts.signal?.cancelled) { cancelled = true; break; }
    emit(makeEvent({ type: "intake.chunk_started", occurredAt: opts.nowIso, sourceId: job.sourceId, payload: { jobId: job.id, chunkIndex, rows: chunk.length } }));
    const t0 = Date.now();

    const results = await mapBounded(chunk, concurrency, async (record, i) => {
      const rctx: RecordContext = { job, policy: opts.policy, state, recordIndex: rowOffset + i, nowIso: opts.nowIso };
      return processIntakeRecord(record, rctx);
    });

    const summary: ChunkSummary = { chunkIndex, rows: chunk.length, staged: 0, duplicates: 0, conflicts: 0, rejected: 0, evidenceCreated: 0, durationMs: 0 };
    results.forEach((r, i) => {
      job.processedRows++;
      if (r.status === "staged") { job.validRows++; job.stagedDrafts++; job.evidenceCreated++; summary.staged++; summary.evidenceCreated++; }
      else if (r.status === "conflict") { job.validRows++; job.conflictRows++; job.stagedDrafts++; job.evidenceCreated++; summary.conflicts++; summary.evidenceCreated++; }
      else if (r.status === "duplicate") { job.duplicateRows++; summary.duplicates++; }
      else if (r.status === "rejected") {
        job.rejectedRows++; summary.rejected++;
        quarantine(state, job, rowOffset + i, chunk[i], r, opts.nowIso, emit);
      }
      if (sample.length < sampleLimit) sample.push(r);
      opts.onResult?.(r, rowOffset + i);
    });

    const dt = Date.now() - t0;
    summary.durationMs = dt;
    chunkDurations.push(dt);
    state.chunkSummaries.push(summary);

    // Commit checkpoint AFTER the chunk succeeds — a crash before this re-runs only this chunk.
    rowOffset += chunk.length;
    chunkIndex++;
    const checkpoint: IntakeCheckpoint = { chunkIndex, rowOffset, lastRecordHash: lastHash(results), updatedAt: opts.nowIso };
    job.checkpoint = checkpoint;
    state.checkpoints.push(checkpoint);
    state.metrics.peakHeapBytes = Math.max(state.metrics.peakHeapBytes ?? 0, heapUsed() ?? 0) || state.metrics.peakHeapBytes;
    job.updatedAt = opts.nowIso;
    emit(makeEvent({ type: "intake.chunk_completed", occurredAt: opts.nowIso, sourceId: job.sourceId, payload: { jobId: job.id, chunkIndex, summary } }));
    emit(makeEvent({ type: "intake.checkpoint_saved", occurredAt: opts.nowIso, sourceId: job.sourceId, payload: { jobId: job.id, rowOffset } }));
  }

  finalizeMetrics(state, startWall, chunkDurations);

  if (cancelled) {
    job.status = "cancelled";
    emit(makeEvent({ type: "intake.job_failed", occurredAt: opts.nowIso, sourceId: job.sourceId, payload: { jobId: job.id, reason: "cancelled" } }));
  } else {
    job.completedAt = opts.nowIso;
    job.status = job.rejectedRows > 0 ? "completed_with_errors" : job.stagedDrafts > 0 ? "needs_review" : "completed";
    emit(makeEvent({ type: "intake.job_completed", occurredAt: opts.nowIso, sourceId: job.sourceId, payload: { jobId: job.id, status: job.status, processed: job.processedRows } }));
  }
  job.updatedAt = opts.nowIso;
  return { state, job, sample };
}

function lastHash(results: IntakeRecordResult[]): string | undefined {
  for (let i = results.length - 1; i >= 0; i--) { const r = results[i]; if ("recordHash" in r && r.recordHash) return r.recordHash; }
  return undefined;
}

function quarantine(state: IntakeState, job: IntakeJob, index: number, record: RawRecord, result: Extract<IntakeRecordResult, { status: "rejected" }>, nowIso: string, emit: (e: FabricEvent) => void): void {
  if (state.quarantine.length >= INTAKE_LIMITS.maxRows) return; // never unbounded
  const errorClass = (result.errors[0]?.split(":")[0] ?? "internal") as QuarantineRecord["errorClass"];
  const q: QuarantineRecord = {
    id: `q_${job.id}_${index}`, jobId: job.id, recordIndex: index, sourceRef: job.inputRef,
    excerpt: sanitizeExcerpt(record), recordHash: result.recordHash, errorClass,
    errorCodes: result.errors, warnings: result.warnings, retryable: isRetryable(errorClass),
    disposition: "quarantined", attempts: 0, createdAt: nowIso,
  };
  state.quarantine.push(q);
  emit(makeEvent({ type: "intake.record_quarantined", occurredAt: nowIso, sourceId: job.sourceId, payload: { jobId: job.id, index, errorClass } }));
}

function finalizeMetrics(state: IntakeState, startWall: number, chunkDurations: number[]): void {
  const j = state.job;
  const elapsedSec = Math.max(0.001, (Date.now() - startWall) / 1000);
  const m = state.metrics;
  m.rowsPerSecond = Math.round(j.processedRows / elapsedSec);
  m.bytesPerSecond = j.totalBytes ? Math.round(j.totalBytes / elapsedSec) : 0;
  m.chunkDurationMsAvg = chunkDurations.length ? Math.round(chunkDurations.reduce((a, b) => a + b, 0) / chunkDurations.length) : 0;
  const p = j.processedRows || 1;
  m.validationFailureRate = round(j.rejectedRows / p);
  m.duplicateRate = round(j.duplicateRows / p);
  m.conflictRate = round(j.conflictRows / p);
  m.evidenceCreationRate = round(j.evidenceCreated / p);
  m.draftCreationRate = round(j.stagedDrafts / p);
  m.quarantineRate = round(state.quarantine.length / p);
  m.retryRate = round(j.retryCount / p);
  m.checkpointCount = state.checkpoints.length;
  m.estimatedRemainingSeconds = j.estimatedRows && j.estimatedRows > j.processedRows ? Math.round((j.estimatedRows - j.processedRows) / Math.max(1, m.rowsPerSecond)) : 0;
}
const round = (n: number) => Math.round(n * 1000) / 1000;

function structuredCloneJob(job: IntakeJob): IntakeJob { return JSON.parse(JSON.stringify(job)); }
