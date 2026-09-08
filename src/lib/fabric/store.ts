/**
 * Retail Fabric — prototype local persistence + registry bootstrap.
 *
 * "Prototype — local persisted data": the fabric dataset (policies, evidence,
 * provenance, runs, events) lives in localStorage under `mallmind.fabric.v1`,
 * mirroring the existing ingestion store pattern. The adapter REGISTRY is rebuilt
 * in-process each load (it holds functions, which are never persisted).
 */

import type {
  FabricDatabase, SourceAccessPolicy, EvidenceRecord, ProvenanceLink, AdapterRun, FabricEvent, ConfidenceDimensions, OfferDraft, ReviewDecision,
} from "./types";
import { AdapterRegistry, defaultCapabilities } from "./registry";
import { runAdapter } from "./runner";
import { makeConfidence } from "./evidence";
import { ManualSnapshotAdapter, type ManualPayload } from "./adapters/manualSnapshot";
import { JsonLdFixtureAdapter } from "./adapters/jsonLdFixture";
import { CatalogueFixtureAdapter } from "./adapters/catalogueFixture";
import { SitemapFixtureAdapter } from "./adapters/sitemapFixture";

export const FABRIC_STORAGE_KEY = "mallmind.fabric.v1";

// ── Registry bootstrap (rebuilt every load — never persisted) ─────────────────

export const DEMO_MANUAL_PAYLOAD: ManualPayload = {
  url: "https://www.game.co.za/hisense-43a4k",
  title: 'Hisense 43" A4 FHD Smart TV',
  contentText: 'In-store shelf: Hisense 43" A4 FHD Smart TV — R3,999. Confirmed on display.',
  fields: { productTitle: 'Hisense 43" A4 FHD Smart TV', brand: "Hisense", model: "43A4K", price: 3999, currency: "ZAR", availability: "known_available" },
};

/** Build a fresh registry with the four deterministic demo adapters. */
export function buildRegistry(): AdapterRegistry {
  const reg = new AdapterRegistry();
  reg.register(new ManualSnapshotAdapter("src_game"), {
    name: "Manual snapshot", status: "manual", description: "Human-supplied URL/text/metadata capture. Always requires review.",
    capabilities: defaultCapabilities({ supportsDiscovery: false, requiresAuthorization: false, humanReviewRequired: true }),
  });
  reg.register(new JsonLdFixtureAdapter("src_game"), {
    name: "JSON-LD (fixture)", status: "prototype", description: "Parses local Schema.org Product/Offer JSON-LD fixtures. No network request.",
    capabilities: defaultCapabilities({ humanReviewRequired: true }),
  });
  reg.register(new CatalogueFixtureAdapter("src_checkers_specials"), {
    name: "Catalogue (fixture)", status: "prototype", description: "Parses a deterministic catalogue fixture with page + bounding-box metadata. No OCR.",
    capabilities: defaultCapabilities({ humanReviewRequired: true }),
  });
  reg.register(new SitemapFixtureAdapter("src_game"), {
    name: "Sitemap (fixture)", status: "prototype", description: "Parses a local XML sitemap fixture into candidate URLs. No live request.",
    capabilities: defaultCapabilities({ supportsValidation: true, humanReviewRequired: true }),
  });
  return reg;
}

// ── Persistence ───────────────────────────────────────────────────────────────

export function loadFabric(now: number = Date.now()): FabricDatabase {
  if (typeof localStorage !== "undefined") {
    try {
      const raw = localStorage.getItem(FABRIC_STORAGE_KEY);
      if (raw) {
        const db = JSON.parse(raw) as FabricDatabase;
        // Defensive: older persisted fabric may predate drafts/decisions.
        if (!db.drafts) db.drafts = [];
        if (!db.decisions) db.decisions = [];
        return db;
      }
    } catch { /* fall through to seed */ }
  }
  return buildSeedFabric(now);
}

export function saveFabric(db: FabricDatabase): void {
  if (typeof localStorage === "undefined") return;
  try { localStorage.setItem(FABRIC_STORAGE_KEY, JSON.stringify(db)); } catch { /* quota */ }
}

export function resetFabricSeed(now: number = Date.now()): FabricDatabase {
  const db = buildSeedFabric(now);
  saveFabric(db);
  return db;
}

const clone = (db: FabricDatabase): FabricDatabase => JSON.parse(JSON.stringify(db));

/** Run a registered adapter and persist evidence/run/events/provenance. */
export async function executeAndPersist(
  db: FabricDatabase, registry: AdapterRegistry, adapterId: string, nowIso: string, input?: unknown,
): Promise<{ db: FabricDatabase; run: AdapterRun }> {
  const reg = registry.require(adapterId);
  const policy = db.policies.find((p) => p.sourceId === reg.adapter.sourceId);
  const result = await runAdapter(reg, policy, nowIso, input);
  registry.recordRun(adapterId, result.run.id, nowIso);
  const next = clone(db);
  next.evidence.push(...result.evidence);
  next.provenance.push(...result.provenance);
  next.runs.push(result.run);
  next.events.push(...result.events);
  return { db: next, run: result.run };
}

// ── Deterministic seed ─────────────────────────────────────────────────────────

export function seedPolicies(nowIso: string): SourceAccessPolicy[] {
  return [
    { sourceId: "src_game", automationStatus: "approved_public_observation", allowedModes: ["manual", "catalogue", "json_ld", "sitemap", "browser_observation"], requiresHumanReview: true, legalRisk: "low", termsUrl: "https://www.game.co.za/terms", robotsUrl: "https://www.game.co.za/robots.txt", ownerNotes: "Public product pages; observe robots.txt + rate limits. No automation in this sprint.", approvedAt: nowIso, approvedBy: "admin" },
    { sourceId: "src_checkers_specials", automationStatus: "approved_public_observation", allowedModes: ["catalogue", "manual"], requiresHumanReview: true, legalRisk: "medium", ownerNotes: "Time-boxed catalogue; manual/catalogue capture only." },
    { sourceId: "src_takealot", automationStatus: "manual_only", allowedModes: ["manual"], requiresHumanReview: true, legalRisk: "medium", ownerNotes: "Marketplace ToS restrict automated access — manual only." },
    { sourceId: "src_login_walled", automationStatus: "blocked", allowedModes: [], requiresHumanReview: true, legalRisk: "high", ownerNotes: "Login wall / anti-bot — blocked. No adapter may run." },
    { sourceId: "src_mallreds_dir", automationStatus: "approved_public_observation", allowedModes: ["manual", "sitemap"], requiresHumanReview: true, legalRisk: "low", ownerNotes: "Public mall directory for store presence only." },
    { sourceId: "src_pricecheck", automationStatus: "manual_only", allowedModes: ["manual"], requiresHumanReview: true, legalRisk: "medium", ownerNotes: "Aggregator — benchmark/reference only, never MallMind-verified." },
  ];
}

export function buildSeedFabric(now: number): FabricDatabase {
  const iso = (offsetMs: number) => new Date(now + offsetMs).toISOString();
  const HOUR = 3_600_000, DAY = 24 * HOUR;
  const nowIso = iso(0);

  const conf = (over: Partial<ConfidenceDimensions>): ConfidenceDimensions => makeConfidence(over);

  const evidence: EvidenceRecord[] = [
    {
      id: "ev_seed_jsonld_game43", sourceId: "src_game", sourceUrl: "https://www.game.co.za/hisense-43a4k", sourceOwner: "Game",
      adapterId: "jsonld_fixture", adapterVersion: "1.0.0", lifecycleState: "validated", capturedAt: iso(-3 * HOUR), observedAt: iso(-3 * HOUR),
      contentType: "json", contentHash: "sha256:txt-demo-jsonld43", rawContentRef: "fixture://jsonld/jsonld_game_hisense43", screenshotRef: null, documentRef: null,
      pageNumber: null, boundingBox: null, extractedText: 'Product JSON-LD: Hisense 43" A4 FHD — R3,999.00 ZAR, InStock.',
      structuredData: { name: 'Hisense 43" A4 FHD Smart TV', price: 3999, currency: "ZAR", availability: "known_available" },
      extractorId: "schema_org_jsonld", extractorVersion: "1.0.0",
      fieldConfidence: conf({ identityConfidence: 0.95, priceConfidence: 0.85, availabilityConfidence: 0.6, freshnessConfidence: 0.8, sourceAuthority: 0.6 }),
      reviewerStatus: "accepted", reviewerNotes: "Prototype fixture — no live source request performed.", revision: 1, revisionOf: null, supersededBy: null, createdAt: iso(-3 * HOUR), updatedAt: iso(-3 * HOUR),
    },
    {
      id: "ev_seed_manual_game43", sourceId: "src_game", sourceUrl: "https://www.game.co.za/hisense-43a4k", sourceOwner: "Game",
      adapterId: "manual_snapshot", adapterVersion: "1.0.0", lifecycleState: "reviewed", capturedAt: iso(-2 * HOUR), observedAt: iso(-2 * HOUR),
      contentType: "manual", contentHash: "sha256:txt-demo-manual43", rawContentRef: "fixture://manual/cand_manual_src_game", screenshotRef: null, documentRef: null,
      pageNumber: null, boundingBox: null, extractedText: 'In-store shelf confirmation: Hisense 43" A4 — R3,999.',
      structuredData: { productTitle: 'Hisense 43" A4 FHD Smart TV', price: 3999, availability: "known_available" },
      extractorId: "manual_fields", extractorVersion: "1.0.0",
      fieldConfidence: conf({ identityConfidence: 0.9, priceConfidence: 0.9, availabilityConfidence: 0.7, locationConfidence: 0.6, freshnessConfidence: 0.9, sourceAuthority: 0.5 }),
      reviewerStatus: "accepted", reviewerNotes: "Manual snapshot — second evidence record for the same offer.", revision: 1, revisionOf: null, supersededBy: null, createdAt: iso(-2 * HOUR), updatedAt: iso(-2 * HOUR),
    },
    {
      id: "ev_seed_catalogue_checkers32", sourceId: "src_checkers_specials", sourceUrl: "https://www.checkers.co.za/catalogue/electronics-2026-07.pdf", sourceOwner: "Checkers",
      adapterId: "catalogue_fixture", adapterVersion: "1.0.0", lifecycleState: "validated", capturedAt: iso(-20 * HOUR), observedAt: iso(-20 * HOUR),
      contentType: "pdf", contentHash: "sha256:txt-demo-cat32", rawContentRef: null, screenshotRef: null, documentRef: "fixture://catalogue/cat_checkers_2026_07#p4",
      pageNumber: 4, boundingBox: { x: 62, y: 410, width: 240, height: 96 }, extractedText: 'Hisense 32" A4 HD Smart TV — R2 999 (was R3 499). Valid 11–17 July.',
      structuredData: { productTitle: 'Hisense 32" A4 HD Smart TV', price: 2999, originalPrice: 3499, validTo: "2026-07-17" },
      extractorId: "catalogue_blocks", extractorVersion: "1.0.0",
      fieldConfidence: conf({ identityConfidence: 0.85, priceConfidence: 0.9, availabilityConfidence: 0.4, freshnessConfidence: 0.8, sourceAuthority: 0.7 }),
      reviewerStatus: "unreviewed", reviewerNotes: null, revision: 1, revisionOf: null, supersededBy: null, createdAt: iso(-20 * HOUR), updatedAt: iso(-20 * HOUR),
    },
  ];

  // One offer with MULTIPLE evidence records (product page + manual confirmation).
  const provenance: ProvenanceLink[] = [
    { id: "prov_off_game43_jsonld", entityType: "product_offer", entityId: "offer_game_hisense43", evidenceId: "ev_seed_jsonld_game43", relation: "json_ld_product_page", createdAt: nowIso },
    { id: "prov_off_game43_manual", entityType: "product_offer", entityId: "offer_game_hisense43", evidenceId: "ev_seed_manual_game43", relation: "phone_or_shelf_confirmation", createdAt: nowIso },
    { id: "prov_snap_game43", entityType: "source_snapshot", entityId: "snap_game_hisense43", evidenceId: "ev_seed_jsonld_game43", relation: "snapshot_evidence", createdAt: nowIso },
    { id: "prov_off_checkers32", entityType: "product_offer", entityId: "offer_checkers_hisense32", evidenceId: "ev_seed_catalogue_checkers32", relation: "catalogue_page", createdAt: nowIso },
  ];

  const runs: AdapterRun[] = [
    {
      id: "arun_seed_jsonld", adapterId: "jsonld_fixture", sourceId: "src_game", mode: "json_ld", lifecycleStage: "conflict_checked",
      candidatesDiscovered: 2, captures: 2, extractedCandidates: 2, validationFailures: 0, warnings: 2,
      evidenceIds: ["ev_seed_jsonld_game43"], eventIds: ["evt_seed_1"],
      status: "needs_review", policyDecision: { allowed: true, reason: "ok", message: "Adapter permitted by policy.", requiresHumanReview: true },
      startedAt: iso(-3 * HOUR), completedAt: iso(-3 * HOUR), notes: "Captured 2, extracted 2. Awaiting human review — nothing published.",
    },
    {
      id: "arun_seed_blocked", adapterId: "jsonld_fixture", sourceId: "src_login_walled", mode: "json_ld", lifecycleStage: "discovered",
      candidatesDiscovered: 0, captures: 0, extractedCandidates: 0, validationFailures: 0, warnings: 0,
      evidenceIds: [], eventIds: ["evt_seed_blocked"],
      status: "blocked", policyDecision: { allowed: false, reason: "source_blocked", message: "Source src_login_walled is policy-blocked and cannot run any adapter.", requiresHumanReview: true },
      startedAt: iso(-1 * DAY), completedAt: iso(-1 * DAY), notes: "Blocked by policy: source is login-walled.",
    },
  ];

  const events: FabricEvent[] = [
    { id: "evt_seed_1", type: "review.required", sourceId: "src_game", adapterId: "jsonld_fixture", payload: { evidenceId: "ev_seed_jsonld_game43" }, occurredAt: iso(-3 * HOUR) },
    { id: "evt_seed_blocked", type: "source.policy_blocked", sourceId: "src_login_walled", adapterId: "jsonld_fixture", payload: { reason: "source_blocked" }, occurredAt: iso(-1 * DAY) },
    { id: "evt_seed_cat", type: "extraction.completed", sourceId: "src_checkers_specials", adapterId: "catalogue_fixture", payload: { count: 2 }, occurredAt: iso(-20 * HOUR) },
  ];

  // Seed offer drafts across the review scenarios (needs_review; no decisions yet).
  const baseConf = conf({ identityConfidence: 0.9, priceConfidence: 0.85, availabilityConfidence: 0.6, freshnessConfidence: 0.8, sourceAuthority: 0.6 });
  const draft = (over: Partial<OfferDraft>): OfferDraft => ({
    id: "draft_x", sourceId: "src_game", retailerId: "ret_game", retailerName: "Game", mallId: null, storeId: null,
    productIdentityCandidateId: null, productTitle: 'Hisense 43" A4 FHD Smart TV', brand: "Hisense", manufacturerModel: "43A4K",
    retailerSku: "43A4K", gtin: "6942147489012", category: "television", price: 3999, currency: "ZAR", originalPrice: 4499,
    promoText: null, promoStart: null, promoEnd: null, availabilityStatus: "inferred", geographicScope: "online_only",
    sellerName: null, observedAt: iso(-3 * HOUR), expiresAt: null, suggestedTrustLabel: "recently_observed", finalTrustLabel: null,
    reviewStatus: "needs_review", evidenceIds: ["ev_seed_jsonld_game43"], confidence: baseConf, warnings: [], conflictState: "none",
    draftHash: "sha256:txt-seeddraft", normalizerVersion: "1.0.0", adapterId: "jsonld_fixture", extractorId: "schema_org_jsonld",
    createdAt: iso(-3 * HOUR), updatedAt: iso(-3 * HOUR), ...over,
  });

  const drafts: OfferDraft[] = [
    draft({ id: "draft_seed_game43" }),
    draft({ id: "draft_seed_conflict", conflictState: "conflict_detected", price: 4499, retailerId: "ret_checkers", retailerName: "Checkers", warnings: ["Conflicting price for the same product/source category."] }),
    draft({
      id: "draft_seed_expired_cat", sourceId: "src_checkers_specials", retailerId: "ret_checkers", retailerName: "Checkers",
      productTitle: 'Hisense 32" A4 HD Smart TV', manufacturerModel: "32A4K", retailerSku: "32A4K", gtin: null, price: 2999, originalPrice: 3499,
      promoStart: iso(-8 * DAY), promoEnd: iso(-1 * DAY), expiresAt: iso(-1 * DAY), availabilityStatus: "inferred", geographicScope: "national",
      suggestedTrustLabel: "catalogue_special", evidenceIds: ["ev_seed_catalogue_checkers32"], adapterId: "catalogue_fixture", extractorId: "catalogue_blocks",
      warnings: ["Catalogue past its validity window."],
    }),
    draft({
      id: "draft_seed_unknown_avail", availabilityStatus: "unknown", geographicScope: "unknown", evidenceIds: ["ev_seed_manual_game43"],
      adapterId: "manual_snapshot", extractorId: "manual_fields", suggestedTrustLabel: "manual_admin", warnings: ["Availability is unknown — not presented as in-stock."],
    }),
  ];

  return { version: 2, policies: seedPolicies(nowIso), evidence, provenance, runs, events, drafts, decisions: [] };
}
