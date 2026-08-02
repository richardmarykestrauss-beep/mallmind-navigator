/**
 * durableStagingPromoterHarness — Sprint 3A.4 crash-safety unit proof (no DB, no network).
 * Run: `npx ts-node --transpile-only src/services/__tests__/durableStagingPromoterHarness.ts`
 *
 * Fakes: an in-memory ledger (mirrors retail_intake_job_drafts + the 041 ledger RPCs) and an
 * idempotent stage caller (mirrors the md5 + unique-pending-index authority: first call per
 * identity → staged; repeat → replayed, SAME observation id). Crash hooks throw to exercise the
 * restart windows. Asserts: no duplicate observation; restart re-promotes; error isolation.
 */

import { promoteRun, resumePending, stateForOutcome, type DraftLedgerPort, type DraftPromotionState } from "../intake/durableStagingPromoter";
import type { StageRetailFeedObservationArgs } from "../intake/canonicalStagingMapper";
import type { StageRpcCaller, StageOutcomeRow } from "../intake/retailStagingPromotion";

let failures = 0;
const ok = (c: boolean, m: string) => { if (!c) { failures++; console.error("FAIL:", m); } };
const eq = (a: unknown, b: unknown, m: string) => ok(JSON.stringify(a) === JSON.stringify(b), `${m} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

// ── Fake idempotent stage RPC (identity = the canonical tuple) ────────────────
class FakeStage implements StageRpcCaller {
  calls = 0;
  private staged = new Map<string, string>();   // identity → observation_id
  boom = new Set<string>();                       // draftRefs that should throw
  private idOf = (a: StageRetailFeedObservationArgs) =>
    [a.p_source_id, a.p_source_product_id ?? a.p_retailer_sku ?? a.p_gtin, a.p_observed_at, a.p_price_scope, a.p_branch_external_id ?? "", a.p_current_price_cents].join("|");
  async stage(a: StageRetailFeedObservationArgs): Promise<StageOutcomeRow> {
    this.calls++;
    if (this.boom.has(a.p_intake_draft_ref ?? "")) throw new Error("db down");
    const id = this.idOf(a);
    if (this.staged.has(id)) return { outcome: "replayed", observation_id: this.staged.get(id)!, listing_id: null, review_status: "pending", mapping_outcome: "not_applicable", observation_identity: id, explanation: null };
    const obs = `obs_${this.staged.size + 1}`; this.staged.set(id, obs);
    return { outcome: "staged", observation_id: obs, listing_id: null, review_status: "pending", mapping_outcome: "not_applicable", observation_identity: id, explanation: null };
  }
  get observationCount() { return this.staged.size; }
}

// ── Fake durable ledger (mirrors retail_intake_job_drafts) ────────────────────
interface Row { candidate: StageRetailFeedObservationArgs | null; state: DraftPromotionState; outcome: string | null; obs: string | null; attempts: number; }
class FakeLedger implements DraftLedgerPort {
  rows = new Map<string, Row>();
  constructor(draftRefs: string[]) { for (const r of draftRefs) this.rows.set(r, { candidate: null, state: "eligible", outcome: null, obs: null, attempts: 0 }); }
  async persistCandidate(_j: string, ref: string, c: StageRetailFeedObservationArgs): Promise<void> {
    const r = this.rows.get(ref) ?? { candidate: null, state: "eligible", outcome: null, obs: null, attempts: 0 };
    if (r.state !== "promoted") r.candidate = c; this.rows.set(ref, r);
  }
  async recordPromotion(_j: string, ref: string, state: DraftPromotionState, obs: string | null, outcome: string): Promise<void> {
    const r = this.rows.get(ref)!; r.state = state; r.obs = obs ?? r.obs; r.outcome = outcome; r.attempts++;
  }
  async listPromotable(_j: string): Promise<Array<{ draftRef: string; candidate: StageRetailFeedObservationArgs; attempts: number }>> {
    return [...this.rows.entries()].filter(([, r]) => (r.state === "eligible" || r.state === "failed") && r.candidate).map(([draftRef, r]) => ({ draftRef, candidate: r.candidate!, attempts: r.attempts }));
  }
}

const draft = (id: string) => ({ id, sourceId: "11111111-1111-1111-1111-111111111111", retailerSku: `SKU-${id}`, gtin: null, productTitle: `P ${id}`, brand: "B", category: "Home", price: 79.99, currency: "ZAR", originalPrice: null, promoText: null, availabilityStatus: "known_available", geographicScope: "national", observedAt: "2026-07-31T10:00:00Z", warnings: [] as string[] }) as unknown as Parameters<typeof promoteRun>[0][number];

// stateForOutcome mapping
eq(stateForOutcome("staged"), "promoted", "staged→promoted");
eq(stateForOutcome("replayed"), "promoted", "replayed→promoted");
eq(stateForOutcome("mapping_required"), "failed", "mapping_required→failed(retry)");
eq(stateForOutcome("rejected"), "skipped", "rejected→skipped(terminal)");
eq(stateForOutcome("conflict"), "skipped", "conflict→skipped(review)");

async function main() {
  // S3 happy path — 3 drafts all staged, all ledger 'promoted', 3 stage calls, 3 unique obs.
  {
    const stage = new FakeStage(); const led = new FakeLedger(["a", "b", "c"]);
    const sum = await promoteRun([draft("a"), draft("b"), draft("c")], { caller: stage, ledger: led, actorId: "act", intakeJobId: "job" });
    eq([sum.staged, sum.errors], [3, 0], "S3 all staged");
    ok([...led.rows.values()].every((r) => r.state === "promoted"), "S3 all ledger promoted");
    eq(stage.calls, 3, "S3 exactly 3 stage calls (no dup)");
  }

  // S1 crash AFTER persist, BEFORE stage → run records 'failed'; restart promotes. 1 stage call total.
  {
    const stage = new FakeStage(); const led = new FakeLedger(["a"]);
    const sum1 = await promoteRun([draft("a")], { caller: stage, ledger: led, actorId: "act", intakeJobId: "job", crashHooks: { afterPersist: () => { throw new Error("crash after persist"); } } });
    eq(sum1.errors, 1, "S1 run records error"); eq(stage.calls, 0, "S1 stage not called in crashed run");
    ok(led.rows.get("a")!.candidate !== null, "S1 candidate persisted before crash");
    const sum2 = await resumePending({ caller: stage, ledger: led, actorId: "act", intakeJobId: "job" });
    eq(sum2.staged, 1, "S1 restart stages"); eq(stage.calls, 1, "S1 exactly 1 stage call across crash+restart");
    eq(led.rows.get("a")!.state, "promoted", "S1 ledger promoted after restart");
  }

  // S2 crash AFTER stage, BEFORE record → observation exists but ledger 'failed'; restart → replay, NOT duplicate.
  {
    const stage = new FakeStage(); const led = new FakeLedger(["a"]);
    const sum1 = await promoteRun([draft("a")], { caller: stage, ledger: led, actorId: "act", intakeJobId: "job", crashHooks: { afterStage: () => { throw new Error("crash after stage"); } } });
    eq(sum1.errors, 1, "S2 run records error"); eq(stage.calls, 1, "S2 stage ran once");
    eq(led.rows.get("a")!.state, "failed", "S2 ledger failed (record didn't run)");
    const sum2 = await resumePending({ caller: stage, ledger: led, actorId: "act", intakeJobId: "job" });
    eq(sum2.replayed, 1, "S2 restart → replayed (idempotent, not duplicate)");
    eq(stage.calls, 2, "S2 two stage calls but one observation");
    eq((stage as any).staged.size, 1, "S2 exactly ONE observation (no duplicate)");
    eq(led.rows.get("a")!.state, "promoted", "S2 ledger promoted after restart");
  }

  // S4 error isolation — one draft's stage throws; batch continues; others staged.
  {
    const stage = new FakeStage(); stage.boom.add("b"); const led = new FakeLedger(["a", "b", "c"]);
    const sum = await promoteRun([draft("a"), draft("b"), draft("c")], { caller: stage, ledger: led, actorId: "act", intakeJobId: "job" });
    eq([sum.staged, sum.errors], [2, 1], "S4 2 staged 1 error (batch not aborted)");
    eq(led.rows.get("b")!.state, "failed", "S4 failed row retryable");
  }

  if (failures > 0) { console.error(`\ndurable-promoter harness: ${failures} FAILURE(S)`); process.exit(1); }
  console.log("durable-promoter harness: ALL CRASH-SAFETY CASES PASSED");
}
void main();
