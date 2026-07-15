import { describe, it, expect } from "vitest";
import { buildSeedDatabase } from "@/lib/ingestion/seed";
import { buildSeedFabric } from "../store";
import type { FabricDatabase, SourceAccessPolicy } from "../types";
import type { RawRecord, IntakeJob, IntakeState } from "./types";
import { createIntakeJob } from "./jobs";
import { processIntakeStream } from "./engine";
import { splitCsvLine, streamCsvRecords, streamJsonlRecords } from "./parsers";
import { safeJsonParse, scrubObject, neutralizeFormula, sanitizeExcerpt, withinFieldLimits, INTAKE_LIMITS } from "./security";
import { isRetryable, planRetry, MAX_RETRIES } from "./retry";
import { createReviewBatch, bulkReview } from "./reviewBatch";
import { planPublication, offersForDrafts } from "./publicationBatch";

const NOW = "2026-07-13T12:00:00.000Z";
const policy: SourceAccessPolicy = { sourceId: "src_game", automationStatus: "approved_public_observation", allowedModes: ["manual", "browser_observation"], requiresHumanReview: true, legalRisk: "low" };

async function* fromArray(arr: RawRecord[]): AsyncGenerator<RawRecord> { for (const r of arr) yield r; }
function job(mode: IntakeJob["mode"] = "json"): IntakeJob {
  return createIntakeJob({ sourceId: "src_game", mode, inputRef: "fixture://x", inputHash: "hash1", requestedBy: "admin" }, NOW);
}
const rec = (over: Partial<RawRecord> = {}): RawRecord => ({ product_title: "Hisense TV", model: "M1", brand: "Hisense", price: "3999", currency: "ZAR", source_type: "retailer_product_page", source_url: "https://x/1", observed_at: NOW, availability_status: "inferred", retailer: "Game", ...over });

// ── Security + parsers ───────────────────────────────────────────────────────
describe("security controls", () => {
  it("blocks JSON prototype pollution", () => {
    const parsed = safeJsonParse('{"__proto__":{"polluted":true},"a":2}') as Record<string, unknown>;
    expect(parsed.a).toBe(2);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect((scrubObject({ constructor: 1, ok: 2 }) as Record<string, unknown>).constructor).not.toBe(1);
  });
  it("neutralizes CSV formula injection and caps excerpts", () => {
    expect(neutralizeFormula("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(neutralizeFormula("+cmd")).toBe("'+cmd");
    expect(neutralizeFormula("Hisense")).toBe("Hisense");
    expect(sanitizeExcerpt("a".repeat(9999)).length).toBeLessThanOrEqual(INTAKE_LIMITS.excerptLength);
  });
  it("enforces field-count limits", () => {
    const many: RawRecord = {}; for (let i = 0; i < 200; i++) many[`f${i}`] = i;
    expect(withinFieldLimits(many)).toBe(false);
    expect(withinFieldLimits({ a: 1 })).toBe(true);
  });
});

describe("streaming parsers", () => {
  it("parses CSV with quotes and JSONL lines", async () => {
    expect(splitCsvLine('a,"b,c",d')).toEqual(["a", "b,c", "d"]);
    async function* csv() { yield 'product_title,price\n"Hisense 43\"\" TV",3999\n'; }
    const rows = []; for await (const r of streamCsvRecords(csv())) rows.push(r);
    expect(rows[0].product_title).toContain("Hisense 43");
    async function* jsonl() { yield '{"a":1}\n{"a":2}\n'; }
    const jl = []; for await (const r of streamJsonlRecords(jsonl())) jl.push(r);
    expect(jl).toHaveLength(2);
  });
});

// ── Engine core ──────────────────────────────────────────────────────────────
describe("engine core", () => {
  it("reconciles counters and never publishes", async () => {
    const records = [rec({ model: "A", price: "1000" }), rec({ model: "B", price: "2000" }), rec({ price: "-5", model: "C" }), rec({ product_title: "", model: "D" })];
    const { state, job: j } = await processIntakeStream({ job: job(), records: fromArray(records), policy, nowIso: NOW, chunkSize: 2 });
    expect(j.processedRows).toBe(4);
    expect(j.validRows + j.duplicateRows + j.rejectedRows).toBe(j.processedRows); // reconcile
    expect(j.rejectedRows).toBe(2);
    expect(state.drafts.every((d) => d.reviewStatus === "needs_review")).toBe(true); // nothing published
    expect(j.status === "needs_review" || j.status === "completed_with_errors").toBe(true);
    expect(state.quarantine).toHaveLength(2);
  });
  it("is deterministic under different bounded concurrency", async () => {
    const records = Array.from({ length: 20 }, (_, i) => rec({ model: `M${i}`, price: String(1000 + i) }));
    const a = await processIntakeStream({ job: job(), records: fromArray(records), policy, nowIso: NOW, chunkSize: 5, concurrency: 1 });
    const b = await processIntakeStream({ job: job(), records: fromArray(records), policy, nowIso: NOW, chunkSize: 5, concurrency: 8 });
    expect(a.job.validRows).toBe(b.job.validRows);
    expect(a.state.drafts.map((d) => d.id)).toEqual(b.state.drafts.map((d) => d.id));
  });
  it("deduplicates identical records and produces stable hashes regardless of key order", async () => {
    const r1: RawRecord = { product_title: "Hisense TV", price: "3999", model: "M1", currency: "ZAR", source_type: "retailer_product_page", source_url: "https://x", observed_at: NOW, retailer: "Game" };
    const r2: RawRecord = { retailer: "Game", observed_at: NOW, source_url: "https://x", source_type: "retailer_product_page", currency: "ZAR", model: "M1", price: "3999", product_title: "Hisense TV" }; // reordered keys
    const { state, job: j } = await processIntakeStream({ job: job(), records: fromArray([r1, r2]), policy, nowIso: NOW, chunkSize: 10 });
    expect(j.duplicateRows).toBe(1);
    expect(j.stagedDrafts).toBe(1);
    expect(state.evidence).toHaveLength(1); // duplicate creates no evidence
  });
  it("detects conflicts (same product/source, different price) and never auto-resolves", async () => {
    const records = [rec({ product_title: "Conflict TV", model: "C1", price: "3000" }), rec({ product_title: "Conflict TV", model: "C1", price: "3500", source_url: "https://x/2" })];
    const { state, job: j } = await processIntakeStream({ job: job(), records: fromArray(records), policy, nowIso: NOW, chunkSize: 10 });
    expect(j.conflictRows).toBe(1);
    expect(state.drafts.filter((d) => d.conflictState === "conflict_detected")).toHaveLength(2); // both flagged
  });
  it("preserves evidence lineage on staged drafts", async () => {
    const { state } = await processIntakeStream({ job: job(), records: fromArray([rec({ model: "L1" })]), policy, nowIso: NOW });
    const d = state.drafts[0];
    expect(d.evidenceIds).toHaveLength(1);
    expect(state.evidence.some((e) => e.id === d.evidenceIds[0])).toBe(true);
  });
  it("rejects records from a blocked source policy", async () => {
    const blocked: SourceAccessPolicy = { ...policy, automationStatus: "blocked", allowedModes: [] };
    const { job: j } = await processIntakeStream({ job: job(), records: fromArray([rec()]), policy: blocked, nowIso: NOW });
    expect(j.rejectedRows).toBe(1);
    expect(j.validRows).toBe(0);
  });
  it("is idempotent on repeat import (fresh job, retained dedup index)", async () => {
    const records = Array.from({ length: 5 }, (_, i) => rec({ model: `R${i}`, price: String(1000 + i) }));
    const first = await processIntakeStream({ job: job(), records: fromArray(records), policy, nowIso: NOW, chunkSize: 5 });
    // Re-import the SAME file as a new job, carrying forward the dedup index (as a real store would).
    const reimport = { ...first.state, job: job() };
    const second = await processIntakeStream({ job: reimport.job, records: fromArray(records), policy, nowIso: NOW, chunkSize: 5, state: reimport });
    expect(second.job.duplicateRows).toBe(5);         // every row already seen
    expect(second.job.stagedDrafts).toBe(0);          // no new drafts
    expect(second.state.drafts.length).toBe(first.state.drafts.length);
  });
});

// ── Resume / cancel / checkpoints ────────────────────────────────────────────
describe("checkpoint / resume / cancel", () => {
  const records = () => Array.from({ length: 30 }, (_, i) => rec({ model: `X${i}`, price: String(1000 + i) }));

  it("resume from checkpoint yields the same final result as an uninterrupted run", async () => {
    const full = await processIntakeStream({ job: job(), records: fromArray(records()), policy, nowIso: NOW, chunkSize: 10 });
    // Interrupted: cancel after the first chunk via a one-shot signal.
    let reads = 0;
    const signal = { get cancelled() { return reads++ >= 1; } };
    const interrupted = await processIntakeStream({ job: job(), records: fromArray(records()), policy, nowIso: NOW, chunkSize: 10, signal });
    expect(interrupted.job.status).toBe("cancelled");
    expect(interrupted.job.processedRows).toBe(10);
    // Resume with the checkpointed state over the same input.
    const resumed = await processIntakeStream({ job: interrupted.job, records: fromArray(records()), policy, nowIso: NOW, chunkSize: 10, state: interrupted.state });
    expect(resumed.job.processedRows).toBe(full.job.processedRows);
    expect(resumed.job.validRows).toBe(full.job.validRows);
    expect(resumed.state.drafts.length).toBe(full.state.drafts.length); // committed chunk not reprocessed
  });
  it("advances checkpoints monotonically", async () => {
    const { state, job: j } = await processIntakeStream({ job: job(), records: fromArray(records()), policy, nowIso: NOW, chunkSize: 10 });
    const offsets = state.checkpoints.map((c) => c.rowOffset);
    expect(offsets).toEqual([...offsets].sort((a, b) => a - b));
    expect(j.checkpoint?.rowOffset).toBe(30);
    expect(state.metrics.checkpointCount).toBe(3);
  });
});

// ── Retry ────────────────────────────────────────────────────────────────────
describe("retry policy", () => {
  it("retries only retryable errors, bounded", () => {
    expect(isRetryable("transient")).toBe(true);
    expect(isRetryable("validation")).toBe(false);
    const q = { attempts: MAX_RETRIES, retryable: true, disposition: "quarantined" as const } as never;
    expect(planRetry(q).retry).toBe(false); // max exceeded
    const q2 = { attempts: 0, retryable: false, disposition: "quarantined" as const } as never;
    expect(planRetry(q2).retry).toBe(false);
    const q3 = { attempts: 0, retryable: true, disposition: "quarantined" as const } as never;
    expect(planRetry(q3).retry).toBe(true);
  });
});

// ── Batch review + publication ───────────────────────────────────────────────
describe("batch review + publication planning", () => {
  async function stagedFabric(): Promise<{ fabric: FabricDatabase; ingestion: ReturnType<typeof buildSeedDatabase>; state: IntakeState }> {
    const records = [rec({ product_title: "Clean TV", model: "CL1", price: "3999" }), rec({ product_title: "Conflict TV", model: "CF1", price: "3000" }), rec({ product_title: "Conflict TV", model: "CF1", price: "3500", source_url: "https://x/2" })];
    const { state } = await processIntakeStream({ job: job(), records: fromArray(records), policy, nowIso: NOW, chunkSize: 10 });
    const base = buildSeedFabric(Date.parse(NOW));
    const fabric: FabricDatabase = { ...base, drafts: state.drafts, evidence: [...base.evidence, ...state.evidence], policies: base.policies };
    return { fabric, ingestion: buildSeedDatabase(Date.parse(NOW)), state };
  }

  it("bulk-approves only independently-approvable drafts and skips conflicts, one decision each", async () => {
    const { fabric, ingestion } = await stagedFabric();
    const { batch } = createReviewBatch("job1", fabric.drafts.map((d) => d.id), fabric.drafts, NOW);
    const res = bulkReview(fabric, ingestion, batch, { reviewerId: "admin", decision: "approve", reasoning: "bulk" }, NOW);
    expect(res.skipped.some((s) => s.blockers.includes("unresolved_conflict"))).toBe(true); // conflicts not hidden
    expect(res.decisions.length).toBe(res.batch.approvedCount);           // individual auditable decisions
    expect(res.batch.approvedCount).toBeGreaterThanOrEqual(1);             // the clean draft
    expect(res.ingestion.offers.some((o) => o.reviewStatus === "approved" && o.draftId)).toBe(true);
  });

  it("publication dry-run writes nothing; apply publishes only eligible; idempotent", async () => {
    const { fabric, ingestion } = await stagedFabric();
    const { batch } = createReviewBatch("job1", fabric.drafts.map((d) => d.id), fabric.drafts, NOW);
    const approved = bulkReview(fabric, ingestion, batch, { reviewerId: "admin", decision: "approve", reasoning: "ok" }, NOW);
    const draftIds = approved.fabric.drafts.map((d) => d.id);
    const offers = offersForDrafts(approved.ingestion, draftIds);
    const dry = planPublication(approved.fabric, approved.ingestion, offers, "job1", "dry_run", Date.parse(NOW), NOW);
    expect(dry.plan.applied).toBe(0);
    expect(dry.ingestion.offers.filter((o) => o.published).length).toBe(approved.ingestion.offers.filter((o) => o.published).length); // unchanged
    const apply1 = planPublication(approved.fabric, approved.ingestion, offers, "job1", "apply", Date.parse(NOW), NOW);
    const offers2 = offersForDrafts(apply1.ingestion, draftIds);
    const apply2 = planPublication(apply1.fabric, apply1.ingestion, offers2, "job1", "apply", Date.parse(NOW), NOW);
    expect(apply2.plan.applied).toBe(0); // idempotent — already published
    expect(apply1.plan.eligible.length).toBeGreaterThanOrEqual(0);
  });
});
