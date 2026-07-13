/**
 * Prototype local persistence + pure DB transforms.
 *
 * "Prototype — local persisted data": the ingestion dataset lives in
 * localStorage (browser) so the admin experience is fully working without a
 * backend, while staying honest that it is not a live/remote store. All mutations
 * are pure `(db, …) => db` transforms so they are unit-testable.
 */

import type { IngestionDatabase, ProductOffer, IngestionRun, ReviewQueueItem, ReviewStatus } from "./model";
import { buildSeedDatabase } from "./seed";
import { validateOffer, type ValidationIssue } from "./validation";
import { computeEffectiveFreshness } from "./freshness";

export const STORAGE_KEY = "mallmind.ingestion.v1";

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
  const needingReview = db.offers.filter((o) => o.reviewStatus === "pending" || o.reviewStatus === "needs_correction");
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
    validFrom: null,
    validUntil: input.validUntil ?? null,
    availabilityScope: input.availabilityScope,
    priceTrustLabel: input.priceTrustLabel,
    reviewStatus: "pending",
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
      severity: issue.severity, status: "pending", createdAt: nowIso, reviewedAt: null, reviewedBy: null, decisionNotes: null,
    });
  }
  // Always queue for manual approval even when clean.
  if (issues.length === 0) {
    next.reviewQueue.push({
      id: newId("rq"), entityType: "product_offer", entityId: offer.id, reason: input.notes?.trim() || "Manual offer entry — approve to publish.",
      severity: "info", status: "pending", createdAt: nowIso, reviewedAt: null, reviewedBy: null, decisionNotes: null,
    });
  }
  return { db: next, offer, issues };
}

// ── Review decisions ──────────────────────────────────────────────────────────
export type ReviewDecision = "approved" | "rejected" | "needs_correction";

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
    if (q.entityType === "product_offer" && q.entityId === offerId && q.status === "pending") {
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

/** Commit accepted+warning offer rows, create the ingestion run + review entries. */
export function commitOfferCsv(
  db: IngestionDatabase,
  accepted: ProductOffer[],
  warned: { offer: ProductOffer; reason: string }[],
  meta: { filename: string; initiatedBy: string; totalRows: number; rejectedRows: number },
  nowIso: string,
): CommitResult {
  const next = clone(db);
  const runId = newId("run");
  for (const o of accepted) next.offers.push({ ...o, reviewStatus: "pending", published: false });
  for (const w of warned) {
    next.offers.push({ ...w.offer, reviewStatus: "pending", published: false });
    next.reviewQueue.push({ id: newId("rq"), entityType: "product_offer", entityId: w.offer.id, reason: w.reason, severity: "warning", status: "pending", createdAt: nowIso, reviewedAt: null, reviewedBy: null, decisionNotes: null });
  }
  const run: IngestionRun = {
    id: runId, sourceType: "csv_import", filename: meta.filename, startedAt: nowIso, completedAt: nowIso, status: "completed",
    totalRows: meta.totalRows, acceptedRows: accepted.length, rejectedRows: meta.rejectedRows, warningRows: warned.length,
    initiatedBy: meta.initiatedBy, notes: "CSV import (prototype — local persisted data).",
  };
  next.runs.push(run);
  return { db: next, run };
}
