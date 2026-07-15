/**
 * Durable intake worker orchestrator.
 *
 * Claims/renews a lease, validates the input object reference, resumes from the
 * durable checkpoint, streams records, processes bounded chunks through the
 * EXISTING pure engine, and commits each chunk ATOMICALLY (drafts + evidence +
 * quarantine + dedup + counters + checkpoint + events in one transaction). It
 * heartbeats between chunks, honours pause/cancel, and finalizes honestly.
 *
 * Nothing publishes — the worker only ever stages drafts for review. A stale
 * worker (expired lease / stale version) fails safely; a crash before a commit
 * re-runs that chunk; a crash after a commit resumes from the durable checkpoint.
 */

import type { RawRecord, IntakeState, IntakeJob, QuarantineRecord } from "../types";
import type { SourceAccessPolicy, EvidenceRecord, OfferDraft } from "../../types";
import type { IntakeInputStore } from "../types";
import { processIntakeRecord, type RecordContext } from "../recordPipeline";
import { recordStreamFor } from "../parsers";
import { isRetryable, planRetry, MAX_RETRIES } from "../retry";
import { sanitizeExcerpt, INTAKE_LIMITS } from "../security";
import type {
  DurableIntakeStore, DurableJobRow, DurableJobStatus, ChunkCommit, DurableEventRow,
} from "./durableTypes";
import { StaleWorkerError, IntegrityError } from "./durableTypes";
import { chunkHash } from "./hashes";

export interface WorkerHooks {
  onBeforeCommit?: (chunkIndex: number) => void | Promise<void>;
  onAfterCommit?: (chunkIndex: number) => void | Promise<void>;
}

export interface RunDurableOptions {
  store: DurableIntakeStore;
  inputStore: IntakeInputStore;
  jobId: string;
  workerId: string;
  policy: SourceAccessPolicy | undefined;
  nowIso: string;
  parseMode: "csv" | "jsonl" | "json";
  leaseSeconds?: number;
  chunkSize?: number;
  hooks?: WorkerHooks;
  /** Optional injected transient-fault: throw for a chunk index to exercise retry. */
  transientFaultAt?: (chunkIndex: number) => boolean;
}

export interface RunDurableResult {
  job: DurableJobRow;
  status: DurableJobStatus;
  drafts: OfferDraft[];
  evidence: EvidenceRecord[];
}

async function* chunkedSkip(records: AsyncIterable<RawRecord>, size: number, skip: number): AsyncGenerator<{ chunk: RawRecord[]; startOffset: number }> {
  let buf: RawRecord[] = [];
  let index = 0, startOffset = skip;
  for await (const r of records) {
    if (index++ < skip) continue;
    buf.push(r);
    if (buf.length >= size) { yield { chunk: buf, startOffset }; startOffset += buf.length; buf = []; }
  }
  if (buf.length) yield { chunk: buf, startOffset };
}

interface WorkingSet { seen: Set<string>; productIndex: Record<string, { price: number; draftRef: string }>; }

/** Process one bounded chunk through the pure pipeline and build an atomic commit payload. */
function processChunkForCommit(
  chunk: RawRecord[], startOffset: number, chunkIndex: number, job: IntakeJob, policy: SourceAccessPolicy | undefined,
  working: WorkingSet, dedupScope: string, nowIso: string, workerId: string,
): { commit: Omit<ChunkCommit, "jobVersion">; drafts: OfferDraft[]; evidence: EvidenceRecord[] } {
  const state: IntakeState = {
    job, drafts: [], evidence: [], quarantine: [], events: [], chunkSummaries: [], checkpoints: [],
    metrics: {} as IntakeState["metrics"],
    seen: Object.fromEntries([...working.seen].map((h) => [h, "durable"])),
    productIndex: Object.fromEntries(Object.entries(working.productIndex).map(([k, v]) => [k, { price: v.price, draftId: v.draftRef }])),
  };
  const priorSeen = new Set(Object.keys(state.seen));
  const priorProduct = new Set(Object.keys(state.productIndex));

  let staged = 0, duplicates = 0, conflicts = 0, rejected = 0;
  const quarantine: QuarantineRecord[] = [];
  const events: DurableEventRow[] = [];
  let lastRecordHash: string | null = null;

  chunk.forEach((record, i) => {
    const ctx: RecordContext = { job, policy, state, recordIndex: startOffset + i, nowIso };
    const r = processIntakeRecord(record, ctx);
    if ("recordHash" in r && r.recordHash) lastRecordHash = r.recordHash;
    if (r.status === "staged") staged++;
    else if (r.status === "conflict") conflicts++;
    else if (r.status === "duplicate") duplicates++;
    else if (r.status === "rejected") {
      rejected++;
      if (quarantine.length < INTAKE_LIMITS.maxRows) {
        const cls = (r.errors[0]?.split(":")[0] ?? "internal") as QuarantineRecord["errorClass"];
        quarantine.push({ id: `q_${job.id}_${startOffset + i}`, jobId: job.id, recordIndex: startOffset + i, sourceRef: job.inputRef, excerpt: sanitizeExcerpt(record), recordHash: r.recordHash, errorClass: cls, errorCodes: r.errors, warnings: r.warnings, retryable: isRetryable(cls), disposition: "quarantined", attempts: 0, createdAt: nowIso });
        events.push({ eventId: `qev_${job.id}_${startOffset + i}`, jobId: job.id, workerId, eventType: "intake.record_quarantined", chunkIndex, countsDelta: null, traceId: `trace_${job.id}`, createdAt: nowIso, metadata: { index: startOffset + i, errorClass: cls } });
      }
    }
  });

  const newDedup = Object.keys(state.seen).filter((h) => !priorSeen.has(h));
  const productKeys = Object.keys(state.productIndex).filter((k) => !priorProduct.has(k)).map((k) => ({ key: k, price: state.productIndex[k].price, draftRef: state.productIndex[k].draftId }));
  const draftRefs = state.drafts.map((d) => ({ draftRef: d.id, recordHash: d.draftHash, conflictState: d.conflictState }));
  const evidenceRefs = state.drafts.map((d) => ({ evidenceRef: d.evidenceIds[0], recordHash: d.draftHash }));

  // Update the worker's working set for the next chunk.
  working.seen = new Set(Object.keys(state.seen));
  working.productIndex = Object.fromEntries(Object.entries(state.productIndex).map(([k, v]) => [k, { price: v.price, draftRef: v.draftId }]));

  const endOffset = startOffset + chunk.length;
  const commit: Omit<ChunkCommit, "jobVersion"> = {
    jobId: job.id, workerId, chunkIndex, chunkHash: chunkHash(job.id, chunkIndex, startOffset, endOffset),
    rowOffsetStart: startOffset, rowOffsetEnd: endOffset,
    counters: { staged, duplicates, conflicts, rejected, evidenceCreated: staged + conflicts },
    dedupScope, dedupKeys: newDedup, productKeys, draftRefs, evidenceRefs, quarantine,
    checkpoint: { rowOffset: endOffset, lastRecordHash, inputCursor: `row:${endOffset}` }, events, durationMs: 0,
  };
  return { commit, drafts: state.drafts, evidence: state.evidence };
}

/** Sanitize any error into a short, secret-free message. */
function sanitizeError(err: unknown): string { return (err instanceof Error ? err.message : String(err)).replace(/\s+/g, " ").slice(0, 160); }

export async function runDurableJob(opts: RunDurableOptions): Promise<RunDurableResult> {
  const { store, inputStore, jobId, workerId, policy, nowIso } = opts;
  const leaseSeconds = opts.leaseSeconds ?? 60;
  const chunkSize = Math.max(1, opts.chunkSize ?? 200);

  // 1. Claim / renew lease.
  let job = store.claimJob(jobId, workerId, leaseSeconds, nowIso);
  let version = job.version;

  // 2. Validate input reference (hash + generation + size). Fail safely if it changed.
  const meta = await inputStore.stat(job.inputRef);
  if ((meta.metadata.contentHash ?? "") && meta.metadata.contentHash !== job.inputHash) {
    const failed = store.markFailed(jobId, workerId, version, "input_changed", "Input content hash no longer matches the job.", nowIso);
    return { job: failed, status: "failed", drafts: [], evidence: [] };
  }

  // 3. Resume from the durable checkpoint.
  const checkpoint = store.loadCheckpoint(jobId);
  const rowOffset = checkpoint?.rowOffset ?? 0;
  if (checkpoint && checkpoint.rowOffset !== job.currentRowOffset) throw new IntegrityError("Checkpoint and job counters disagree.");
  const dedupScope = job.sourceId;
  const working: WorkingSet = { seen: store.loadDedupScope(dedupScope), productIndex: store.loadProductIndex(dedupScope) };

  const engineJob = { id: job.id, sourceId: job.sourceId, adapterId: job.adapterId ?? undefined, mode: job.mode, inputRef: job.inputRef } as unknown as IntakeJob;
  const chunks = await inputStore.open(job.inputRef);
  const records = recordStreamFor(opts.parseMode, chunks);

  const drafts: OfferDraft[] = [];
  const evidence: EvidenceRecord[] = [];
  let chunkIndex = checkpoint ? checkpoint.chunkIndex + 1 : 0;

  for await (const { chunk, startOffset } of chunkedSkip(records, chunkSize, rowOffset)) {
    // Honour pause / cancel at the safe chunk boundary.
    const live = store.getJob(jobId)!;
    if (live.cancellationRequestedAt) { job = store.finalize(jobId, workerId, live.version, "cancelled", nowIso); return { job, status: "cancelled", drafts, evidence }; }
    if (live.pausedAt) return { job: live, status: "paused", drafts, evidence };

    // Heartbeat (renew lease). A stale worker throws here and aborts safely.
    store.renewLease(jobId, workerId, leaseSeconds, version, nowIso);

    // Optional injected transient fault → bounded retry (does not bypass gates).
    if (opts.transientFaultAt?.(chunkIndex)) {
      const cur = store.getJob(jobId)!;
      if (cur.retryCount < cur.maxRetries) { store.markFailed(jobId, workerId, version, "transient", "Injected transient fault.", nowIso); throw new Error(`transient_fault_chunk_${chunkIndex}`); }
    }

    const t0 = Date.now();
    const built = processChunkForCommit(chunk, startOffset, chunkIndex, engineJob, policy, working, dedupScope, nowIso, workerId);
    built.commit.durationMs = Date.now() - t0;

    await opts.hooks?.onBeforeCommit?.(chunkIndex);   // crash-before-commit hook

    const result = store.commitChunk({ ...built.commit, jobVersion: version }, nowIso);
    version = result.jobVersion;
    if (result.committed) { drafts.push(...built.drafts); evidence.push(...built.evidence); }

    await opts.hooks?.onAfterCommit?.(chunkIndex);    // crash-after-commit hook (checkpoint already durable)

    chunkIndex++;
  }

  // 4. Finalize honestly.
  const finalJob = store.getJob(jobId)!;
  const status: DurableJobStatus = finalJob.rejectedRows > 0 ? "completed_with_errors" : finalJob.stagedDrafts > 0 ? "needs_review" : "completed";
  job = store.finalize(jobId, workerId, finalJob.version, status, nowIso);
  return { job, status, drafts, evidence };
}

/** Claim the next queued/expired job and run it (Cloud Run `claim-next` entrypoint). */
export async function claimNextAndRun(opts: Omit<RunDurableOptions, "jobId"> & { leaseSeconds?: number }): Promise<RunDurableResult | null> {
  const claimed = opts.store.claimNextJob(opts.workerId, opts.leaseSeconds ?? 60, opts.nowIso);
  if (!claimed) return null;
  return runDurableJob({ ...opts, jobId: claimed.id });
}

export { MAX_RETRIES, planRetry, StaleWorkerError };
