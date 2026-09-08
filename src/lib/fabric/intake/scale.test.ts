import { describe, it, expect } from "vitest";
import type { SourceAccessPolicy } from "../types";
import type { IntakeJob } from "./types";
import { createIntakeJob } from "./jobs";
import { processIntakeStream } from "./engine";
import { scaleRecords, expectedCounts } from "./scaleFixtures";

/**
 * Scale + resilience harness. CI runs 1,000 and 10,000 deterministic records.
 * The 50,000-record benchmark is gated behind INTAKE_BENCH=1 (extended/local):
 *   INTAKE_BENCH=1 npx vitest run src/lib/fabric/intake/scale.test.ts
 * Reported throughput/memory are ACTUAL measured values from the environment.
 */

const NOW = "2026-07-13T12:00:00.000Z";
const policy: SourceAccessPolicy = { sourceId: "src_bulk", automationStatus: "authorized_feed", allowedModes: ["merchant_feed", "manual", "browser_observation", "catalogue"], requiresHumanReview: true, legalRisk: "low" };
const job = (): IntakeJob => createIntakeJob({ sourceId: "src_bulk", mode: "fixture_load_test", inputRef: "fixture://scale", inputHash: "scale", requestedBy: "bench", estimatedRows: undefined }, NOW);

/** Always-true invariants (hold at any scale). */
function assertReconciles(n: number, j: IntakeJob) {
  expect(j.processedRows).toBe(n);
  expect(j.validRows + j.duplicateRows + j.rejectedRows).toBe(n);        // reconcile
  expect(j.stagedDrafts).toBe(j.validRows);                              // one draft per valid row
  expect(j.evidenceCreated).toBe(j.validRows);                          // one evidence per valid row
  expect(j.rejectedRows).toBeGreaterThan(0);
  expect(j.duplicateRows).toBeGreaterThan(0);
  expect(j.conflictRows).toBeGreaterThan(0);
}

/** Exact per-category counts — deterministic only below the price-collision horizon (~14.5k). */
function assertExactCounts(n: number, j: IntakeJob) {
  const e = expectedCounts(n);
  expect(j.rejectedRows).toBe(e.missing_title + e.invalid_price + e.bad_currency + e.malformed);
  expect(j.duplicateRows).toBe(e.duplicate > 0 ? e.duplicate - 1 : 0);
  expect(j.conflictRows).toBe(e.conflict > 0 ? e.conflict - 1 : 0);
}

describe("scale harness", () => {
  it("processes 1,000 records with reconciling counts and no auto-publish", async () => {
    const { state, job: j } = await processIntakeStream({ job: job(), records: scaleRecords(1000, NOW), policy, nowIso: NOW, chunkSize: 200, concurrency: 8 });
    assertReconciles(1000, j); assertExactCounts(1000, j);
    expect(state.drafts.every((d) => d.reviewStatus === "needs_review")).toBe(true); // nothing published
    expect(state.drafts.some((d) => d.conflictState === "conflict_detected")).toBe(true);
    expect(state.quarantine.length).toBe(j.rejectedRows);
  });

  it("processes 10,000 records deterministically with bounded chunks", async () => {
    const { state, job: j } = await processIntakeStream({ job: job(), records: scaleRecords(10_000, NOW), policy, nowIso: NOW, chunkSize: 1000, concurrency: 8 });
    assertReconciles(10_000, j); assertExactCounts(10_000, j);
    // checkpoints advance monotonically to the end.
    const offsets = state.checkpoints.map((c) => c.rowOffset);
    expect(offsets).toEqual([...offsets].sort((a, b) => a - b));
    expect(j.checkpoint?.rowOffset).toBe(10_000);
    expect(state.drafts.every((d) => d.reviewStatus === "needs_review")).toBe(true);
  });

  it("resume yields the same final result as an uninterrupted run", async () => {
    const full = await processIntakeStream({ job: job(), records: scaleRecords(1000, NOW), policy, nowIso: NOW, chunkSize: 200 });
    let reads = 0;
    const signal = { get cancelled() { return reads++ >= 1; } };
    const interrupted = await processIntakeStream({ job: job(), records: scaleRecords(1000, NOW), policy, nowIso: NOW, chunkSize: 200, signal });
    expect(interrupted.job.status).toBe("cancelled");
    expect(interrupted.job.processedRows).toBe(200);
    const resumed = await processIntakeStream({ job: interrupted.job, records: scaleRecords(1000, NOW), policy, nowIso: NOW, chunkSize: 200, state: interrupted.state });
    expect(resumed.job.processedRows).toBe(full.job.processedRows);
    expect(resumed.job.validRows).toBe(full.job.validRows);
    expect(resumed.job.rejectedRows).toBe(full.job.rejectedRows);
    expect(resumed.state.drafts.length).toBe(full.state.drafts.length); // committed chunks not reprocessed
  });

  it("repeat import is idempotent (retained dedup index → all duplicates, no new drafts)", async () => {
    const first = await processIntakeStream({ job: job(), records: scaleRecords(1000, NOW), policy, nowIso: NOW, chunkSize: 500 });
    const reimport = { ...first.state, job: job() };
    const second = await processIntakeStream({ job: reimport.job, records: scaleRecords(1000, NOW), policy, nowIso: NOW, chunkSize: 500, state: reimport });
    expect(second.job.stagedDrafts).toBe(0);
    expect(second.state.drafts.length).toBe(first.state.drafts.length);
  });

  const BENCH = typeof process !== "undefined" && process.env?.INTAKE_BENCH === "1";
  (BENCH ? it : it.skip)("BENCHMARK: 50,000 records (extended)", async () => {
    const t0 = Date.now();
    const { state, job: j } = await processIntakeStream({ job: job(), records: scaleRecords(50_000, NOW), policy, nowIso: NOW, chunkSize: 2000, concurrency: 8 });
    const secs = (Date.now() - t0) / 1000;
    assertReconciles(50_000, j);
    expect(state.drafts.every((d) => d.reviewStatus === "needs_review")).toBe(true);
    // Report ACTUAL measured values (not asserted numerically).
    // eslint-disable-next-line no-console
    console.log(`[bench] 50k rows in ${secs.toFixed(2)}s → ${Math.round(50_000 / secs)} rows/s; peakHeap=${state.metrics.peakHeapBytes ?? "n/a"} bytes`);
  }, 120_000);
});
