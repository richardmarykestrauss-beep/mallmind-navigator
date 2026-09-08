/**
 * Review decision model — explicit, auditable, append-only.
 *
 * Decisions never overwrite prior decisions (each carries `previousDecisionId` +
 * `decisionVersion`). Corrections are explicit field patches, not silent edits to
 * the draft or evidence. Approval is guarded: it requires evidence, price, title,
 * observedAt and source; branch availability requires branch-scoped evidence;
 * verified_live requires a supporting policy + evidence; unresolved conflicts
 * block approval.
 */

import type {
  OfferDraft, ReviewDecision, ReviewDecisionType, FieldPatch, EvidenceRecord, SourceAccessPolicy, GeographicScope,
} from "./types";
import type { AvailabilityStatus, PriceTrustLabel } from "@/lib/ingestion/model";

let seq = 0;
function id(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return `rev_${crypto.randomUUID()}`;
  seq += 1;
  return `rev_seq${seq}`;
}

/** Branch-capable evidence = an observation that establishes branch-level presence. */
export function hasBranchEvidence(evidence: EvidenceRecord[]): boolean {
  return evidence.some((e) => (e.fieldConfidence?.locationConfidence ?? 0) >= 0.5);
}

/** verified_live needs an authorized source policy AND high source-authority evidence. */
export function supportsLiveVerification(policy: SourceAccessPolicy | undefined, evidence: EvidenceRecord[]): boolean {
  if (!policy) return false;
  const authorized = policy.automationStatus === "authorized_feed" || policy.automationStatus === "authorized_api";
  return authorized && evidence.some((e) => (e.fieldConfidence?.sourceAuthority ?? 0) >= 0.8);
}

export interface DecisionInput {
  reviewerId: string;
  decision: ReviewDecisionType;
  finalTrustLabel?: PriceTrustLabel | null;
  approvedAvailabilityStatus?: AvailabilityStatus | null;
  approvedGeographicScope?: GeographicScope | null;
  correctedFields?: FieldPatch[];
  reasoning?: string;
}

export class ReviewValidationError extends Error {
  constructor(public blockers: string[]) {
    super(`Approval blocked: ${blockers.join("; ")}`);
    this.name = "ReviewValidationError";
  }
}

/** Effective conflict state after applying any conflict-resolving correction. */
function effectiveConflict(draft: OfferDraft, patches: FieldPatch[]): string {
  const resolved = patches.some((p) => p.field === "conflictState" && p.to === "resolved");
  return resolved ? "resolved" : draft.conflictState;
}

/** Blockers that would prevent an approval. Empty ⇒ approvable. */
export function approvalBlockers(
  draft: OfferDraft, input: DecisionInput, evidence: EvidenceRecord[], policy: SourceAccessPolicy | undefined,
): string[] {
  const b: string[] = [];
  const patches = input.correctedFields ?? [];
  const get = (field: string, fallback: unknown) => {
    const p = [...patches].reverse().find((x) => x.field === field);
    return p ? p.to : fallback;
  };

  if (draft.evidenceIds.length === 0 || evidence.length === 0) b.push("missing_evidence");
  const price = Number(get("price", draft.price));
  if (!Number.isFinite(price) || price <= 0) b.push("missing_or_invalid_price");
  if (!String(get("productTitle", draft.productTitle) ?? "").trim()) b.push("missing_title");
  if (!draft.observedAt) b.push("missing_observed_at");
  if (!draft.sourceId) b.push("missing_source");

  const scope = (input.approvedGeographicScope ?? get("geographicScope", draft.geographicScope)) as GeographicScope;
  if (scope === "branch" && !hasBranchEvidence(evidence)) b.push("branch_requires_branch_evidence");

  const avail = (input.approvedAvailabilityStatus ?? draft.availabilityStatus) as AvailabilityStatus;
  if (avail === "known_available" && scope === "branch" && !hasBranchEvidence(evidence)) b.push("branch_stock_requires_branch_evidence");

  if (input.finalTrustLabel === "verified_live" && !supportsLiveVerification(policy, evidence)) b.push("verified_live_not_supported");

  if (effectiveConflict(draft, patches) === "conflict_detected") b.push("unresolved_conflict");

  return b;
}

export function canApprove(
  draft: OfferDraft, input: DecisionInput, evidence: EvidenceRecord[], policy: SourceAccessPolicy | undefined,
): { ok: boolean; blockers: string[] } {
  const blockers = approvalBlockers(draft, input, evidence, policy);
  return { ok: blockers.length === 0, blockers };
}

/**
 * Create an append-only ReviewDecision. Approvals are guarded (throws
 * ReviewValidationError if invalid). reject/request_changes/archive always record.
 */
export function decide(
  draft: OfferDraft, input: DecisionInput, priorDecisions: ReviewDecision[], evidence: EvidenceRecord[],
  policy: SourceAccessPolicy | undefined, nowIso: string,
): ReviewDecision {
  if (input.decision === "approve") {
    const { ok, blockers } = canApprove(draft, input, evidence, policy);
    if (!ok) throw new ReviewValidationError(blockers);
  }
  const prior = priorDecisions.filter((d) => d.draftId === draft.id).sort((a, b) => a.decisionVersion - b.decisionVersion);
  const last = prior[prior.length - 1];
  return {
    id: id(),
    draftId: draft.id,
    evidenceIds: [...draft.evidenceIds],
    reviewerId: input.reviewerId,
    decision: input.decision,
    finalTrustLabel: input.finalTrustLabel ?? null,
    approvedAvailabilityStatus: input.approvedAvailabilityStatus ?? null,
    approvedGeographicScope: input.approvedGeographicScope ?? null,
    correctedFields: input.correctedFields ?? [],
    reasoning: input.reasoning ?? "",
    decidedAt: nowIso,
    previousDecisionId: last?.id ?? null,
    decisionVersion: (last?.decisionVersion ?? 0) + 1,
  };
}

/** The latest (highest-version) decision for a draft, if any. */
export function latestDecision(draftId: string, decisions: ReviewDecision[]): ReviewDecision | null {
  const forDraft = decisions.filter((d) => d.draftId === draftId).sort((a, b) => a.decisionVersion - b.decisionVersion);
  return forDraft[forDraft.length - 1] ?? null;
}
