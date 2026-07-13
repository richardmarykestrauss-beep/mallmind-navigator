/**
 * Prototype local persistence + pure DB transforms.
 *
 * "Prototype — local persisted data": the ingestion dataset lives in
 * localStorage (browser) so the admin experience is fully working without a
 * backend, while staying honest that it is not a live/remote store. All mutations
 * are pure `(db, …) => db` transforms so they are unit-testable.
 */

import type { IngestionDatabase, ProductOffer, IngestionRun, ReviewQueueItem, ReviewStatus, Source, SourceSnapshot, SourceType, SourceRegistryStatus, RiskLevel } from "./model";
import { buildSeedDatabase } from "./seed";
import { validateOffer, type ValidationIssue } from "./validation";
import { computeEffectiveFreshness, isEffectivelyStale } from "./freshness";
import { deriveAvailabilityStatus } from "./availability";

export const STORAGE_KEY = "mallmind.ingestion.v2";

export function loadDatabase(now: number = Date.now()): IngestionDatabase {
  if (typeof localStorage !== "undefined") {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw) as IngestionDatabase;
    } catch { /* fall through to seed */ }
  }
  return buildSeedDatabase(now);
}

export function saveDatabase(db: IngestionDatabase): void {
  if (typeof localStorage === "undefined") return;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(db)); } catch { /* quota */ }
}

export function resetToSeed(now: number = Date.now()): IngestionDatabase {
  const db = buildSeedDatabase(now);
  saveDatabase(db);
  return db;
}

// ── Overview ────────────────────────────────────────────────────────────────
export interface Overview {
  totalMalls: number;
  totalPhysicalStores: number;
  totalProducts: number;
  totalActiveOffers: number;
  offersNeedingReview: number;
  staleOffers: number;
  latestRun: IngestionRun | null;
}

export function computeOverview(db: IngestionDatabase, nowMs: number): Overview {
  const activeOffers = db.offers.filter(
    (o) => o.published && o.reviewStatus === "approved" && computeEffectiveFreshness(o, nowMs).effectiveTrustLabel !== "unavailable",
  );
  const staleOffers = db.offers.filter((o) => o.published && computeEffectiveFreshness(o, nowMs).state === "stale");
  const needingReview = db.offers.filter((o) => o.reviewStatus === "staged" || o.reviewStatus === "needs_review");
  const latestRun = [...db.runs].sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))[0] ?? null;
  return {
    totalMalls: db.malls.length,
    totalPhysicalStores: db.stores.length,
    totalProducts: db.products.length,
    totalActiveOffers: activeOffers.length,
    offersNeedingReview: needingReview.length,
    staleOffers: staleOffers.length,
    latestRun,
  };
}

const clone = (db: IngestionDatabase): IngestionDatabase => JSON.parse(JSON.stringify(db));

function newId(prefix: string): string {
  const uuid = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
  return `${prefix}_${uuid}`;
}

// ── Manual offer entry ────────────────────────────────────────────────────────
export interface OfferInput {
  productId: string;
  retailerId: string;
  sellerName?: string | null;
  channel: ProductOffer["channel"];
  currency: string;
  currentPrice: number;
  previousPrice?: number | null;
  promotionLabel?: string | null;
  sourceUrl: string;
  sourceType: ProductOffer["sourceType"];
  sourceObservedAt: string;
  validUntil?: string | null;
  availabilityScope: ProductOffer["availabilityScope"];
  priceTrustLabel: ProductOffer["priceTrustLabel"];
  branchEvidencePresent: boolean;
  evidenceText?: string | null;
  notes?: string | null;
}

export interface AddOfferResult {
  db: IngestionDatabase;
  offer: ProductOffer;
  issues: ValidationIssue[];
}

/** Add a manually-entered offer (always pending review; never auto-published). */
export function addOffer(db: IngestionDatabase, input: OfferInput, nowIso: string): AddOfferResult {
  const next = clone(db);
  const offer: ProductOffer = {
    id: newId("offer"),
    productId: input.productId,
    retailerId: input.retailerId,
    sellerName: input.sellerName ?? null,
    channel: input.channel,
    currency: input.currency.toUpperCase(),
    currentPrice: input.currentPrice,
    previousPrice: input.previousPrice ?? null,
    promotionLabel: input.promotionLabel ?? null,
    sourceUrl: input.sourceUrl,
    sourceType: input.sourceType,
    sourceObservedAt: input.sourceObservedAt,
    expiresAt: null,
    validFrom: null,
    validUntil: input.validUntil ?? null,
    availabilityStatus: deriveAvailabilityStatus(input.availabilityScope),
    availabilityScope: input.availabilityScope,
    priceTrustLabel: input.priceTrustLabel,
    snapshotId: null,
    evidenceText: input.evidenceText?.trim() || null,
    evidenceHash: null,
    conflictGroupId: null,
    reviewStatus: "staged",
    published: false,
    createdAt: nowIso,
    updatedAt: nowIso,
    demonstrationData: true,
  };
  next.offers.push(offer);
  const issues = validateOffer(offer, next, Date.parse(nowIso));
  // Create review-queue entries for any warnings/errors so nothing is silently accepted.
  for (const issue of issues) {
    next.reviewQueue.push({
      id: newId("rq"), entityType: "product_offer", entityId: offer.id, reason: issue.message,
      severity: issue.severity, status: "staged", createdAt: nowIso, reviewedAt: null, reviewedBy: null, decisionNotes: null,
    });
  }
  // Always queue for manual approval even when clean.
  if (issues.length === 0) {
    next.reviewQueue.push({
      id: newId("rq"), entityType: "product_offer", entityId: offer.id, reason: input.notes?.trim() || "Manual offer entry — approve to publish.",
      severity: "info", status: "staged", createdAt: nowIso, reviewedAt: null, reviewedBy: null, decisionNotes: null,
    });
  }
  return { db: next, offer, issues };
}

// ── Review decisions ──────────────────────────────────────────────────────────
export type ReviewDecision = "approved" | "rejected" | "needs_review" | "archived";

export function decideOfferReview(
  db: IngestionDatabase, offerId: string, decision: ReviewDecision, reviewer: string, notes: string | null, nowIso: string,
): IngestionDatabase {
  const next = clone(db);
  const offer = next.offers.find((o) => o.id === offerId);
  if (offer) {
    const status: ReviewStatus = decision;
    offer.reviewStatus = status;
    offer.published = decision === "approved"; // publish ONLY on approval
    offer.updatedAt = nowIso;
  }
  next.reviewQueue.forEach((q: ReviewQueueItem) => {
    if (q.entityType === "product_offer" && q.entityId === offerId && (q.status === "staged" || q.status === "needs_review")) {
      q.status = decision;
      q.reviewedAt = nowIso;
      q.reviewedBy = reviewer;
      q.decisionNotes = notes;
    }
  });
  return next;
}

// ── CSV commit ─────────────────────────────────────────────────────────────────
export interface CommitResult { db: IngestionDatabase; run: IngestionRun; }

/** Commit accepted+warning offer rows (+ any new products), create the run + review entries. */
export function commitOfferCsv(
  db: IngestionDatabase,
  accepted: ProductOffer[],
  warned: { offer: ProductOffer; reason: string }[],
  meta: { filename: string; initiatedBy: string; totalRows: number; rejectedRows: number },
  nowIso: string,
  newProducts: import("./model").Product[] = [],
): CommitResult {
  const next = clone(db);
  const runId = newId("run");
  const nowMs = Date.parse(nowIso);
  for (const p of newProducts) if (!next.products.some((x) => x.id === p.id)) next.products.push(p);
  for (const o of accepted) next.offers.push({ ...o, reviewStatus: "staged", published: false });
  for (const w of warned) {
    next.offers.push({ ...w.offer, reviewStatus: "staged", published: false });
    next.reviewQueue.push({ id: newId("rq"), entityType: "product_offer", entityId: w.offer.id, reason: w.reason, severity: "warning", status: "staged", createdAt: nowIso, reviewedAt: null, reviewedBy: null, decisionNotes: null });
  }
  const staleItemsDetected = [...accepted, ...warned.map((w) => w.offer)].filter((o) => isEffectivelyStale(o, nowMs)).length;
  const run: IngestionRun = {
    id: runId, runType: "manual_csv", sourceType: "csv_import", filename: meta.filename, evidenceUrl: null, startedAt: nowIso, completedAt: nowIso, status: "completed",
    totalRows: meta.totalRows, acceptedRows: accepted.length, rejectedRows: meta.rejectedRows, warningRows: warned.length, conflictsDetected: 0, staleItemsDetected,
    initiatedBy: meta.initiatedBy, notes: "CSV import (prototype — local persisted data).",
  };
  next.runs.push(run);
  return { db: next, run };
}

// ── Source registry (3rd ingestion path) ────────────────────────────────────────
export interface SourceInput {
  name: string;
  sourceUrl: string;
  sourceType: SourceType;
  retailerId?: string | null;
  mallId?: string | null;
  status?: SourceRegistryStatus;
  riskLevel?: RiskLevel;
  legalRiskNote?: string | null;
  ownerNotes?: string | null;
}

/** Register a public source in the registry (no fetching is performed). */
export function addSource(db: IngestionDatabase, input: SourceInput, nowIso: string): { db: IngestionDatabase; source: Source } {
  const next = clone(db);
  const source: Source = {
    id: newId("src"), name: input.name, sourceUrl: input.sourceUrl, sourceType: input.sourceType,
    retailerId: input.retailerId ?? null, mallId: input.mallId ?? null, status: input.status ?? "candidate",
    riskLevel: input.riskLevel ?? "medium",
    legalRiskNote: input.legalRiskNote ?? null, lastCheckedAt: nowIso, ownerNotes: input.ownerNotes ?? null, createdAt: nowIso,
  };
  next.sources.push(source);
  next.runs.push({
    id: newId("run"), runType: "source_snapshot", sourceType: input.sourceType, filename: null, evidenceUrl: input.sourceUrl,
    startedAt: nowIso, completedAt: nowIso, status: "completed", totalRows: 0, acceptedRows: 0, rejectedRows: 0, warningRows: 0,
    conflictsDetected: 0, staleItemsDetected: 0, initiatedBy: "admin", notes: `Source registered: ${input.name}.`,
  });
  return { db: next, source };
}

export function decideSourceStatus(db: IngestionDatabase, sourceId: string, status: SourceRegistryStatus, nowIso: string): IngestionDatabase {
  const next = clone(db);
  const s = next.sources.find((x) => x.id === sourceId);
  if (s) { s.status = status; s.lastCheckedAt = nowIso; }
  return next;
}

// ── Source snapshots (captured evidence) ─────────────────────────────────────
export interface SnapshotInput {
  sourceUrl: string;
  sourceType: SourceType;
  evidenceText: string;
  retailerId?: string | null;
  mallId?: string | null;
  observedAt?: string | null;
  notes?: string | null;
}

/**
 * Capture a source snapshot: preserve the URL, observed timestamp, source type
 * and cited evidence text. No page is fetched — the admin pastes the evidence.
 */
export function addSourceSnapshot(db: IngestionDatabase, input: SnapshotInput, nowIso: string): { db: IngestionDatabase; snapshot: SourceSnapshot } {
  const next = clone(db);
  const runId = newId("run");
  const retrievedAt = input.observedAt?.trim() || nowIso;
  // Deterministic-enough content hash marker (prototype — not a real digest).
  const hash = `sha256:snap-${input.evidenceText.length}-${retrievedAt.replace(/[^0-9]/g, "").slice(0, 12)}`;
  const snapshot: SourceSnapshot = {
    id: newId("snap"), sourceUrl: input.sourceUrl, sourceType: input.sourceType, retrievedAt,
    contentHash: hash, evidenceExcerpt: input.evidenceText.trim(),
    evidenceMetadata: { note: "Admin-captured evidence (prototype — no live page capture stored)." },
    parserVersion: "ingest-rc1", ingestionRunId: runId, status: "captured",
    retailerId: input.retailerId ?? null, mallId: input.mallId ?? null,
    reviewStatus: "staged", reviewedBy: null, notes: input.notes?.trim() || null,
  };
  next.snapshots.push(snapshot);
  next.runs.push({
    id: runId, runType: "source_snapshot", sourceType: input.sourceType, filename: null, evidenceUrl: input.sourceUrl,
    startedAt: nowIso, completedAt: nowIso, status: "completed", totalRows: 1, acceptedRows: 0, rejectedRows: 0, warningRows: 0,
    conflictsDetected: 0, staleItemsDetected: 0, initiatedBy: "admin", notes: `Source snapshot captured for ${input.sourceUrl}.`,
  });
  return { db: next, snapshot };
}
