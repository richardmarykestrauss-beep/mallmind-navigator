import { describe, it, expect } from "vitest";
import { buildSeedDatabase } from "@/lib/ingestion/seed";
import { AdapterRegistry, defaultCapabilities, DuplicateAdapterError } from "./registry";
import { evaluatePolicy, tierPermits, isExecutionAllowed } from "./policy";
import { runAdapter } from "./runner";
import { contentHash, structuredHash } from "./hash";
import { createEvidence, reviseEvidence, linkProvenance, evidenceForEntity, isValidConfidence, makeConfidence, suggestTrustLabel, ZERO_CONFIDENCE } from "./evidence";
import { canTransition, transition, LifecycleTransitionError, nextStates, isTerminal } from "./lifecycle";
import { makeEvent, EventCollector } from "./events";
import { buildIdentityCandidate, matchIdentity, isAutoLinkSafe } from "./identity";
import { normalizeModel, normalizeTitle } from "./normalize";
import { ManualSnapshotAdapter } from "./adapters/manualSnapshot";
import { JsonLdFixtureAdapter } from "./adapters/jsonLdFixture";
import { CatalogueFixtureAdapter } from "./adapters/catalogueFixture";
import { SitemapFixtureAdapter } from "./adapters/sitemapFixture";
import { buildRegistry, seedPolicies, buildSeedFabric, DEMO_MANUAL_PAYLOAD } from "./store";
import type { SourceAccessPolicy } from "./types";

const NOW = Date.parse("2026-07-13T12:00:00.000Z");
const NOW_ISO = new Date(NOW).toISOString();
const policyFor = (over: Partial<SourceAccessPolicy>): SourceAccessPolicy => ({
  sourceId: "src_game", automationStatus: "approved_public_observation", allowedModes: ["manual", "json_ld", "catalogue", "sitemap"],
  requiresHumanReview: true, legalRisk: "low", ...over,
});

// 1-3. Registry
describe("adapter registry", () => {
  it("registers, retrieves and lists adapters with capabilities", () => {
    const reg = new AdapterRegistry();
    reg.register(new JsonLdFixtureAdapter("src_game"), { name: "JSON-LD", status: "prototype", description: "d", capabilities: defaultCapabilities() });
    expect(reg.has("jsonld_fixture")).toBe(true);
    expect(reg.list()).toHaveLength(1);
    expect(reg.capabilities("jsonld_fixture")?.humanReviewRequired).toBe(true);
  });
  it("rejects duplicate adapter ids", () => {
    const reg = new AdapterRegistry();
    reg.register(new JsonLdFixtureAdapter("src_game"), { name: "a", status: "prototype", description: "d", capabilities: defaultCapabilities() });
    expect(() => reg.register(new JsonLdFixtureAdapter("src_game"), { name: "b", status: "prototype", description: "d", capabilities: defaultCapabilities() })).toThrow(DuplicateAdapterError);
  });
  it("blocks a disabled adapter from running", () => {
    const reg = new AdapterRegistry();
    reg.register(new JsonLdFixtureAdapter("src_game"), { name: "a", status: "prototype", description: "d", capabilities: defaultCapabilities() });
    reg.setEnabled("jsonld_fixture", false);
    expect(() => reg.require("jsonld_fixture")).toThrow(/disabled/);
  });
});

// 4-7. Policy engine
describe("source policy engine", () => {
  it("blocks execution when no policy exists", () => {
    const d = evaluatePolicy("json_ld", undefined);
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe("no_policy");
  });
  it("blocks a disallowed adapter mode", () => {
    const d = evaluatePolicy("partner_api", policyFor({ allowedModes: ["manual"] }));
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe("mode_not_allowed");
  });
  it("blocks a blocked source entirely", () => {
    const d = evaluatePolicy("manual", policyFor({ automationStatus: "blocked", allowedModes: ["manual"] }));
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe("source_blocked");
  });
  it("manual-only policy blocks automated modes but allows manual/catalogue", () => {
    const manualOnly = policyFor({ automationStatus: "manual_only", allowedModes: ["manual", "catalogue", "json_ld"] });
    expect(evaluatePolicy("json_ld", manualOnly).allowed).toBe(false); // automated → tier forbids
    expect(evaluatePolicy("json_ld", manualOnly).reason).toBe("tier_forbids_mode");
    expect(evaluatePolicy("manual", manualOnly).allowed).toBe(true);
    expect(tierPermits("manual_only", "manual")).toBe(true);
    expect(tierPermits("manual_only", "partner_api")).toBe(false);
    expect(isExecutionAllowed("catalogue", manualOnly)).toBe(true);
  });
});

// 4-6 via runner. blocked source cannot run
describe("runner enforces policy", () => {
  it("produces a blocked run with no evidence when the source is blocked", async () => {
    const reg = buildRegistry();
    const registration = reg.get("jsonld_fixture")!;
    const { run, evidence, events } = await runAdapter(registration, policyFor({ automationStatus: "blocked", allowedModes: [] }), NOW_ISO);
    expect(run.status).toBe("blocked");
    expect(evidence).toHaveLength(0);
    expect(events.some((e) => e.type === "source.policy_blocked")).toBe(true);
  });
  it("blocks when no policy is supplied", async () => {
    const reg = buildRegistry();
    const { run } = await runAdapter(reg.get("jsonld_fixture")!, undefined, NOW_ISO);
    expect(run.status).toBe("blocked");
    expect(run.policyDecision?.reason).toBe("no_policy");
  });
});

// 8. Manual adapter creates evidence
describe("ManualSnapshotAdapter", () => {
  it("creates evidence with field confidence and requires review", async () => {
    const reg = buildRegistry();
    const { run, evidence } = await runAdapter(reg.get("manual_snapshot")!, policyFor({ allowedModes: ["manual"] }), NOW_ISO, DEMO_MANUAL_PAYLOAD);
    expect(evidence.length).toBeGreaterThanOrEqual(1);
    expect(evidence[0].fieldConfidence).not.toBeNull();
    expect(evidence[0].contentType).toBe("manual");
    expect(run.status).toBe("needs_review");
  });
});

// 9. JSON-LD extraction
describe("JsonLdFixtureAdapter", () => {
  it("extracts title/brand/price/currency/availability from Schema.org JSON-LD", async () => {
    const a = new JsonLdFixtureAdapter("src_game");
    const [cand] = await a.discover();
    const snap = await a.capture(cand);
    const [ext] = await a.extract(snap);
    const get = (f: string) => ext.fields.find((x) => x.field === f)?.value;
    expect(get("productTitle")).toBe('Hisense 43" A4 FHD Smart TV');
    expect(get("brand")).toBe("Hisense");
    expect(get("price")).toBe(3999);
    expect(get("currency")).toBe("ZAR");
    expect(get("availability")).toBe("known_available");
    expect((await a.validate(ext)).valid).toBe(true);
  });
});

// 10. Catalogue extraction
describe("CatalogueFixtureAdapter", () => {
  it("extracts price, validity and page/bounding-box metadata", async () => {
    const a = new CatalogueFixtureAdapter("src_checkers_specials");
    const cands = await a.discover();
    const snap = await a.capture(cands[0]);
    const [ext] = await a.extract(snap);
    const get = (f: string) => ext.fields.find((x) => x.field === f)?.value;
    expect(get("price")).toBe(2999);
    expect(get("validTo")).toBe("2026-07-17");
    expect(get("pageNumber")).toBe(4);
    expect(snap.documentRef).toContain("#p4");
    expect(snap.metadata?.boundingBox).toEqual({ x: 62, y: 410, width: 240, height: 96 });
  });
});

// 10b. Sitemap extraction
describe("SitemapFixtureAdapter", () => {
  it("emits product/category URL candidates without a live request", async () => {
    const a = new SitemapFixtureAdapter("src_game");
    const [cand] = await a.discover();
    const snap = await a.capture(cand);
    const exts = await a.extract(snap);
    const urls = exts.map((e) => e.fields.find((f) => f.field === "url")?.value);
    expect(urls).toContain("https://www.game.co.za/hisense-43a4k");
    expect(exts.some((e) => e.candidateType === "catalogue")).toBe(true); // the /category/ URL
  });
});

// 11. Stable hash
describe("content hashing", () => {
  it("is deterministic and CRLF-insensitive", () => {
    expect(contentHash("hello world")).toBe(contentHash("hello world"));
    expect(contentHash("a\r\nb")).toBe(contentHash("a\nb"));
    expect(contentHash("a")).not.toBe(contentHash("b"));
    expect(structuredHash({ a: 1, b: 2 })).toBe(structuredHash({ b: 2, a: 1 })); // key order independent
  });
});

// 12. Evidence immutability
describe("evidence immutability", () => {
  it("creates a new revision without overwriting the original meaning", () => {
    const original = createEvidence({ sourceId: "src_game", adapterId: "manual_snapshot", adapterVersion: "1.0.0", capturedAt: NOW_ISO, contentType: "manual", contentHash: "sha256:x", extractedText: "R3999" }, NOW_ISO);
    const { revised, supersededOriginal } = reviseEvidence(original, { extractedText: "R3899 (corrected)" }, NOW_ISO);
    expect(revised.id).not.toBe(original.id);
    expect(revised.revision).toBe(2);
    expect(revised.revisionOf).toBe(original.id);
    expect(revised.extractedText).toBe("R3899 (corrected)");
    expect(original.extractedText).toBe("R3999"); // original object untouched
    expect(supersededOriginal.supersededBy).toBe(revised.id);
    expect(supersededOriginal.reviewerStatus).toBe("superseded");
  });
});

// 13. Multiple evidence per offer
describe("provenance links", () => {
  it("links one offer to multiple evidence records", () => {
    const links = [
      linkProvenance("product_offer", "offer_1", "ev_a", "json_ld_product_page", NOW_ISO),
      linkProvenance("product_offer", "offer_1", "ev_b", "phone_confirmation", NOW_ISO),
      linkProvenance("product_offer", "offer_2", "ev_c", "catalogue_page", NOW_ISO),
    ];
    expect(evidenceForEntity(links, "product_offer", "offer_1")).toEqual(["ev_a", "ev_b"]);
  });
  it("seed links offer_game_hisense43 to two evidence records", () => {
    const fabric = buildSeedFabric(NOW);
    expect(evidenceForEntity(fabric.provenance, "product_offer", "offer_game_hisense43")).toHaveLength(2);
  });
});

// 14. Confidence validation
describe("field confidence", () => {
  it("validates that all dimensions are within [0,1]", () => {
    expect(isValidConfidence(makeConfidence({ priceConfidence: 0.5 }))).toBe(true);
    expect(isValidConfidence({ ...ZERO_CONFIDENCE, priceConfidence: 1.5 })).toBe(false);
    expect(isValidConfidence({ ...ZERO_CONFIDENCE, identityConfidence: -0.1 })).toBe(false);
  });
});

// 15 + 16. Suggested trust label + conflict
describe("suggested trust label (advisory only)", () => {
  const c = ZERO_CONFIDENCE;
  it("suggests conflict_detected when evidence conflicts", () => {
    expect(suggestTrustLabel({ mode: "json_ld", hasConflict: true, ageHours: 1, hasValidityDates: false, branchAvailabilityConfirmed: false, confidence: c }).suggested).toBe("conflict_detected");
  });
  it("suggests verified_live for a recent authorized feed with branch availability", () => {
    expect(suggestTrustLabel({ mode: "partner_api", hasConflict: false, ageHours: 2, hasValidityDates: false, branchAvailabilityConfirmed: true, confidence: c }).suggested).toBe("verified_live");
  });
  it("suggests partner_feed / recently_observed / catalogue_special appropriately", () => {
    expect(suggestTrustLabel({ mode: "merchant_feed", hasConflict: false, ageHours: 100, hasValidityDates: false, branchAvailabilityConfirmed: false, confidence: c }).suggested).toBe("partner_feed");
    expect(suggestTrustLabel({ mode: "json_ld", hasConflict: false, ageHours: 2, hasValidityDates: false, branchAvailabilityConfirmed: false, confidence: c }).suggested).toBe("recently_observed");
    expect(suggestTrustLabel({ mode: "catalogue", hasConflict: false, ageHours: 5, hasValidityDates: true, branchAvailabilityConfirmed: false, confidence: c }).suggested).toBe("catalogue_special");
  });
});

// 17 + 18. Identity matching
describe("product identity matching", () => {
  const products = buildSeedDatabase(NOW).products;
  it("matches on exact GTIN and exact manufacturer model", () => {
    const g = matchIdentity(buildIdentityCandidate({ gtin: "6942147489012", brand: "Hisense", productTitle: "x" }), products.map((p) => ({ ...p, gtin: p.id === "p_hisense43" ? "6942147489012" : p.gtin })));
    expect(g[0].tier).toBe("exact_gtin");
    const m = matchIdentity(buildIdentityCandidate({ manufacturerModel: "43-A4K", brand: "Hisense", productTitle: "x" }), products);
    expect(m[0].tier).toBe("exact_manufacturer_model");
    expect(m[0].productId).toBe("p_hisense43");
  });
  it("returns human_review and never auto-links on a title-only soft match", () => {
    const t = matchIdentity(buildIdentityCandidate({ brand: "Hisense", productTitle: 'Hisense 43" A4 FHD Smart TV' }), products);
    expect(t[0].tier).toBe("normalized_title");
    expect(isAutoLinkSafe(t)).toBe(false);
    const none = matchIdentity(buildIdentityCandidate({ brand: "Nobody", productTitle: "Unknown gadget" }), products);
    expect(none[0].tier).toBe("human_review");
    expect(none[0].productId).toBe("");
  });
  it("normalizes model punctuation and inch marks", () => {
    expect(normalizeModel("43-A4K")).toBe(normalizeModel("43 a4k"));
    expect(normalizeTitle('Hisense 43" TV')).toBe(normalizeTitle("Hisense 43 inch TV"));
  });
});

// 19 + 20. Lifecycle
describe("lifecycle state machine", () => {
  it("allows the canonical forward transitions", () => {
    expect(canTransition("discovered", "captured")).toBe(true);
    expect(canTransition("approved", "published")).toBe(true);
    expect(canTransition("published", "stale")).toBe(true);
    expect(nextStates("reviewed")).toContain("approved");
    expect(isTerminal("withdrawn")).toBe(true);
  });
  it("rejects illegal transitions (no skipping review)", () => {
    expect(canTransition("captured", "published")).toBe(false);
    expect(canTransition("validated", "approved")).toBe(false); // must pass conflict_checked + reviewed
    expect(() => transition("discovered", "published")).toThrow(LifecycleTransitionError);
  });
});

// 21. Events
describe("event model", () => {
  it("generates typed events with a payload", () => {
    const e = makeEvent({ type: "conflict.detected", occurredAt: NOW_ISO, payload: { productId: "p1" } });
    expect(e.type).toBe("conflict.detected");
    expect(e.payload.productId).toBe("p1");
    const col = new EventCollector(NOW_ISO);
    col.emit("review.required", { sourceId: "s" });
    col.emit("review.approved", { sourceId: "s" });
    expect(col.all()).toHaveLength(2);
  });
});

// 22. No auto-publish
describe("no adapter output is automatically published", () => {
  it("never reaches a published lifecycle stage or published status", async () => {
    const reg = buildRegistry();
    for (const id of ["jsonld_fixture", "catalogue_fixture", "sitemap_fixture"]) {
      const registration = reg.get(id)!;
      const policy = seedPolicies(NOW_ISO).find((p) => p.sourceId === registration.adapter.sourceId);
      const { run, evidence } = await runAdapter(registration, policy, NOW_ISO);
      expect(run.status).not.toBe("published" as unknown);
      expect(run.lifecycleStage).not.toBe("published");
      expect(evidence.every((e) => e.lifecycleState !== "published" && e.lifecycleState !== "approved")).toBe(true);
    }
  });
});

// Seed integrity
describe("fabric seed", () => {
  it("seeds policies incl. a blocked source and a manual_only source", () => {
    const f = buildSeedFabric(NOW);
    expect(f.policies.find((p) => p.sourceId === "src_login_walled")?.automationStatus).toBe("blocked");
    expect(f.policies.find((p) => p.sourceId === "src_takealot")?.automationStatus).toBe("manual_only");
    expect(f.runs.some((r) => r.status === "blocked")).toBe(true);
    expect(f.evidence.length).toBeGreaterThanOrEqual(3);
  });
});
