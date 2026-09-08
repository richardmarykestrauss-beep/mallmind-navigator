/**
 * Publication batch planning.
 *
 * Created only AFTER review. Evaluates every offer independently, lists eligible
 * vs blocked (preserving blockers), is idempotent, performs NO publication in
 * dry-run, requires explicit apply, and never downgrades a blocker to a warning.
 * A deterministic local executor — no production DB in this sprint.
 */

import type { FabricDatabase } from "../types";
import type { IngestionDatabase, ProductOffer } from "@/lib/ingestion/model";
import type { PublicationPlan } from "./types";
import { offerPublication } from "../assistantSafe";
import { applyPublication } from "../offerBridge";
import { makeEvent } from "../events";

/** Approved offers derived from a given set of draft ids (the caller scopes to a job). */
export function offersForDrafts(ingestion: IngestionDatabase, draftIds: string[]): ProductOffer[] {
  const set = new Set(draftIds);
  return ingestion.offers.filter((o) => o.reviewStatus === "approved" && o.draftId != null && set.has(o.draftId));
}

export interface PlanResult {
  fabric: FabricDatabase;
  ingestion: IngestionDatabase;
  plan: PublicationPlan;
  event: ReturnType<typeof makeEvent>;
}

/**
 * Build (dry-run) or apply a publication plan over the approved offers linked to
 * a job. Dry-run writes nothing; apply sets `published` ONLY for eligible offers.
 * Idempotent: re-running apply yields the same published set.
 */
export function planPublication(
  fabric: FabricDatabase, ingestion: IngestionDatabase, offers: ProductOffer[], intakeJobId: string, mode: "dry_run" | "apply", nowMs: number, nowIso: string,
): PlanResult {
  const eligible: string[] = [];
  const blocked: { draftId: string; blockers: string[] }[] = [];
  let ing = ingestion;
  let applied = 0;

  for (const offer of offers) {
    const decision = offerPublication(offer, fabric, nowMs);
    const draftId = offer.draftId ?? offer.id;
    if (decision.eligible) {
      eligible.push(draftId);
      if (mode === "apply" && !offer.published) {
        const published = applyPublication(offer, decision, nowIso);
        ing = { ...ing, offers: ing.offers.map((o) => (o.id === offer.id ? published : o)) };
        applied++;
      }
    } else {
      blocked.push({ draftId, blockers: decision.blockers }); // blockers preserved, never downgraded
    }
  }

  const plan: PublicationPlan = {
    id: `pubplan_${intakeJobId}_${mode}`, intakeJobId, mode, eligible, blocked, applied, createdAt: nowIso,
  };
  return { fabric, ingestion: ing, plan, event: makeEvent({ type: "publication.plan_created", occurredAt: nowIso, payload: { planId: plan.id, mode, eligible: eligible.length, blocked: blocked.length, applied } }) };
}
