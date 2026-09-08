/**
 * Gate 8 lease-ownership concurrency proof (durable store semantics).
 *
 * The Gate 8 defect was that the WORKER generated non-instance-unique ids, so two
 * Cloud Run instances of one revision shared an id and the store could not tell them
 * apart. The store's lease semantics themselves are correct — this test proves them
 * against TWO genuinely distinct worker ids:
 *
 *   • worker B cannot renew or commit under worker A's ACTIVE lease (owner mismatch)
 *   • after the lease expires, worker B may reclaim it
 *   • the lease "generation" (optimistic version) increases on reclaim
 *   • worker A, using its old owner/generation, is rejected after the reclaim
 *     (both owner-mismatch and stale-version paths)
 *
 * This is the store-level counterpart to workerIdentity's uniqueness tests: unique
 * ids (worker) + these rejections (store) together make the lease safe.
 */

import { describe, it, expect } from "vitest";
import { InMemoryDurableStore } from "./inMemoryStore";
import { StaleWorkerError, type ChunkCommit, type CreateJobInputDurable } from "./durableTypes";

const A = "w_revX_aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const B = "w_revX_bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb";
const T0 = "2026-07-24T12:00:00.000Z";
const T_EXPIRED = "2026-07-24T12:01:01.000Z"; // T0 + 61s (> 60s lease)
const LEASE = 60;

function seedJob(store: InMemoryDurableStore): string {
  const input: CreateJobInputDurable = {
    id: "job_lease", sourceId: "src_lease", inputRef: "gs://b/o#1", inputHash: "h".repeat(12),
    inputContentType: "application/x-ndjson", mode: "jsonl", requestedBy: "test", isFixture: true,
  };
  return store.createJob(input, T0).id;
}

function commit(workerId: string, version: number, chunkIndex: number, offEnd: number): ChunkCommit {
  return {
    jobId: "job_lease", workerId, jobVersion: version, chunkIndex, chunkHash: `h${chunkIndex}`,
    rowOffsetStart: chunkIndex * 10, rowOffsetEnd: offEnd,
    counters: { staged: 1, duplicates: 0, conflicts: 0, rejected: 0, evidenceCreated: 1 },
    dedupScope: "src_lease", dedupKeys: [`k${chunkIndex}`], productKeys: [],
    draftRefs: [{ draftRef: `d${chunkIndex}`, recordHash: `k${chunkIndex}`, conflictState: "none" }],
    evidenceRefs: [{ evidenceRef: `e${chunkIndex}`, recordHash: `k${chunkIndex}` }], quarantine: [],
    checkpoint: { rowOffset: offEnd, lastRecordHash: `k${chunkIndex}`, inputCursor: `row:${offEnd}` },
    events: [], durationMs: 1,
  };
}

describe("durable lease — owner mismatch, expiry reclaim, generation, stale rejection", () => {
  it("enforces the full crash/reclaim lease contract across two distinct workers", () => {
    const store = new InMemoryDurableStore();
    seedJob(store);

    // 1. Worker A claims (generation increments) and commits chunk 0.
    const claimedA = store.claimJob("job_lease", A, LEASE, T0);
    const genA = claimedA.version;
    const c0 = store.commitChunk(commit(A, genA, 0, 10), T0);
    expect(c0.committed).toBe(true);
    const genAfterChunk0 = c0.jobVersion;

    // 2. Worker B CANNOT commit or renew under A's ACTIVE (unexpired) lease.
    expect(() => store.commitChunk(commit(B, genAfterChunk0, 1, 20), T0)).toThrow(StaleWorkerError); // owner mismatch
    expect(() => store.renewLease("job_lease", B, LEASE, genAfterChunk0, T0)).toThrow(StaleWorkerError);
    // A still owns it: no third worker claimed, checkpoint unchanged.
    expect(store.loadCheckpoint("job_lease")?.rowOffset).toBe(10);

    // 3. After the lease expires, worker B reclaims — generation strictly increases.
    const reclaimed = store.claimJob("job_lease", B, LEASE, T_EXPIRED);
    const genB = reclaimed.version;
    expect(genB).toBeGreaterThan(genAfterChunk0); // new generation > old

    // 4. Worker A, using its OLD owner + OLD generation, is now rejected (both paths).
    expect(() => store.commitChunk(commit(A, genAfterChunk0, 1, 20), T_EXPIRED)).toThrow(StaleWorkerError); // stale owner+version
    expect(() => store.renewLease("job_lease", A, LEASE, genAfterChunk0, T_EXPIRED)).toThrow(StaleWorkerError); // stale version

    // 5. Worker B resumes and commits the next chunk under its own generation.
    const c1 = store.commitChunk(commit(B, genB, 1, 20), T_EXPIRED);
    expect(c1.committed).toBe(true);
    expect(store.loadCheckpoint("job_lease")?.rowOffset).toBe(20); // monotonic, never backwards
  });

  it("a distinct worker cannot claim while the lease is live (premature reclaim blocked)", () => {
    const store = new InMemoryDurableStore();
    seedJob(store);
    store.claimJob("job_lease", A, LEASE, T0);
    // B tries to claim before expiry → owner mismatch on a live lease.
    expect(() => store.claimJob("job_lease", B, LEASE, T0)).toThrow(StaleWorkerError);
  });
});
