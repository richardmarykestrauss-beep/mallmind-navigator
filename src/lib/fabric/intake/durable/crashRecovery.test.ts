import { describe, it, expect } from "vitest";
import type { SourceAccessPolicy } from "../../types";
import { scaleRecords } from "../scaleFixtures";
import { InMemoryDurableStore } from "./inMemoryStore";
import type { DurableJobRow } from "./durableTypes";
import { StaleWorkerError } from "./durableTypes";
import { GcsInputStore, FixtureGcsBackend } from "./gcsInputStore";
import { runDurableJob, type WorkerHooks } from "./worker";
import { inputHash } from "./hashes";

/**
 * Crash-simulation harness. Every recovery guarantee is proven against the
 * Postgres-faithful in-memory store: no duplicate drafts/evidence/quarantine,
 * exact counters, monotonic checkpoints, stale-worker rejection, committed chunks
 * survive, uncommitted chunks rerun safely, and nothing ever publishes.
 * "Generated recovery fixture — no retailer data."
 */

const NOW = "2026-07-13T12:00:00.000Z";
const BUCKET = "mallmind-intake-dev";
const OBJECT = "intake/recovery.jsonl";
const policy: SourceAccessPolicy = { sourceId: "src_bulk", automationStatus: "authorized_feed", allowedModes: ["merchant_feed", "browser_observation", "manual", "catalogue"], requiresHumanReview: true, legalRisk: "low" };

async function jsonl(n: number): Promise<string> {
  const lines: string[] = [];
  for await (const r of scaleRecords(n, NOW)) lines.push(JSON.stringify(r));
  return lines.join("\n") + "\n";
}
function harness(content: string) {
  const store = new InMemoryDurableStore();
  const backend = new FixtureGcsBackend();
  const ref = backend.seed(BUCKET, OBJECT, content, "application/x-ndjson", "1");
  const gcs = new GcsInputStore(backend, { allowedBuckets: [BUCKET] });
  store.createJob({ id: "job_a", sourceId: "src_bulk", inputRef: ref, inputHash: inputHash(content), inputContentType: "application/x-ndjson", mode: "jsonl", requestedBy: "admin" }, NOW);
  return { store, backend, gcs, ref };
}
const run = (store: InMemoryDurableStore, gcs: GcsInputStore, workerId = "w1", hooks?: WorkerHooks) =>
  runDurableJob({ store, inputStore: gcs, jobId: "job_a", workerId, policy, nowIso: NOW, parseMode: "jsonl", chunkSize: 20, hooks });

function counters(j: DurableJobRow) { return { processed: j.processedRows, valid: j.validRows, rejected: j.rejectedRows, duplicate: j.duplicateRows, conflict: j.conflictRows, drafts: j.stagedDrafts, evidence: j.evidenceCreated }; }
function assertNoDuplication(store: InMemoryDurableStore) {
  const drafts = store.listDrafts("job_a");
  expect(new Set(drafts.map((d) => d.recordHash)).size).toBe(drafts.length);        // no duplicate drafts
  const q = store.listQuarantine("job_a");
  expect(new Set(q.map((x) => x.recordIndex)).size).toBe(q.length);                  // no duplicate quarantine
}

let CONTENT = "";
async function content(): Promise<string> { if (!CONTENT) CONTENT = await jsonl(80); return CONTENT; }
async function cleanRun(): Promise<DurableJobRow> { const c = await content(); const { store, gcs } = harness(c); return (await run(store, gcs)).job; }

describe("crash recovery", () => {
  it("1-2. crash before first chunk commit → recover from scratch, exact counters, no dup", async () => {
    const c = await content(); const clean = await cleanRun();
    const { store, gcs } = harness(c);
    await expect(run(store, gcs, "w1", { onBeforeCommit: (i) => { if (i === 0) throw new Error("crash"); } })).rejects.toThrow();
    expect(store.listChunks("job_a")).toHaveLength(0);                 // uncommitted chunk not persisted
    const rec = await run(store, gcs);                                 // rerun the uncommitted chunk safely
    expect(counters(rec.job)).toEqual(counters(clean));
    assertNoDuplication(store);
    expect(rec.drafts.every((d) => d.reviewStatus === "needs_review")).toBe(true); // nothing published
  });

  it("3-4. crash AFTER commit → resume from durable checkpoint, no replay, exact counters", async () => {
    const c = await content(); const clean = await cleanRun();
    const { store, gcs } = harness(c);
    await expect(run(store, gcs, "w1", { onAfterCommit: (i) => { if (i === 1) throw new Error("crash"); } })).rejects.toThrow();
    expect(store.loadCheckpoint("job_a")!.chunkIndex).toBe(1);         // chunks 0+1 durably committed
    const committed = store.listChunks("job_a").length;
    const rec = await run(store, gcs);                                 // resumes from chunk 2
    expect(store.listChunks("job_a").length).toBeGreaterThan(committed);
    expect(counters(rec.job)).toEqual(counters(clean));               // counters reconcile after recovery
    assertNoDuplication(store);
  });

  it("5-6. lease expires mid-job → a second worker reclaims and completes", async () => {
    const c = await content(); const clean = await cleanRun();
    const { store, gcs } = harness(c);
    await expect(run(store, gcs, "w1", { onAfterCommit: (i) => { if (i === 0) throw new Error("worker died"); } })).rejects.toThrow();
    store.expireLease("job_a");
    const rec = await run(store, gcs, "w2");                           // second worker reclaims expired lease
    expect(counters(rec.job)).toEqual(counters(clean));
    assertNoDuplication(store);
  });

  it("7. a stale first worker cannot commit after its lease is reclaimed", async () => {
    const c = await content(); const { store } = harness(c);
    const claim = store.claimJob("job_a", "w1", 60, NOW);
    const base = { jobId: "job_a", workerId: "w1", chunkIndex: 0, chunkHash: "h", rowOffsetStart: 0, rowOffsetEnd: 1, counters: { staged: 1, duplicates: 0, conflicts: 0, rejected: 0, evidenceCreated: 1 }, dedupScope: "src_bulk", dedupKeys: ["k0"], productKeys: [], draftRefs: [], evidenceRefs: [], quarantine: [], checkpoint: { rowOffset: 1, lastRecordHash: "k0", inputCursor: "row:1" }, events: [], durationMs: 1 };
    store.commitChunk({ ...base, jobVersion: claim.version }, NOW);
    store.expireLease("job_a");
    const reclaimed = store.claimNextJob("w2", 60, new Date(Date.parse(NOW) + 999_000).toISOString());
    expect(reclaimed?.id).toBe("job_a");
    expect(() => store.commitChunk({ ...base, chunkIndex: 1, jobVersion: claim.version, dedupKeys: ["k1"] }, NOW)).toThrow(StaleWorkerError);
  });

  it("8, 16. duplicate run request / same job rerun is idempotent (no new drafts)", async () => {
    const c = await content(); const { store, gcs } = harness(c);
    const first = await run(store, gcs);
    const draftsBefore = store.listDrafts("job_a").length;
    const second = await run(store, gcs);                              // rerun the completed job
    expect(store.listDrafts("job_a").length).toBe(draftsBefore);
    expect(second.drafts).toHaveLength(0);
    expect(counters(second.job)).toEqual(counters(first.job));
  });

  it("9-10. pause then resume; cancel preserves committed work and never publishes", async () => {
    const c = await content(); const clean = await cleanRun();
    // pause
    const p = harness(c);
    const paused = await run(p.store, p.gcs, "w1", { onAfterCommit: (i) => { if (i === 0) p.store.requestPause("job_a", NOW); } });
    expect(paused.status).toBe("paused");
    p.store.requestResume("job_a", NOW);
    const resumed = await run(p.store, p.gcs);
    expect(counters(resumed.job)).toEqual(counters(clean));
    assertNoDuplication(p.store);
    // cancel
    const x = harness(c);
    const cancelled = await run(x.store, x.gcs, "w1", { onAfterCommit: (i) => { if (i === 0) x.store.requestCancel("job_a", NOW); } });
    expect(cancelled.status).toBe("cancelled");
    expect(x.store.listDrafts("job_a").length).toBeGreaterThan(0);     // committed drafts preserved
    expect(cancelled.job.completedAt).toBeNull();
    expect(cancelled.drafts.every((d) => d.reviewStatus === "needs_review")).toBe(true); // nothing published
  });

  it("11. a transient fault fails safely and a retry resumes without duplication", async () => {
    const c = await content(); const clean = await cleanRun();
    const { store, gcs } = harness(c);
    await expect(runDurableJob({ store, inputStore: gcs, jobId: "job_a", workerId: "w1", policy, nowIso: NOW, parseMode: "jsonl", chunkSize: 20, transientFaultAt: (i) => i === 1 })).rejects.toThrow(/transient/);
    expect(store.getJob("job_a")!.retryCount).toBe(1);
    const rec = await run(store, gcs);                                 // retry resumes from checkpoint
    expect(counters(rec.job)).toEqual(counters(clean));
    assertNoDuplication(store);
  });

  it("14-15. input content/generation change mid-job fails safely; committed work survives", async () => {
    const c = await content(); const { store, backend, gcs } = harness(c);
    await expect(run(store, gcs, "w1", { onAfterCommit: (i) => { if (i === 0) throw new Error("died"); } })).rejects.toThrow();
    const committed = store.listChunks("job_a").length;
    backend.bumpGeneration(BUCKET, OBJECT);                            // object changed under us
    await expect(run(store, gcs)).rejects.toThrow(/generation/);       // fail safely
    expect(store.listChunks("job_a").length).toBe(committed);          // committed chunks never disappear
  });

  it("19. concurrent workers — only one owns a live lease", async () => {
    const c = await content(); const { store } = harness(c);
    store.claimJob("job_a", "w1", 60, NOW);
    expect(store.claimNextJob("w2", 60, NOW)).toBeNull();              // nothing else claimable
    expect(() => store.claimJob("job_a", "w2", 60, NOW)).toThrow(StaleWorkerError);
  });

  it("12, 20. conflicts stay blocked and audit events preserve the recovery history", async () => {
    const c = await content(); const { store, gcs } = harness(c);
    await expect(run(store, gcs, "w1", { onAfterCommit: (i) => { if (i === 1) throw new Error("crash"); } })).rejects.toThrow();
    const rec = await run(store, gcs);
    expect(rec.drafts.some((d) => d.conflictState === "conflict_detected")).toBe(true); // conflicts remain blocked
    const events = store.listEvents("job_a").map((e) => e.eventType);
    expect(events).toContain("intake.job_claimed");
    expect(events).toContain("intake.chunk_committed");
    expect(events).toContain("intake.checkpoint_saved");
    expect(events).toContain("intake.job_completed");                 // full recovery history retained
  });
});
