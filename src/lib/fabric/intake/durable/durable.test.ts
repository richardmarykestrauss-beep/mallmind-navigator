import { describe, it, expect } from "vitest";
import type { SourceAccessPolicy } from "../../types";
import { scaleRecords } from "../scaleFixtures";
import { InMemoryDurableStore } from "./inMemoryStore";
import { StaleWorkerError } from "./durableTypes";
import { GcsInputStore, FixtureGcsBackend, parseGcsRef, GcsRefError } from "./gcsInputStore";
import { runDurableJob } from "./worker";
import { createIntakeService } from "./service";
import { inputHash } from "./hashes";

const NOW = "2026-07-13T12:00:00.000Z";
const later = (s: number) => new Date(Date.parse(NOW) + s * 1000).toISOString();
const BUCKET = "mallmind-intake-dev";
const policy: SourceAccessPolicy = { sourceId: "src_bulk", automationStatus: "authorized_feed", allowedModes: ["merchant_feed", "browser_observation", "manual", "catalogue"], requiresHumanReview: true, legalRisk: "low" };

async function jsonl(n: number): Promise<string> {
  const lines: string[] = [];
  for await (const r of scaleRecords(n, NOW)) lines.push(JSON.stringify(r));
  return lines.join("\n") + "\n";
}
function setup(content: string) {
  const store = new InMemoryDurableStore();
  const backend = new FixtureGcsBackend();
  const ref = backend.seed(BUCKET, "intake/fixture.jsonl", content, "application/x-ndjson", "1");
  const gcs = new GcsInputStore(backend, { allowedBuckets: [BUCKET] });
  return { store, backend, gcs, ref };
}
function makeJob(store: InMemoryDurableStore, ref: string, content: string, id = "job_a") {
  return store.createJob({ id, sourceId: "src_bulk", inputRef: ref, inputHash: inputHash(content), inputContentType: "application/x-ndjson", mode: "jsonl", requestedBy: "admin" }, NOW);
}

// ── Store + leases ───────────────────────────────────────────────────────────
describe("durable store + leases", () => {
  it("create is idempotent and claim is exclusive", async () => {
    const content = await jsonl(20);
    const { store, ref } = setup(content);
    const j1 = makeJob(store, ref, content);
    expect(store.createJob({ id: "job_a", sourceId: "src_bulk", inputRef: ref, inputHash: j1.inputHash, inputContentType: "x", mode: "jsonl", requestedBy: "admin" }, NOW).id).toBe("job_a");
    store.claimJob("job_a", "w1", 60, NOW);
    expect(() => store.claimJob("job_a", "w2", 60, NOW)).toThrow(StaleWorkerError); // w2 cannot steal a live lease
  });
  it("reclaims only after lease expiry; stale version/worker cannot renew or commit", async () => {
    const content = await jsonl(20);
    const { store, ref } = setup(content);
    makeJob(store, ref, content);
    const c = store.claimJob("job_a", "w1", 60, NOW);
    expect(() => store.renewLease("job_a", "w2", 60, c.version, NOW)).toThrow(StaleWorkerError); // wrong worker
    store.expireLease("job_a");
    const reclaimed = store.claimNextJob("w2", 60, later(120));
    expect(reclaimed?.id).toBe("job_a");
    expect(() => store.renewLease("job_a", "w1", 60, c.version, later(120))).toThrow(StaleWorkerError); // stale w1
  });
  it("chunk commit is idempotent and rejects a stale worker", async () => {
    const content = await jsonl(20);
    const { store, ref } = setup(content);
    makeJob(store, ref, content);
    const c = store.claimJob("job_a", "w1", 60, NOW);
    const commit = { jobId: "job_a", workerId: "w1", jobVersion: c.version, chunkIndex: 0, chunkHash: "h0", rowOffsetStart: 0, rowOffsetEnd: 2, counters: { staged: 2, duplicates: 0, conflicts: 0, rejected: 0, evidenceCreated: 2 }, dedupScope: "src_bulk", dedupKeys: ["ra", "rb"], productKeys: [], draftRefs: [], evidenceRefs: [], quarantine: [], checkpoint: { rowOffset: 2, lastRecordHash: "rb", inputCursor: "row:2" }, events: [], durationMs: 1 };
    const r1 = store.commitChunk(commit, NOW);
    expect(r1.committed).toBe(true);
    const r2 = store.commitChunk({ ...commit, jobVersion: r1.jobVersion }, NOW); // replay same chunk
    expect(r2.alreadyCommitted).toBe(true);
    expect(store.getJob("job_a")!.processedRows).toBe(2); // no counter drift
    expect(() => store.commitChunk({ ...commit, workerId: "w_other", chunkIndex: 1, jobVersion: r1.jobVersion }, NOW)).toThrow(StaleWorkerError);
  });
});

// ── GCS reference validation ─────────────────────────────────────────────────
describe("cloud storage reference validation", () => {
  it("parses valid refs and rejects malformed / traversal / disallowed / mismatched", async () => {
    expect(parseGcsRef("gs://b/x/y.jsonl#3")).toEqual({ bucket: "b", object: "x/y.jsonl", generation: "3" });
    expect(() => parseGcsRef("https://b/x")).toThrow(GcsRefError);
    expect(() => parseGcsRef("gs://b/../secret#1")).toThrow(/Illegal/);
    const backend = new FixtureGcsBackend();
    const ref = backend.seed(BUCKET, "intake/f.jsonl", "a\n", "application/x-ndjson", "1");
    const disallowed = new GcsInputStore(backend, { allowedBuckets: ["other"] });
    await expect(disallowed.verify(ref)).rejects.toThrow(/allow-listed/);
    const wrongGen = new GcsInputStore(backend, { allowedBuckets: [BUCKET] });
    await expect(wrongGen.verify(`gs://${BUCKET}/intake/f.jsonl#9`)).rejects.toThrow(/generation/);
    const tiny = new GcsInputStore(backend, { allowedBuckets: [BUCKET], maxBytes: 1 });
    await expect(tiny.verify(ref)).rejects.toThrow(/max size/);
    const badHash = new GcsInputStore(backend, { allowedBuckets: [BUCKET], expectedHashes: { [ref]: "sha256:nope" } });
    await expect(badHash.verify(ref)).rejects.toThrow(/content hash/);
  });
});

// ── Worker happy path + durable dedup ────────────────────────────────────────
describe("durable worker", () => {
  it("processes a fixture job atomically, stages drafts, publishes nothing, checkpoints durably", async () => {
    const content = await jsonl(100);
    const { store, gcs, ref } = setup(content);
    makeJob(store, ref, content);
    const res = await runDurableJob({ store, inputStore: gcs, jobId: "job_a", workerId: "w1", policy, nowIso: NOW, parseMode: "jsonl", chunkSize: 25 });
    const job = res.job;
    expect(["needs_review", "completed_with_errors"]).toContain(res.status);
    expect(job.processedRows).toBe(100);
    expect(job.validRows + job.duplicateRows + job.rejectedRows).toBe(100);     // reconcile
    expect(job.stagedDrafts).toBe(job.validRows);
    expect(res.drafts.every((d) => d.reviewStatus === "needs_review")).toBe(true); // nothing published
    expect(store.loadCheckpoint("job_a")?.rowOffset).toBe(100);                  // durable checkpoint
    expect(store.listChunks("job_a")).toHaveLength(4);
    expect(store.listEvents("job_a").some((e) => e.eventType === "intake.chunk_committed")).toBe(true);
    // durable dedup: same file as a NEW job → all duplicates, no new drafts.
    makeJob(store, ref, content, "job_b");
    const res2 = await runDurableJob({ store, inputStore: gcs, jobId: "job_b", workerId: "w1", policy, nowIso: NOW, parseMode: "jsonl", chunkSize: 25 });
    expect(res2.job.stagedDrafts).toBe(0);                                    // no new drafts on re-import
    expect(res2.job.duplicateRows).toBe(job.validRows + job.duplicateRows);   // every prior non-rejected row dedups
    expect(res2.job.rejectedRows).toBe(job.rejectedRows);                    // rejected rows re-reject (no dedup key)
  });
  it("a blocked source policy rejects every row (import never bypasses policy)", async () => {
    const content = await jsonl(30);
    const { store, gcs, ref } = setup(content);
    makeJob(store, ref, content);
    const blocked: SourceAccessPolicy = { ...policy, automationStatus: "blocked", allowedModes: [] };
    const res = await runDurableJob({ store, inputStore: gcs, jobId: "job_a", workerId: "w1", policy: blocked, nowIso: NOW, parseMode: "jsonl", chunkSize: 30 });
    expect(res.job.validRows).toBe(0);
    expect(res.job.rejectedRows).toBe(30);
    expect(res.drafts).toHaveLength(0);
  });
});

// ── Service auth + hardening ─────────────────────────────────────────────────
describe("worker service", () => {
  const deps = () => ({ store: new InMemoryDurableStore(), inputStore: new GcsInputStore(new FixtureGcsBackend(), { allowedBuckets: [BUCKET] }), policyFor: () => policy, now: () => NOW, internalToken: "secret-token", parseModeFor: () => "jsonl" as const });
  it("rejects unauthenticated calls and never exposes service-role/secrets", async () => {
    const svc = createIntakeService(deps());
    const noAuth = await svc.getJob({ headers: {}, params: { jobId: "job_a" } });
    expect(noAuth.status).toBe(401);
    const bad = await svc.getJob({ headers: { "x-internal-token": "wrong" }, params: { jobId: "job_a" } });
    expect(bad.status).toBe(401);
    expect(JSON.stringify(bad.body)).not.toContain("secret-token");
  });
  it("validates ids and grounds requestedBy in the caller", async () => {
    const svc = createIntakeService(deps());
    const badId = await svc.getJob({ headers: { "x-internal-token": "secret-token" }, params: { jobId: "bad id!" } });
    expect(badId.status).toBe(400);
    const created = await svc.createJob({ headers: { "x-internal-token": "secret-token" }, callerId: "admin-42", body: { id: "job_svc", sourceId: "src_bulk", inputRef: `gs://${BUCKET}/f#1`, inputHash: "h", mode: "jsonl" } });
    expect(created.status).toBe(201);
    expect((created.body as { requestedBy: string }).requestedBy).toBe("admin-42"); // not trusted from JSON
  });
});
