/**
 * retailVerificationPolicy.ts — Retail Intelligence Core v1 (Sprint 20A.8A)
 *
 * THE single deterministic gate that decides whether an APPROVED,
 * evidence-backed `retail_price_observation` is eligible to project a VERIFIED
 * price onto a product. A product may only become newly `manually_verified`,
 * or have its verification freshness renewed, from an observation that passes
 * this policy.
 *
 * This does NOT invent new trust statuses. It reuses the existing doctrine:
 *   - mapTrustStateToProductQuality / isVerifiedQuality  (manual_fact_entry +
 *     csv_manual stays needs_review; only external-evidence methods verify)
 *   - the ambiguity refusal from retailNameMatcher (passed in as a MatchResult)
 * and adds the explicit eligibility gates that the publish planner assumes its
 * callers already enforce.
 *
 * Observation = historical source of truth. Product row = current shopper-facing
 * projection. This module decides; it never writes.
 *
 * Pure: no Supabase, no env, no network, no fs, no side effects, no clock reads
 * (the caller passes `nowIso`).
 */

import {
  ObservationLike,
  RetailSourceLike,
  RetailSnapshotLike,
  MatchResult,
  ProductQualityStatus,
} from "./retailTypes";
import {
  mapTrustStateToProductQuality,
  isVerifiedQuality,
} from "./retailTrustMapper";

/**
 * CANONICAL VERIFICATION-POLICY MATRIX (single source of truth).
 *
 * One row per recognised observation method (migration-026 vocabulary). Every
 * derived set/threshold below comes from this table — no duplicate magic
 * constants. The SQL RPC (`publish_verified_observation`, migration 027) MUST
 * mirror these exact numbers/semantics; the parity test (retail-core harness)
 * and docs/retail/evidence-backed-verification-unification.md pin them.
 *
 *   snapshotRequired — a durable evidence snapshot is mandatory.
 *   minConfidence    — minimum observation confidence for a verified projection.
 *   validityDays     — default freshness window when the observation has no valid_to.
 *   canVerify        — may EVER produce a manually_verified/live_feed projection.
 *   online           — price is inherently online (never claim as in-store).
 */
export interface MethodPolicy {
  snapshotRequired: boolean;
  minConfidence: number;
  validityDays: number;
  canVerify: boolean;
  online: boolean;
}

export const METHOD_POLICY: Readonly<Record<string, MethodPolicy>> = {
  store_visit:           { snapshotRequired: true,  minConfidence: 0.6,  validityDays: 14, canVerify: true,  online: false },
  receipt:               { snapshotRequired: true,  minConfidence: 0.6,  validityDays: 14, canVerify: true,  online: false },
  retailer_confirmation: { snapshotRequired: true,  minConfidence: 0.6,  validityDays: 14, canVerify: true,  online: false },
  phone:                 { snapshotRequired: true,  minConfidence: 0.65, validityDays: 14, canVerify: true,  online: false },
  flyer:                 { snapshotRequired: true,  minConfidence: 0.65, validityDays: 7,  canVerify: true,  online: false },
  website:               { snapshotRequired: true,  minConfidence: 0.7,  validityDays: 7,  canVerify: true,  online: true  },
  affiliate_feed:        { snapshotRequired: false, minConfidence: 0.7,  validityDays: 2,  canVerify: true,  online: true  },
  partner_feed:          { snapshotRequired: false, minConfidence: 0.7,  validityDays: 2,  canVerify: true,  online: true  },
  csv_manual:            { snapshotRequired: false, minConfidence: 0.6,  validityDays: 7,  canVerify: false, online: false },
  user_submission:       { snapshotRequired: false, minConfidence: 0.6,  validityDays: 7,  canVerify: false, online: false },
};

/** Verification methods recognised by migration 026 (derived from the matrix). */
export const RECOGNISED_OBSERVATION_METHODS: ReadonlySet<string> = new Set(
  Object.keys(METHOD_POLICY)
);

/** Methods that REQUIRE a durable evidence snapshot (derived). */
export const SNAPSHOT_REQUIRED_METHODS: ReadonlySet<string> = new Set(
  Object.entries(METHOD_POLICY).filter(([, p]) => p.snapshotRequired).map(([m]) => m)
);

/** Methods whose price is inherently ONLINE, not in-store (derived). */
export const ONLINE_ONLY_METHODS: ReadonlySet<string> = new Set(
  Object.entries(METHOD_POLICY).filter(([, p]) => p.online).map(([m]) => m)
);

/** Methods that may ever produce a verified projection (derived). */
export const VERIFY_CAPABLE_METHODS: ReadonlySet<string> = new Set(
  Object.entries(METHOD_POLICY).filter(([, p]) => p.canVerify).map(([m]) => m)
);

/** Source legal statuses that block publication outright. */
export const BLOCKING_LEGAL_STATUS: ReadonlySet<string> = new Set([
  "needs_legal_review",
  "reference_only",
]);

/** Baseline confidence/validity fallbacks for any method missing from the matrix. */
export const VERIFIED_MIN_CONFIDENCE = 0.6;
export const DEFAULT_VALIDITY_DAYS = 7;

const MS_PER_DAY = 86_400_000;

/** Minimum confidence for a method (matrix value, else baseline). */
export function methodMinConfidence(method: string | null | undefined): number {
  return METHOD_POLICY[String(method ?? "")]?.minConfidence ?? VERIFIED_MIN_CONFIDENCE;
}

/** Default validity window (days) for a method (matrix value, else fallback). */
export function methodValidityDays(method: string | null | undefined): number {
  return METHOD_POLICY[String(method ?? "")]?.validityDays ?? DEFAULT_VALIDITY_DAYS;
}

/** Whether a method may ever produce a verified projection (matrix value). */
export function methodCanVerify(method: string | null | undefined): boolean {
  return METHOD_POLICY[String(method ?? "")]?.canVerify ?? false;
}

/**
 * Source eligibility for STAGING/publication (20A.8 hardening). Pure: lets the
 * price-correction route return a precise 404/400 instead of a generic 500.
 */
export interface SourceEligibility {
  found: boolean;
  active: boolean;
  legallyClear: boolean;
  blockers: string[];
}

export function assessSourceEligibility(
  source: RetailSourceLike | null | undefined
): SourceEligibility {
  if (!source || !source.id) {
    return { found: false, active: false, legallyClear: false, blockers: ["Source not found."] };
  }
  const blockers: string[] = [];
  const active = source.is_active !== false;
  if (!active) blockers.push("Source is inactive.");
  const legallyClear = !BLOCKING_LEGAL_STATUS.has(String(source.legal_status ?? ""));
  if (!legallyClear) {
    blockers.push(`Source legal_status '${source.legal_status}' is not eligible for publication.`);
  }
  return { found: true, active, legallyClear, blockers };
}

/** Observation shape this policy reads (superset of ObservationLike). */
export interface VerificationPolicyObservation extends ObservationLike {
  review_status?: string | null;
  observed_at?: string | null;
  valid_from?: string | null;
  valid_to?: string | null;
  published_product_id?: string | null;
  published_at?: string | null;
}

export interface VerificationPolicyInput {
  observation?: VerificationPolicyObservation | null;
  /** Linked source; falls back to observation.retail_data_sources. */
  source?: RetailSourceLike | null;
  /** Linked evidence snapshot; falls back to observation.retail_source_snapshots. */
  snapshot?: RetailSnapshotLike | null;
  /** Pre-computed product match — strategy "ambiguous" is refused. */
  match?: MatchResult | null;
  /** Optional live product to check mall/shop/product identity consistency. */
  product?: { id?: string | null; mall_id?: string | null; shop_id?: string | null } | null;
  /** Deterministic "now" (ISO). Required — the policy never reads the clock. */
  nowIso: string;
}

export interface VerificationDecision {
  /** True only when EVERY gate passes AND it maps to a verified tier. */
  eligible: boolean;
  /** Projected products.data_quality_status (existing doctrine). */
  projectedQuality: ProductQualityStatus;
  /** Projected products.price_verified_at (publish time), or null if ineligible. */
  projectedVerifiedAt: string | null;
  /** Projected freshness horizon (valid_to or method policy), or null. */
  projectedValidUntil: string | null;
  /** Observation confidence considered (0..1). */
  confidence: number;
  /** Hard reasons the observation cannot verify a product (admin-facing). */
  blockers: string[];
  /** Soft cautions that do not block (admin-facing). */
  warnings: string[];
}

/**
 * Freshness horizon for a projection:
 *   1. explicit observation valid_to
 *   2. method/source validity policy (observed_at + METHOD_VALIDITY_DAYS)
 *   3. conservative DEFAULT_VALIDITY_DAYS fallback
 * All measured from observed_at when available (honest about real age).
 */
export function computeProjectedValidUntil(
  validTo: string | null | undefined,
  method: string | null | undefined,
  observedAt: string | null | undefined,
  nowIso: string
): string | null {
  if (validTo) {
    const t = new Date(validTo).getTime();
    return Number.isNaN(t) ? null : new Date(t).toISOString();
  }
  const days = methodValidityDays(method);
  const baseMs = observedAt ? new Date(observedAt).getTime() : new Date(nowIso).getTime();
  if (Number.isNaN(baseMs)) return null;
  return new Date(baseMs + days * MS_PER_DAY).toISOString();
}

/**
 * Evaluate whether an observation may project a verified price onto a product.
 * Deterministic and side-effect free: same input → same decision.
 */
export function evaluateObservationVerification(
  input: VerificationPolicyInput
): VerificationDecision {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const nowMs = new Date(input.nowIso).getTime();

  const obs = input.observation ?? null;

  if (!obs) {
    return {
      eligible: false,
      projectedQuality: "needs_review",
      projectedVerifiedAt: null,
      projectedValidUntil: null,
      confidence: 0,
      blockers: ["Observation does not exist."],
      warnings,
    };
  }

  const method = String(obs.verification_method ?? "");
  const source = input.source ?? obs.retail_data_sources ?? null;
  const snapshot = input.snapshot ?? obs.retail_source_snapshots ?? null;
  const confidence = Number(obs.confidence ?? 0);

  // Projected product quality via the EXISTING trust doctrine. This is where
  // manual_fact_entry + csv_manual (or any non-evidence method) deterministically
  // stays needs_review and can never become a verified projection.
  const projectedQuality = mapTrustStateToProductQuality(
    obs.trust_state,
    obs.verification_method
  );

  // 1. Approved review status.
  const reviewStatus = String(obs.review_status ?? "");
  if (reviewStatus !== "approved") {
    blockers.push(
      `Observation review_status is '${reviewStatus || "missing"}', not 'approved'.`
    );
  }

  // 2. Not already published (re-publication must go through the idempotent RPC).
  if (obs.published_product_id || obs.published_at || reviewStatus === "published") {
    blockers.push(
      "Observation is already published; re-publication must use the idempotent publish path."
    );
  }

  // 3. Positive price.
  if (!(Number(obs.price) > 0)) {
    blockers.push("Observation price must be a positive number.");
  }

  // 4. Recognised verification method.
  if (!RECOGNISED_OBSERVATION_METHODS.has(method)) {
    blockers.push(`Verification method '${method || "missing"}' is not recognised.`);
  }

  // 5. Source exists, is active, and is legally clear.
  if (!source || !source.id) {
    blockers.push("Observation has no linked data source.");
  } else {
    if (source.is_active === false) {
      blockers.push("Linked data source is inactive.");
    }
    if (BLOCKING_LEGAL_STATUS.has(String(source.legal_status ?? ""))) {
      blockers.push(
        `Source legal_status '${source.legal_status}' blocks publication.`
      );
    }
  }

  // 6. Evidence snapshot present when the method requires it.
  if (SNAPSHOT_REQUIRED_METHODS.has(method) && !(snapshot && snapshot.id)) {
    blockers.push(
      `Verification method '${method}' requires an evidence snapshot, but none is linked.`
    );
  }

  // 7. Observed time present.
  if (!obs.observed_at) {
    blockers.push("Observation observed_at is missing.");
  }

  // 8. Product / mall / shop identity consistency.
  if (input.product) {
    if (input.product.mall_id && obs.mall_id && input.product.mall_id !== obs.mall_id) {
      blockers.push("Observation mall_id does not match the target product's mall_id.");
    }
    if (input.product.shop_id && obs.shop_id && input.product.shop_id !== obs.shop_id) {
      blockers.push("Observation shop_id does not match the target product's shop_id.");
    }
    if (obs.product_id && input.product.id && obs.product_id !== input.product.id) {
      blockers.push("Observation product_id does not match the target product id.");
    }
  }

  // 9. Ambiguous product match is refused (never auto-pick a product).
  if (input.match && input.match.strategy === "ambiguous") {
    blockers.push(
      "Ambiguous product match; refusing to choose a product automatically."
    );
  }

  // 10. Confidence meets the threshold for this method (canonical matrix).
  const minConfidence = methodMinConfidence(method);
  if (confidence < minConfidence) {
    blockers.push(
      `Confidence ${confidence} is below the ${minConfidence} threshold required for method '${method || "unknown"}'.`
    );
  }

  // 11. Evidence sufficiency for a verified tier (manual/csv/user → refused).
  if (!isVerifiedQuality(projectedQuality)) {
    blockers.push(
      `Evidence is insufficient for a verified projection: trust_state '${obs.trust_state ?? "none"}' + method '${method || "none"}' maps to '${projectedQuality}', not a verified tier.`
    );
  }

  // 11b. A method that can never verify (csv_manual / user_submission) must not
  //      produce a verified projection even if the trust_state claims 'verified'.
  if (isVerifiedQuality(projectedQuality) && !methodCanVerify(method)) {
    blockers.push(
      `Method '${method || "none"}' can never produce a verified price; it requires evidence-backed upgrade.`
    );
  }

  // 12. Validity window has not already expired.
  const projectedValidUntil = computeProjectedValidUntil(
    obs.valid_to,
    method,
    obs.observed_at,
    input.nowIso
  );
  if (projectedValidUntil && new Date(projectedValidUntil).getTime() <= nowMs) {
    blockers.push(
      "Validity window has already expired; this observation cannot produce a fresh verified price."
    );
  }

  // ── Soft, admin-facing warnings (never block) ─────────────────────────────
  if (ONLINE_ONLY_METHODS.has(method)) {
    warnings.push(
      `Method '${method}' reflects an online price; do not present it as a confirmed in-store price.`
    );
  }
  if (confidence > 0 && confidence < 0.8) {
    warnings.push(`Confidence ${confidence} is modest; stronger evidence is preferable.`);
  }

  const eligible = blockers.length === 0;

  return {
    eligible,
    projectedQuality,
    projectedVerifiedAt: eligible ? input.nowIso : null,
    projectedValidUntil: eligible ? projectedValidUntil : null,
    confidence,
    blockers,
    warnings,
  };
}

/**
 * Confidence assigned to a user price-correction by its claimed source. Always
 * LOW / non-verifying — a user report can never self-verify a price.
 */
export const CORRECTION_SOURCE_CONFIDENCE: Readonly<Record<string, number>> = {
  in_store_seen: 0.45,
  retailer_website: 0.4,
  catalogue: 0.4,
  user_memory: 0.3,
  other: 0.3,
};

/**
 * Draft a staged observation from a user price correction (20A.8C).
 *
 * trust_state and verification_method are ALWAYS user-submitted regardless of
 * the claimed source: a user report enters the evidence pipeline as unverified
 * and can only become verified later via real admin evidence + this policy.
 * (mapTrustStateToProductQuality maps user_submitted → user_submitted, never a
 * verified tier — so a correction alone can never produce verified trust.)
 */
export function buildUserCorrectionObservationDraft(
  sourceType: string | null | undefined
): {
  trust_state: "user_submitted";
  verification_method: "user_submission";
  confidence: number;
} {
  const key = String(sourceType ?? "other");
  return {
    trust_state: "user_submitted",
    verification_method: "user_submission",
    confidence:
      CORRECTION_SOURCE_CONFIDENCE[key] ?? CORRECTION_SOURCE_CONFIDENCE.other,
  };
}
