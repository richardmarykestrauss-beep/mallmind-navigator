/**
 * Adapter run orchestrator.
 *
 * Walks a registered adapter through the lifecycle (discover → capture → extract
 * → validate) against local fixtures, enforcing the source policy up front. It
 * produces an EvidenceRecord for every capture, emits typed events, and returns a
 * run summary. It NEVER publishes — the furthest an offer can get here is
 * "needs_review"; approval/publish only ever happens in the human review queue.
 */

import type {
  AdapterRegistration, AdapterRun, ConfidenceDimensions, EvidenceRecord, ExtractionCandidate,
  FabricEvent, ProvenanceLink, SourceAccessPolicy, AdapterMode,
} from "./types";
import { evaluatePolicy } from "./policy";
import { EventCollector } from "./events";
import { createEvidence, linkProvenance } from "./evidence";

let runSeq = 0;
function runId(): string {
  runSeq += 1;
  return `arun_${runSeq}_${(typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `s${runSeq}`).slice(0, 8)}`;
}

const AUTHORITY: Record<AdapterMode, number> = {
  partner_api: 0.95, merchant_feed: 0.9, newsletter: 0.7, catalogue: 0.7,
  json_ld: 0.6, browser_observation: 0.55, manual: 0.5, sitemap: 0.4,
};

function deriveConfidence(ext: ExtractionCandidate, mode: AdapterMode): ConfidenceDimensions {
  const conf = (name: string) => ext.fields.find((f) => f.field === name)?.confidence ?? 0;
  const identity = Math.max(conf("gtin"), conf("model"), conf("sku"), conf("productTitle"));
  return {
    identityConfidence: round(identity),
    priceConfidence: round(conf("price")),
    availabilityConfidence: round(conf("availability")),
    locationConfidence: 0, // none of these sources establish branch location
    freshnessConfidence: 0.8, // fixtures are treated as freshly captured
    sourceAuthority: AUTHORITY[mode],
  };
}
const round = (n: number) => Math.round(n * 100) / 100;

export interface RunResult {
  run: AdapterRun;
  evidence: EvidenceRecord[];
  events: FabricEvent[];
  provenance: ProvenanceLink[];
}

/**
 * Execute an adapter against a source policy. Pure w.r.t. inputs (deterministic
 * given `nowIso`); performs no persistence — the caller writes the result.
 */
export async function runAdapter(
  registration: AdapterRegistration,
  policy: SourceAccessPolicy | undefined,
  nowIso: string,
  discoverInput?: unknown,
): Promise<RunResult> {
  const adapter = registration.adapter;
  const rid = runId();
  const collector = new EventCollector(nowIso);
  const evidence: EvidenceRecord[] = [];
  const provenance: ProvenanceLink[] = [];

  const decision = evaluatePolicy(adapter.mode, policy);
  if (!decision.allowed) {
    collector.emit("source.policy_blocked", { sourceId: adapter.sourceId, adapterId: adapter.adapterId, payload: { reason: decision.reason, message: decision.message } });
    const run: AdapterRun = {
      id: rid, adapterId: adapter.adapterId, sourceId: adapter.sourceId, mode: adapter.mode,
      lifecycleStage: "discovered", candidatesDiscovered: 0, captures: 0, extractedCandidates: 0,
      validationFailures: 0, warnings: 0, evidenceIds: [], eventIds: collector.all().map((e) => e.id),
      status: "blocked", policyDecision: decision, startedAt: nowIso, completedAt: nowIso,
      notes: `Blocked by policy: ${decision.message}`,
    };
    return { run, evidence, events: collector.all(), provenance };
  }

  let captures = 0, extractedCandidates = 0, validationFailures = 0, warnings = 0;
  let stage: AdapterRun["lifecycleStage"] = "discovered";

  const candidates = await adapter.discover(discoverInput);
  for (const c of candidates) collector.emit("source.candidate_discovered", { sourceId: adapter.sourceId, adapterId: adapter.adapterId, payload: { candidateId: c.id, url: c.url } });

  for (const candidate of candidates) {
    const cap = await adapter.capture(candidate);
    captures += 1;
    stage = "captured";
    collector.emit("source.capture_created", { sourceId: adapter.sourceId, adapterId: adapter.adapterId, payload: { snapshotId: cap.snapshotId, contentHash: cap.contentHash } });

    let extractions: ExtractionCandidate[] = [];
    try {
      extractions = await adapter.extract(cap);
      collector.emit("extraction.completed", { sourceId: adapter.sourceId, adapterId: adapter.adapterId, payload: { snapshotId: cap.snapshotId, count: extractions.length } });
    } catch (err) {
      collector.emit("extraction.failed", { sourceId: adapter.sourceId, adapterId: adapter.adapterId, payload: { snapshotId: cap.snapshotId, error: sanitizeError(err) } });
      validationFailures += 1;
    }

    // One evidence record per capture, carrying the first extraction's confidence.
    const primary = extractions[0];
    const confidence = primary ? deriveConfidence(primary, adapter.mode) : null;
    if (primary) extractedCandidates += extractions.length;
    stage = primary ? "extracted" : stage;

    let lifecycleState: EvidenceRecord["lifecycleState"] = primary ? "extracted" : "captured";
    if (primary) {
      const result = await adapter.validate(primary);
      warnings += result.warnings.length;
      collector.emit("validation.completed", { sourceId: adapter.sourceId, adapterId: adapter.adapterId, payload: { snapshotId: cap.snapshotId, valid: result.valid, errors: result.errors } });
      if (result.valid) { lifecycleState = "validated"; stage = "conflict_checked"; }
      else { validationFailures += 1; lifecycleState = "captured"; }
    }

    const ev = createEvidence({
      sourceId: adapter.sourceId,
      sourceUrl: candidate.url ?? (cap.metadata?.sourceUrl as string) ?? null,
      sourceOwner: (cap.metadata?.owner as string) ?? null,
      adapterId: adapter.adapterId,
      adapterVersion: adapter.version,
      lifecycleState,
      capturedAt: nowIso,
      observedAt: nowIso,
      contentType: cap.contentType,
      contentHash: cap.contentHash,
      rawContentRef: cap.rawContentRef ?? null,
      screenshotRef: cap.screenshotRef ?? null,
      documentRef: cap.documentRef ?? null,
      pageNumber: (cap.metadata?.page as number) ?? null,
      boundingBox: (cap.metadata?.boundingBox as EvidenceRecord["boundingBox"]) ?? null,
      extractedText: primary?.fields.find((f) => f.evidenceText)?.evidenceText ?? null,
      structuredData: primary ? { fields: primary.fields } : null,
      extractorId: primary?.extractorId ?? null,
      extractorVersion: primary?.extractorVersion ?? null,
      fieldConfidence: confidence,
    }, nowIso);
    evidence.push(ev);
    provenance.push(linkProvenance("ingestion_run", rid, ev.id, "adapter_capture", nowIso));

    // Human review is always required before anything is published.
    collector.emit("review.required", { sourceId: adapter.sourceId, adapterId: adapter.adapterId, payload: { evidenceId: ev.id, lifecycleState } });
  }

  const run: AdapterRun = {
    id: rid, adapterId: adapter.adapterId, sourceId: adapter.sourceId, mode: adapter.mode,
    lifecycleStage: stage, candidatesDiscovered: candidates.length, captures, extractedCandidates,
    validationFailures, warnings, evidenceIds: evidence.map((e) => e.id), eventIds: collector.all().map((e) => e.id),
    status: candidates.length === 0 ? "completed" : "needs_review",
    policyDecision: decision, startedAt: nowIso, completedAt: nowIso,
    notes: candidates.length === 0 ? "No candidates found in fixture." : `Captured ${captures}, extracted ${extractedCandidates}. Awaiting human review — nothing published.`,
  };
  return { run, evidence, events: collector.all(), provenance };
}

/** Never leak stack traces / internals into stored events. */
function sanitizeError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.replace(/\s+/g, " ").slice(0, 160);
}
