/**
 * Source Research Bot
 *
 * Sprint 9C · MallMind Navigator
 *
 * Classifies a data source URL or description and assesses its safety,
 * reliability, and compliance with MallMind's source policy.
 *
 * Deterministic — no external API calls, no DB reads.
 */

import type { BotOutputBase, BotRiskLevel, BotRecommendation, LiveDataActionSafety } from "./types.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export type SourceCategory =
  | "official_mall_website"
  | "official_retailer_website"
  | "retail_directory"
  | "public_flyer"
  | "press_release"
  | "social_media_verified"
  | "social_media_unverified"
  | "government_or_regulatory"
  | "news_media"
  | "user_generated"
  | "unknown";

export interface SourceResearchInput {
  source_url?: string;
  source_name?: string;
  source_description?: string;
  submitted_by_type?: "user" | "admin" | "retailer" | "mall" | "system";
}

export interface SourceResearchResult extends BotOutputBase {
  source_category: SourceCategory;
  is_restricted: boolean;
  restriction_reason?: string;
  trust_ceiling: string;
  sa_relevance_signals: string[];
  quality_flags: string[];
}

// ── Restricted source patterns ────────────────────────────────────────────────
// Google ToS explicitly forbids storing or redistributing their places data.
// Apple Maps, Foursquare (without API), Yelp (without API) are also blocked.

const RESTRICTED_PATTERNS: { pattern: RegExp; reason: string }[] = [
  { pattern: /google\.com\/maps/i,           reason: "Google Maps — ToS prohibits data extraction" },
  { pattern: /maps\.google/i,                reason: "Google Maps — ToS prohibits data extraction" },
  { pattern: /google.*places/i,              reason: "Google Places API — ToS prohibits storing places data" },
  { pattern: /place_id/i,                    reason: "Google Places place_id — ToS prohibits storing places data" },
  { pattern: /googleapis\.com\/maps/i,       reason: "Google Maps API — ToS prohibits data redistribution" },
  { pattern: /maps\.apple\.com/i,            reason: "Apple Maps — ToS prohibits data extraction" },
  { pattern: /foursquare\.com/i,             reason: "Foursquare — requires valid API agreement" },
  { pattern: /yelp\.com/i,                   reason: "Yelp — requires valid API agreement" },
];

// ── SA official mall and retailer domain signals ──────────────────────────────

const SA_MALL_DOMAINS = [
  "sandtoncity.com", "mallofafrica.co.za", "menlyn.co.za", "gateway.co.za",
  "waterfrontshops.co.za", "clearwatermall.co.za", "sowetomall.co.za",
  "fourways.co.za", "tygervalley.co.za", "cavendishsquare.co.za",
  "canalwalk.co.za", "eastgate.co.za", "pavilion.co.za", "northgate.co.za",
  "westgate.co.za", "cresta.co.za", "southgate.co.za", "maponya.co.za",
];

const SA_RETAILER_DOMAINS = [
  "game.co.za", "woolworths.co.za", "clicks.co.za", "dis-chem.co.za",
  "dischem.co.za", "mrprice.co.za", "mrp.com", "checkers.co.za",
  "shoprite.co.za", "picknpay.co.za", "spar.co.za", "edgars.co.za",
  "truworths.co.za", "foschini.co.za", "totalsports.co.za",
  "sportsmanswarehouse.co.za", "hi.co.za", "incredible.co.za",
  "hificorporation.co.za", "makro.co.za", "takealot.com",
  "pricecheck.co.za", "bidorbuy.co.za",
];

const SA_NEWS_DOMAINS = [
  "businessinsider.co.za", "bizcommunity.com", "retailbriefafrica.co.za",
  "businesslive.co.za", "dailymaverick.co.za", "moneyweb.co.za",
  "fin24.com", "mybroadband.co.za",
];

const SOCIAL_MEDIA_DOMAINS = [
  "instagram.com", "facebook.com", "twitter.com", "x.com",
  "tiktok.com", "linkedin.com", "youtube.com",
];

const PRESS_RELEASE_SIGNALS = [
  "press-release", "pressrelease", "media-release", "mediarelease",
  "investor-relations", "ir.co.za", "prwire", "prnewswire",
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function combined(input: SourceResearchInput): string {
  return `${input.source_url ?? ""} ${input.source_name ?? ""} ${input.source_description ?? ""}`.toLowerCase();
}

function checkRestricted(input: SourceResearchInput): { restricted: boolean; reason?: string } {
  const text = combined(input);
  for (const { pattern, reason } of RESTRICTED_PATTERNS) {
    if (pattern.test(text)) return { restricted: true, reason };
  }
  return { restricted: false };
}

function classifySource(input: SourceResearchInput): SourceCategory {
  const text = combined(input);
  const url = (input.source_url ?? "").toLowerCase();

  if (SA_MALL_DOMAINS.some((d) => text.includes(d))) return "official_mall_website";
  if (SA_RETAILER_DOMAINS.some((d) => text.includes(d))) return "official_retailer_website";
  if (SOCIAL_MEDIA_DOMAINS.some((d) => url.includes(d))) {
    // Heuristic: if it's from a known retailer's social account it may be verified brand content
    const isRetailerSocial = SA_RETAILER_DOMAINS.some((d) =>
      (input.source_description ?? "").toLowerCase().includes(d.split(".")[0])
    );
    return isRetailerSocial ? "social_media_verified" : "social_media_unverified";
  }
  if (SA_NEWS_DOMAINS.some((d) => text.includes(d))) return "news_media";
  if (PRESS_RELEASE_SIGNALS.some((s) => text.includes(s))) return "press_release";
  if (text.includes("gumtree") || text.includes("directory") || text.includes("tenant list"))
    return "retail_directory";
  if (text.includes("flyer") || text.includes("catalogue") || text.includes("catalog"))
    return "public_flyer";
  if (text.includes("gov.za") || text.includes("cipc.co.za")) return "government_or_regulatory";
  if (input.submitted_by_type === "user" && !input.source_url) return "user_generated";

  return "unknown";
}

function trustCeiling(category: SourceCategory, submitted_by_type?: string): string {
  if (submitted_by_type === "mall")     return "mall_verified";
  if (submitted_by_type === "retailer") return "retailer_verified";
  if (submitted_by_type === "admin")    return "admin_verified";

  switch (category) {
    case "official_mall_website":
    case "official_retailer_website":
      return "source_matched → admin_verified";
    case "retail_directory":
    case "press_release":
    case "news_media":
      return "source_matched";
    case "public_flyer":
    case "social_media_verified":
      return "evidence_submitted";
    case "social_media_unverified":
    case "user_generated":
    case "unknown":
      return "user_submitted";
    case "government_or_regulatory":
      return "source_matched";
  }
}

function saRelevanceSignals(input: SourceResearchInput): string[] {
  const signals: string[] = [];
  const text = combined(input);

  if (SA_MALL_DOMAINS.some((d) => text.includes(d)))
    signals.push("Recognised South African mall domain");
  if (SA_RETAILER_DOMAINS.some((d) => text.includes(d)))
    signals.push("Recognised South African retailer domain");
  if (text.includes(".co.za"))
    signals.push(".co.za TLD detected — likely South African site");
  if (SA_NEWS_DOMAINS.some((d) => text.includes(d)))
    signals.push("Recognised South African news/business media");
  if (!signals.length && text.includes("mall"))
    signals.push("Contains 'mall' keyword — possible SA mall reference");

  return signals;
}

function qualityFlags(input: SourceResearchInput, category: SourceCategory): string[] {
  const flags: string[] = [];
  if (!input.source_url) flags.push("No source URL provided — harder to verify");
  if (category === "unknown") flags.push("Source type could not be classified");
  if (category === "user_generated") flags.push("User-generated source — low baseline trust");
  if (category === "social_media_unverified") flags.push("Unverified social media — screenshots can be edited");
  if (input.source_url && !/^https?:\/\//i.test(input.source_url))
    flags.push("Source URL does not start with http(s)://");
  return flags;
}

// ── Main export ───────────────────────────────────────────────────────────────

export function runSourceResearchBot(input: SourceResearchInput): SourceResearchResult {
  const now = new Date().toISOString();

  // 1. Restricted source check (hard policy)
  const restrictedCheck = checkRestricted(input);
  if (restrictedCheck.restricted) {
    return {
      bot_name:                 "SourceResearchBot",
      processed_at:             now,
      risk_level:               "critical",
      recommendation:           "reject",
      live_data_action_safety:  "blocked_by_policy",
      must_not_update_live_data: true,
      reasoning: [
        `RESTRICTED SOURCE DETECTED: ${restrictedCheck.reason}`,
        "MallMind policy prohibits storing or redistributing data from this source.",
        "Reject this submission. Use the mall's own official website or contact mall management directly.",
      ],
      source_category:    "unknown",
      is_restricted:      true,
      restriction_reason: restrictedCheck.reason,
      trust_ceiling:      "none — blocked by policy",
      sa_relevance_signals: [],
      quality_flags:      [`Policy violation: ${restrictedCheck.reason}`],
    };
  }

  // 2. Classify
  const category   = classifySource(input);
  const ceiling    = trustCeiling(category, input.submitted_by_type);
  const saSignals  = saRelevanceSignals(input);
  const qFlags     = qualityFlags(input, category);

  // 3. Determine risk + recommendation
  let risk: BotRiskLevel;
  let recommendation: BotRecommendation;
  let safety: LiveDataActionSafety;
  const reasoning: string[] = [];

  switch (category) {
    case "official_mall_website":
    case "official_retailer_website":
      risk           = "low";
      recommendation = "proceed";
      safety         = "safe_to_plan";
      reasoning.push(`Official source detected (${category}). High baseline trust.`);
      reasoning.push(`Trust ceiling: ${ceiling}.`);
      break;
    case "retail_directory":
    case "press_release":
    case "news_media":
    case "government_or_regulatory":
      risk           = "low";
      recommendation = "proceed_with_caution";
      safety         = "requires_review";
      reasoning.push(`Semi-official source (${category}). Admin should cross-check against official records.`);
      reasoning.push(`Trust ceiling: ${ceiling}.`);
      break;
    case "public_flyer":
    case "social_media_verified":
      risk           = "medium";
      recommendation = "proceed_with_caution";
      safety         = "requires_review";
      reasoning.push(`Evidence-grade source (${category}). Requires admin review before applying.`);
      reasoning.push(`Trust ceiling: ${ceiling}.`);
      break;
    case "social_media_unverified":
      risk           = "high";
      recommendation = "needs_admin_review";
      safety         = "do_not_apply";
      reasoning.push("Unverified social media post. Screenshots can be fabricated or outdated.");
      reasoning.push("Admin must cross-check against official source before any live data consideration.");
      break;
    case "user_generated":
      risk           = "high";
      recommendation = "needs_admin_review";
      safety         = "do_not_apply";
      reasoning.push("User-generated content only. No verifiable source attached.");
      reasoning.push("Treat as a pending finding — admin verification required.");
      break;
    default:
      risk           = "medium";
      recommendation = "needs_admin_review";
      safety         = "requires_review";
      reasoning.push("Source type could not be classified. Manual admin review required.");
  }

  if (qFlags.length) reasoning.push(`Quality flags: ${qFlags.join("; ")}.`);
  if (!saSignals.length) reasoning.push("No South African relevance signals detected — verify this is a SA mall/retailer source.");

  return {
    bot_name:                 "SourceResearchBot",
    processed_at:             now,
    risk_level:               risk,
    recommendation,
    live_data_action_safety:  safety,
    must_not_update_live_data: safety !== "safe_to_plan",
    reasoning,
    source_category:          category,
    is_restricted:            false,
    trust_ceiling:            ceiling,
    sa_relevance_signals:     saSignals,
    quality_flags:            qFlags,
  };
}
