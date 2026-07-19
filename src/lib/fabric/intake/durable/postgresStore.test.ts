/**
 * PostgresDurableIntakeStore — contract tests against a fake gateway.
 *
 * These prove the parts that are OURS: the fixture-only boundary, error
 * classification, error sanitization, RPC argument/payload shape, bounded paging,
 * and row mapping. Postgres's own transactional guarantees are proved by the
 * migration + the DB verification job, not re-implemented here.
 */

import { describe, it, expect } from "vitest";
import {
  PostgresDurableIntakeStore, classifyDbError, DbError, DURABLE_PAGE_SIZE,
  type PostgresGateway, type DbFilter, type DbSelectOptions,
} from "./postgresStore";
import { StaleWorkerError, IntegrityError, type ChunkCommit } from "./durableTypes";

const JOB_ID = "11111111-2222-4333-8444-555555555555";
const SOURCE_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const NOW = "2026-07-16T10:00:00.000Z";

interface Call { fn: string; args: Record<string, unknown>; }

/** Records every call and returns scripted results. */
class FakeGateway implements PostgresGateway {
  calls: Call[] = [];
  selects: { table: string; filter: DbFilter; options?: DbSelectOptions }[] = [];
  rpcResults: Record<string, unknown> = {};
  rpcErrors: Record<string, unknown> = {};
  tables: Record<string, Record<string, unknown>[]> = {};

  async rpc(fn: string, args: Record<string, unknown>): Promise<unknown> {
    this.calls.push({ fn, args });
    if (fn in this.rpcErrors) throw this.rpcErrors[fn];
    return this.rpcResults[fn] ?? null;
  }
  async selectRows(table: string, filter: DbFilter, options?: DbSelectOptions): Promise<Record<string, unknown>[]> {
    this.selects.push({ table, filter, options });
    const all = (this.tables[table] ?? []).filter((r) => Object.entries(filter).every(([k, v]) => r[k] === v));
    const offset = options?.offset ?? 0;
    return all.slice(offset, offset + (options?.limit ?? all.length));
  }
}

const jobRow = (over: Record<string, unknown> = {}) => ({
  id: JOB_ID, source_id: SOURCE_ID, adapter_id: null, input_ref: "gs://b/o#1", input_hash: "h".repeat(20),
  input_content_type: "text/csv", mode: "csv", status: "queued", requested_by: "svc", priority: 0,
  total_bytes: 100, estimated_rows: 10, processed_rows: 0, valid_rows: 0, rejected_rows: 0,
  duplicate_rows: 0, conflict_rows: 0, staged_drafts: 0, evidence_created: 0, retry_count: 0, max_retries: 3,
  current_chunk_index: 0, current_row_offset: 0, last_record_hash: null, cancellation_requested_at: null,
  paused_at: null, started_at: null, completed_at: null, failed_at: null, failure_code: null,
  failure_message_sanitized: null, created_at: NOW, updated_at: NOW, version: 1, ...over,
});

const storeWith = (gw: FakeGateway, fixtureOnlyMode = true) =>
  new PostgresDurableIntakeStore({ gateway: gw, fixtureOnlyMode });

const createInput = (over: Record<string, unknown> = {}) => ({
  id: "ignored-by-postgres", sourceId: SOURCE_ID, inputRef: "gs://dev-bucket/fixtures/x.csv#17",
  inputHash: "h".repeat(20), inputContentType: "text/csv", mode: "csv" as const,
  requestedBy: "svc", isFixture: true, ...over,
});

// ── Fixture-only boundary ────────────────────────────────────────────────────

describe("fixture-only boundary", () => {
  it("refuses a non-fixture job with the exact operator wording, before any DB call", async () => {
    const gw = new FakeGateway();
    await expect(storeWith(gw).createJob(createInput({ isFixture: false }), NOW)).rejects.toThrow(
      "Durable worker is currently restricted to generated development fixtures.",
    );
    expect(gw.calls).toHaveLength(0);   // fails closed before it reaches the wire
  });

  it("refuses a job with no fixture marker at all", async () => {
    const gw = new FakeGateway();
    await expect(storeWith(gw).createJob(createInput({ isFixture: undefined }), NOW)).rejects.toThrow(
      "Durable worker is currently restricted to generated development fixtures.",
    );
  });

  it("passes fixture_only_mode to the RPC so the database enforces the boundary too", async () => {
    const gw = new FakeGateway();
    gw.rpcResults.create_intake_job = jobRow();
    await storeWith(gw).createJob(createInput(), NOW);
    expect(gw.calls[0].args.p_fixture_only_mode).toBe(true);
    expect(gw.calls[0].args.p_is_fixture).toBe(true);
    expect(gw.calls[0].args.p_requested_by).toBe("svc");
  });

  it("surfaces the database's own fixture refusal with the same wording", async () => {
    const gw = new FakeGateway();
    gw.rpcErrors.create_intake_job = { message: "Durable worker is currently restricted to generated development fixtures." };
    await expect(storeWith(gw, false).createJob(createInput({ isFixture: false }), NOW)).rejects.toThrow(
      "Durable worker is currently restricted to generated development fixtures.",
    );
  });
});

// ── Error classification + sanitization ──────────────────────────────────────

describe("classifyDbError", () => {
  it("maps a stale lease/version to StaleWorkerError so the worker aborts instead of retrying", () => {
    expect(classifyDbError({ message: "stale_worker: lease" })).toBeInstanceOf(StaleWorkerError);
    expect(classifyDbError({ message: "stale_worker: version" })).toBeInstanceOf(StaleWorkerError);
  });

  it("classifies connection/serialization/resource SQLSTATEs as retryable", () => {
    for (const code of ["08006", "40001", "40P01", "53300", "57014"]) {
      const e = classifyDbError({ message: "boom", code }) as DbError;
      expect(e.retryable, code).toBe(true);
    }
  });

  it("classifies constraint violations as permanent", () => {
    const e = classifyDbError({ message: "duplicate key value", code: "23505" }) as DbError;
    expect(e.retryable).toBe(false);
  });

  it("classifies network-shaped errors as retryable even without a SQLSTATE", () => {
    expect((classifyDbError(new Error("fetch failed")) as DbError).retryable).toBe(true);
    expect((classifyDbError(new Error("socket hang up")) as DbError).retryable).toBe(true);
  });

  it("treats an oversized chunk as an integrity failure, not a retry", () => {
    expect(classifyDbError({ message: "chunk too large" })).toBeInstanceOf(IntegrityError);
  });

  it("scrubs tokens, URLs and object refs out of the message", () => {
    const e = classifyDbError({
      message: "failed at https://xyz.supabase.co/rest/v1 with key eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9 for gs://secret-bucket/obj#3",
    }) as DbError;
    expect(e.message).not.toMatch(/eyJhbGci/);
    expect(e.message).not.toMatch(/supabase\.co/);
    expect(e.message).not.toMatch(/secret-bucket/);
    expect(e.message).toContain("[token]");
    expect(e.message).toContain("[url]");
    expect(e.message).toContain("[gs-ref]");
  });

  it("bounds the message length", () => {
    const e = classifyDbError({ message: "x".repeat(5000) }) as DbError;
    expect(e.message.length).toBeLessThanOrEqual(200);
  });
});

describe("input validation", () => {
  it("rejects a non-UUID job id before calling the database", async () => {
    const gw = new FakeGateway();
    await expect(storeWith(gw).getJob("../../etc/passwd")).rejects.toThrow(/Invalid jobId/);
    expect(gw.selects).toHaveLength(0);
  });

  it("rejects a malformed worker id", async () => {
    const gw = new FakeGateway();
    await expect(storeWith(gw).claimNextJob("worker id with spaces", 60, NOW)).rejects.toThrow(/Invalid worker id/);
  });
});

// ── Row mapping ──────────────────────────────────────────────────────────────

describe("row mapping", () => {
  it("maps a job row from snake_case to the shared contract", async () => {
    const gw = new FakeGateway();
    gw.tables.retail_intake_jobs = [jobRow({ status: "processing", valid_rows: 7, version: 4, paused_at: NOW })];
    const job = (await storeWith(gw).getJob(JOB_ID))!;
    expect(job).toMatchObject({ id: JOB_ID, sourceId: SOURCE_ID, status: "processing", validRows: 7, version: 4, pausedAt: NOW });
    expect(job.adapterId).toBeNull();
  });

  it("returns undefined for a missing job rather than throwing", async () => {
    const gw = new FakeGateway();
    expect(await storeWith(gw).getJob(JOB_ID)).toBeUndefined();
  });

  it("returns null from claim-next when no job is eligible", async () => {
    const gw = new FakeGateway();
    gw.rpcResults.claim_next_intake_job = null;
    expect(await storeWith(gw).claimNextJob("worker_1", 60, NOW)).toBeNull();
  });
});

// ── Bounded paging ───────────────────────────────────────────────────────────

describe("bounded reads", () => {
  it("pages a dedup scope larger than one page and never issues an unbounded select", async () => {
    const gw = new FakeGateway();
    gw.tables.retail_intake_dedup_keys = Array.from({ length: DURABLE_PAGE_SIZE + 250 }, (_, i) => ({
      scope: SOURCE_ID, record_hash: `h${i}`, draft_ref: `d${i}`,
    }));
    const seen = await storeWith(gw).loadDedupScope(SOURCE_ID);
    expect(seen.size).toBe(DURABLE_PAGE_SIZE + 250);
    expect(gw.selects).toHaveLength(2);
    expect(gw.selects.every((s) => (s.options?.limit ?? Infinity) <= DURABLE_PAGE_SIZE)).toBe(true);
  });

  it("loads the durable product index so a resumed job still detects conflicts", async () => {
    const gw = new FakeGateway();
    gw.tables.retail_intake_product_index = [{ scope: SOURCE_ID, product_key: "p1", price: "19.99", draft_ref: "d1" }];
    const index = await storeWith(gw).loadProductIndex(SOURCE_ID);
    expect(index.p1).toEqual({ price: 19.99, draftRef: "d1" });
  });

  it("bounds the event feed", async () => {
    const gw = new FakeGateway();
    await storeWith(gw).listEvents(JOB_ID);
    expect(gw.selects[0].options?.limit).toBe(DURABLE_PAGE_SIZE);
  });
});

// ── Atomic chunk commit ──────────────────────────────────────────────────────

const commit = (over: Partial<ChunkCommit> = {}): ChunkCommit => ({
  jobId: JOB_ID, workerId: "worker_1", jobVersion: 3, chunkIndex: 2, chunkHash: "ch",
  rowOffsetStart: 400, rowOffsetEnd: 600,
  counters: { staged: 180, duplicates: 10, conflicts: 5, rejected: 5, evidenceCreated: 185 },
  dedupScope: SOURCE_ID, dedupKeys: ["rh1", "rh2"],
  productKeys: [{ key: "p1", price: 19.99, draftRef: "d1" }],
  draftRefs: [{ draftRef: "d1", recordHash: "rh1", conflictState: "none" }],
  evidenceRefs: [{ evidenceRef: "e1", recordHash: "rh1" }],
  quarantine: [{
    id: "q1", jobId: JOB_ID, recordIndex: 401, sourceRef: "gs://b/o#1", excerpt: "bad",
    recordHash: "rh9", errorClass: "validation", errorCodes: ["validation:price"], warnings: [],
    retryable: false, disposition: "quarantined", attempts: 0, createdAt: NOW,
  }] as ChunkCommit["quarantine"],
  checkpoint: { rowOffset: 600, lastRecordHash: "rh2", inputCursor: "row:600" },
  events: [], durationMs: 12, ...over,
});

describe("commitChunk", () => {
  it("sends ONE bounded RPC carrying the whole chunk, in the shape the RPC destructures", async () => {
    const gw = new FakeGateway();
    gw.rpcResults.commit_intake_chunk = { committed: true, already_committed: false, job_version: 4 };
    const res = await storeWith(gw).commitChunk(commit(), NOW);

    expect(gw.calls).toHaveLength(1);                       // never emulated in app code
    expect(gw.calls[0].fn).toBe("commit_intake_chunk");
    expect(gw.calls[0].args).toMatchObject({ p_job_id: JOB_ID, p_worker_id: "worker_1", p_job_version: 3 });

    const chunk = gw.calls[0].args.p_chunk as Record<string, unknown>;
    expect(chunk).toMatchObject({ chunkIndex: 2, rowOffsetStart: 400, rowOffsetEnd: 600, dedupScope: SOURCE_ID });
    expect(chunk.dedupRefs).toEqual([
      { record_hash: "rh1", draft_ref: "d1" },
      { record_hash: "rh2", draft_ref: expect.stringContaining("q_") },   // rejected rows have no draft
    ]);
    expect(chunk.productKeys).toEqual([{ key: "p1", price: 19.99, draft_ref: "d1" }]);
    expect(chunk.draftRefs).toEqual([{ draft_ref: "d1", record_hash: "rh1", conflict_state: "none" }]);
    expect(chunk.quarantine).toEqual([{
      record_index: 401, source_ref: "gs://b/o#1", excerpt: "bad", record_hash: "rh9",
      error_class: "validation", error_codes: ["validation:price"], retryable: false,
    }]);
    expect(res).toEqual({ committed: true, alreadyCommitted: false, jobVersion: 4 });
  });

  it("reports a replayed chunk as already committed instead of double counting", async () => {
    const gw = new FakeGateway();
    gw.rpcResults.commit_intake_chunk = { committed: false, already_committed: true, job_version: 4 };
    const res = await storeWith(gw).commitChunk(commit(), NOW);
    expect(res).toEqual({ committed: false, alreadyCommitted: true, jobVersion: 4 });
  });

  it("raises StaleWorkerError when another worker owns the lease", async () => {
    const gw = new FakeGateway();
    gw.rpcErrors.commit_intake_chunk = { message: "stale_worker: lease" };
    await expect(storeWith(gw).commitChunk(commit(), NOW)).rejects.toBeInstanceOf(StaleWorkerError);
  });

  it("raises IntegrityError when the RPC returns nothing", async () => {
    const gw = new FakeGateway();
    gw.rpcResults.commit_intake_chunk = null;
    await expect(storeWith(gw).commitChunk(commit(), NOW)).rejects.toBeInstanceOf(IntegrityError);
  });
});

// ── Control + finalize + reconciliation ──────────────────────────────────────

describe("control and finalize", () => {
  it("routes pause/resume/cancel through the single control RPC", async () => {
    const gw = new FakeGateway();
    gw.rpcResults.set_intake_job_control = jobRow({ paused_at: NOW });
    const store = storeWith(gw);
    await store.requestPause(JOB_ID, NOW);
    await store.requestResume(JOB_ID, NOW);
    await store.requestCancel(JOB_ID, NOW);
    expect(gw.calls.map((c) => c.args.p_action)).toEqual(["pause", "resume", "cancel"]);
    expect(new Set(gw.calls.map((c) => c.fn))).toEqual(new Set(["set_intake_job_control"]));
  });

  it("passes the optimistic version to finalize", async () => {
    const gw = new FakeGateway();
    gw.rpcResults.finalize_intake_job = jobRow({ status: "needs_review", version: 9 });
    const job = await storeWith(gw).finalize(JOB_ID, "worker_1", 8, "needs_review", NOW);
    expect(gw.calls[0].args).toMatchObject({ p_job_version: 8, p_status: "needs_review" });
    expect(job.status).toBe("needs_review");
  });

  it("sanitizes the failure message before it is persisted", async () => {
    const gw = new FakeGateway();
    gw.rpcResults.fail_intake_job = jobRow({ status: "failed" });
    await storeWith(gw).markFailed(JOB_ID, "worker_1", 3, "transient", "read gs://secret/obj#2 failed with eyJhbGciOiJzZWNyZXQi", NOW);
    const msg = String(gw.calls[0].args.p_message_sanitized);
    expect(msg).not.toMatch(/secret/);
    expect(msg).not.toMatch(/eyJhbGci/);
  });
});

describe("reconciliation", () => {
  it("reads the durable counters and reports whether they reconcile", async () => {
    const gw = new FakeGateway();
    gw.rpcResults.intake_job_reconciliation = {
      jobId: JOB_ID, processedRows: 200, validRows: 185, rejectedRows: 5, duplicateRows: 10, conflictRows: 5,
      stagedDrafts: 185, evidenceCreated: 185, committedChunks: 1, quarantineRows: 5, dedupKeys: 195,
      checkpointRowOffset: 200, reconciles: true,
    };
    const summary = await storeWith(gw).reconcile(JOB_ID);
    expect(summary.reconciles).toBe(true);
    expect(summary).toMatchObject({ processedRows: 200, committedChunks: 1, checkpointRowOffset: 200 });
  });

  it("reports a mismatch honestly rather than smoothing it over", async () => {
    const gw = new FakeGateway();
    gw.rpcResults.intake_job_reconciliation = { jobId: JOB_ID, processedRows: 200, validRows: 100, reconciles: false };
    expect((await storeWith(gw).reconcile(JOB_ID)).reconciles).toBe(false);
  });
});
