/**
 * Mall Source Discovery Service — Sprint 12C
 *
 * Validates and classifies seed URLs for mall intelligence acquisition.
 * Determines source type, confidence, and blocked-domain status.
 *
 * No external API calls. No DB access. Pure deterministic logic.
 */

// ── Blocked domains ───────────────────────────────────────────────────────────

const BLOCKED_DOMAINS: string[] = [
  "google.com/maps",
  "maps.google.com",
  "yelp.com",
  "tripadvisor.com",
  "foursquare.com",
  "waze.com",
  "apple.com/maps",
  "facebook.com",
  "instagram.com",
  "twitter.com",
  "x.com",
  "tiktok.com",
  "youtube.com",
];

// ── Types ─────────────────────────────────────────────────────────────────────

export type MallSourceType =
  | "official_website"
  | "floor_map"
  | "store_directory"
  | "tenant_list"
  | "social_media"
  | "unknown";

export interface DiscoverSourcesInput {
  mall_id?:     string;
  seed_url:     string;
  mall_name?:   string;
  source_type?: MallSourceType;
  notes?:       string;
}

export interface DiscoveryResult {
  url:                  string;
  inferred_source_type: MallSourceType;
  /** 0–1 confidence that the classification and URL are correct */
  confidence:           number;
  is_blocked:           boolean;
  block_reason?:        string;
  warnings:             string[];
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/** Infer source type from URL path keywords. */
function inferSourceType(url: string): { type: MallSourceType; confidence: number } {
  const lower = url.toLowerCase();

  if (/(?:facebook|instagram|twitter|x\.com|tiktok|youtube)/.test(lower)) {
    return { type: "social_media", confidence: 0.95 };
  }
  if (/mall.?map|floorplan|floor.?plan|floor.?map|mapguide|storemap/.test(lower)) {
    return { type: "floor_map", confidence: 0.90 };
  }
  if (/directory|stores|tenants|shop.?finder|find.?a.?store/.test(lower)) {
    return { type: "store_directory", confidence: 0.85 };
  }
  if (/tenant|leasing|retailer/.test(lower)) {
    return { type: "tenant_list", confidence: 0.75 };
  }
  if (/mall|centre|center|plaza|park/.test(lower)) {
    return { type: "official_website", confidence: 0.65 };
  }
  return { type: "unknown", confidence: 0.40 };
}

/** Check if URL's hostname or path matches a blocked domain. */
function checkBlocked(url: string): { blocked: boolean; reason?: string } {
  const lower = url.toLowerCase();
  for (const domain of BLOCKED_DOMAINS) {
    if (lower.includes(domain)) {
      return { blocked: true, reason: `Domain '${domain}' is on the restricted source list` };
    }
  }
  return { blocked: false };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Validate and classify a seed URL for mall source discovery.
 * Returns a DiscoveryResult with inferred type, confidence, and any warnings.
 * Never writes to DB — caller handles persistence.
 */
export function classifyMallSource(input: DiscoverSourcesInput): DiscoveryResult {
  const url = input.seed_url.trim();
  const warnings: string[] = [];

  // URL parse check
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return {
      url,
      inferred_source_type: "unknown",
      confidence:           0,
      is_blocked:           true,
      block_reason:         "Invalid URL — could not be parsed",
      warnings:             ["URL failed to parse — check format and scheme"],
    };
  }

  // Protocol check
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return {
      url,
      inferred_source_type: "unknown",
      confidence:           0,
      is_blocked:           true,
      block_reason:         `Protocol '${parsed.protocol}' is not allowed (http/https only)`,
      warnings:             [],
    };
  }

  // Blocked domain check
  const blockCheck = checkBlocked(url);
  if (blockCheck.blocked) {
    return {
      url,
      inferred_source_type: "social_media",
      confidence:           1.0,
      is_blocked:           true,
      block_reason:         blockCheck.reason,
      warnings:             [],
    };
  }

  // Infer type (caller override takes precedence)
  const { type: inferred, confidence: inferredConf } = inferSourceType(url);
  const finalType       = input.source_type ?? inferred;
  // If admin explicitly set source_type, boost confidence
  const finalConfidence = input.source_type
    ? Math.max(inferredConf, 0.70)
    : inferredConf;

  if (parsed.protocol === "http:") {
    warnings.push("Source uses HTTP (not HTTPS) — treat as lower trust");
  }
  if (finalType === "unknown") {
    warnings.push("Could not infer source type from URL — set source_type manually");
  }

  return {
    url,
    inferred_source_type: finalType,
    confidence:           finalConfidence,
    is_blocked:           false,
    warnings,
  };
}
