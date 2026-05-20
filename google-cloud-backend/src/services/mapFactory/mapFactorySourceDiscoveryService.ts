/**
 * mapFactorySourceDiscoveryService.ts — Sprint 15
 *
 * Classifies and enumerates evidence sources for a mall cartography job.
 * Supports 15 source types.  Does NOT fetch content — that is the harvester's job.
 *
 * Interface:
 *   classifySource(params)  → SourceClassification
 *   discoverSourcesForMall(mallId, jobId, supabase) → DiscoveredSource[]
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export type MapFactorySourceType =
  | "mall_website"
  | "evacuation_map_image"
  | "directory_pdf"
  | "google_maps_screenshot"
  | "retailer_website"
  | "geo_directory_api"
  | "crowdsource_submission"
  | "admin_manual_upload"
  | "existing_mall_map_asset"
  | "street_view_image"
  | "satellite_image"
  | "social_media_image"
  | "news_article"
  | "press_release"
  | "lease_plan";

export const ALL_SOURCE_TYPES: MapFactorySourceType[] = [
  "mall_website",
  "evacuation_map_image",
  "directory_pdf",
  "google_maps_screenshot",
  "retailer_website",
  "geo_directory_api",
  "crowdsource_submission",
  "admin_manual_upload",
  "existing_mall_map_asset",
  "street_view_image",
  "satellite_image",
  "social_media_image",
  "news_article",
  "press_release",
  "lease_plan",
];

/** Confidence weight per source type — higher = more trustworthy for coordinates */
export const SOURCE_TYPE_CONFIDENCE: Record<MapFactorySourceType, number> = {
  lease_plan:               0.95,
  admin_manual_upload:      0.90,
  existing_mall_map_asset:  0.88,
  evacuation_map_image:     0.80,
  directory_pdf:            0.75,
  geo_directory_api:        0.72,
  mall_website:             0.65,
  retailer_website:         0.55,
  crowdsource_submission:   0.50,
  google_maps_screenshot:   0.45,
  street_view_image:        0.40,
  satellite_image:          0.35,
  press_release:            0.25,
  news_article:             0.20,
  social_media_image:       0.15,
};

export interface SourceClassification {
  source_type:  MapFactorySourceType;
  confidence:   number;
  rationale:    string;
}

export interface DiscoveredSource {
  source_type:  MapFactorySourceType;
  url:          string | null;
  asset_id:     string | null;
  title:        string;
  confidence:   number;
  notes:        string;
}

// ── Classify by URL heuristic ─────────────────────────────────────────────────

/**
 * Infer source type from a URL string.
 * Pure function — no I/O.
 */
export function classifySourceUrl(url: string): SourceClassification {
  const lower = url.toLowerCase();

  if (lower.includes("evacuation") || lower.includes("fire-escape"))
    return { source_type: "evacuation_map_image", confidence: SOURCE_TYPE_CONFIDENCE.evacuation_map_image, rationale: "URL contains 'evacuation' keyword" };

  if (lower.endsWith(".pdf") || lower.includes("/pdf/") || lower.includes("directory"))
    return { source_type: "directory_pdf", confidence: SOURCE_TYPE_CONFIDENCE.directory_pdf, rationale: "URL ends with .pdf or contains directory path" };

  if (lower.includes("google.com/maps") || lower.includes("maps.google"))
    return { source_type: "google_maps_screenshot", confidence: SOURCE_TYPE_CONFIDENCE.google_maps_screenshot, rationale: "Google Maps URL" };

  if (lower.includes("streetview") || lower.includes("street-view"))
    return { source_type: "street_view_image", confidence: SOURCE_TYPE_CONFIDENCE.street_view_image, rationale: "Street View URL" };

  if (lower.includes("satellite") || lower.includes("aerial"))
    return { source_type: "satellite_image", confidence: SOURCE_TYPE_CONFIDENCE.satellite_image, rationale: "Satellite/aerial imagery URL" };

  if (lower.includes("instagram.com") || lower.includes("twitter.com") || lower.includes("tiktok.com") || lower.includes("facebook.com"))
    return { source_type: "social_media_image", confidence: SOURCE_TYPE_CONFIDENCE.social_media_image, rationale: "Social media domain" };

  if (lower.includes("press-release") || lower.includes("pressrelease") || lower.includes("/news/"))
    return { source_type: "news_article", confidence: SOURCE_TYPE_CONFIDENCE.news_article, rationale: "Press/news URL pattern" };

  if (lower.includes("lease") || lower.includes("leasing"))
    return { source_type: "lease_plan", confidence: SOURCE_TYPE_CONFIDENCE.lease_plan, rationale: "Lease/leasing URL pattern" };

  // Default: treat as mall website
  return { source_type: "mall_website", confidence: SOURCE_TYPE_CONFIDENCE.mall_website, rationale: "No specific pattern matched — treated as mall website" };
}

/**
 * Discover sources for a mall by querying existing mall_map_assets.
 * Returns DiscoveredSource[] ready to INSERT into map_factory_sources.
 */
export async function discoverSourcesForMall(
  mallId:    string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase:  any,
): Promise<DiscoveredSource[]> {
  const sources: DiscoveredSource[] = [];

  // 1. Existing mall_map_assets → "existing_mall_map_asset"
  const { data: assets, error } = await supabase
    .from("mall_map_assets")
    .select("id, asset_url, asset_type, floor_label, notes")
    .eq("mall_id", mallId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(`discoverSourcesForMall: ${error.message}`);

  for (const asset of (assets ?? [])) {
    let sourceType: MapFactorySourceType = "existing_mall_map_asset";
    if (asset.notes?.toLowerCase().includes("evacuation")) sourceType = "evacuation_map_image";
    else if (asset.asset_type === "pdf")                    sourceType = "directory_pdf";

    sources.push({
      source_type: sourceType,
      url:         asset.asset_url,
      asset_id:    asset.id,
      title:       `${asset.asset_type ?? "asset"} — ${asset.floor_label ?? "unknown floor"}`,
      confidence:  SOURCE_TYPE_CONFIDENCE[sourceType],
      notes:       asset.notes ?? "",
    });
  }

  return sources;
}
