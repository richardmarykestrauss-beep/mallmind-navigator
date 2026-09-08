/**
 * InMemoryDurableStore — a Postgres-FAITHFUL reference implementation of the
 * durable intake store.
 *
 * It enforces the same invariants the migration + RPCs enforce in Postgres:
 *   • atomic chunk commit (all-or-nothing; validate first, then apply together)
 *   • unique (job_id, chunk_index) → idempotent chunk replay
 *   • unique dedup key (scope, record_hash) → evidence/drafts never multiply
 *   • optimistic `version` guard → a stale worker cannot commit
 *   • lease atomicity + expiry → only one live owner
 *
 * The crash-recovery harness runs against this store, so the recovery guarantees
 * are proven deterministically without a live database.
 */

import type { QuarantineRecord } from "../types";
import type {
  DurableIntakeStore, DurableJobRow, WorkerLeaseRow, ChunkRow, CheckpointRow, DurableEventRow,
  ChunkCommit, CommitResult, CreateJobInputDurable, DurableJobStatus,
} from "./durableTypes";
import { StaleWorkerError, IntegrityError } from "./durableTypes";

const RECLAIMABLE: ReadonlySet<DurableJobStatus> = new Set<DurableJobStatus>(["queued", "claimed", "validating", "processing", "paused"]);

export class InMemoryDurableStore implements DurableIntakeStore {
  private jobs = new Map<string, DurableJobRow>();
  private leases = new Map<string, WorkerLeaseRow>();
  private chunks = new Map<string, ChunkRow[]>();
  private committedChunkIx = new Map<string, Set<number>>();
  private checkpoints = new Map<string, CheckpointRow>();
  private quarantine = new Map<string, QuarantineRecord[]>();
  private events = new Map<string, DurableEventRow[]>();
  private dedup = new Map<string, Set<string>>();
  private productIndex = new Map<string, Map<string, { price: number; draftRef: string }>>();
  private draftRefs = new Map<string, { draftRef: string; recordHash: string; conflictState: string }[]>();
  private evidenceRefs = new Map<string, { evidenceRef: string; recordHash: string }[]>();

  private arr<T>(m: Map<string, T[]>, k: string): T[] { let a = m.get(k); if (!a) { a = []; m.set(k, a); } return a; }
  private leaseExpired(l: WorkerLeaseRow | undefined, nowIso: string): boolean { return !l || Date.parse(l.leaseExpiresAt) <= Date.parse(nowIso); }

  createJob(input: CreateJobInputDurable, nowIso: string): DurableJobRow {
    if (this.jobs.has(input.id)) return this.jobs.get(input.id)!; // idempotent create (duplicate submission)
    const job: DurableJobRow = {
      id: input.id, sourceId: input.sourceId, adapterId: input.adapterId ?? null, inputRef: input.inputRef,
      inputHash: input.inputHash, inputContentType: input.inputContentType, mode: input.mode, status: "queued",
      requestedBy: input.requestedBy, priority: input.priority ?? 0, totalBytes: input.totalBytes ?? null,
      estimatedRows: input.estimatedRows ?? null, processedRows: 0, validRows: 0, rejectedRows: 0, duplicateRows: 0,
      conflictRows: 0, stagedDrafts: 0, evidenceCreated: 0, retryCount: 0, maxRetries: input.maxRetries ?? 3,
      currentChunkIndex: 0, currentRowOffset: 0, lastRecordHash: null, cancellationRequestedAt: null, pausedAt: null,
      startedAt: null, completedAt: null, failedAt: null, failureCode: null, failureMessageSanitized: null,
      createdAt: nowIso, updatedAt: nowIso, version: 1,
    };
    this.jobs.set(job.id, job);
    this.pushEvent(job.id, null, "intake.job_created", nowIso);
    return { ...job };
  }

  getJob(jobId: string): DurableJobRow | undefined { const j = this.jobs.get(jobId); return j ? { ...j } : undefined; }
  listJobs(): DurableJobRow[] { return [...this.jobs.values()].map((j) => ({ ...j })); }
  getLease(jobId: string): WorkerLeaseRow | undefined { const l = this.leases.get(jobId); return l ? { ...l } : undefined; }

  claimNextJob(workerId: string, leaseSeconds: number, nowIso: string): DurableJobRow | null {
    // FOR UPDATE SKIP LOCKED analogue: first reclaimable job with no live lease, by priority then creation.
    const candidates = [...this.jobs.values()]
      .filter((j) => RECLAIMABLE.has(j.status) && j.cancellationRequestedAt == null && this.leaseExpired(this.leases.get(j.id), nowIso))
      .sort((a, b) => b.priority - a.priority || Date.parse(a.createdAt) - Date.parse(b.createdAt));
    const job = candidates[0];
    if (!job) return null;
    return this.claimJob(job.id, workerId, leaseSeconds, nowIso);
  }

  claimJob(jobId: string, workerId: string, leaseSeconds: number, nowIso: string): DurableJobRow {
    const job = this.jobs.get(jobId);
    if (!job) throw new IntegrityError(`Unknown job ${jobId}`);
    const lease = this.leases.get(jobId);
    if (lease && !this.leaseExpired(lease, nowIso) && lease.workerId !== workerId) throw new StaleWorkerError(`Job ${jobId} is leased by ${lease.workerId}`);
    const expiresAt = new Date(Date.parse(nowIso) + leaseSeconds * 1000).toISOString();
    this.leases.set(jobId, { jobId, workerId, claimedAt: nowIso, leaseExpiresAt: expiresAt, heartbeatAt: nowIso });
    job.status = job.status === "queued" ? "claimed" : job.status;
    job.startedAt ??= nowIso;
    job.version++; job.updatedAt = nowIso;
    this.pushEvent(jobId, workerId, "intake.job_claimed", nowIso);
    return { ...job };
  }

  renewLease(jobId: string, workerId: string, leaseSeconds: number, jobVersion: number, nowIso: string): WorkerLeaseRow {
    const job = this.jobs.get(jobId);
    if (!job) throw new IntegrityError(`Unknown job ${jobId}`);
    if (job.version !== jobVersion) throw new StaleWorkerError(`Version mismatch for ${jobId} (have ${jobVersion}, is ${job.version})`);
    const lease = this.leases.get(jobId);
    if (!lease || lease.workerId !== workerId || this.leaseExpired(lease, nowIso)) throw new StaleWorkerError(`Lease not held by ${workerId}`);
    lease.leaseExpiresAt = new Date(Date.parse(nowIso) + leaseSeconds * 1000).toISOString();
    lease.heartbeatAt = nowIso;
    this.pushEvent(jobId, workerId, "intake.lease_renewed", nowIso);
    return { ...lease };
  }

  loadCheckpoint(jobId: string): CheckpointRow | undefined { const c = this.checkpoints.get(jobId); return c ? { ...c } : undefined; }
  loadDedupScope(scope: string): Set<string> { return new Set(this.dedup.get(scope) ?? []); }
  loadProductIndex(scope: string): Record<string, { price: number; draftRef: string }> {
    const m = this.productIndex.get(scope); const out: Record<string, { price: number; draftRef: string }> = {};
    if (m) for (const [k, v] of m) out[k] = { ...v };
    return out;
  }

  commitChunk(commit: ChunkCommit, nowIso: string): CommitResult {
    const job = this.jobs.get(commit.jobId);
    if (!job) throw new IntegrityError(`Unknown job ${commit.jobId}`);
    const lease = this.leases.get(commit.jobId);
    if (!lease || lease.workerId !== commit.workerId || this.leaseExpired(lease, nowIso)) throw new StaleWorkerError(`Worker ${commit.workerId} does not hold a live lease on ${commit.jobId}`);
    if (job.version !== commit.jobVersion) throw new StaleWorkerError(`Stale version on ${commit.jobId} (have ${commit.jobVersion}, is ${job.version})`);

    // Idempotent: a chunk already committed (crash-after-commit replay / overlapping retry) is a no-op.
    const seen = this.committedChunkIx.get(commit.jobId) ?? new Set<number>();
    if (seen.has(commit.chunkIndex)) return { committed: false, alreadyCommitted: true, jobVersion: job.version };

    // ── Atomic apply (validate above; mutate together below) ──
    seen.add(commit.chunkIndex); this.committedChunkIx.set(commit.jobId, seen);
    this.arr(this.chunks, commit.jobId).push({
      jobId: commit.jobId, chunkIndex: commit.chunkIndex, chunkHash: commit.chunkHash,
      rowOffsetStart: commit.rowOffsetStart, rowOffsetEnd: commit.rowOffsetEnd,
      staged: commit.counters.staged, duplicates: commit.counters.duplicates, conflicts: commit.counters.conflicts,
      rejected: commit.counters.rejected, evidenceCreated: commit.counters.evidenceCreated,
      durationMs: commit.durationMs, workerId: commit.workerId, committedAt: nowIso,
    });
    const scopeSet = this.dedup.get(commit.dedupScope) ?? new Set<string>();
    for (const k of commit.dedupKeys) scopeSet.add(k);              // unique (scope, record_hash)
    this.dedup.set(commit.dedupScope, scopeSet);
    const pIndex = this.productIndex.get(commit.dedupScope) ?? new Map<string, { price: number; draftRef: string }>();
    for (const p of commit.productKeys) if (!pIndex.has(p.key)) pIndex.set(p.key, { price: p.price, draftRef: p.draftRef });
    this.productIndex.set(commit.dedupScope, pIndex);
    const drafts = this.arr(this.draftRefs, commit.jobId);
    for (const d of commit.draftRefs) if (!drafts.some((x) => x.recordHash === d.recordHash)) drafts.push(d);
    const evid = this.arr(this.evidenceRefs, commit.jobId);
    for (const e of commit.evidenceRefs) if (!evid.some((x) => x.recordHash === e.recordHash)) evid.push(e);
    for (const q of commit.quarantine) this.arr(this.quarantine, commit.jobId).push(q);

    job.processedRows += commit.counters.staged + commit.counters.duplicates + commit.counters.conflicts + commit.counters.rejected;
    job.validRows += commit.counters.staged + commit.counters.conflicts;
    job.stagedDrafts += commit.counters.staged + commit.counters.conflicts;
    job.evidenceCreated += commit.counters.evidenceCreated;
    job.duplicateRows += commit.counters.duplicates;
    job.conflictRows += commit.counters.conflicts;
    job.rejectedRows += commit.counters.rejected;
    job.currentChunkIndex = commit.chunkIndex + 1;
    job.currentRowOffset = commit.checkpoint.rowOffset;
    job.lastRecordHash = commit.checkpoint.lastRecordHash;
    job.status = "processing";
    job.version++; job.updatedAt = nowIso;

    this.checkpoints.set(commit.jobId, {
      jobId: commit.jobId, chunkIndex: commit.chunkIndex, rowOffset: commit.checkpoint.rowOffset,
      lastRecordHash: commit.checkpoint.lastRecordHash, inputCursor: commit.checkpoint.inputCursor,
      committedAt: nowIso, workerId: commit.workerId, jobVersion: job.version,
    });
    for (const ev of commit.events) this.arr(this.events, commit.jobId).push(ev);
    this.pushEvent(commit.jobId, commit.workerId, "intake.chunk_committed", nowIso, commit.chunkIndex);
    this.pushEvent(commit.jobId, commit.workerId, "intake.checkpoint_saved", nowIso, commit.chunkIndex);
    return { committed: true, alreadyCommitted: false, jobVersion: job.version };
  }

  requestPause(jobId: string, nowIso: string): DurableJobRow {
    const job = this.mustJob(jobId); job.pausedAt = nowIso; job.version++; job.updatedAt = nowIso;
    this.pushEvent(jobId, null, "intake.job_paused", nowIso); return { ...job };
  }
  requestResume(jobId: string, nowIso: string): DurableJobRow {
    const job = this.mustJob(jobId); job.pausedAt = null; job.version++; job.updatedAt = nowIso;
    this.pushEvent(jobId, null, "intake.job_resumed", nowIso); return { ...job };
  }
  requestCancel(jobId: string, nowIso: string): DurableJobRow {
    const job = this.mustJob(jobId); job.cancellationRequestedAt = nowIso; job.version++; job.updatedAt = nowIso;
    this.pushEvent(jobId, null, "intake.job_cancelled", nowIso); return { ...job };
  }
  markFailed(jobId: string, workerId: string, jobVersion: number, code: string, messageSanitized: string, nowIso: string): DurableJobRow {
    const job = this.mustJob(jobId);
    if (job.version !== jobVersion) throw new StaleWorkerError(`Stale version on fail(${jobId})`);
    job.status = "failed"; job.failedAt = nowIso; job.failureCode = code; job.failureMessageSanitized = messageSanitized;
    job.retryCount++; job.version++; job.updatedAt = nowIso;
    this.pushEvent(jobId, workerId, "intake.job_failed", nowIso, null, { code });
    return { ...job };
  }
  finalize(jobId: string, workerId: string, jobVersion: number, status: DurableJobStatus, nowIso: string): DurableJobRow {
    const job = this.mustJob(jobId);
    if (job.version !== jobVersion) throw new StaleWorkerError(`Stale version on finalize(${jobId})`);
    job.status = status;
    if (status === "cancelled") { /* keep committed work */ } else job.completedAt = nowIso;
    job.version++; job.updatedAt = nowIso;
    this.pushEvent(jobId, workerId, status === "cancelled" ? "intake.job_cancelled" : "intake.job_completed", nowIso);
    return { ...job };
  }

  listChunks(jobId: string): ChunkRow[] { return (this.chunks.get(jobId) ?? []).map((c) => ({ ...c })); }
  listQuarantine(jobId: string): QuarantineRecord[] { return (this.quarantine.get(jobId) ?? []).map((q) => ({ ...q })); }
  listEvents(jobId: string): DurableEventRow[] { return (this.events.get(jobId) ?? []).map((e) => ({ ...e })); }
  listDrafts(jobId: string): { draftRef: string; recordHash: string; conflictState: string }[] { return (this.draftRefs.get(jobId) ?? []).map((d) => ({ ...d })); }

  /** Force a lease to expire (recovery-test hook — models a dead worker, not a real API). */
  expireLease(jobId: string): void { const l = this.leases.get(jobId); if (l) l.leaseExpiresAt = new Date(0).toISOString(); }

  private mustJob(jobId: string): DurableJobRow { const j = this.jobs.get(jobId); if (!j) throw new IntegrityError(`Unknown job ${jobId}`); return j; }
  private evSeq = 0;
  private pushEvent(jobId: string, workerId: string | null, type: DurableEventRow["eventType"], nowIso: string, chunkIndex: number | null = null, metadata: Record<string, unknown> = {}): void {
    this.evSeq++;
    this.arr(this.events, jobId).push({ eventId: `ev_${this.evSeq}`, jobId, workerId, eventType: type, chunkIndex, countsDelta: null, traceId: `trace_${jobId}`, createdAt: nowIso, metadata });
  }
}
