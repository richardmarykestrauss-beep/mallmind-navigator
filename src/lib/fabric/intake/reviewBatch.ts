/**
 * Batch review over staged drafts.
 *
 * A ReviewBatch groups a job's staged drafts. Bulk approval approves ONLY drafts
 * that independently pass approval rules — one invalid/conflicted draft is never
 * hidden by a bulk action, and every draft gets its own auditable ReviewDecision.
 */

import type { FabricDatabase, OfferDraft, ReviewDecision } from "../types";
import type { IngestionDatabase } from "@/lib/ingestion/model";
import type { ReviewBatch } from "./types";
import { approvalBlockers, type DecisionInput } from "../review";
import { submitDecision } from "../bridgeStore";
import { makeEvent } from "../events";

export interface DraftFilter {
  sourceId?: string;
  retailerName?: string;
  category?: string;
  mallId?: string;
  minConfidence?: number;
  hasWarning?: boolean;
  conflictOnly?: boolean;
  expiringBefore?: string;
  geographicScope?: OfferDraft["geographicScope"];
}

export function filterDrafts(drafts: OfferDraft[], f: DraftFilter): OfferDraft[] {
  return drafts.filter((d) => {
    if (f.sourceId && d.sourceId !== f.sourceId) return false;
    if (f.retailerName && d.retailerName !== f.retailerName) return false;
    if (f.category && d.category !== f.category) return false;
    if (f.mallId && d.mallId !== f.mallId) return false;
    if (f.minConfidence != null && d.confidence.identityConfidence < f.minConfidence) return false;
    if (f.hasWarning && d.warnings.length === 0) return false;
    if (f.conflictOnly && d.conflictState !== "conflict_detected") return false;
    if (f.geographicScope && d.geographicScope !== f.geographicScope) return false;
    if (f.expiringBefore && !(d.expiresAt && d.expiresAt < f.expiringBefore)) return false;
    return true;
  });
}

export function createReviewBatch(intakeJobId: string, draftIds: string[], drafts: OfferDraft[], nowIso: string): { batch: ReviewBatch; event: ReturnType<typeof makeEvent> } {
  const conflictCount = drafts.filter((d) => draftIds.includes(d.id) && d.conflictState === "conflict_detected").length;
  const batch: ReviewBatch = {
    id: `rb_${intakeJobId}_${draftIds.length}`, intakeJobId, status: "open", draftIds,
    approvedCount: 0, rejectedCount: 0, changesRequestedCount: 0, conflictCount, createdAt: nowIso, updatedAt: nowIso,
  };
  return { batch, event: makeEvent({ type: "review.batch_created", occurredAt: nowIso, payload: { batchId: batch.id, drafts: draftIds.length } }) };
}

export interface BulkReviewResult {
  fabric: FabricDatabase;
  ingestion: IngestionDatabase;
  batch: ReviewBatch;
  decisions: ReviewDecision[];
  skipped: { draftId: string; blockers: string[] }[];
}

/**
 * Apply a bulk decision. For "approve", only drafts that INDEPENDENTLY meet
 * approval rules are approved (each via a real, individual, auditable decision);
 * blocked/conflicted drafts are skipped and reported. reject/request_changes/
 * archive apply per-draft too.
 */
export function bulkReview(
  fabric: FabricDatabase, ingestion: IngestionDatabase, batch: ReviewBatch, input: DecisionInput, nowIso: string,
): BulkReviewResult {
  let f = fabric, ing = ingestion;
  const decisions: ReviewDecision[] = [];
  const skipped: { draftId: string; blockers: string[] }[] = [];
  const updated: ReviewBatch = { ...batch };

  for (const draftId of batch.draftIds) {
    const draft = f.drafts.find((d) => d.id === draftId);
    if (!draft) continue;
    if (input.decision === "approve") {
      const evidence = draft.evidenceIds.map((id) => f.evidence.find((e) => e.id === id)).filter(Boolean) as FabricDatabase["evidence"];
      const policy = f.policies.find((p) => p.sourceId === draft.sourceId);
      const blockers = approvalBlockers(draft, input, evidence, policy);
      if (blockers.length > 0) { skipped.push({ draftId, blockers }); continue; }
    }
    const res = submitDecision(f, ing, draftId, input, nowIso); // individual auditable decision
    f = res.fabric; ing = res.ingestion; decisions.push(res.decision);
    if (input.decision === "approve") updated.approvedCount++;
    else if (input.decision === "reject") updated.rejectedCount++;
    else if (input.decision === "request_changes") updated.changesRequestedCount++;
  }
  updated.status = skipped.length === 0 && decisions.length === batch.draftIds.length ? "completed" : "partially_reviewed";
  updated.updatedAt = nowIso;
  return { fabric: f, ingestion: ing, batch: updated, decisions, skipped };
}
