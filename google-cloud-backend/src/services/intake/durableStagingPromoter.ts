/**
 * durableStagingPromoter — Sprint 3A.4 crash-safe canonical promotion.
 *
 * Restart-safe flow per draft:
 *   1. persist the normalized candidate (RPC args) on the durable draft   [persist_draft_staging_candidate]
 *   2. call stage_retail_feed_observation()                                [the sole staging authority]
 *   3. record the outcome + promotion_state on the durable draft          [record_draft_promotion]
 * A crash after (1) or after (2) leaves the draft re-promotable; `resumePending` reloads persisted
 * candidates and re-promotes. The DB RPC (md5 + unique-pending index) is the final replay authority,
 * so re-promotion of an already-staged row returns 'replayed', never a duplicate. Never writes products.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { OfferDraft } from "@/lib/fabric/types";
import { offerDraftToStageArgs, type StageRetailFeedObservationArgs } from "./canonicalStagingMapper";
import type { StageRpcCaller, StageOutcomeRow } from "./retailStagingPromotion";

export const CANDIDATE_VERSION = "stage_retail_feed_observation.v1";

/** Durable ledger port (write via RPC; testable with a fake). */
export interface DraftLedgerPort {
  persistCandidate(jobId: string, draftRef: string, candidate: StageRetailFeedObservationArgs, version: string): Promise<void>;
  recordPromotion(jobId: string, draftRef: string, state: DraftPromotionState, observationId: string | null, outcome: string): Promise<void>;
  listPromotable(jobId: string): Promise<Array<{ draftRef: string; candidate: StageRetailFeedObservationArgs; attempts: number }>>;
}

export type DraftPromotionState = "eligible" | "promoted" | "failed" | "skipped";

/** staged/replayed = done; rejected/conflict = terminal (needs human); mapping_required = retryable. */
export function stateForOutcome(outcome: StageOutcomeRow["outcome"]): DraftPromotionState {
  switch (outcome) {
    case "staged":
    case "replayed": return "promoted";
    case "mapping_required": return "failed";     // retryable once an approved mapping exists
    case "conflict":
    case "rejected": return "skipped";            // terminal — surfaced for review, not auto-retried
  }
}

const LEDGER_RPCS = new Set(["persist_draft_staging_candidate", "record_draft_promotion", "list_promotable_drafts"]);

/** Service-role ledger gateway scoped to exactly the three 041 ledger RPCs. */
export class SupabaseDraftLedgerGateway implements DraftLedgerPort {
  constructor(private readonly client: SupabaseClient) {}
  private async rpc(fn: string, args: Record<string, unknown>): Promise<unknown> {
    if (!LEDGER_RPCS.has(fn)) throw new Error(`ledger rpc not allowed: ${fn}`);
    const { data, error } = await this.client.rpc(fn, args);
    if (error) throw error;
    return data;
  }
  async persistCandidate(jobId: string, draftRef: string, candidate: StageRetailFeedObservationArgs, version: string): Promise<void> {
    await this.rpc("persist_draft_staging_candidate", { p_job_id: jobId, p_draft_ref: draftRef, p_candidate: candidate, p_version: version });
  }
  async recordPromotion(jobId: string, draftRef: string, state: DraftPromotionState, observationId: string | null, outcome: string): Promise<void> {
    await this.rpc("record_draft_promotion", { p_job_id: jobId, p_draft_ref: draftRef, p_state: state, p_observation_id: observationId, p_outcome: outcome });
  }
  async listPromotable(jobId: string): Promise<Array<{ draftRef: string; candidate: StageRetailFeedObservationArgs; attempts: number }>> {
    const rows = (await this.rpc("list_promotable_drafts", { p_job_id: jobId })) as Array<Record<string, unknown>>;
    return (rows ?? []).map((r) => ({ draftRef: String(r.draft_ref), candidate: r.staging_candidate as StageRetailFeedObservationArgs, attempts: Number(r.promotion_attempts ?? 0) }));
  }
}

export interface DurablePromotionSummary {
  total: number; staged: number; replayed: number; conflict: number; mappingRequired: number; rejected: number; errors: number;
}
const empty = (): DurablePromotionSummary => ({ total: 0, staged: 0, replayed: 0, conflict: 0, mappingRequired: 0, rejected: 0, errors: 0 });

function tally(s: DurablePromotionSummary, o: StageOutcomeRow["outcome"]): void {
  if (o === "staged") s.staged++; else if (o === "replayed") s.replayed++; else if (o === "conflict") s.conflict++;
  else if (o === "mapping_required") s.mappingRequired++; else if (o === "rejected") s.rejected++;
}

export interface DurablePromoteDeps {
  caller: StageRpcCaller;
  ledger: DraftLedgerPort;
  actorId: string;
  intakeJobId: string;
  /** Test hook: throw AFTER candidate persist / AFTER stage, to exercise restart windows. */
  crashHooks?: { afterPersist?: (draftRef: string) => void; afterStage?: (draftRef: string) => void };
}

/** One durable promotion attempt for one candidate. persist? → stage → record. */
async function promoteOne(candidate: StageRetailFeedObservationArgs, draftRef: string, deps: DurablePromoteDeps, s: DurablePromotionSummary, doPersist: boolean): Promise<void> {
  s.total++;
  try {
    if (doPersist) { await deps.ledger.persistCandidate(deps.intakeJobId, draftRef, candidate, CANDIDATE_VERSION); deps.crashHooks?.afterPersist?.(draftRef); }
    const row = await deps.caller.stage(candidate);
    deps.crashHooks?.afterStage?.(draftRef);
    tally(s, row.outcome);
    await deps.ledger.recordPromotion(deps.intakeJobId, draftRef, stateForOutcome(row.outcome), row.observation_id, row.outcome);
  } catch (err) {
    s.errors++;
    // Leave the draft retryable (state stays 'eligible' or set 'failed'); never abort the batch.
    try { await deps.ledger.recordPromotion(deps.intakeJobId, draftRef, "failed", null, `error:${(err instanceof Error ? err.message : String(err)).slice(0, 80)}`); } catch { /* record best-effort */ }
  }
}

/** Initial run: map this run's in-memory drafts, persist candidate, promote, record. */
export async function promoteRun(drafts: OfferDraft[], deps: DurablePromoteDeps): Promise<DurablePromotionSummary> {
  const s = empty();
  for (const d of drafts) {
    const candidate = offerDraftToStageArgs(d, { actorId: deps.actorId, intakeJobId: deps.intakeJobId, draftRef: d.id });
    await promoteOne(candidate, d.id, deps, s, true);
  }
  return s;
}

/** Restart recovery: re-promote persisted candidates that are not yet 'promoted'. */
export async function resumePending(deps: DurablePromoteDeps): Promise<DurablePromotionSummary> {
  const s = empty();
  const pending = await deps.ledger.listPromotable(deps.intakeJobId);
  for (const p of pending) await promoteOne(p.candidate, p.draftRef, deps, s, false);
  return s;
}
