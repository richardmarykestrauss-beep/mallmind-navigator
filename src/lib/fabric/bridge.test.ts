import { describe, it, expect } from "vitest";
import { buildSeedDatabase } from "@/lib/ingestion/seed";
import { JsonLdFixtureAdapter } from "./adapters/jsonLdFixture";
import { normalizeToDraft, NormalizationError, DRAFT_NORMALIZER_VERSION, type NormalizeContext } from "./draft";
import { decide, approvalBlockers, canApprove, ReviewValidationError, latestDecision, hasBranchEvidence, supportsLiveVerification, type DecisionInput } from "./review";
import { evaluatePublication } from "./publication";
import { createOfferFromDecision, applyPublication, NotApprovedError } from "./offerBridge";
import { offerPublication, isAssistantEligible, filterAssistantEligible, buildSafeAssistantOffer } from "./assistantSafe";
import { submitDecision } from "./bridgeStore";
import { createEvidence, makeConfidence } from "./evidence";
import { buildSeedFabric } from "./store";
import type { ExtractionCandidate, ExtractedField, FabricDatabase, SourceAccessPolicy } from "./types";

const NOW = Date.parse("2026-07-13T12:00:00.000Z");
const NOW_ISO = new Date(NOW).toISOString();
const conf = makeConfidence({ identityConfidence: 0.9, priceConfidence: 0.85, availabilityConfidence: 0.6, freshnessConfidence: 0.8, sourceAuthority: 0.6 });

const ext = (fields: ExtractedField[], extractorId = "schema_org_jsonld"): ExtractionCandidate => ({
  id: "ext_test", snapshotId: "snap_test", candidateType: "offer", fields, extractorId, extractorVersion: "1.0.0",
});
const ctx = (over: Partial<NormalizeContext> = {}): NormalizeContext => ({
  sourceId: "src_game", adapterId: "jsonld_fixture", adapterMode: "json_ld", extractorId: "schema_org_jsonld",
  retailerId: "ret_game", retailerName: "Game", evidenceIds: ["ev1"], confidence: conf, observedAt: NOW_ISO, nowIso: NOW_ISO, ...over,
});

async function jsonLdExtraction(): Promise<ExtractionCandidate> {
  const a = new JsonLdFixtureAdapter("src_game");
  const [cand] = await a.discover();
  const snap = await a.capture(cand);
  const [e] = await a.extract(snap);
  return e;
}

// 1-5. Normalizer
describe("extraction → draft normalization", () => {
  it("normalizes a JSON-LD extraction into a reviewable draft", async () => {
    const draft = normalizeToDraft(await jsonLdExtraction(), ctx());
    expect(draft.productTitle).toBe('Hisense 43" A4 FHD Smart TV');
    expect(draft.price).toBe(3999);
    expect(draft.currency).toBe("ZAR");
    expect(draft.reviewStatus).toBe("needs_review");
    expect(draft.geographicScope).toBe("online_only"); // never branch from a public page
    expect(draft.evidenceIds).toEqual(["ev1"]);
  });
  it("produces a stable draft identity/hash (idempotent)", async () => {
    const e = await jsonLdExtraction();
    const a = normalizeToDraft(e, ctx());
    const b = normalizeToDraft(e, ctx());
    expect(a.draftHash).toBe(b.draftHash);
    expect(a.id).toBe(b.id);
    expect(a.normalizerVersion).toBe(DRAFT_NORMALIZER_VERSION);
  });
  it("rejects an invalid price and an unsupported currency", () => {
    expect(() => normalizeToDraft(ext([{ field: "productTitle", value: "X", confidence: 1 }, { field: "price", value: -5, confidence: 1 }]), ctx())).toThrow(NormalizationError);
    expect(() => normalizeToDraft(ext([{ field: "productTitle", value: "X", confidence: 1 }, { field: "price", value: 10, confidence: 1 }, { field: "currency", value: "XYZ", confidence: 1 }]), ctx())).toThrow(/currency/i);
  });
  it("does not invent missing fields", () => {
    const draft = normalizeToDraft(ext([{ field: "productTitle", value: "Mystery TV", confidence: 1 }, { field: "price", value: 1999, confidence: 1 }]), ctx());
    expect(draft.brand).toBeNull();
    expect(draft.manufacturerModel).toBeNull();
    expect(draft.warnings.some((w) => /No brand/.test(w))).toBe(true);
  });
});

// 6-8. Review decisions
describe("review decisions", () => {
  const fabric = () => buildSeedFabric(NOW);
  const evidenceFor = (f: FabricDatabase, ids: string[]) => ids.map((id) => f.evidence.find((e) => e.id === id)!).filter(Boolean);

  it("requires evidence, price, title and source for approval", () => {
    const f = fabric();
    const draft = f.drafts.find((d) => d.id === "draft_seed_game43")!;
    const noEvidence = { ...draft, evidenceIds: [] };
    expect(approvalBlockers(noEvidence, { reviewerId: "a", decision: "approve" }, [], undefined)).toContain("missing_evidence");
    expect(canApprove(draft, { reviewerId: "a", decision: "approve" }, evidenceFor(f, draft.evidenceIds), f.policies.find((p) => p.sourceId === "src_game")).ok).toBe(true);
  });
  it("appends decisions rather than overwriting, with a version chain", () => {
    const f = fabric();
    const draft = f.drafts.find((d) => d.id === "draft_seed_game43")!;
    const ev = evidenceFor(f, draft.evidenceIds);
    const policy = f.policies.find((p) => p.sourceId === "src_game");
    const d1 = decide(draft, { reviewerId: "a", decision: "request_changes", reasoning: "check price" }, [], ev, policy, NOW_ISO);
    const d2 = decide(draft, { reviewerId: "a", decision: "approve", reasoning: "ok" }, [d1], ev, policy, NOW_ISO);
    expect(d1.decisionVersion).toBe(1);
    expect(d2.decisionVersion).toBe(2);
    expect(d2.previousDecisionId).toBe(d1.id);
    expect(latestDecision(draft.id, [d1, d2])!.id).toBe(d2.id);
  });
  it("records corrected fields as an explicit patch without mutating the draft", () => {
    const f = fabric();
    const draft = f.drafts.find((d) => d.id === "draft_seed_game43")!;
    const before = draft.price;
    const d = decide(draft, { reviewerId: "a", decision: "approve", correctedFields: [{ field: "price", from: 3999, to: 3899 }] }, [], evidenceFor(f, draft.evidenceIds), f.policies.find((p) => p.sourceId === "src_game"), NOW_ISO);
    expect(d.correctedFields[0]).toEqual({ field: "price", from: 3999, to: 3899 });
    expect(draft.price).toBe(before); // original draft unchanged
  });
});

// 9, 13, 14. Approval guards
describe("approval guards", () => {
  const f = buildSeedFabric(NOW);
  const ev = (ids: string[]) => ids.map((id) => f.evidence.find((e) => e.id === id)!);
  it("blocks approval on unresolved conflicting evidence", () => {
    const conflict = f.drafts.find((d) => d.id === "draft_seed_conflict")!;
    expect(approvalBlockers(conflict, { reviewerId: "a", decision: "approve" }, ev(conflict.evidenceIds), undefined)).toContain("unresolved_conflict");
    // resolving it via an explicit correction unblocks
    expect(approvalBlockers(conflict, { reviewerId: "a", decision: "approve", correctedFields: [{ field: "conflictState", from: "conflict_detected", to: "resolved" }] }, ev(conflict.evidenceIds), undefined)).not.toContain("unresolved_conflict");
  });
  it("requires branch-scoped evidence before branch scope can be approved", () => {
    const jsonldDraft = f.drafts.find((d) => d.id === "draft_seed_game43")!;         // json_ld evidence, no branch signal
    const manualDraft = f.drafts.find((d) => d.id === "draft_seed_unknown_avail")!;  // manual evidence w/ locationConfidence 0.6
    expect(approvalBlockers(jsonldDraft, { reviewerId: "a", decision: "approve", approvedGeographicScope: "branch" }, ev(jsonldDraft.evidenceIds), undefined)).toContain("branch_requires_branch_evidence");
    expect(hasBranchEvidence(ev(manualDraft.evidenceIds))).toBe(true);
    expect(approvalBlockers(manualDraft, { reviewerId: "a", decision: "approve", approvedGeographicScope: "branch" }, ev(manualDraft.evidenceIds), undefined)).not.toContain("branch_requires_branch_evidence");
  });
  it("blocks verified_live from a public fixture page but allows it under an authorized policy", () => {
    const draft = f.drafts.find((d) => d.id === "draft_seed_game43")!;
    const publicPolicy = f.policies.find((p) => p.sourceId === "src_game");
    expect(approvalBlockers(draft, { reviewerId: "a", decision: "approve", finalTrustLabel: "verified_live" }, ev(draft.evidenceIds), publicPolicy)).toContain("verified_live_not_supported");
    const authorized: SourceAccessPolicy = { sourceId: "src_game", automationStatus: "authorized_api", allowedModes: ["partner_api"], requiresHumanReview: true, legalRisk: "low" };
    const strongEvidence = [createEvidence({ sourceId: "src_game", adapterId: "partner", adapterVersion: "1", capturedAt: NOW_ISO, contentType: "json", contentHash: "h", fieldConfidence: makeConfidence({ sourceAuthority: 0.95 }) }, NOW_ISO)];
    expect(supportsLiveVerification(authorized, strongEvidence)).toBe(true);
    expect(approvalBlockers(draft, { reviewerId: "a", decision: "approve", finalTrustLabel: "verified_live" }, strongEvidence, authorized)).not.toContain("verified_live_not_supported");
  });
  it("throws ReviewValidationError when approving an invalid draft", () => {
    const conflict = f.drafts.find((d) => d.id === "draft_seed_conflict")!;
    expect(() => decide(conflict, { reviewerId: "a", decision: "approve" }, [], ev(conflict.evidenceIds), undefined, NOW_ISO)).toThrow(ReviewValidationError);
  });
});

// 10, 11, 12. Publication policy
describe("publication policy", () => {
  const base = {
    reviewStatus: "approved" as const, evidenceIds: ["ev1"], policy: undefined, finalTrustLabel: "recently_observed" as const,
    availabilityStatus: "inferred" as const, geographicScope: "national" as const, conflictState: "none" as const,
    sourceUrl: "https://x", observedAt: NOW_ISO, expiresAt: null, nowMs: NOW,
  };
  it("blocks expired, unavailable and conflicting offers", () => {
    expect(evaluatePublication({ ...base, expiresAt: new Date(NOW - 86_400_000).toISOString() }).blockers).toContain("expired");
    expect(evaluatePublication({ ...base, availabilityStatus: "unavailable" }).blockers).toContain("availability_unavailable");
    expect(evaluatePublication({ ...base, conflictState: "conflict_detected" }).blockers).toContain("unresolved_conflict");
    expect(evaluatePublication({ ...base, reviewStatus: "staged" }).blockers).toContain("not_approved");
    expect(evaluatePublication({ ...base, sourceUrl: null }).blockers).toContain("missing_source_reference");
  });
  it("publishes an unknown-availability offer but with a warning, never as a blocker", () => {
    const d = evaluatePublication({ ...base, availabilityStatus: "unknown" });
    expect(d.eligible).toBe(true);
    expect(d.warnings).toContain("availability_unknown");
    expect(d.blockers).not.toContain("availability_unknown"); // never downgraded/promoted incorrectly
  });
});

// 15-18. Offer creation
describe("offer creation bridge", () => {
  it("creates an offer only from an approved decision, retaining lineage + multiple evidence", () => {
    const f = buildSeedFabric(NOW);
    const draft = { ...f.drafts.find((d) => d.id === "draft_seed_game43")!, evidenceIds: ["ev_seed_jsonld_game43", "ev_seed_manual_game43"] };
    const approve = decide(draft, { reviewerId: "a", decision: "approve" }, [], draft.evidenceIds.map((id) => f.evidence.find((e) => e.id === id)!), f.policies.find((p) => p.sourceId === "src_game"), NOW_ISO);
    const { offer, provenance } = createOfferFromDecision(draft, approve, { productId: "p_hisense43", sourceType: "retailer_product_page", channel: "online", sourceUrl: "https://www.game.co.za/hisense-43a4k", nowIso: NOW_ISO });
    expect(offer.reviewStatus).toBe("approved");
    expect(offer.published).toBe(false); // publication is a separate gate
    expect(offer.evidenceIds).toHaveLength(2);
    expect(offer.draftId).toBe(draft.id);
    expect(offer.reviewDecisionId).toBe(approve.id);
    expect(provenance.filter((p) => p.entityType === "product_offer")).toHaveLength(2);
  });
  it("refuses to build an offer from a non-approve decision", () => {
    const f = buildSeedFabric(NOW);
    const draft = f.drafts.find((d) => d.id === "draft_seed_game43")!;
    const reject = decide(draft, { reviewerId: "a", decision: "reject", reasoning: "no" }, [], [], undefined, NOW_ISO);
    expect(() => createOfferFromDecision(draft, reject, { productId: "p", sourceType: "manual_admin", channel: "online", sourceUrl: "https://x", nowIso: NOW_ISO })).toThrow(NotApprovedError);
  });
});

// Full orchestrated flow + idempotency + rejection
describe("submitDecision orchestration", () => {
  it("approve → creates a published, evidence-backed offer; re-approval is idempotent", () => {
    const fabric = buildSeedFabric(NOW);
    const ingestion = buildSeedDatabase(NOW);
    const r1 = submitDecision(fabric, ingestion, "draft_seed_game43", { reviewerId: "admin", decision: "approve", reasoning: "looks good" }, NOW_ISO);
    expect(r1.offer).not.toBeNull();
    expect(r1.offer!.reviewStatus).toBe("approved");
    expect(r1.publication!.eligible).toBe(true);
    expect(r1.offer!.published).toBe(true);
    expect(r1.offer!.evidenceIds!.length).toBeGreaterThan(0);
    const count1 = r1.ingestion.offers.filter((o) => o.draftId === "draft_seed_game43").length;
    // Idempotent: approving again updates the same offer, does not duplicate.
    const r2 = submitDecision(r1.fabric, r1.ingestion, "draft_seed_game43", { reviewerId: "admin", decision: "approve", reasoning: "again" }, NOW_ISO);
    const count2 = r2.ingestion.offers.filter((o) => o.draftId === "draft_seed_game43").length;
    expect(count1).toBe(1);
    expect(count2).toBe(1);
    expect(r2.offer!.offerRevision).toBe(2);
  });
  it("rejection creates no offer", () => {
    const fabric = buildSeedFabric(NOW);
    const ingestion = buildSeedDatabase(NOW);
    const before = ingestion.offers.length;
    const r = submitDecision(fabric, ingestion, "draft_seed_game43", { reviewerId: "admin", decision: "reject", reasoning: "bad data" }, NOW_ISO);
    expect(r.offer).toBeNull();
    expect(r.ingestion.offers.length).toBe(before);
    expect(r.fabric.drafts.find((d) => d.id === "draft_seed_game43")!.reviewStatus).toBe("rejected");
  });
  it("blocks publication for an expired catalogue draft (approved but not published)", () => {
    const fabric = buildSeedFabric(NOW);
    const ingestion = buildSeedDatabase(NOW);
    const r = submitDecision(fabric, ingestion, "draft_seed_expired_cat", { reviewerId: "admin", decision: "approve", reasoning: "expired promo" }, NOW_ISO);
    expect(r.offer!.reviewStatus).toBe("approved");
    expect(r.publication!.blockers).toContain("expired");
    expect(r.offer!.published).toBe(false);
  });
});

// 18. Adapter cannot publish directly
describe("adapter cannot publish directly", () => {
  it("adapters expose no publish path; only an approved decision creates offers", async () => {
    const a = new JsonLdFixtureAdapter("src_game");
    expect((a as unknown as Record<string, unknown>).publish).toBeUndefined();
    // The bridge is the only path, and it refuses non-approve decisions.
    const f = buildSeedFabric(NOW);
    const draft = f.drafts.find((d) => d.id === "draft_seed_game43")!;
    const archive = decide(draft, { reviewerId: "a", decision: "archive" }, [], [], undefined, NOW_ISO);
    expect(() => createOfferFromDecision(draft, archive, { productId: "p", sourceType: "manual_admin", channel: "online", sourceUrl: "https://x", nowIso: NOW_ISO })).toThrow(NotApprovedError);
  });
});

// 19, 20. Assistant safety path
describe("assistant safety path", () => {
  const fabric = buildSeedFabric(NOW);
  const ingestion = buildSeedDatabase(NOW);
  it("excludes non-eligible offers (conflict / unavailable / no-evidence)", () => {
    const eligible = filterAssistantEligible(ingestion.offers, fabric, NOW);
    const ids = eligible.map((o) => o.id);
    expect(ids).toContain("offer_checkers_hisense32");        // evidence-backed, not conflicted, not expired
    expect(ids).not.toContain("offer_game_hisense43");        // conflictGroupId set → blocked
    expect(ids).not.toContain("offer_edgars_tcl32");          // unavailable
    expect(isAssistantEligible(ingestion.offers.find((o) => o.id === "offer_pnp_tcl43")!, fabric, NOW)).toBe(false); // no fabric evidence
  });
  it("assistant output carries trust, freshness, scope and availability limitations", () => {
    const offer = ingestion.offers.find((o) => o.id === "offer_checkers_hisense32")!;
    const view = buildSafeAssistantOffer(offer, fabric, NOW);
    expect(view.trustLabel).toBeTruthy();
    expect(view.observedDate).toBe(offer.sourceObservedAt);
    expect(view.sourceFreshnessStatement).toMatch(/Observed|not live/);
    expect(view.scopeStatement).toBeTruthy();
    expect(view.availabilityLimitation).toBeTruthy();
    expect(view.warnings).toContain("branch_not_confirmed");
  });
});

// Section 8 — full deterministic fixture workflow
describe("full fixture workflow: JSON-LD → evidence → draft → review → publish → assistant", () => {
  it("carries evidence end-to-end and never publishes without approval", async () => {
    // extract from the JSON-LD fixture (no network)
    const extraction = await jsonLdExtraction();
    // evidence
    const evidence = createEvidence({ sourceId: "src_game", sourceUrl: "https://www.game.co.za/hisense-43a4k", adapterId: "jsonld_fixture", adapterVersion: "1.0.0", capturedAt: NOW_ISO, observedAt: NOW_ISO, contentType: "json", contentHash: "sha256:txt-flow", lifecycleState: "validated", extractedText: "R3,999", structuredData: { fields: extraction.fields }, fieldConfidence: conf }, NOW_ISO);
    // draft
    const draft = normalizeToDraft(extraction, ctx({ evidenceIds: [evidence.id] }));
    expect(draft.reviewStatus).toBe("needs_review");
    // assemble a fabric with the policy + evidence + draft
    let fabric: FabricDatabase = buildSeedFabric(NOW);
    fabric = { ...fabric, evidence: [...fabric.evidence, evidence], drafts: [...fabric.drafts, draft] };
    let ingestion = buildSeedDatabase(NOW);
    // before approval, the offer does not exist / is not assistant-visible
    expect(ingestion.offers.some((o) => o.draftId === draft.id)).toBe(false);
    // approve → offer created + published (eligible)
    const res = submitDecision(fabric, ingestion, draft.id, { reviewerId: "admin", decision: "approve", finalTrustLabel: "recently_observed", reasoning: "public product page" }, NOW_ISO);
    ingestion = res.ingestion;
    expect(res.offer!.evidenceIds).toContain(evidence.id);
    expect(res.publication!.eligible).toBe(true);
    // assistant-safe retrieval now includes it
    const safe = filterAssistantEligible(ingestion.offers, res.fabric, NOW).find((o) => o.id === res.offer!.id);
    expect(safe).toBeTruthy();
    const view = buildSafeAssistantOffer(res.offer!, res.fabric, NOW);
    expect(view.warnings).toContain("online_only");
    // verified_live cannot be selected from this public fixture page
    expect(offerPublication({ ...res.offer!, priceTrustLabel: "verified_live" }, res.fabric, NOW).blockers).toContain("verified_live_requirements_not_met");
  });
});
