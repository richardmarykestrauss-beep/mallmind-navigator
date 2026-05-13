// ─────────────────────────────────────────────────────────────────────────────
// dataGuardianService.ts — MallMind Data Guardian Bot
//
// CORE PRINCIPLE:
//   Raw data is not live data.
//   A submission must become a finding. A finding must be reviewed.
//   Only an explicit admin apply action may write to live shops/products/routes.
//
// This service is 100% deterministic — no external AI calls, no DB reads.
// It scores a submission and returns a structured review recommendation.
// ─────────────────────────────────────────────────────────────────────────────

// ── FORBIDDEN WORDING GUARD ───────────────────────────────────────────────────
// The following terms MUST NOT appear in safe_badge or user-visible output
// unless the trust_level explicitly supports them (see SAFE_BADGES below).
//
// ❌  "verified"          — only admin_verified and above
// ❌  "confirmed"         — only retailer_verified / mall_verified
// ❌  "guaranteed"        — never allowed
// ❌  "in stock"          — never allowed without a live_feed data_quality_status
// ❌  "definitely available" — never allowed
// ❌  "official"          — only mall_verified
// ❌  "accurate"          — never allowed for user_submitted
// ❌  "live price"        — only live_feed data_quality_status
//
// All user-visible wording MUST come from the SAFE_BADGES mapping below.

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DataGuardianInput {
  mall_id?: string;
  source_type?: string;
  finding_type?: string;
  submitted_by_type?: "user" | "admin" | "retailer" | "mall" | "system";
  raw_text?: string;
  source_url?: string;
  evidence_types?: string[];
  structured_data?: Record<string, unknown>;
  observed_at?: string;
  has_photo?: boolean;
  has_receipt?: boolean;
  has_official_source?: boolean;
  has_retailer_confirmation?: boolean;
  has_mall_confirmation?: boolean;
  has_physical_verification?: boolean;
}

export type RecommendedAction =
  | "create_finding"
  | "needs_more_info"
  | "reject"
  | "approve_for_admin_review"
  | "apply_to_existing_record";

export type GuardianFindingType =
  | "shop"
  | "product"
  | "price"
  | "trading_hours"
  | "floor_layout"
  | "route_hint"
  | "promotion"
  | "other";

export type GuardianTrustLevel =
  | "demo"
  | "user_submitted"
  | "evidence_submitted"
  | "source_matched"
  | "admin_verified"
  | "physically_verified"
  | "retailer_verified"
  | "mall_verified";

export interface DataGuardianResult {
  recommended_action: RecommendedAction;
  finding_type: GuardianFindingType;
  trust_level: GuardianTrustLevel;
  confidence_score: number;
  safe_badge: string;
  reasoning_summary: string;
  missing_evidence: string[];
  structured_data: Record<string, unknown>;
  admin_note: string;
  /** true = this submission MUST NOT be used to update live shops/products.
   *  false = trust is high enough that an admin COULD apply it, but only via
   *  an explicit admin apply action — never automatically. */
  must_not_update_live_data: boolean;
}

// ── Trust level ordering ──────────────────────────────────────────────────────

const TRUST_ORDER: Record<GuardianTrustLevel, number> = {
  demo:               0,
  user_submitted:     1,
  evidence_submitted: 2,
  source_matched:     3,
  admin_verified:     4,
  physically_verified: 5,
  retailer_verified:  6,
  mall_verified:      7,
};

// ── Safe badge wording (ONLY source of user-visible trust labels) ─────────────

const SAFE_BADGES: Record<GuardianTrustLevel, string> = {
  demo:               "Sample data · price may vary",
  user_submitted:     "Reported by shopper · awaiting verification",
  evidence_submitted: "Evidence submitted · under review",
  source_matched:     "Source matched · awaiting admin approval",
  admin_verified:     "Verified by MallMind",
  physically_verified: "Physically verified",
  retailer_verified:  "Retailer verified",
  mall_verified:      "Mall verified",
};

// ── Source type sets ──────────────────────────────────────────────────────────

const OFFICIAL_SOURCE_TYPES = new Set([
  "official_website",
  "press_release",
]);

const SEMI_OFFICIAL_SOURCE_TYPES = new Set([
  "retail_directory",
  "public_flyer",
]);

// ── Step 1: Base trust determination ─────────────────────────────────────────

interface BaseTrust {
  trustLevel: GuardianTrustLevel;
  baseConfidence: number;
  trustReason: string;
}

function computeBaseTrust(input: DataGuardianInput): BaseTrust {
  const {
    submitted_by_type,
    has_photo,
    has_receipt,
    has_official_source,
    has_retailer_confirmation,
    has_mall_confirmation,
    has_physical_verification,
    source_type,
  } = input;

  // ── Highest trust first ──────────────────────────────────────────────────

  if (has_mall_confirmation) {
    return {
      trustLevel: "mall_verified",
      baseConfidence: 98,
      trustReason: "Mall management confirmation provided",
    };
  }

  if (has_retailer_confirmation) {
    return {
      trustLevel: "retailer_verified",
      baseConfidence: 95,
      trustReason: "Retailer directly confirmed this information",
    };
  }

  if (has_physical_verification) {
    return {
      trustLevel: "physically_verified",
      baseConfidence: 90,
      trustReason: "Physical on-site verification performed",
    };
  }

  // ── Admin or mall-staff submitted ────────────────────────────────────────

  if (submitted_by_type === "admin" || submitted_by_type === "mall") {
    if (has_official_source || (source_type && OFFICIAL_SOURCE_TYPES.has(source_type))) {
      return {
        trustLevel: "admin_verified",
        baseConfidence: 85,
        trustReason: "Admin reviewed with official source confirmation",
      };
    }
    return {
      trustLevel: "admin_verified",
      baseConfidence: 82,
      trustReason: "Submitted and reviewed by admin",
    };
  }

  // ── Retailer submitted (without explicit retailer_confirmation flag) ──────

  if (submitted_by_type === "retailer") {
    return {
      trustLevel: "source_matched",
      baseConfidence: 75,
      trustReason: "Submitted by retailer representative",
    };
  }

  // ── Official or semi-official source ─────────────────────────────────────

  const isOfficialSourceType = source_type && OFFICIAL_SOURCE_TYPES.has(source_type);
  const isSemiOfficialSourceType = source_type && SEMI_OFFICIAL_SOURCE_TYPES.has(source_type);

  if (has_official_source || isOfficialSourceType) {
    return {
      trustLevel: "source_matched",
      baseConfidence: 72,
      trustReason: `Official source matched (${source_type ?? "website"})`,
    };
  }

  if (isSemiOfficialSourceType) {
    return {
      trustLevel: "source_matched",
      baseConfidence: 65,
      trustReason: `Semi-official source (${source_type})`,
    };
  }

  // ── Evidence (receipt ranks higher than photo) ────────────────────────────

  if (has_receipt) {
    return {
      trustLevel: "evidence_submitted",
      baseConfidence: 60,
      trustReason: "Receipt evidence submitted",
    };
  }

  if (has_photo) {
    // Social media source photo is slightly less trustworthy
    const photoConf = source_type === "social_media" ? 45 : 50;
    return {
      trustLevel: "evidence_submitted",
      baseConfidence: photoConf,
      trustReason: "Photo evidence submitted",
    };
  }

  // Public flyer / catalogue (no admin review yet)
  if (source_type === "public_flyer") {
    return {
      trustLevel: "evidence_submitted",
      baseConfidence: 48,
      trustReason: "Public flyer or catalogue submitted",
    };
  }

  // ── User text only ────────────────────────────────────────────────────────

  if (submitted_by_type === "user") {
    return {
      trustLevel: "user_submitted",
      baseConfidence: 25,
      trustReason: "User text submission only — no supporting evidence",
    };
  }

  if (submitted_by_type === "system") {
    return {
      trustLevel: "user_submitted",
      baseConfidence: 20,
      trustReason: "System-generated submission without explicit verification",
    };
  }

  // ── Fallback: no context ──────────────────────────────────────────────────
  return {
    trustLevel: "demo",
    baseConfidence: 10,
    trustReason: "No submission context provided — treated as demo/sample data",
  };
}

// ── Step 2: Confidence caps ───────────────────────────────────────────────────

function applyConfidenceCaps(
  baseConfidence: number,
  input: DataGuardianInput,
  trustLevel: GuardianTrustLevel
): number {
  const {
    submitted_by_type,
    has_photo,
    has_receipt,
    has_official_source,
    has_retailer_confirmation,
    has_mall_confirmation,
    has_physical_verification,
  } = input;

  const hasAnyEvidence = has_photo || has_receipt || has_official_source ||
    has_retailer_confirmation || has_mall_confirmation || has_physical_verification;

  const hasAdminOrBetterVerification =
    has_official_source || has_retailer_confirmation || has_mall_confirmation ||
    has_physical_verification ||
    submitted_by_type === "admin" || submitted_by_type === "mall" ||
    submitted_by_type === "retailer";

  let confidence = baseConfidence;

  // Cap 1: No evidence and user submitted → never exceed 40
  if (!hasAnyEvidence && submitted_by_type === "user") {
    confidence = Math.min(confidence, 40);
  }

  // Cap 2: Evidence present but no official/admin/retailer/mall verification → never exceed 60
  if (!hasAdminOrBetterVerification) {
    confidence = Math.min(confidence, 60);
  }

  // Cap 3: Source matched but not admin reviewed → never exceed 75
  if (trustLevel === "source_matched") {
    confidence = Math.min(confidence, 75);
  }

  // Cap 4: Admin or physical verification only → never exceed 90
  if (trustLevel === "admin_verified" || trustLevel === "physically_verified") {
    confidence = Math.min(confidence, 90);
  }

  // Cap 5: Retailer or mall verified → never exceed 98
  if (trustLevel === "retailer_verified" || trustLevel === "mall_verified") {
    confidence = Math.min(confidence, 98);
  }

  return Math.max(0, confidence);
}

// ── Step 3: Normalize finding type ───────────────────────────────────────────

function normalizeFindingType(raw?: string): GuardianFindingType {
  switch (raw) {
    case "shop":         return "shop";
    case "product":      return "product";
    case "price":        return "price";
    case "trading_hours":
    case "shop_hours":
    case "mall_hours":   return "trading_hours";
    case "floor_layout": return "floor_layout";
    case "route_hint":   return "route_hint";
    case "promotion":    return "promotion";
    default:             return "other";
  }
}

// ── Step 4: Missing evidence checks ──────────────────────────────────────────

function checkMissingEvidence(
  findingType: GuardianFindingType,
  input: DataGuardianInput
): string[] {
  const missing: string[] = [];
  const data = input.structured_data ?? {};
  const hasEvidence =
    input.has_photo || input.has_receipt || input.has_official_source;

  switch (findingType) {

    // ── Shop ────────────────────────────────────────────────────────────────
    case "shop": {
      if (!data.name && !data.shop_name) {
        missing.push("Shop name");
      }
      if (!input.mall_id && !data.mall_name && !data.mall) {
        missing.push("Mall name or mall ID");
      }
      if (!data.floor) {
        missing.push("Floor number");
      }
      if (!data.unit && !data.unit_number && !data.landmark) {
        missing.push("Unit number or nearby landmark");
      }
      if (!data.category) {
        missing.push("Shop category");
      }
      if (!hasEvidence) {
        missing.push("Storefront photo or official source URL");
      }
      if (!input.observed_at && !data.observed_at) {
        missing.push("Date observed");
      }
      break;
    }

    // ── Product / Price ──────────────────────────────────────────────────────
    case "product":
    case "price": {
      if (!data.name && !data.product_name) {
        missing.push("Product name");
      }
      if (!data.brand) {
        missing.push("Brand (if applicable)");
      }
      if (!data.shop_name && !data.shop && !data.shop_id) {
        missing.push("Shop/store name");
      }
      if (!input.mall_id && !data.mall_name && !data.mall) {
        missing.push("Mall name or mall ID");
      }
      if ((data.price == null || data.price === "")) {
        missing.push("Price (required for price/product findings)");
      }
      if (!hasEvidence && !input.has_retailer_confirmation) {
        missing.push("Shelf photo, receipt, retailer source, or admin verification");
      }
      if (!input.observed_at && !data.observed_at) {
        missing.push("Date observed");
      }
      // Check promotion expiry when promotion is flagged
      const isPromo = data.is_on_special === true ||
                      data.promotion === true ||
                      String(data.is_on_special) === "true";
      if (isPromo) {
        const hasExpiry = data.promo_expiry || data.promotion_ends ||
                          data.valid_to || data.expiry_date;
        if (!hasExpiry) {
          missing.push("Promotion expiry date");
        }
      }
      break;
    }

    // ── Floor layout / Route hint ────────────────────────────────────────────
    case "floor_layout":
    case "route_hint": {
      const hasTrustedSource =
        input.has_official_source ||
        input.has_physical_verification ||
        input.has_mall_confirmation ||
        input.submitted_by_type === "admin" ||
        input.submitted_by_type === "mall";
      if (!hasTrustedSource) {
        missing.push(
          "Official mall map, admin survey, physical verification, or mall management source required"
        );
      }
      if (!input.mall_id && !data.mall_name && !data.mall) {
        missing.push("Mall name or mall ID");
      }
      if (!data.floor && findingType === "floor_layout") {
        missing.push("Floor identifier");
      }
      break;
    }

    // ── Trading hours ────────────────────────────────────────────────────────
    case "trading_hours": {
      const hasOpenTime  = data.opens || data.opening_time || data.open;
      const hasCloseTime = data.closes || data.closing_time || data.close;
      if (!hasOpenTime) {
        missing.push("Opening time");
      }
      if (!hasCloseTime) {
        missing.push("Closing time");
      }
      if (!data.shop_name && !data.shop && !data.mall_wide) {
        missing.push("Shop name (or flag as mall-wide hours)");
      }
      if (!input.observed_at && !data.observed_at && !data.effective_date) {
        missing.push("Date observed or effective date");
      }
      break;
    }

    // ── Promotion ────────────────────────────────────────────────────────────
    case "promotion": {
      if (!data.shop_name && !data.shop) {
        missing.push("Shop/store name");
      }
      if (!data.promotion_text && !data.description) {
        missing.push("Promotion description");
      }
      if (!data.valid_from && !data.starts) {
        missing.push("Promotion start date");
      }
      if (!data.valid_to && !data.ends && !data.expiry) {
        missing.push("Promotion end/expiry date");
      }
      if (!hasEvidence) {
        missing.push("Flyer scan, screenshot, or official source URL");
      }
      break;
    }

    // ── Other ────────────────────────────────────────────────────────────────
    default: {
      const hasContent =
        input.raw_text?.trim() || Object.keys(data).length > 0;
      if (!hasContent) {
        missing.push("Description or structured data is required");
      }
      if (!input.mall_id && !data.mall_name && !data.mall) {
        missing.push("Mall name or mall ID");
      }
      break;
    }
  }

  return missing;
}

// ── Step 5: must_not_update_live_data ─────────────────────────────────────────

function computeMustNotUpdate(trustLevel: GuardianTrustLevel): boolean {
  const trustRank = TRUST_ORDER[trustLevel];
  // admin_verified (4) and above may allow live update IF admin explicitly applies it
  return trustRank < TRUST_ORDER["admin_verified"];
}

// ── Step 6: Recommended action ───────────────────────────────────────────────

function computeRecommendedAction(
  trustLevel: GuardianTrustLevel,
  missingEvidence: string[],
  input: DataGuardianInput
): RecommendedAction {
  const trustRank  = TRUST_ORDER[trustLevel];
  const missingLen = missingEvidence.length;

  // Reject: nothing useful submitted
  const hasContent =
    input.raw_text?.trim() ||
    Object.keys(input.structured_data ?? {}).length > 0;
  const hasAnyEvidence =
    input.has_photo || input.has_receipt || input.has_official_source ||
    input.has_retailer_confirmation || input.has_mall_confirmation ||
    input.has_physical_verification;

  if (!hasContent && !hasAnyEvidence) {
    return "reject";
  }

  // Very high trust + complete → suggest applying to existing record
  if (
    trustRank >= TRUST_ORDER["retailer_verified"] &&
    missingLen === 0
  ) {
    return "apply_to_existing_record";
  }

  // Admin / physical verified → ready for admin review
  if (trustRank >= TRUST_ORDER["admin_verified"]) {
    return "approve_for_admin_review";
  }

  // Source matched → approve for admin review unless very incomplete
  if (trustRank >= TRUST_ORDER["source_matched"]) {
    return missingLen > 3 ? "needs_more_info" : "approve_for_admin_review";
  }

  // Evidence present → create finding unless too much is missing
  if (trustRank >= TRUST_ORDER["evidence_submitted"]) {
    return missingLen > 4 ? "needs_more_info" : "create_finding";
  }

  // User text only → create finding if minimal gaps, otherwise needs more info
  if (trustRank >= TRUST_ORDER["user_submitted"]) {
    return missingLen > 3 ? "needs_more_info" : "create_finding";
  }

  return "needs_more_info";
}

// ── Step 7: Reasoning summary ─────────────────────────────────────────────────

function buildReasoningSummary(
  trustLevel: GuardianTrustLevel,
  confidence: number,
  missingEvidence: string[],
  trustReason: string
): string {
  const parts: string[] = [
    `Trust level: ${trustLevel.replace(/_/g, " ")} (confidence: ${confidence}%).`,
    trustReason.endsWith(".") ? trustReason : trustReason + ".",
  ];

  if (missingEvidence.length > 0) {
    parts.push(
      `Missing evidence (${missingEvidence.length}): ${missingEvidence.slice(0, 4).join("; ")}` +
      (missingEvidence.length > 4 ? "; and more." : ".")
    );
  } else {
    parts.push("All required evidence fields are present.");
  }

  return parts.join(" ");
}

// ── Step 8: Admin note ────────────────────────────────────────────────────────

function buildAdminNote(
  trustLevel: GuardianTrustLevel,
  confidence: number,
  missingEvidence: string[],
  action: RecommendedAction
): string {
  const notes: string[] = [
    `Auto-scored by Data Guardian: ${trustLevel} at ${confidence}% confidence.`,
  ];

  switch (action) {
    case "reject":
      notes.push("Rejected: no content or evidence provided.");
      break;
    case "needs_more_info":
      if (missingEvidence.length > 0) {
        notes.push(
          `Request submitter to provide: ${missingEvidence.slice(0, 3).join(", ")}.`
        );
      }
      break;
    case "create_finding":
      notes.push(
        "Created as a pending finding. Requires admin review before any live data update."
      );
      break;
    case "approve_for_admin_review":
      notes.push(
        "Evidence quality sufficient for admin review. Verify source before applying to live data."
      );
      break;
    case "apply_to_existing_record":
      notes.push(
        "Trust level qualifies for live data update, but an explicit admin apply action is still required."
      );
      break;
  }

  notes.push("REMINDER: Live database update requires an explicit admin apply action — never automatic.");

  return notes.join(" ");
}

// ── Main exported function ────────────────────────────────────────────────────

/**
 * reviewMallDataSubmission
 *
 * Deterministic trust scoring for any mall data submission.
 * No external API calls. No database writes. Pure function.
 *
 * Call this before creating a mall_source_finding to pre-populate
 * its trust classification and surface missing evidence to the submitter.
 */
export function reviewMallDataSubmission(
  input: DataGuardianInput
): DataGuardianResult {
  // Step 1: Compute base trust
  const { trustLevel, baseConfidence, trustReason } = computeBaseTrust(input);

  // Step 2: Apply confidence caps
  const confidence = applyConfidenceCaps(baseConfidence, input, trustLevel);

  // Step 3: Normalize finding type
  const findingType = normalizeFindingType(input.finding_type);

  // Step 4: Check missing evidence
  const missingEvidence = checkMissingEvidence(findingType, input);

  // Step 5: must_not_update_live_data
  const mustNotUpdateLiveData = computeMustNotUpdate(trustLevel);

  // Step 6: Recommended action
  const recommendedAction = computeRecommendedAction(
    trustLevel, missingEvidence, input
  );

  // Step 7: Safe badge (from SAFE_BADGES — never inline trust words)
  const safeBadge = SAFE_BADGES[trustLevel];

  // Step 8: Reasoning summary
  const reasoningSummary = buildReasoningSummary(
    trustLevel, confidence, missingEvidence, trustReason
  );

  // Step 9: Admin note
  const adminNote = buildAdminNote(
    trustLevel, confidence, missingEvidence, recommendedAction
  );

  return {
    recommended_action:     recommendedAction,
    finding_type:           findingType,
    trust_level:            trustLevel,
    confidence_score:       confidence,
    safe_badge:             safeBadge,
    reasoning_summary:      reasoningSummary,
    missing_evidence:       missingEvidence,
    structured_data:        input.structured_data ?? {},
    admin_note:             adminNote,
    must_not_update_live_data: mustNotUpdateLiveData,
  };
}
