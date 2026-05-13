/**
 * dataTrustPolicy.ts — MallMind Data Trust Policy Engine
 *
 * Sprint 9G · MallMind Navigator
 *
 * CENTRAL deterministic verification rulebook.
 * All mall data bots call this to classify whether a data point is:
 *   real · trusted · verified · stale · disputed · risky · rejected
 *
 * 100% deterministic — no external calls, no DB reads, no mutations.
 * Pure functions. Consistent results for the same input, every time.
 *
 * SAFE BADGE CONTRACT:
 *   All user-visible trust labels MUST come from getSafeBadgeForTrustState().
 *   Never inline trust words like "verified", "confirmed", "guaranteed" elsewhere.
 */

// ── Trust state (12 states) ───────────────────────────────────────────────────

export type TrustState =
  | "raw"                // Just arrived, no checks run yet
  | "reported"           // User submitted, no supporting evidence
  | "evidence_submitted" // Has photo, receipt, or attached evidence
  | "source_matched"     // Source URL/name validated as credible
  | "community_supported"// 3+ matching independent reports agree
  | "admin_verified"     // Admin reviewed and approved
  | "physically_verified"// Physical on-site verification performed
  | "retailer_verified"  // Retailer directly confirmed
  | "mall_verified"      // Mall management confirmed
  | "stale"              // Data has expired / gone stale
  | "disputed"           // Conflicting reports — blocked until resolved
  | "rejected";          // Explicitly rejected — do not use

// ── Trust level (existing 8-level ladder) ────────────────────────────────────
// Kept consistent with dataGuardianService.ts and liveDataApplyPlannerBot.ts

export type PolicyTrustLevel =
  | "demo"
  | "user_submitted"
  | "evidence_submitted"
  | "source_matched"
  | "admin_verified"
  | "physically_verified"
  | "retailer_verified"
  | "mall_verified";

// ── Supporting enumerations ───────────────────────────────────────────────────

export type EvidenceStrength   = "none" | "weak" | "moderate" | "strong" | "verified";
export type SourceQuality      = "unknown" | "restricted" | "low" | "medium" | "high" | "official";
export type FreshnessState     = "fresh" | "aging" | "stale" | "unknown";
export type ConflictRisk       = "none" | "low" | "medium" | "high";
export type ManualReviewPriority = "none" | "low" | "medium" | "high" | "urgent";

// ── Finding types ─────────────────────────────────────────────────────────────

export type PolicyFindingType =
  | "shop"
  | "product"
  | "price"
  | "trading_hours"
  | "floor_layout"
  | "promotion"
  | "route_hint"
  | "other";

// ── Input ─────────────────────────────────────────────────────────────────────

export interface TrustPolicyInput {
  // What kind of data this is
  finding_type?: PolicyFindingType | string;

  // Source provenance
  source_type?:           string;  // e.g. "official_website", "social_media", "unknown"
  source_classification?: string;  // Source Research Bot output: "official_mall_website", etc.
  source_url?:            string;

  // Who submitted it
  submitted_by_type?: "user" | "admin" | "retailer" | "mall" | "system";

  // Evidence flags
  evidence_types?:              string[];  // array of evidence kinds present
  has_photo?:                   boolean;
  has_receipt?:                 boolean;
  has_official_source?:         boolean;
  has_retailer_confirmation?:   boolean;
  has_mall_confirmation?:       boolean;
  has_physical_verification?:   boolean;

  // Duplicate state
  has_duplicate_match?: boolean;
  duplicate_status?:    "exact" | "high" | "medium" | "low" | "none";

  // Conflict / dispute
  has_conflicting_reports?: boolean;
  pending_dispute_count?:   number;

  // Timestamps for freshness
  observed_at?:          string;  // ISO 8601
  verified_at?:          string;  // ISO 8601
  promotion_expires_at?: string;  // ISO 8601

  // Existing scores (from Data Guardian, if already run)
  confidence_score?: number;  // 0–100

  // Structured data snapshot (for context-sensitive rules)
  structured_data?: Record<string, unknown>;
}

// ── Output ────────────────────────────────────────────────────────────────────

export interface TrustPolicyResult {
  /** 12-state trust classification */
  trust_state:            TrustState;
  /** 8-level trust ladder (compatible with guardian + apply planner) */
  trust_level:            PolicyTrustLevel;
  /** 0–100 confidence score */
  confidence_score:       number;
  /** How strong the attached evidence is */
  evidence_strength:      EvidenceStrength;
  /** Quality of the data source */
  source_quality:         SourceQuality;
  /** How current / recent the data is */
  freshness_state:        FreshnessState;
  /** Risk of conflicting or disputed data */
  conflict_risk:          ConflictRisk;
  /** How urgently a human admin should look at this */
  manual_review_priority: ManualReviewPriority;
  /** User-safe badge text — the ONLY approved source for trust wording */
  safe_badge:             string;
  /** Actions that are permitted given this trust state */
  allowed_next_actions:   string[];
  /** Actions that are blocked given this trust state */
  blocked_actions:        string[];
  /** Plain-language reasoning for admin display */
  reasoning_summary:      string;
  /** What evidence would elevate this record's trust */
  missing_evidence:       string[];
  /** True = this data MUST NOT be used to update live shops/products/mall_nodes */
  must_not_update_live_data: boolean;
}

// ── Constants ─────────────────────────────────────────────────────────────────

// Days before data is considered stale per finding type
const STALE_THRESHOLDS_DAYS: Partial<Record<PolicyFindingType, number>> = {
  price:          7,
  product:        7,
  promotion:      0,   // Uses promotion_expires_at instead
  shop:           90,
  trading_hours:  90,
  floor_layout:   90,
  route_hint:     90,
  other:          90,
};

// Restricted source domains/patterns
const RESTRICTED_SOURCE_PATTERNS = [
  "google.com/maps", "maps.google", "google places", "place_id",
  "googleapis.com/maps", "maps.apple.com", "foursquare.com", "yelp.com",
];

// Source classifications from SourceResearchBot that map to high/official quality
const HIGH_QUALITY_CLASSIFICATIONS = new Set([
  "official_mall_website",
  "official_retailer_website",
  "government_or_regulatory",
]);

const MEDIUM_QUALITY_CLASSIFICATIONS = new Set([
  "retail_directory",
  "press_release",
  "news_media",
  "public_flyer",
]);

// Trust rank for allow/block logic
const TRUST_STATE_RANK: Record<TrustState, number> = {
  raw:                 0,
  reported:            1,
  evidence_submitted:  2,
  source_matched:      3,
  community_supported: 3,  // Parallel to source_matched
  admin_verified:      4,
  physically_verified: 5,
  retailer_verified:   6,
  mall_verified:       7,
  stale:              -1,  // Blocked regardless of underlying trust
  disputed:           -1,  // Blocked regardless of underlying trust
  rejected:           -2,  // Hard block
};

// ── Safe badge wording (ONLY approved user-visible source) ────────────────────

const SAFE_BADGES: Record<TrustState, string> = {
  raw:                 "Unverified · awaiting review",
  reported:            "Reported by shopper · not yet verified",
  evidence_submitted:  "Evidence submitted · under review",
  source_matched:      "Source checked · awaiting admin approval",
  community_supported: "Community supported · multiple reports agree",
  admin_verified:      "Verified by MallMind",
  physically_verified: "Physically verified on-site",
  retailer_verified:   "Retailer confirmed",
  mall_verified:       "Officially verified by mall management",
  stale:               "Data may be outdated · please check for current information",
  disputed:            "Data disputed · conflicting reports under review",
  rejected:            "Submission rejected",
};

// ── Action catalogue ──────────────────────────────────────────────────────────
// Canonical action identifiers used in allowed_next_actions / blocked_actions

const ALL_ACTIONS = [
  "create_finding",
  "add_to_batch",
  "run_apply_planner",
  "create_live_record",
  "apply_to_live_data",
  "request_more_evidence",
  "flag_for_human_review",
  "mark_as_stale",
  "mark_as_disputed",
  "reject",
] as const;

type Action = typeof ALL_ACTIONS[number];

// ── Helper: days since a date string ─────────────────────────────────────────

function daysSince(isoDate: string): number {
  const ms = Date.now() - new Date(isoDate).getTime();
  return ms / (1000 * 60 * 60 * 24);
}

// ── Helper: days until a future date ─────────────────────────────────────────

function daysUntil(isoDate: string): number {
  const ms = new Date(isoDate).getTime() - Date.now();
  return ms / (1000 * 60 * 60 * 24);
}

// ─────────────────────────────────────────────────────────────────────────────
// Exported sub-classifiers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Classify the quality of a data source.
 * Used internally and exported for direct use in pipeline steps.
 */
export function classifySourceTrust(
  source_type?: string,
  source_classification?: string,
  source_url?: string,
): SourceQuality {
  // Restricted check first — hard block
  const combined = [source_type, source_classification, source_url]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (RESTRICTED_SOURCE_PATTERNS.some((pattern) => combined.includes(pattern))) {
    return "restricted";
  }

  // Classification-based quality
  if (source_classification) {
    if (HIGH_QUALITY_CLASSIFICATIONS.has(source_classification)) {
      return "official";
    }
    if (MEDIUM_QUALITY_CLASSIFICATIONS.has(source_classification)) {
      return "medium";
    }
    if (source_classification === "social_media_verified") {
      return "low";
    }
    if (source_classification === "social_media_unverified" ||
        source_classification === "user_generated") {
      return "low";
    }
  }

  // Source type fallback
  if (source_type === "official_website" || source_type === "press_release") {
    return "high";
  }
  if (source_type === "retail_directory" || source_type === "public_flyer") {
    return "medium";
  }
  if (source_type === "social_media") {
    return "low";
  }

  // URL heuristic — .co.za or known SA retail domains
  if (source_url) {
    const url = source_url.toLowerCase();
    if (url.includes(".co.za") || url.includes(".gov.za")) {
      return "medium";
    }
  }

  return "unknown";
}

/**
 * Classify the strength of evidence attached to a submission.
 */
export function classifyEvidenceStrength(
  evidence_types?: string[],
  has_photo?: boolean,
  has_receipt?: boolean,
  has_official_source?: boolean,
  has_retailer_confirmation?: boolean,
  has_mall_confirmation?: boolean,
  has_physical_verification?: boolean,
): EvidenceStrength {
  if (has_mall_confirmation || has_retailer_confirmation) {
    return "verified";
  }
  if (has_physical_verification) {
    return "strong";
  }
  if (has_official_source || has_receipt) {
    return "strong";
  }
  if (has_photo) {
    return "moderate";
  }

  // Evidence types array fallback
  if (evidence_types && evidence_types.length > 0) {
    const types = evidence_types.map((t) => t.toLowerCase());
    if (types.some((t) => ["mall_confirmation", "retailer_confirmation"].includes(t))) {
      return "verified";
    }
    if (types.some((t) => ["receipt", "invoice", "official_source", "physical"].includes(t))) {
      return "strong";
    }
    if (types.some((t) => ["photo", "screenshot", "flyer"].includes(t))) {
      return "moderate";
    }
    if (types.length > 0) {
      return "weak";
    }
  }

  return "none";
}

/**
 * Classify the freshness of a data point based on when it was observed/verified.
 * Prices go stale in 7 days; promotions use their expiry; everything else 90 days.
 */
export function classifyFreshness(
  finding_type?: PolicyFindingType | string,
  observed_at?: string,
  verified_at?: string,
  promotion_expires_at?: string,
): FreshnessState {
  const referenceDate = verified_at ?? observed_at;

  // Promotions: use the expiry date if provided
  if (finding_type === "promotion" && promotion_expires_at) {
    const remaining = daysUntil(promotion_expires_at);
    if (remaining < 0) return "stale";
    if (remaining < 3) return "aging";
    return "fresh";
  }

  if (!referenceDate) {
    return "unknown";
  }

  const ageInDays = daysSince(referenceDate);
  const ft = (finding_type ?? "other") as PolicyFindingType;
  const threshold = STALE_THRESHOLDS_DAYS[ft] ?? 90;

  if (ageInDays > threshold) return "stale";
  if (ageInDays > threshold * 0.75) return "aging";
  return "fresh";
}

/**
 * Classify the risk level of conflicting or disputed data.
 */
export function classifyConflictRisk(
  has_conflicting_reports?: boolean,
  pending_dispute_count?: number,
): ConflictRisk {
  const disputes = pending_dispute_count ?? 0;

  if (has_conflicting_reports && disputes >= 3) return "high";
  if (has_conflicting_reports && disputes >= 1) return "medium";
  if (has_conflicting_reports) return "low";
  if (disputes >= 3) return "high";
  if (disputes >= 1) return "medium";
  return "none";
}

/**
 * Return the safe badge string for a given trust state.
 * Optionally inject the stale age into the badge text.
 */
export function getSafeBadgeForTrustState(
  trust_state: TrustState,
  options?: { stale_days?: number; stale_verified_at?: string },
): string {
  if (trust_state === "stale") {
    if (options?.stale_days !== undefined) {
      const days = Math.round(options.stale_days);
      return `Data may be outdated · last verified ${days} day${days === 1 ? "" : "s"} ago`;
    }
    if (options?.stale_verified_at) {
      const days = Math.round(daysSince(options.stale_verified_at));
      return `Data may be outdated · last verified ${days} day${days === 1 ? "" : "s"} ago`;
    }
  }
  return SAFE_BADGES[trust_state] ?? "Unverified · awaiting review";
}

/**
 * Determine how urgently a human admin should review this record.
 */
export function getManualReviewPriority(
  trust_state: TrustState,
  conflict_risk: ConflictRisk,
  freshness_state: FreshnessState,
  confidence_score: number,
): ManualReviewPriority {
  // Disputes and rejections are always urgent
  if (trust_state === "disputed") return "urgent";
  if (trust_state === "rejected") return "none";  // Already decided

  // Conflict risk escalates
  if (conflict_risk === "high") return "urgent";
  if (conflict_risk === "medium") return "high";

  // Stale data needs review
  if (trust_state === "stale") return "high";
  if (freshness_state === "stale") return "high";
  if (freshness_state === "aging") return "medium";

  // Low confidence needs human eyes
  if (confidence_score < 40) return "high";
  if (confidence_score < 60) return "medium";

  // Trust state
  if (trust_state === "raw" || trust_state === "reported") return "medium";
  if (trust_state === "evidence_submitted" || trust_state === "source_matched") return "low";
  if (trust_state === "community_supported") return "low";

  // High trust states — no urgent review needed
  return "none";
}

// ─────────────────────────────────────────────────────────────────────────────
// Derive TrustState from all signals
// ─────────────────────────────────────────────────────────────────────────────

function deriveTrustState(
  input: TrustPolicyInput,
  source_quality: SourceQuality,
  evidence_strength: EvidenceStrength,
  freshness_state: FreshnessState,
  conflict_risk: ConflictRisk,
): TrustState {
  // ── Hard blocks first ──────────────────────────────────────────────────────

  // Restricted source → immediately disputed/blocked
  if (source_quality === "restricted") {
    return "rejected";
  }

  // Disputes → always blocked until resolved
  if (conflict_risk === "high" || conflict_risk === "medium" ||
      input.has_conflicting_reports ||
      (input.pending_dispute_count ?? 0) > 0) {
    return "disputed";
  }

  // Stale data → special state (freshness overrides positive trust signals)
  if (freshness_state === "stale") {
    return "stale";
  }

  // ── Positive trust signals (highest first) ─────────────────────────────────

  if (input.has_mall_confirmation) {
    return "mall_verified";
  }
  if (input.has_retailer_confirmation) {
    return "retailer_verified";
  }
  if (input.has_physical_verification) {
    return "physically_verified";
  }

  // Admin / mall staff with evidence or official source
  if (input.submitted_by_type === "admin" || input.submitted_by_type === "mall") {
    return "admin_verified";
  }

  // Official/high-quality source
  if (source_quality === "official" || source_quality === "high") {
    return "source_matched";
  }
  if (input.has_official_source) {
    return "source_matched";
  }
  if (source_quality === "medium") {
    return "source_matched";
  }

  // Retailer submitted (without explicit confirmation flag)
  if (input.submitted_by_type === "retailer") {
    return "source_matched";
  }

  // Community support: 3+ agreeing reports
  if (input.has_duplicate_match && input.duplicate_status === "exact") {
    // Exact duplicate match from crowdsourced reports = community_supported
    return "community_supported";
  }

  // Strong evidence
  if (evidence_strength === "strong" || evidence_strength === "verified") {
    return "evidence_submitted";
  }
  if (evidence_strength === "moderate") {
    return "evidence_submitted";
  }

  // Weak evidence or photos
  if (evidence_strength === "weak") {
    return "reported";
  }

  // User submitted with no evidence
  if (input.submitted_by_type === "user") {
    return "reported";
  }

  // System submitted (scraper, etc.) with no checks
  if (input.submitted_by_type === "system") {
    return "reported";
  }

  // Nothing provided
  return "raw";
}

// ─────────────────────────────────────────────────────────────────────────────
// Derive PolicyTrustLevel from TrustState
// ─────────────────────────────────────────────────────────────────────────────

function deriveTrustLevel(trust_state: TrustState): PolicyTrustLevel {
  switch (trust_state) {
    case "mall_verified":       return "mall_verified";
    case "retailer_verified":   return "retailer_verified";
    case "physically_verified": return "physically_verified";
    case "admin_verified":      return "admin_verified";
    case "community_supported": return "source_matched";
    case "source_matched":      return "source_matched";
    case "evidence_submitted":  return "evidence_submitted";
    case "reported":            return "user_submitted";
    case "raw":                 return "demo";
    case "stale":               return "user_submitted";  // Treat stale as untrusted
    case "disputed":            return "user_submitted";  // Treat disputed as untrusted
    case "rejected":            return "demo";
    default:                    return "demo";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Compute allowed / blocked actions
// ─────────────────────────────────────────────────────────────────────────────

function computeActions(
  trust_state: TrustState,
  source_quality: SourceQuality,
): { allowed: Action[]; blocked: Action[] } {
  const rank = TRUST_STATE_RANK[trust_state];

  // Rejected — almost everything blocked
  if (trust_state === "rejected" || source_quality === "restricted") {
    return {
      allowed: ["reject"],
      blocked: ["create_finding", "add_to_batch", "run_apply_planner",
                "create_live_record", "apply_to_live_data", "request_more_evidence",
                "flag_for_human_review", "mark_as_stale", "mark_as_disputed"],
    };
  }

  // Disputed — no live data actions until resolved
  if (trust_state === "disputed") {
    return {
      allowed: ["flag_for_human_review", "reject", "mark_as_disputed"],
      blocked: ["create_finding", "add_to_batch", "run_apply_planner",
                "create_live_record", "apply_to_live_data"],
    };
  }

  // Stale — no live data actions until refreshed
  if (trust_state === "stale") {
    return {
      allowed: ["flag_for_human_review", "mark_as_stale", "request_more_evidence"],
      blocked: ["run_apply_planner", "create_live_record", "apply_to_live_data"],
    };
  }

  // Live data actions only for admin_verified (rank 4) and above
  if (rank >= 4) {
    return {
      allowed: ["create_finding", "add_to_batch", "run_apply_planner",
                "create_live_record", "apply_to_live_data", "flag_for_human_review"],
      blocked: [],
    };
  }

  // Low-to-mid trust: can create findings and batch items, but no live updates
  if (rank >= 1) {
    return {
      allowed: ["create_finding", "add_to_batch", "request_more_evidence",
                "flag_for_human_review"],
      blocked: ["run_apply_planner", "create_live_record", "apply_to_live_data"],
    };
  }

  // Raw — can only flag for review
  return {
    allowed: ["flag_for_human_review", "request_more_evidence"],
    blocked: ["create_finding", "add_to_batch", "run_apply_planner",
              "create_live_record", "apply_to_live_data"],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Compute confidence score (if not already provided)
// ─────────────────────────────────────────────────────────────────────────────

function computeConfidenceScore(
  trust_state: TrustState,
  evidence_strength: EvidenceStrength,
  source_quality: SourceQuality,
  freshness_state: FreshnessState,
  provided_score?: number,
): number {
  // If a score was already computed by Data Guardian, trust it (with freshness penalty)
  if (provided_score !== undefined && provided_score > 0) {
    let score = provided_score;
    if (freshness_state === "stale") score = Math.min(score, 20);
    if (freshness_state === "aging") score = Math.min(score, score * 0.85);
    if (trust_state === "disputed") score = Math.min(score, 15);
    if (trust_state === "rejected") score = 0;
    return Math.round(Math.max(0, Math.min(100, score)));
  }

  // Derive from trust_state
  const baseByState: Record<TrustState, number> = {
    raw:                 5,
    reported:            20,
    evidence_submitted:  50,
    source_matched:      65,
    community_supported: 60,
    admin_verified:      82,
    physically_verified: 90,
    retailer_verified:   95,
    mall_verified:       98,
    stale:               15,
    disputed:            10,
    rejected:            0,
  };

  let score = baseByState[trust_state] ?? 5;

  // Evidence bonus
  if (evidence_strength === "verified") score = Math.min(score + 5, 98);
  if (evidence_strength === "strong")   score = Math.min(score + 3, 90);
  if (evidence_strength === "moderate") score = Math.min(score + 2, 75);

  // Source quality bonus
  if (source_quality === "official") score = Math.min(score + 5, 98);
  if (source_quality === "high")     score = Math.min(score + 3, 90);

  // Freshness penalty
  if (freshness_state === "stale")  score = Math.min(score, 20);
  if (freshness_state === "aging")  score = Math.round(score * 0.85);
  if (freshness_state === "unknown") score = Math.round(score * 0.95);

  return Math.max(0, Math.min(100, score));
}

// ─────────────────────────────────────────────────────────────────────────────
// Missing evidence hints
// ─────────────────────────────────────────────────────────────────────────────

function computeMissingEvidence(
  trust_state: TrustState,
  evidence_strength: EvidenceStrength,
  source_quality: SourceQuality,
  freshness_state: FreshnessState,
  input: TrustPolicyInput,
): string[] {
  const missing: string[] = [];

  if (trust_state === "rejected" || trust_state === "disputed") {
    if (trust_state === "disputed") {
      missing.push("Resolve conflicting reports before re-evaluating");
    }
    return missing;
  }

  // Evidence gaps
  if (evidence_strength === "none") {
    missing.push("Any supporting evidence (photo, receipt, or official source URL)");
  } else if (evidence_strength === "weak") {
    missing.push("Stronger evidence (receipt, official source, or retailer confirmation)");
  }

  // Source gaps
  if (source_quality === "unknown" || source_quality === "low") {
    missing.push("Credible source URL (mall website, retailer website, or press release)");
  }

  // Freshness gaps
  if (freshness_state === "stale" || freshness_state === "unknown") {
    missing.push("Recent observation date (data needs to be re-verified)");
  }

  // Trust elevation suggestions
  if (TRUST_STATE_RANK[trust_state] < 4) {
    if (!input.has_official_source && !input.has_retailer_confirmation && !input.has_mall_confirmation) {
      missing.push("Admin verification or official source to reach admin_verified status");
    }
  }

  // Promotion expiry
  const ft = input.finding_type;
  if ((ft === "promotion" || ft === "price") && !input.promotion_expires_at) {
    const data = input.structured_data ?? {};
    const hasExpiry = data.promo_expiry || data.valid_to || data.expiry || data.ends;
    if (!hasExpiry) {
      missing.push("Promotion expiry date (required for price/promotion data)");
    }
  }

  return missing;
}

// ─────────────────────────────────────────────────────────────────────────────
// Build reasoning summary
// ─────────────────────────────────────────────────────────────────────────────

function buildReasoningSummary(
  trust_state: TrustState,
  trust_level: PolicyTrustLevel,
  confidence_score: number,
  evidence_strength: EvidenceStrength,
  source_quality: SourceQuality,
  freshness_state: FreshnessState,
  conflict_risk: ConflictRisk,
  missing_evidence: string[],
): string {
  const parts: string[] = [];

  parts.push(`Trust state: ${trust_state} (${trust_level}, ${confidence_score}% confidence).`);
  parts.push(`Evidence: ${evidence_strength}. Source quality: ${source_quality}. Freshness: ${freshness_state}.`);

  if (conflict_risk !== "none") {
    parts.push(`Conflict risk: ${conflict_risk} — data is disputed and must not be applied to live records.`);
  }

  if (trust_state === "stale") {
    parts.push("Data has exceeded its freshness window. Re-verification required before live application.");
  }

  if (trust_state === "rejected") {
    parts.push("Source is policy-restricted or data was explicitly rejected.");
  }

  if (missing_evidence.length > 0) {
    parts.push(
      `To elevate trust: ${missing_evidence.slice(0, 3).join("; ")}` +
      (missing_evidence.length > 3 ? "; and more." : ".")
    );
  }

  return parts.join(" ");
}

// ─────────────────────────────────────────────────────────────────────────────
// Main exported function
// ─────────────────────────────────────────────────────────────────────────────

/**
 * evaluateDataTrust
 *
 * Central deterministic trust evaluation for any mall data submission.
 * No external calls. No DB writes. Pure function.
 *
 * Returns a TrustPolicyResult containing:
 * - trust_state (12-state)
 * - trust_level (8-level ladder)
 * - confidence_score (0–100)
 * - evidence_strength, source_quality, freshness_state, conflict_risk
 * - manual_review_priority
 * - safe_badge (user-visible text — ONLY approved source)
 * - allowed_next_actions / blocked_actions
 * - must_not_update_live_data
 */
export function evaluateDataTrust(input: TrustPolicyInput): TrustPolicyResult {
  // Step 1: Classify each dimension independently
  const source_quality = classifySourceTrust(
    input.source_type,
    input.source_classification,
    input.source_url,
  );

  const evidence_strength = classifyEvidenceStrength(
    input.evidence_types,
    input.has_photo,
    input.has_receipt,
    input.has_official_source,
    input.has_retailer_confirmation,
    input.has_mall_confirmation,
    input.has_physical_verification,
  );

  const freshness_state = classifyFreshness(
    input.finding_type as PolicyFindingType | undefined,
    input.observed_at,
    input.verified_at,
    input.promotion_expires_at,
  );

  const conflict_risk = classifyConflictRisk(
    input.has_conflicting_reports,
    input.pending_dispute_count,
  );

  // Step 2: Derive the trust_state
  const trust_state = deriveTrustState(
    input,
    source_quality,
    evidence_strength,
    freshness_state,
    conflict_risk,
  );

  // Step 3: Derive the 8-level trust_level from trust_state
  const trust_level = deriveTrustLevel(trust_state);

  // Step 4: Compute confidence score
  const confidence_score = computeConfidenceScore(
    trust_state,
    evidence_strength,
    source_quality,
    freshness_state,
    input.confidence_score,
  );

  // Step 5: must_not_update_live_data
  // Always true for stale/disputed/rejected/raw/reported/evidence_submitted/source_matched/community_supported
  // False only for admin_verified (rank 4) and above — but admin must still explicitly apply
  const must_not_update_live_data =
    trust_state === "stale"    ||
    trust_state === "disputed" ||
    trust_state === "rejected" ||
    TRUST_STATE_RANK[trust_state] < 4;

  // Step 6: Compute allowed / blocked actions
  const { allowed: allowed_next_actions, blocked: blocked_actions } = computeActions(
    trust_state,
    source_quality,
  );

  // Step 7: Safe badge
  const referenceDate = input.verified_at ?? input.observed_at;
  const safe_badge = getSafeBadgeForTrustState(
    trust_state,
    trust_state === "stale" && referenceDate
      ? { stale_verified_at: referenceDate }
      : undefined,
  );

  // Step 8: Manual review priority
  const manual_review_priority = getManualReviewPriority(
    trust_state,
    conflict_risk,
    freshness_state,
    confidence_score,
  );

  // Step 9: Missing evidence hints
  const missing_evidence = computeMissingEvidence(
    trust_state,
    evidence_strength,
    source_quality,
    freshness_state,
    input,
  );

  // Step 10: Reasoning summary
  const reasoning_summary = buildReasoningSummary(
    trust_state,
    trust_level,
    confidence_score,
    evidence_strength,
    source_quality,
    freshness_state,
    conflict_risk,
    missing_evidence,
  );

  return {
    trust_state,
    trust_level,
    confidence_score,
    evidence_strength,
    source_quality,
    freshness_state,
    conflict_risk,
    manual_review_priority,
    safe_badge,
    allowed_next_actions,
    blocked_actions,
    reasoning_summary,
    missing_evidence,
    must_not_update_live_data,
  };
}
