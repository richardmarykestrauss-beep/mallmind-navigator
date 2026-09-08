/**
 * retailStagingPromotion — Sprint 3A.3.
 *
 * Promotes validated durable-intake OfferDrafts into pending observations by calling the
 * migration-040 `stage_retail_feed_observation` RPC — ONE validated record per call.
 *
 * Boundaries (enforced by construction):
 *  - The ONLY RPC this may call is `stage_retail_feed_observation`. It never writes `products`,
 *    never inserts `retail_price_observations` directly, and never publishes.
 *  - The RPC is the identity/replay/rights/lifecycle authority; this layer only maps + reports.
 *  - A per-row failure is captured and left retryable; it never aborts the whole batch, and the
 *    RPC's own idempotency (md5 + unique-pending index) makes a retry non-duplicating.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { OfferDraft } from "@/lib/fabric/types";
import { offerDraftToStageArgs, type StageMappingContext, type StageRetailFeedObservationArgs } from "./canonicalStagingMapper";

/** Coded outcome row returned by the staging RPC. */
export interface StageOutcomeRow {
  outcome: "staged" | "replayed" | "conflict" | "mapping_required" | "rejected";
  observation_id: string | null;
  listing_id: string | null;
  review_status: string | null;
  mapping_outcome: string | null;
  observation_identity: string | null;
  explanation: string | null;
}

/** Minimal port so the promoter is unit-testable with no database. */
export interface StageRpcCaller {
  stage(args: StageRetailFeedObservationArgs): Promise<StageOutcomeRow>;
}

/** The single RPC this gateway is permitted to call. */
const STAGING_RPC = "stage_retail_feed_observation";

/** Service-role caller scoped to exactly the staging RPC (no other table/RPC access). */
export class SupabaseStagingGateway implements StageRpcCaller {
  constructor(private readonly client: SupabaseClient) {}
  async stage(args: StageRetailFeedObservationArgs): Promise<StageOutcomeRow> {
    const { data, error } = await this.client.rpc(STAGING_RPC, args as unknown as Record<string, unknown>);
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    if (!row || typeof row.outcome !== "string") throw new Error("staging RPC returned no outcome row");
    return row as StageOutcomeRow;
  }
}

export interface PromotionResult {
  draftRef: string;
  ok: boolean;
  outcome: StageOutcomeRow["outcome"] | "error";
  observationId: string | null;
  mappingOutcome: string | null;
  explanation: string | null;
}

export interface PromotionSummary {
  total: number;
  staged: number;
  replayed: number;
  conflict: number;
  mappingRequired: number;
  rejected: number;
  errors: number;
  results: PromotionResult[];
}

export interface PromoteOptions {
  actorId: string;
  intakeJobId: string;
  sourceFileName?: string | null;
  /** draft.id → source row number, when the caller can supply it (optional, never guessed). */
  rowNumberFor?: (draft: OfferDraft) => number | null;
}

const emptySummary = (): PromotionSummary => ({
  total: 0, staged: 0, replayed: 0, conflict: 0, mappingRequired: 0, rejected: 0, errors: 0, results: [],
});

/**
 * Promote each validated OfferDraft through the staging RPC. Returns an honest per-row +
 * aggregate summary. Never throws for a single-row failure — that row is retryable.
 */
export async function promoteDrafts(
  drafts: OfferDraft[],
  caller: StageRpcCaller,
  opts: PromoteOptions,
): Promise<PromotionSummary> {
  const summary = emptySummary();
  for (const draft of drafts) {
    summary.total++;
    const ctx: StageMappingContext = {
      actorId: opts.actorId,
      intakeJobId: opts.intakeJobId,
      draftRef: draft.id,
      sourceFileName: opts.sourceFileName ?? null,
      sourceRowNumber: opts.rowNumberFor?.(draft) ?? null,
    };
    try {
      const args = offerDraftToStageArgs(draft, ctx);
      const row = await caller.stage(args);
      switch (row.outcome) {
        case "staged": summary.staged++; break;
        case "replayed": summary.replayed++; break;
        case "conflict": summary.conflict++; break;
        case "mapping_required": summary.mappingRequired++; break;
        case "rejected": summary.rejected++; break;
      }
      summary.results.push({
        draftRef: draft.id, ok: true, outcome: row.outcome,
        observationId: row.observation_id, mappingOutcome: row.mapping_outcome, explanation: row.explanation,
      });
    } catch (err) {
      summary.errors++;
      summary.results.push({
        draftRef: draft.id, ok: false, outcome: "error", observationId: null, mappingOutcome: null,
        explanation: (err instanceof Error ? err.message : String(err)).slice(0, 160),
      });
    }
  }
  return summary;
}
