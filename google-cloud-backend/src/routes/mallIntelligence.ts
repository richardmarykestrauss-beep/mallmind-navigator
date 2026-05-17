/**
 * mallIntelligence.ts — Sprint 12C
 *
 * REST routes for the Mall Intelligence Harvester pipeline.
 * All routes require an admin bearer token.
 *
 * Mounted at /admin/mall-intelligence in server.ts.
 *
 * GUARANTEE: No route in this file writes to shops, products, mall_nodes,
 *            or any live table. All writes are to the five staging tables
 *            created in migration 013_mall_intelligence.sql.
 *
 * Routes:
 *   POST   /admin/mall-intelligence/discover-sources
 *   POST   /admin/mall-intelligence/scan-website
 *   POST   /admin/mall-intelligence/extract-map
 *   POST   /admin/mall-intelligence/verify-store-location
 *   PATCH  /admin/mall-intelligence/staged-locations/:id/review
 *   GET    /admin/mall-intelligence/assets
 *   GET    /admin/mall-intelligence/staged-locations
 */

import { Router, Request, Response } from "express";
import { getSupabaseClient } from "../lib/supabase.js";

import { classifyMallSource }     from "../services/mallIntelligence/mallSourceDiscoveryService.js";
import { scanMallWebsite }        from "../services/mallIntelligence/mallWebsiteScannerService.js";
import { extractStoreLocations }  from "../services/mallIntelligence/floorMapExtractorService.js";
import { verifyStoreLocation }    from "../services/mallIntelligence/googlePlacesVerificationService.js";
import { buildRouteNodeCandidates } from "../services/mallIntelligence/mallRouteGraphStagingService.js";
import {
  detectGeoDirectoryApi,
  importGeoDirectoryStoresForSource,
  DEFAULT_IMPORT_PER_PAGE,
  DEFAULT_IMPORT_MAX_PAGES,
  ABSOLUTE_MAX_PER_PAGE,
  ABSOLUTE_MAX_PAGES,
} from "../services/mallIntelligence/geoDirectoryConnectorService.js";
import { fetchImageDimensions } from "../services/mallIntelligence/imageDimensionService.js";
import { validateRouteNodeCoordinate } from "../services/mallIntelligence/routeNodeCoordinateService.js";
import { getMallHealth } from "../services/mallIntelligence/mallHealthService.js";
import {
  validatePipelineInput,
  normalizeMallFloorLabel,
  type PipelineStepOutcome,
  type MallSetupPipelineResult,
} from "../services/mallIntelligence/mallSetupPipelineService.js";
import {
  generateSameFloorEdges,
  generateVerticalEdges,
  validateFloorChangeNode,
  dijkstra,
  FLOOR_CHANGE_NODE_TYPES,
} from "../services/mallIntelligence/routeEdgeService.js";

const router = Router();

// ── Auth helpers ──────────────────────────────────────────────────────────────

function getBearerToken(req: Request): string | null {
  const h = req.headers.authorization;
  if (!h?.startsWith("Bearer ")) return null;
  return h.slice("Bearer ".length).trim();
}

async function requireAdmin(req: Request, res: Response) {
  const token = getBearerToken(req);
  if (!token) {
    res.status(401).json({ error: "Missing Authorization bearer token" });
    return null;
  }
  const supabase = getSupabaseClient();
  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData.user) {
    res.status(401).json({ error: "Invalid or expired auth token" });
    return null;
  }
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, is_admin")
    .eq("id", userData.user.id)
    .maybeSingle();
  if (!profile?.is_admin) {
    res.status(403).json({ error: "Admin access required" });
    return null;
  }
  return { user: userData.user, profile };
}

// ── Audit log ─────────────────────────────────────────────────────────────────

function fireAuditLog(
  adminId:   string,
  action:    string,
  newValues: Record<string, unknown>,
): void {
  const supabase = getSupabaseClient();
  void supabase.from("admin_audit_log").insert({
    admin_id:   adminId,
    action,
    table_name: "mall_intelligence",
    row_id:     null,
    old_values: {},
    new_values: newValues,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /admin/mall-intelligence/discover-sources
//
// Register a seed URL for a mall.
// Classifies the URL, checks the blocked-domain list, saves to mall_sources.
// ─────────────────────────────────────────────────────────────────────────────

router.post("/discover-sources", async (req: Request, res: Response) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const { mall_id, seed_url, mall_name, source_type, notes } = req.body as {
    mall_id?:     string;
    seed_url:     string;
    mall_name?:   string;
    source_type?: string;
    notes?:       string;
  };

  if (!seed_url?.trim()) {
    return res.status(400).json({ error: "seed_url is required" });
  }

  // Classify the URL
  const classification = classifyMallSource({
    mall_id,
    seed_url,
    mall_name,
    source_type: source_type as never,
    notes,
  });

  if (classification.is_blocked) {
    return res.status(422).json({
      error:          "Source URL is blocked",
      block_reason:   classification.block_reason,
      classification,
    });
  }

  // Persist to mall_sources
  const supabase = getSupabaseClient();
  const { data: inserted, error } = await supabase
    .from("mall_sources")
    .insert({
      mall_id:     mall_id ?? null,
      source_type: classification.inferred_source_type,
      url:         classification.url,
      confidence:  classification.confidence,
      notes:       notes ?? null,
      created_by:  admin.user.id,
      scan_status: "pending",
    })
    .select()
    .single();

  if (error) {
    console.error("[mall-intelligence/discover-sources]", error);
    return res.status(500).json({ error: error.message });
  }

  fireAuditLog(admin.user.id, "mall_source_discovered", {
    source_id:   (inserted as Record<string, unknown>).id,
    url:         classification.url,
    source_type: classification.inferred_source_type,
  });

  return res.json({
    source:         inserted,
    classification,
    warnings:       classification.warnings,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /admin/mall-intelligence/scan-website
//
// Fetch the source URL and discover floor map / directory asset links.
// Saves discovered assets to mall_map_assets.
// Updates mall_sources.scan_status + last_scanned_at.
// ─────────────────────────────────────────────────────────────────────────────

router.post("/scan-website", async (req: Request, res: Response) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const { source_id } = req.body as { source_id: string };

  if (!source_id?.trim()) {
    return res.status(400).json({ error: "source_id is required" });
  }

  const supabase = getSupabaseClient();

  // Load source
  const { data: source, error: loadErr } = await supabase
    .from("mall_sources")
    .select("*")
    .eq("id", source_id)
    .maybeSingle();

  if (loadErr || !source) {
    return res.status(404).json({ error: "Source not found" });
  }

  const src = source as Record<string, unknown>;

  // Mark as scanning
  await supabase
    .from("mall_sources")
    .update({ scan_status: "scanning" })
    .eq("id", source_id);

  // Fetch the page
  const scanResult = await scanMallWebsite({
    source_id,
    url: src.url as string,
  });

  // Update source record
  const newStatus = scanResult.error ? "failed" : "scanned";
  await supabase
    .from("mall_sources")
    .update({
      scan_status:     newStatus,
      last_scanned_at: new Date().toISOString(),
      page_title:      scanResult.page_title ?? null,
    })
    .eq("id", source_id);

  // Save discovered assets — enrich image assets with pixel dimensions.
  // Deduplicate by (asset_type, floor_label, link_text, asset_url) so that
  // re-scanning the same source never creates duplicate mall_map_assets rows.
  const savedAssets:     unknown[] = [];
  const dimensionWarnings: string[] = [];
  let   skippedDuplicateAssets = 0;

  // Load existing assets for this source to build the dedup set
  const { data: existingAssets } = await supabase
    .from("mall_map_assets")
    .select("asset_type, floor_label, link_text, asset_url")
    .eq("mall_source_id", source_id);

  const assetDedupSet = new Set<string>(
    ((existingAssets ?? []) as Array<{
      asset_type: string; floor_label: string | null;
      link_text:  string | null; asset_url: string;
    }>).map(
      (a) => `${a.asset_type}::${a.floor_label ?? ""}::${a.link_text ?? ""}::${a.asset_url}`,
    ),
  );

  for (const asset of scanResult.discovered_assets) {
    const dedupKey = `${asset.asset_type}::${asset.floor_label ?? ""}::${asset.link_text ?? ""}::${asset.url}`;

    if (assetDedupSet.has(dedupKey)) {
      skippedDuplicateAssets++;
      continue;
    }
    assetDedupSet.add(dedupKey); // prevent in-scan duplicates too

    let pageWidthPx:  number | null = null;
    let pageHeightPx: number | null = null;

    if (asset.asset_type === "image") {
      const dimResult = await fetchImageDimensions(asset.url);
      if (dimResult.dimensions) {
        pageWidthPx  = dimResult.dimensions.width;
        pageHeightPx = dimResult.dimensions.height;
      }
      dimensionWarnings.push(...dimResult.warnings);
    }

    const { data: assetRow } = await supabase
      .from("mall_map_assets")
      .insert({
        mall_source_id:  source_id,
        mall_id:         src.mall_id ?? null,
        asset_type:      asset.asset_type,
        asset_url:       asset.url,
        floor_label:     asset.floor_label ?? null,
        link_text:       asset.link_text ?? null,
        review_status:   "pending",
        page_width_px:   pageWidthPx,
        page_height_px:  pageHeightPx,
      })
      .select()
      .single();
    if (assetRow) savedAssets.push(assetRow);
  }

  fireAuditLog(admin.user.id, "mall_source_scanned", {
    source_id,
    assets_found:      scanResult.discovered_assets.length,
    assets_saved:      savedAssets.length,
    assets_duplicates: skippedDuplicateAssets,
    scan_status:       newStatus,
    duration_ms:       scanResult.scan_duration_ms,
  });

  // Return scan result (raw_html omitted from response to keep payload small)
  return res.json({
    source_id,
    scan_status:              newStatus,
    page_title:               scanResult.page_title,
    assets_saved:             savedAssets,
    assets_found:             scanResult.discovered_assets.length,
    assets_skipped_duplicate: skippedDuplicateAssets,
    scan_duration_ms:         scanResult.scan_duration_ms,
    warnings:                 [...scanResult.warnings, ...dimensionWarnings],
    error:                    scanResult.error,
    // Include a flag so the frontend knows whether to offer "Extract Stores" next
    has_html:                 !!scanResult.raw_html,
    raw_html:                 scanResult.raw_html, // available for immediate extract-map call
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /admin/mall-intelligence/extract-map
//
// Extract store locations from a source's HTML.
// Accepts optional html_content body — if not provided, re-fetches source URL.
// Saves results to mall_store_locations_staged.
// ─────────────────────────────────────────────────────────────────────────────

router.post("/extract-map", async (req: Request, res: Response) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const { source_id, html_content, mall_map_asset_id } = req.body as {
    source_id:        string;
    html_content?:    string;
    mall_map_asset_id?: string;
  };

  if (!source_id?.trim()) {
    return res.status(400).json({ error: "source_id is required" });
  }

  const supabase = getSupabaseClient();

  // Load source
  const { data: source, error: loadErr } = await supabase
    .from("mall_sources")
    .select("*")
    .eq("id", source_id)
    .maybeSingle();

  if (loadErr || !source) {
    return res.status(404).json({ error: "Source not found" });
  }

  const src = source as Record<string, unknown>;

  // Get HTML content — caller can pass it directly (from scan result) or
  // we re-fetch the source URL
  let htmlToProcess = html_content ?? "";
  const warnings: string[] = [];

  if (!htmlToProcess.trim()) {
    const scanResult = await scanMallWebsite({
      source_id,
      url: src.url as string,
    });
    if (scanResult.error) {
      return res.status(502).json({
        error:    `Could not fetch source URL: ${scanResult.error}`,
        warnings: scanResult.warnings,
      });
    }
    htmlToProcess = scanResult.raw_html ?? "";
    warnings.push(...scanResult.warnings);
    warnings.push("html_content not provided — re-fetched source URL for extraction");
  }

  // Run extraction
  const extractResult = extractStoreLocations({
    source_id,
    source_url:       src.url as string,
    html_content:     htmlToProcess,
    mall_id:          src.mall_id as string | undefined,
    mall_map_asset_id: mall_map_asset_id,
  });

  warnings.push(...extractResult.warnings);

  // Persist staged locations — capture per-row insert errors
  const inserted:     unknown[]  = [];
  const insertErrors: string[]   = [];

  for (const store of extractResult.stores_extracted) {
    const { data: row, error: insertErr } = await supabase
      .from("mall_store_locations_staged")
      .insert({
        mall_id:           src.mall_id ?? null,
        mall_source_id:    source_id,
        mall_map_asset_id: mall_map_asset_id ?? null,
        shop_name:         store.shop_name,
        unit_number:       store.unit_number ?? null,
        floor_label:       store.floor_label ?? null,
        category:          store.category    ?? null,
        x_percent:         store.x_percent   ?? null,
        y_percent:         store.y_percent   ?? null,
        source_url:        store.source_url,
        raw_evidence:      store.raw_evidence,
        confidence:        store.confidence,
        extraction_method: store.extraction_method,
        review_status:     "pending",
      })
      .select()
      .single();

    if (row) {
      inserted.push(row);
    }
    if (insertErr) {
      console.error("[mall-intelligence/extract-map] insert error:", insertErr.message, "store:", store.shop_name);
      insertErrors.push(`${store.shop_name}: ${insertErr.message}`);
    }
  }

  // Warn if stores were found but none were persisted
  if (extractResult.total_found > 0 && inserted.length === 0) {
    warnings.push(
      `Extraction found ${extractResult.total_found} store(s) but all DB inserts failed — check staging table constraints`,
    );
  }

  // If no stores found, check whether map assets exist for this source.
  // If so, remind admin that visual/image extraction isn't implemented yet.
  if (extractResult.total_found === 0) {
    const { data: mapAssets } = await supabase
      .from("mall_map_assets")
      .select("id")
      .eq("mall_source_id", source_id)
      .limit(1);
    if (mapAssets && mapAssets.length > 0) {
      warnings.push(
        "Map assets were discovered for this source, but visual/image extraction is not yet implemented. " +
        "Consider manual data entry or OCR (Sprint 13).",
      );
    }
  }

  fireAuditLog(admin.user.id, "mall_map_extracted", {
    source_id,
    stores_found:      extractResult.total_found,
    stores_staged:     inserted.length,
    strategies_tried:  extractResult.strategies_tried,
    insert_errors:     insertErrors.length,
  });

  return res.json({
    source_id,
    total_found:       extractResult.total_found,
    stores_staged:     inserted.length,
    strategies_tried:  extractResult.strategies_tried,
    extraction_log:    extractResult.extraction_log,
    warnings,
    insert_errors:     insertErrors,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /admin/mall-intelligence/verify-store-location
//
// Verify a staged store location against Google Places.
// Updates google_places_verified + google_places_place_id on the staged row.
// ─────────────────────────────────────────────────────────────────────────────

router.post("/verify-store-location", async (req: Request, res: Response) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const { staged_location_id } = req.body as { staged_location_id: string };

  if (!staged_location_id?.trim()) {
    return res.status(400).json({ error: "staged_location_id is required" });
  }

  const supabase = getSupabaseClient();

  // Load staged location
  const { data: loc, error: loadErr } = await supabase
    .from("mall_store_locations_staged")
    .select("*, mall_id")
    .eq("id", staged_location_id)
    .maybeSingle();

  if (loadErr || !loc) {
    return res.status(404).json({ error: "Staged location not found" });
  }

  const l = loc as Record<string, unknown>;

  // Load mall name for search query context
  let mallName: string | undefined;
  if (l.mall_id) {
    const { data: mall } = await supabase
      .from("malls")
      .select("name")
      .eq("id", l.mall_id)
      .maybeSingle();
    mallName = (mall as Record<string, unknown> | null)?.name as string | undefined;
  }

  // Verify
  const verifyResult = await verifyStoreLocation({
    shop_name:           l.shop_name as string,
    mall_name:           mallName,
    staged_location_id:  staged_location_id,
  });

  // Update staged location
  await supabase
    .from("mall_store_locations_staged")
    .update({
      google_places_verified: verifyResult.verified,
      google_places_place_id: verifyResult.place_id ?? null,
    })
    .eq("id", staged_location_id);

  fireAuditLog(admin.user.id, "mall_store_location_verified", {
    staged_location_id,
    verified:   verifyResult.verified,
    method:     verifyResult.method,
    confidence: verifyResult.confidence,
  });

  return res.json(verifyResult);
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /admin/mall-intelligence/staged-locations/:id/review
//
// Admin accept / reject / flag a staged store location.
// Does NOT write to any live table.
// ─────────────────────────────────────────────────────────────────────────────

router.patch("/staged-locations/:id/review", async (req: Request, res: Response) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const locationId = req.params.id as string;
  const { review_status, notes } = req.body as {
    review_status: "pending" | "accepted" | "rejected" | "flagged";
    notes?:        string;
  };

  const VALID_STATUSES = ["pending", "accepted", "rejected", "flagged"];
  if (!VALID_STATUSES.includes(review_status)) {
    return res.status(400).json({
      error: `review_status must be one of: ${VALID_STATUSES.join(", ")}`,
    });
  }

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("mall_store_locations_staged")
    .update({
      review_status,
      reviewed_by:  admin.user.id,
      reviewed_at:  new Date().toISOString(),
      notes:        notes ?? null,
    })
    .eq("id", locationId)
    .select()
    .single();

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  fireAuditLog(admin.user.id, "mall_staged_location_reviewed", {
    location_id:   locationId,
    review_status,
  });

  return res.json({ ok: true, item: data });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /admin/mall-intelligence/stage-route-nodes
//
// Convert accepted staged store locations into route node candidates.
// Does NOT write to live navigation tables.
// ─────────────────────────────────────────────────────────────────────────────

router.post("/stage-route-nodes", async (req: Request, res: Response) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const { mall_id } = req.body as { mall_id: string };

  if (!mall_id?.trim()) {
    return res.status(400).json({ error: "mall_id is required" });
  }

  const supabase = getSupabaseClient();

  // Load accepted staged locations for this mall
  const { data: locations, error: loadErr } = await supabase
    .from("mall_store_locations_staged")
    .select("id, shop_name, floor_label, x_percent, y_percent, category")
    .eq("mall_id", mall_id)
    .eq("review_status", "accepted");

  if (loadErr) {
    return res.status(500).json({ error: loadErr.message });
  }

  const result = buildRouteNodeCandidates(
    (locations ?? []) as Array<{
      id:           string;
      shop_name?:   string;
      floor_label?: string;
      x_percent?:   number | null;
      y_percent?:   number | null;
      category?:    string;
    }>,
    mall_id,
  );

  // Persist to mall_route_nodes_staged
  const savedNodes: unknown[] = [];
  for (const node of result.node_candidates) {
    const { data: row } = await supabase
      .from("mall_route_nodes_staged")
      .insert({
        mall_id,
        staged_location_id: node.staged_location_id ?? null,
        node_type:          node.node_type,
        label:              node.label,
        floor_label:        node.floor_label ?? null,
        x_percent:          node.x_percent   ?? null,
        y_percent:          node.y_percent   ?? null,
        review_status:      "pending",
      })
      .select()
      .single();
    if (row) savedNodes.push(row);
  }

  fireAuditLog(admin.user.id, "mall_route_nodes_staged", {
    mall_id,
    nodes_created: savedNodes.length,
  });

  return res.json({
    mall_id,
    nodes_staged:   savedNodes.length,
    nodes:          savedNodes,
    warnings:       result.warnings,
    note:           result.note,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /admin/mall-intelligence/assets?mall_id=<uuid>
//
// List all mall_sources and mall_map_assets for a given mall.
// ─────────────────────────────────────────────────────────────────────────────

router.get("/assets", async (req: Request, res: Response) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const mallId = req.query.mall_id as string | undefined;
  const supabase = getSupabaseClient();

  let sourcesQuery = supabase
    .from("mall_sources")
    .select("*")
    .order("created_at", { ascending: false });

  let assetsQuery = supabase
    .from("mall_map_assets")
    .select("*")
    .order("created_at", { ascending: false });

  if (mallId) {
    sourcesQuery = sourcesQuery.eq("mall_id", mallId);
    assetsQuery  = assetsQuery.eq("mall_id", mallId);
  }

  const [{ data: sources, error: srcErr }, { data: assets, error: assetErr }] =
    await Promise.all([sourcesQuery, assetsQuery]);

  if (srcErr)   return res.status(500).json({ error: srcErr.message });
  if (assetErr) return res.status(500).json({ error: assetErr.message });

  return res.json({
    sources: sources ?? [],
    assets:  assets  ?? [],
    total_sources: (sources ?? []).length,
    total_assets:  (assets  ?? []).length,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /admin/mall-intelligence/staged-locations?mall_id=<uuid>&status=<str>
//
// List staged store locations with optional filtering.
// ─────────────────────────────────────────────────────────────────────────────

router.get("/staged-locations", async (req: Request, res: Response) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const mallId = req.query.mall_id  as string | undefined;
  const status = req.query.status   as string | undefined;
  const limit  = Math.min(parseInt((req.query.limit as string) ?? "200", 10), 500);

  const supabase = getSupabaseClient();
  let query = supabase
    .from("mall_store_locations_staged")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (mallId) query = query.eq("mall_id", mallId);
  if (status) query = query.eq("review_status", status);

  const { data, error } = await query;

  if (error) return res.status(500).json({ error: error.message });

  return res.json({
    items:  data ?? [],
    total:  (data ?? []).length,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /admin/mall-intelligence/detect-geodirectory
//
// Probe a mall source URL for the WordPress GeoDirectory REST API.
// If confirmed, persists geodir_detected + geodir_api_url on the source record.
// ─────────────────────────────────────────────────────────────────────────────

router.post("/detect-geodirectory", async (req: Request, res: Response) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const { source_id } = req.body as { source_id: string };
  if (!source_id?.trim()) {
    return res.status(400).json({ error: "source_id is required" });
  }

  const supabase = getSupabaseClient();

  // Load source
  const { data: source, error: loadErr } = await supabase
    .from("mall_sources")
    .select("*")
    .eq("id", source_id)
    .maybeSingle();

  if (loadErr || !source) {
    return res.status(404).json({ error: "Source not found" });
  }

  const src = source as Record<string, unknown>;

  // Run detection
  const result = await detectGeoDirectoryApi(src.url as string);

  // Persist outcome on the source record
  await supabase
    .from("mall_sources")
    .update({
      geodir_detected: result.detected,
      geodir_api_url:  result.detected ? result.api_url : null,
    })
    .eq("id", source_id);

  fireAuditLog(admin.user.id, "mall_source_geodir_detect", {
    source_id,
    detected:        result.detected,
    api_url:         result.api_url,
    stores_endpoint: result.stores_endpoint,
  });

  return res.json({
    source_id,
    detected:        result.detected,
    api_url:         result.api_url,
    stores_endpoint: result.stores_endpoint,
    route_names:     result.route_names,
    warnings:        result.warnings,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /admin/mall-intelligence/import-geodirectory
//
// Fetch all pages from the GeoDirectory /stores endpoint for a source,
// normalise records, and upsert into mall_store_locations_staged.
// Deduplicates by (mall_source_id, geodir_store_id).
// ─────────────────────────────────────────────────────────────────────────────

router.post("/import-geodirectory", async (req: Request, res: Response) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const { source_id, max_pages, per_page } = req.body as {
    source_id:  string;
    max_pages?: number;
    per_page?:  number;
  };

  if (!source_id?.trim()) {
    return res.status(400).json({ error: "source_id is required" });
  }

  // Clamp to absolute safety limits — the frontend sends small values by
  // default but a curl call could try to pass 1000.
  const safeMaxPages = Math.min(
    typeof max_pages === "number" && max_pages > 0 ? max_pages : DEFAULT_IMPORT_MAX_PAGES,
    ABSOLUTE_MAX_PAGES,
  );
  const safePerPage = Math.min(
    typeof per_page  === "number" && per_page  > 0 ? per_page  : DEFAULT_IMPORT_PER_PAGE,
    ABSOLUTE_MAX_PER_PAGE,
  );

  const supabase = getSupabaseClient();

  try {
    const result = await importGeoDirectoryStoresForSource(
      source_id,
      supabase,
      { maxPages: safeMaxPages, perPage: safePerPage },
    );

    fireAuditLog(admin.user.id, "mall_geodir_imported", {
      source_id,
      records_found:  result.records_found,
      stores_staged:  result.stores_staged,
      stores_updated: result.stores_updated,
      pages_fetched:  result.pages_fetched,
      max_pages:      safeMaxPages,
      per_page:       safePerPage,
    });

    return res.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[mall-intelligence/import-geodirectory] unexpected error:", msg);
    return res.status(500).json({
      error:    msg,
      warnings: [],
      hint:     "Try max_pages=1 and per_page=25 first.",
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /admin/mall-intelligence/mall-health?mall_id=<uuid>
//
// Returns a structured readiness report for a single mall (or all malls when
// mall_id is omitted).  READ-ONLY — no staging-table writes.
// ─────────────────────────────────────────────────────────────────────────────

router.get("/mall-health", async (req: Request, res: Response) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const mallId = (req.query.mall_id as string | undefined)?.trim() || null;
  const supabase = getSupabaseClient();

  const report = await getMallHealth(mallId, supabase);
  return res.json(report);
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /admin/mall-intelligence/route-nodes?mall_id=<uuid>&unplaced=true
//
// List staged route nodes for a mall, optionally filtered to those that
// are still missing x_percent / y_percent coordinates.
// ─────────────────────────────────────────────────────────────────────────────

router.get("/route-nodes", async (req: Request, res: Response) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const mallId      = req.query.mall_id  as string | undefined;
  const unplacedOnly = req.query.unplaced === "true";
  const limit       = Math.min(parseInt((req.query.limit as string) ?? "200", 10), 500);

  const supabase = getSupabaseClient();
  let query = supabase
    .from("mall_route_nodes_staged")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (mallId)      query = query.eq("mall_id", mallId);
  if (unplacedOnly) query = query.is("x_percent", null);

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });

  return res.json({ items: data ?? [], total: (data ?? []).length });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /admin/mall-intelligence/route-node-coordinate
//
// Place (or update) x_percent / y_percent on a staged route node.
// Also updates the linked mall_store_locations_staged row when
// staged_location_id is set on the node.
//
// Validates:
//   - admin required
//   - route_node_id must be a non-empty string
//   - x_percent and y_percent must be numbers in [0, 100]
//   - route node must exist in mall_route_nodes_staged
// ─────────────────────────────────────────────────────────────────────────────

router.post("/route-node-coordinate", async (req: Request, res: Response) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const { route_node_id, x_percent, y_percent } = req.body as {
    route_node_id: unknown;
    x_percent:     unknown;
    y_percent:     unknown;
  };

  // Pure validation
  const validation = validateRouteNodeCoordinate(route_node_id, x_percent, y_percent);
  if (!validation.valid) {
    return res.status(400).json({ error: validation.error });
  }

  // Typed after validation passes
  const nodeId = (route_node_id as string).trim();
  const xPct   = x_percent as number;
  const yPct   = y_percent as number;

  const supabase = getSupabaseClient();

  // Load route node
  const { data: nodeRow, error: nodeErr } = await supabase
    .from("mall_route_nodes_staged")
    .select("id, staged_location_id")
    .eq("id", nodeId)
    .maybeSingle();

  if (nodeErr || !nodeRow) {
    return res.status(404).json({ error: "Route node not found" });
  }

  const node = nodeRow as { id: string; staged_location_id?: string | null };

  // Update route node coordinates
  const { error: updateErr } = await supabase
    .from("mall_route_nodes_staged")
    .update({ x_percent: xPct, y_percent: yPct })
    .eq("id", nodeId);

  if (updateErr) {
    return res.status(500).json({ error: updateErr.message });
  }

  // Propagate to linked staged store location if present
  let locationUpdated = false;
  if (node.staged_location_id) {
    const { error: locErr } = await supabase
      .from("mall_store_locations_staged")
      .update({ x_percent: xPct, y_percent: yPct })
      .eq("id", node.staged_location_id);
    if (!locErr) locationUpdated = true;
  }

  fireAuditLog(admin.user.id, "mall_route_node_coordinate_placed", {
    route_node_id:    nodeId,
    x_percent:        xPct,
    y_percent:        yPct,
    location_updated: locationUpdated,
  });

  return res.json({
    ok:               true,
    route_node_id:    nodeId,
    x_percent:        xPct,
    y_percent:        yPct,
    location_updated: locationUpdated,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /admin/mall-intelligence/run-setup-pipeline
//
// Orchestration endpoint — runs up to 11 safe setup steps for a mall/source
// and returns a structured step-by-step report.
//
// Safety guarantees (enforced throughout):
//   ✗  Does NOT auto-accept stores.
//   ✗  Does NOT auto-place coordinates.
//   ✗  Does NOT write to live navigation tables.
//   ✗  Does NOT delete data.
//   ✓  Only links null mall_id values when source_id + mall_id are explicit.
//   ✓  Duplicate assets are reported, not deleted.
// ─────────────────────────────────────────────────────────────────────────────

const PIPELINE_DEFAULT_MAX_PAGES = 3;
const PIPELINE_DEFAULT_PER_PAGE  = 50;
const PIPELINE_IMAGE_DIM_CAP     = 8;   // max images to dimension per run

router.post("/run-setup-pipeline", async (req: Request, res: Response) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const { mall_id, source_id, options } = req.body as {
    mall_id:   unknown;
    source_id: unknown;
    options?:  { max_pages?: number; per_page?: number; force_import?: boolean; force_scan?: boolean };
  };

  // ── Step 1: Validate input ────────────────────────────────────────────────
  const validation = validatePipelineInput(mall_id, source_id);
  if (!validation.valid) {
    return res.status(400).json({ error: validation.error });
  }

  const mallId      = (mall_id   as string).trim();
  const sourceId    = (source_id as string).trim();
  const forceImport = options?.force_import === true;
  const forceScan   = options?.force_scan   === true;

  const supabase        = getSupabaseClient();
  const completedSteps: PipelineStepOutcome[] = [];
  const warnings:       string[] = [];
  const errors:         string[] = [];
  let   healthReport:   unknown  = null;

  let stepNum = 1;

  /** Record a step outcome and optionally collect warnings/errors. */
  function step(
    name:     string,
    status:   PipelineStepOutcome["status"],
    message:  string,
    data?:    Record<string, unknown>,
    startMs?: number,
  ): void {
    const duration_ms = startMs !== undefined ? Date.now() - startMs : undefined;
    completedSteps.push({
      step: stepNum++, name, status, message,
      ...(duration_ms !== undefined ? { duration_ms } : {}),
      ...(data ? { data } : {}),
    });
    if (status === "warning") warnings.push(message);
    if (status === "error")   errors.push(message);
  }

  step("Input validation", "ok", `mall_id and source_id accepted`);

  // ── Steps 2–10: individual try/catch per step, outer safety net catches any
  //   unexpected throw so the pipeline always returns structured JSON. ────────
  let sourceUrl:              string | null = null;
  let rawHtml:                string | null = null;
  let geodirAlreadyDetected:  boolean       = false;
  let geodirApiUrlFromSource: string | null = null;
  let geodirApiUrl:           string | null = null;

  try {

  // ── Step 2: Load source + link to mall ────────────────────────────────────

  try {
    const { data: srcRow, error: srcErr } = await supabase
      .from("mall_sources")
      .select("id, mall_id, url, geodir_detected, geodir_api_url")
      .eq("id", sourceId)
      .maybeSingle();

    if (srcErr || !srcRow) {
      step("Link source to mall", "error", `Source "${sourceId}" not found — check source_id`);
    } else {
      const src = srcRow as Record<string, unknown>;
      sourceUrl              = src.url as string;
      geodirAlreadyDetected  = src.geodir_detected === true;
      geodirApiUrlFromSource = (src.geodir_api_url as string | null) ?? null;

      if (!src.mall_id) {
        await supabase.from("mall_sources").update({ mall_id: mallId }).eq("id", sourceId);
        step("Link source to mall", "ok", `Source linked to mall_id=${mallId}`);
      } else if (src.mall_id !== mallId) {
        step("Link source to mall", "warning",
          `Source already linked to mall_id=${src.mall_id} (not changed). ` +
          `Continuing with provided mall_id=${mallId}.`,
          { existing_mall_id: src.mall_id as string });
      } else {
        step("Link source to mall", "ok", "Source already linked to this mall");
      }
    }
  } catch (e) {
    step("Link source to mall", "error", `Unexpected error: ${e instanceof Error ? e.message : String(e)}`);
  }

  // ── Step 3: Scan website ──────────────────────────────────────────────────
  if (sourceUrl) {
    // Skip scan if assets already exist for this source (unless force_scan=true).
    const { count: existingAssetCount } = await supabase
      .from("mall_map_assets")
      .select("id", { count: "exact", head: true })
      .eq("mall_source_id", sourceId);

    if ((existingAssetCount ?? 0) > 0 && !forceScan) {
      step("Scan website", "skipped",
        `${existingAssetCount} asset(s) already stored for this source — skipped. Use force_scan=true to re-scan.`,
        { existing_assets: existingAssetCount });
    } else {
      const scanStartMs = Date.now();
      try {
        await supabase.from("mall_sources").update({ scan_status: "scanning" }).eq("id", sourceId);
        const scanResult = await scanMallWebsite({ source_id: sourceId, url: sourceUrl });
        rawHtml = scanResult.raw_html ?? null;

        const newStatus = scanResult.error ? "failed" : "scanned";
        await supabase.from("mall_sources").update({
          scan_status:     newStatus,
          last_scanned_at: new Date().toISOString(),
          page_title:      scanResult.page_title ?? null,
        }).eq("id", sourceId);

        if (scanResult.error) {
          step("Scan website", "warning",
            `Scan completed with error: ${scanResult.error}. ${scanResult.discovered_assets.length} assets found before error.`,
            { assets_found: scanResult.discovered_assets.length }, scanStartMs);
        } else {
          // Persist newly discovered assets, skipping exact duplicates
          // (same asset_type + floor_label + link_text + asset_url already in DB).
          const { data: existingPipelineAssets } = await supabase
            .from("mall_map_assets")
            .select("asset_type, floor_label, link_text, asset_url")
            .eq("mall_source_id", sourceId);

          const pipelineAssetDedup = new Set<string>(
            ((existingPipelineAssets ?? []) as Array<{
              asset_type: string; floor_label: string | null;
              link_text:  string | null; asset_url: string;
            }>).map(
              (a) => `${a.asset_type}::${a.floor_label ?? ""}::${a.link_text ?? ""}::${a.asset_url}`,
            ),
          );

          let savedAssets = 0;
          let dupAssets   = 0;
          for (const asset of scanResult.discovered_assets) {
            const dk = `${asset.asset_type}::${asset.floor_label ?? ""}::${asset.link_text ?? ""}::${asset.url}`;
            if (pipelineAssetDedup.has(dk)) { dupAssets++; continue; }
            pipelineAssetDedup.add(dk);

            let pw: number | null = null;
            let ph: number | null = null;
            if (asset.asset_type === "image") {
              const dim = await fetchImageDimensions(asset.url);
              if (dim.dimensions) { pw = dim.dimensions.width; ph = dim.dimensions.height; }
            }
            const { error: assetErr } = await supabase.from("mall_map_assets").insert({
              mall_source_id:  sourceId,
              mall_id:         mallId,
              asset_type:      asset.asset_type,
              asset_url:       asset.url,
              floor_label:     asset.floor_label  ?? null,
              link_text:       asset.link_text    ?? null,
              review_status:   "pending",
              page_width_px:   pw,
              page_height_px:  ph,
            });
            if (!assetErr) savedAssets++;
          }
          step("Scan website", "ok",
            `Scan complete — ${scanResult.discovered_assets.length} asset(s) found, ${savedAssets} saved, ${dupAssets} duplicate(s) skipped`,
            { assets_found: scanResult.discovered_assets.length, assets_saved: savedAssets,
              assets_duplicates_skipped: dupAssets, scan_duration_ms: scanResult.scan_duration_ms },
            scanStartMs);
          warnings.push(...scanResult.warnings);
        }
      } catch (e) {
        step("Scan website", "error", `Scan failed: ${e instanceof Error ? e.message : String(e)}`,
          undefined, scanStartMs);
      }
    }
  } else {
    step("Scan website", "skipped", "Skipped — source URL unavailable (see step 2)");
  }

  // ── Step 4: Detect GeoDirectory ───────────────────────────────────────────
  if (sourceUrl) {
    if (geodirAlreadyDetected && geodirApiUrlFromSource) {
      // Use cached value from source row — skip the HTTP detection call.
      geodirApiUrl = geodirApiUrlFromSource;
      step("Detect GeoDirectory", "ok",
        `GeoDirectory API already detected at ${geodirApiUrl} (cached — use force_scan to re-detect)`,
        { detected: true, api_url: geodirApiUrl, cached: true });
    } else {
      try {
        const gdResult = await detectGeoDirectoryApi(sourceUrl);
        geodirApiUrl   = gdResult.detected ? gdResult.api_url : null;
        if (gdResult.detected && gdResult.api_url) {
          await supabase.from("mall_sources").update({
            geodir_detected: true,
            geodir_api_url:  gdResult.api_url,
          }).eq("id", sourceId);
        }
        step("Detect GeoDirectory", gdResult.detected ? "ok" : "skipped",
          gdResult.detected
            ? `GeoDirectory API detected at ${gdResult.api_url}`
            : "GeoDirectory not found — source may use a different store directory format",
          { detected: gdResult.detected, api_url: gdResult.api_url });
      } catch (e) {
        step("Detect GeoDirectory", "warning",
          `Detection attempt failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  } else {
    step("Detect GeoDirectory", "skipped", "Skipped — source URL unavailable");
  }

  // ── Step 5: Import GeoDirectory stores ────────────────────────────────────
  if (geodirApiUrl) {
    // Skip import if geodir stores already staged for this source (unless force_import=true).
    const { count: existingGeoStoreCount } = await supabase
      .from("mall_store_locations_staged")
      .select("id", { count: "exact", head: true })
      .eq("mall_source_id", sourceId)
      .not("geodir_store_id", "is", null);

    if ((existingGeoStoreCount ?? 0) > 0 && !forceImport) {
      step("Import GeoDirectory stores", "skipped",
        `${existingGeoStoreCount} GeoDirectory store(s) already staged — skipped. Use force_import=true to re-import.`,
        { existing_geodir_stores: existingGeoStoreCount });
    } else {
      const importStartMs = Date.now();
      try {
        const maxPages = Math.min(
          typeof options?.max_pages === "number" && options.max_pages > 0
            ? options.max_pages : PIPELINE_DEFAULT_MAX_PAGES,
          ABSOLUTE_MAX_PAGES,
        );
        const perPage = Math.min(
          typeof options?.per_page === "number" && options.per_page > 0
            ? options.per_page : PIPELINE_DEFAULT_PER_PAGE,
          ABSOLUTE_MAX_PER_PAGE,
        );

        const importResult = await importGeoDirectoryStoresForSource(
          sourceId, supabase, { maxPages, perPage },
        );
        step("Import GeoDirectory stores", "ok",
          `${importResult.records_found} records fetched across ${importResult.pages_fetched} page(s); ` +
          `${importResult.stores_staged} staged, ${importResult.stores_updated} updated`,
          {
            records_found:  importResult.records_found,
            stores_staged:  importResult.stores_staged,
            stores_updated: importResult.stores_updated,
            pages_fetched:  importResult.pages_fetched,
          }, importStartMs);
        warnings.push(...importResult.warnings);
        if (importResult.insert_errors.length > 0) {
          warnings.push(`${importResult.insert_errors.length} store(s) failed to insert during GeoDirectory import`);
        }
      } catch (e) {
        step("Import GeoDirectory stores", "error",
          `Import failed: ${e instanceof Error ? e.message : String(e)}`, undefined, importStartMs);
      }
    }
  } else {
    step("Import GeoDirectory stores", "skipped",
      "Skipped — GeoDirectory not detected (step 4). Use manual import if needed.");
  }

  // ── Step 6: Link staged stores to mall ────────────────────────────────────
  try {
    const { data: orphanStores } = await supabase
      .from("mall_store_locations_staged")
      .select("id")
      .eq("mall_source_id", sourceId)
      .is("mall_id", null);

    const orphanCount = (orphanStores ?? []).length;
    if (orphanCount > 0) {
      await supabase.from("mall_store_locations_staged")
        .update({ mall_id: mallId })
        .eq("mall_source_id", sourceId)
        .is("mall_id", null);
    }
    step("Link staged stores to mall", "ok",
      orphanCount > 0
        ? `${orphanCount} staged store(s) linked to mall_id=${mallId}`
        : "All staged stores already linked",
      { linked: orphanCount });
  } catch (e) {
    step("Link staged stores to mall", "error",
      `Failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  // ── Step 7: Normalize floor labels ────────────────────────────────────────
  try {
    const { data: floorRows } = await supabase
      .from("mall_store_locations_staged")
      .select("floor_label")
      .eq("mall_source_id", sourceId)
      .not("floor_label", "is", null);

    const uniqueFloors = [
      ...new Set(
        ((floorRows ?? []) as Array<{ floor_label: string }>)
          .map((r) => r.floor_label)
          .filter(Boolean),
      ),
    ];

    let normalizedCount = 0;
    const changedLabels: Array<{ from: string; to: string }> = [];

    for (const raw of uniqueFloors) {
      const normalized = normalizeMallFloorLabel(raw);
      if (normalized !== raw) {
        await supabase.from("mall_store_locations_staged")
          .update({ floor_label: normalized })
          .eq("mall_source_id", sourceId)
          .eq("floor_label",    raw);
        normalizedCount++;
        changedLabels.push({ from: raw, to: normalized });
      }
    }

    step("Normalize floor labels", "ok",
      normalizedCount > 0
        ? `Normalized ${normalizedCount} floor label variant(s)`
        : `All ${uniqueFloors.length} floor label(s) already canonical`,
      { unique_floors: uniqueFloors.length, normalized: normalizedCount,
        changes: changedLabels });
  } catch (e) {
    step("Normalize floor labels", "warning",
      `Normalization skipped: ${e instanceof Error ? e.message : String(e)}`);
  }

  // ── Step 8: Link map assets to mall ───────────────────────────────────────
  try {
    const { data: orphanAssets } = await supabase
      .from("mall_map_assets")
      .select("id")
      .eq("mall_source_id", sourceId)
      .is("mall_id", null);

    const orphanAssetCount = (orphanAssets ?? []).length;
    if (orphanAssetCount > 0) {
      await supabase.from("mall_map_assets")
        .update({ mall_id: mallId })
        .eq("mall_source_id", sourceId)
        .is("mall_id", null);
    }
    step("Link map assets to mall", "ok",
      orphanAssetCount > 0
        ? `${orphanAssetCount} map asset(s) linked to mall_id=${mallId}`
        : "All map assets already linked",
      { linked: orphanAssetCount });
  } catch (e) {
    step("Link map assets to mall", "error",
      `Failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  // ── Step 9: Populate missing image dimensions ─────────────────────────────
  try {
    const { data: missingDimAssets } = await supabase
      .from("mall_map_assets")
      .select("id, asset_url")
      .eq("mall_source_id", sourceId)
      .eq("asset_type", "image")
      .is("page_width_px", null)
      .limit(PIPELINE_IMAGE_DIM_CAP);

    const toProcess = (missingDimAssets ?? []) as Array<{ id: string; asset_url: string }>;
    let enriched = 0;
    const dimWarnings: string[] = [];

    for (const asset of toProcess) {
      const dimResult = await fetchImageDimensions(asset.asset_url);
      if (dimResult.dimensions) {
        await supabase.from("mall_map_assets")
          .update({ page_width_px: dimResult.dimensions.width, page_height_px: dimResult.dimensions.height })
          .eq("id", asset.id);
        enriched++;
      }
      dimWarnings.push(...dimResult.warnings);
    }

    const wasLimited = toProcess.length === PIPELINE_IMAGE_DIM_CAP;
    step("Populate image dimensions", toProcess.length === 0 ? "skipped" : "ok",
      toProcess.length === 0
        ? "No image assets missing dimensions"
        : `Processed ${toProcess.length} image(s), enriched ${enriched}` +
          (wasLimited ? ` (capped at ${PIPELINE_IMAGE_DIM_CAP} — re-run to process more)` : ""),
      { processed: toProcess.length, enriched });
    warnings.push(...dimWarnings);
  } catch (e) {
    step("Populate image dimensions", "warning",
      `Dimension fetch skipped: ${e instanceof Error ? e.message : String(e)}`);
  }

  // ── Step 10: Detect duplicate asset URLs ──────────────────────────────────
  try {
    const { data: allAssets } = await supabase
      .from("mall_map_assets")
      .select("asset_url")
      .eq("mall_id", mallId);

    const urlCounts = new Map<string, number>();
    for (const a of (allAssets ?? []) as Array<{ asset_url: string }>) {
      urlCounts.set(a.asset_url, (urlCounts.get(a.asset_url) ?? 0) + 1);
    }
    const dupGroups = [...urlCounts.values()].filter((c) => c > 1).length;

    if (dupGroups > 0) {
      const msg = `${dupGroups} duplicate asset URL group(s) detected — review and remove duplicates manually`;
      step("Detect duplicate assets", "warning", msg, { duplicate_groups: dupGroups });
    } else {
      step("Detect duplicate assets", "ok",
        `No duplicate asset URLs detected`, { total_assets: allAssets?.length ?? 0 });
    }
  } catch (e) {
    step("Detect duplicate assets", "warning",
      `Duplicate check skipped: ${e instanceof Error ? e.message : String(e)}`);
  }

  } catch (unexpectedErr) {
    // Outer safety net — ensures any uncaught throw still returns JSON.
    const msg = `Unexpected pipeline error: ${unexpectedErr instanceof Error ? unexpectedErr.message : String(unexpectedErr)}`;
    errors.push(msg);
    completedSteps.push({ step: stepNum++, name: "Pipeline error", status: "error", message: msg });
  }

  // ── Step 11: Run mall health report (always runs, outside outer try) ───────
  try {
    healthReport = await getMallHealth(mallId, supabase);
    const report = healthReport as { readiness_status: string; next_recommended_action: string };
    step("Mall health report", "ok",
      `readiness_status=${report.readiness_status}`,
      { readiness_status: report.readiness_status });
  } catch (e) {
    step("Mall health report", "error",
      `Health check failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  // ── Derive next action ────────────────────────────────────────────────────
  let nextAction = "Pipeline complete.";
  const report = healthReport as ({ next_recommended_action?: string } | null);
  if (report?.next_recommended_action) {
    nextAction = report.next_recommended_action;
  } else if (errors.length > 0) {
    nextAction = `Resolve ${errors.length} error(s) in the pipeline log, then re-run.`;
  } else if (warnings.length > 0) {
    nextAction = "Review warnings above, then run the Mall Health check.";
  }

  fireAuditLog(admin.user.id, "mall_setup_pipeline_run", {
    mall_id:    mallId,
    source_id:  sourceId,
    steps:      completedSteps.length,
    errors:     errors.length,
    warnings:   warnings.length,
  });

  const result: MallSetupPipelineResult = {
    mall_id:                 mallId,
    source_id:               sourceId,
    completed_steps:         completedSteps,
    skipped_steps:           completedSteps.filter((s) => s.status === "skipped").map((s) => s.name),
    warnings,
    errors,
    health_report:           healthReport,
    next_recommended_action: nextAction,
    generated_at:            new Date().toISOString(),
  };

  return res.json(result);
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /admin/mall-intelligence/floor-change-node
//
// Create a single floor-change connector node (lift / escalator / stairs) in
// mall_route_nodes_staged.  Vertical edges between connector nodes sharing the
// same label + node_type are created the next time stage-route-edges is called.
//
// Validation (pure, delegated to routeEdgeService.validateFloorChangeNode):
//   - admin required
//   - mall_id, label, node_type, floor_label required
//   - node_type ∈ { lift, escalator, stairs }
//   - x_percent, y_percent ∈ [0, 100]
// ─────────────────────────────────────────────────────────────────────────────

router.post("/floor-change-node", async (req: Request, res: Response) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const { mall_id, label, node_type, floor_label, x_percent, y_percent } =
    req.body as {
      mall_id:     unknown;
      label:       unknown;
      node_type:   unknown;
      floor_label: unknown;
      x_percent:   unknown;
      y_percent:   unknown;
    };

  const validation = validateFloorChangeNode({
    mall_id, label, node_type, floor_label, x_percent, y_percent,
  });
  if (!validation.valid) {
    return res.status(400).json({ error: validation.error });
  }

  const supabase = getSupabaseClient();
  const { data: row, error: insertErr } = await supabase
    .from("mall_route_nodes_staged")
    .insert({
      mall_id:            (mall_id as string).trim(),
      staged_location_id: null,
      node_type:          (node_type as string).trim(),
      label:              (label as string).trim(),
      floor_label:        (floor_label as string).trim(),
      x_percent:          x_percent as number,
      y_percent:          y_percent as number,
      review_status:      "pending",
    })
    .select()
    .single();

  if (insertErr) {
    return res.status(500).json({ error: insertErr.message });
  }

  const inserted = row as Record<string, unknown>;

  fireAuditLog(admin.user.id, "mall_floor_change_node_created", {
    mall_id:     inserted.mall_id,
    node_id:     inserted.id,
    node_type:   inserted.node_type,
    label:       inserted.label,
    floor_label: inserted.floor_label,
  });

  return res.json({
    ok:          true,
    node_id:     inserted.id,
    mall_id:     inserted.mall_id,
    label:       inserted.label,
    node_type:   inserted.node_type,
    floor_label: inserted.floor_label,
    x_percent:   inserted.x_percent,
    y_percent:   inserted.y_percent,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /admin/mall-intelligence/stage-route-edges
//
// Load all placed route nodes for the mall, generate same-floor walkway edges
// using Euclidean distance weights, skip any already-stored dedup_keys, and
// persist the new edges to mall_route_edges_staged.
// ─────────────────────────────────────────────────────────────────────────────

router.post("/stage-route-edges", async (req: Request, res: Response) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const { mall_id } = req.body as { mall_id: string };
  if (!mall_id?.trim()) {
    return res.status(400).json({ error: "mall_id is required" });
  }

  const supabase = getSupabaseClient();

  // Load placed nodes (x_percent / y_percent must be non-null)
  const { data: nodeRows, error: nodesErr } = await supabase
    .from("mall_route_nodes_staged")
    .select("id, label, floor_label, x_percent, y_percent, node_type")
    .eq("mall_id", mall_id)
    .not("x_percent", "is", null)
    .not("y_percent",  "is", null);

  if (nodesErr) {
    return res.status(500).json({ error: nodesErr.message });
  }

  const nodes = (nodeRows ?? []) as unknown as Array<{
    id:          string;
    label:       string;
    floor_label: string | null;
    x_percent:   number;
    y_percent:   number;
    node_type:   string;
  }>;

  // Generate same-floor walkway edges + vertical floor-change edges
  const { edges: sfEdges, warnings: sfWarn } = generateSameFloorEdges(nodes);
  const { edges: vtEdges, warnings: vtWarn } = generateVerticalEdges(nodes);
  const candidates = [...sfEdges, ...vtEdges];
  const warnings   = [...sfWarn, ...vtWarn];

  if (candidates.length === 0) {
    return res.json({
      mall_id,
      nodes_considered: nodes.length,
      edges_created:    0,
      edges_skipped:    0,
      warnings,
    });
  }

  // Load existing edges so we can skip duplicates
  const { data: existingRows, error: existingErr } = await supabase
    .from("mall_route_edges_staged")
    .select("from_node_id, to_node_id")
    .eq("mall_id", mall_id);

  if (existingErr) {
    return res.status(500).json({ error: existingErr.message });
  }

  const existingKeys = new Set<string>(
    ((existingRows ?? []) as unknown as Array<{ from_node_id: string; to_node_id: string }>)
      .map((e) => {
        const [a, b] =
          e.from_node_id < e.to_node_id
            ? [e.from_node_id, e.to_node_id]
            : [e.to_node_id, e.from_node_id];
        return `${a}:${b}`;
      }),
  );

  const toInsert = candidates.filter((c) => !existingKeys.has(c.dedup_key));
  const skipped  = candidates.length - toInsert.length;

  let created = 0;
  for (const edge of toInsert) {
    const { error: insertErr } = await supabase
      .from("mall_route_edges_staged")
      .insert({
        mall_id,
        from_node_id:   edge.from_node_id,
        to_node_id:     edge.to_node_id,
        edge_type:      edge.edge_type,
        weight_seconds: edge.weight_seconds,
        floor_change:   edge.floor_change,
        review_status:  "pending",
      });
    if (!insertErr) {
      created++;
    } else {
      warnings.push(`Edge ${edge.dedup_key} insert failed: ${insertErr.message}`);
    }
  }

  fireAuditLog(admin.user.id, "mall_route_edges_staged", {
    mall_id,
    nodes_considered: nodes.length,
    edges_created:    created,
    edges_skipped:    skipped,
  });

  return res.json({
    mall_id,
    nodes_considered: nodes.length,
    edges_created:    created,
    edges_skipped:    skipped,
    warnings,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /admin/mall-intelligence/preview-route
//
// Run Dijkstra over the staged route graph and return an ordered step list
// with cumulative walk-time in seconds.
// ─────────────────────────────────────────────────────────────────────────────

router.post("/preview-route", async (req: Request, res: Response) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const { mall_id, from_node_id, to_node_id } = req.body as {
    mall_id:      string;
    from_node_id: string;
    to_node_id:   string;
  };

  if (!mall_id?.trim())      return res.status(400).json({ error: "mall_id is required" });
  if (!from_node_id?.trim()) return res.status(400).json({ error: "from_node_id is required" });
  if (!to_node_id?.trim())   return res.status(400).json({ error: "to_node_id is required" });

  const supabase = getSupabaseClient();

  // Load all placed nodes
  const { data: nodeRows, error: nodesErr } = await supabase
    .from("mall_route_nodes_staged")
    .select("id, label, floor_label, x_percent, y_percent, node_type")
    .eq("mall_id", mall_id)
    .not("x_percent", "is", null)
    .not("y_percent",  "is", null);

  if (nodesErr) return res.status(500).json({ error: nodesErr.message });

  const nodes = (nodeRows ?? []) as unknown as Array<{
    id:          string;
    label:       string;
    floor_label: string | null;
    x_percent:   number;
    y_percent:   number;
    node_type:   string;
  }>;

  // Load all edges for this mall
  const { data: edgeRows, error: edgesErr } = await supabase
    .from("mall_route_edges_staged")
    .select("from_node_id, to_node_id, weight_seconds")
    .eq("mall_id", mall_id);

  if (edgesErr) return res.status(500).json({ error: edgesErr.message });

  const edges = (edgeRows ?? []) as unknown as Array<{
    from_node_id:   string;
    to_node_id:     string;
    weight_seconds: number;
  }>;

  const result = dijkstra(nodes, edges, from_node_id, to_node_id);

  return res.json({
    mall_id,
    from_node_id,
    to_node_id,
    path:          result.path,
    total_seconds: result.total_seconds,
    warning:       result.warning,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Sprint 14A — Mall Map Reconstruction Foundation
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /admin/mall-intelligence/map-assets/:id
//
// Update a map asset's reconstruction metadata:
//   source_kind, floor_label, is_base_map, is_corridor_ref, notes
// Does NOT modify asset_url, mall_id, or review_status — safe for re-runs.
// ─────────────────────────────────────────────────────────────────────────────

router.patch("/map-assets/:id", async (req: Request, res: Response) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const assetId = (req.params.id as string)?.trim();
  if (!assetId) return res.status(400).json({ error: "asset id is required" });

  const { source_kind, floor_label, is_base_map, is_corridor_ref, notes } = req.body as {
    source_kind?:    string | null;
    floor_label?:    string | null;
    is_base_map?:    boolean;
    is_corridor_ref?: boolean;
    notes?:          string | null;
  };

  const patch: Record<string, unknown> = {};
  if (source_kind    !== undefined) patch.source_kind    = source_kind;
  if (floor_label    !== undefined) patch.floor_label    = floor_label;
  if (is_base_map    !== undefined) patch.is_base_map    = is_base_map;
  if (is_corridor_ref !== undefined) patch.is_corridor_ref = is_corridor_ref;
  if (notes          !== undefined) patch.notes          = notes;

  if (Object.keys(patch).length === 0) {
    return res.status(400).json({ error: "No updatable fields provided" });
  }

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("mall_map_assets")
    .update(patch)
    .eq("id", assetId)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: "Asset not found" });

  fireAuditLog(admin.user.id, "mall_map_asset_updated", { asset_id: assetId, ...patch });
  return res.json({ ok: true, asset: data });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /admin/mall-intelligence/map-anchors
//
// List manual map anchors for a mall, ordered floor → anchor_type → label.
// Query params: mall_id (required), floor_label (optional), review_status (optional)
// ─────────────────────────────────────────────────────────────────────────────

router.get("/map-anchors", async (req: Request, res: Response) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const mall_id       = req.query.mall_id       as string | undefined;
  const floor_label   = req.query.floor_label   as string | undefined;
  const review_status = req.query.review_status as string | undefined;

  if (!mall_id?.trim()) return res.status(400).json({ error: "mall_id is required" });

  const supabase = getSupabaseClient();
  let query = supabase
    .from("mall_manual_map_anchors_staged")
    .select("*")
    .eq("mall_id", mall_id.trim())
    .order("floor_label", { ascending: true })
    .order("anchor_type", { ascending: true })
    .order("label",       { ascending: true });

  if (floor_label)   query = query.eq("floor_label", floor_label);
  if (review_status) query = query.eq("review_status", review_status);

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });

  return res.json({ anchors: data ?? [], total: (data ?? []).length });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /admin/mall-intelligence/map-anchors
//
// Insert one or more manual map anchors for a mall.
// Duplicate (mall_id, floor_label, label) rows are silently skipped (upsert
// ignoreDuplicates) so this endpoint is safe to call multiple times.
// ─────────────────────────────────────────────────────────────────────────────

const VALID_ANCHOR_TYPES = new Set([
  "shop", "entrance", "parking", "lift", "escalator", "stairs",
  "toilet", "corridor_node", "emergency_exit", "landmark",
]);

router.post("/map-anchors", async (req: Request, res: Response) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const { mall_id, anchors } = req.body as { mall_id: unknown; anchors: unknown };

  if (!mall_id || typeof mall_id !== "string" || !mall_id.trim()) {
    return res.status(400).json({ error: "mall_id is required" });
  }
  if (!Array.isArray(anchors) || anchors.length === 0) {
    return res.status(400).json({ error: "anchors must be a non-empty array" });
  }

  const rows = (anchors as Array<Record<string, unknown>>)
    .map((a) => ({
      mall_id:          mall_id.trim(),
      map_asset_id:     (a.map_asset_id as string | null) ?? null,
      floor_label:      String(a.floor_label ?? "").trim(),
      label:            String(a.label       ?? "").trim(),
      anchor_type:      VALID_ANCHOR_TYPES.has(String(a.anchor_type)) ? String(a.anchor_type) : "shop",
      raw_text:         (a.raw_text     as string | null) ?? null,
      x_percent:        typeof a.x_percent === "number" ? a.x_percent : null,
      y_percent:        typeof a.y_percent === "number" ? a.y_percent : null,
      confidence_score: typeof a.confidence_score === "number" ? a.confidence_score : 0.0,
      source_note:      (a.source_note as string | null) ?? null,
      notes:            (a.notes       as string | null) ?? null,
      review_status:    "pending",
    }))
    .filter((r) => r.floor_label && r.label);

  if (rows.length === 0) {
    return res.status(400).json({ error: "All anchors were missing floor_label or label" });
  }

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("mall_manual_map_anchors_staged")
    .upsert(rows, { onConflict: "mall_id,floor_label,label", ignoreDuplicates: true })
    .select();

  if (error) return res.status(500).json({ error: error.message });

  fireAuditLog(admin.user.id, "mall_map_anchors_inserted", {
    mall_id: mall_id.trim(), attempted: rows.length, inserted: (data ?? []).length,
  });

  return res.json({ ok: true, inserted: (data ?? []).length, anchors: data ?? [] });
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /admin/mall-intelligence/map-anchors/:id
//
// Update an anchor's placement coordinates, notes, or review status.
// Coordinates are expressed as percentages of the reference image dimensions.
// ─────────────────────────────────────────────────────────────────────────────

router.patch("/map-anchors/:id", async (req: Request, res: Response) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const anchorId = (req.params.id as string)?.trim();
  if (!anchorId) return res.status(400).json({ error: "anchor id is required" });

  const { x_percent, y_percent, review_status, notes, source_note, map_asset_id } = req.body as {
    x_percent?:     number | null;
    y_percent?:     number | null;
    review_status?: string;
    notes?:         string | null;
    source_note?:   string | null;
    map_asset_id?:  string | null;
  };

  const patch: Record<string, unknown> = {};
  if (x_percent    !== undefined) patch.x_percent    = x_percent;
  if (y_percent    !== undefined) patch.y_percent    = y_percent;
  if (notes        !== undefined) patch.notes        = notes;
  if (source_note  !== undefined) patch.source_note  = source_note;
  if (map_asset_id !== undefined) patch.map_asset_id = map_asset_id;

  if (review_status !== undefined) {
    patch.review_status = review_status;
    patch.reviewed_by   = admin.user.id;
    patch.reviewed_at   = new Date().toISOString();
  }

  if (Object.keys(patch).length === 0) {
    return res.status(400).json({ error: "No updatable fields provided" });
  }

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("mall_manual_map_anchors_staged")
    .update(patch)
    .eq("id", anchorId)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: "Anchor not found" });

  fireAuditLog(admin.user.id, "mall_map_anchor_updated", { anchor_id: anchorId, ...patch });
  return res.json({ ok: true, anchor: data });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /admin/mall-intelligence/seed-map-anchors
//
// Insert a preset anchor set for a known mall.  Currently supports:
//   preset="mall_of_africa" — Level 3 + Level 5 anchor set.
//
// Idempotent — existing (mall_id, floor_label, label) rows are skipped.
// ─────────────────────────────────────────────────────────────────────────────

const MAP_ANCHOR_PRESETS: Record<
  string,
  Array<{ floor_label: string; label: string; anchor_type: string }>
> = {
  mall_of_africa: [
    // ── Level 3 ──────────────────────────────────────────────────────────────
    { floor_label: "Level 3", label: "Game",                       anchor_type: "shop"     },
    { floor_label: "Level 3", label: "Edgars",                     anchor_type: "shop"     },
    { floor_label: "Level 3", label: "Truworths",                  anchor_type: "shop"     },
    { floor_label: "Level 3", label: "Checkers",                   anchor_type: "shop"     },
    { floor_label: "Level 3", label: "Woolworths",                 anchor_type: "shop"     },
    { floor_label: "Level 3", label: "Entrance 13",                anchor_type: "entrance" },
    { floor_label: "Level 3", label: "Level 3 North West Parking", anchor_type: "parking"  },
    { floor_label: "Level 3", label: "Level 3 North East Parking", anchor_type: "parking"  },
    { floor_label: "Level 3", label: "Level 3 South West Parking", anchor_type: "parking"  },
    { floor_label: "Level 3", label: "Level 3 South East Parking", anchor_type: "parking"  },
    // ── Level 5 ──────────────────────────────────────────────────────────────
    { floor_label: "Level 5", label: "Edgars",                     anchor_type: "shop"     },
    { floor_label: "Level 5", label: "H&M",                        anchor_type: "shop"     },
    { floor_label: "Level 5", label: "Zara",                       anchor_type: "shop"     },
    { floor_label: "Level 5", label: "Woolworths",                 anchor_type: "shop"     },
    { floor_label: "Level 5", label: "Town Square",                anchor_type: "landmark" },
    { floor_label: "Level 5", label: "Entrance 10",                anchor_type: "entrance" },
    { floor_label: "Level 5", label: "Entrance 11",                anchor_type: "entrance" },
    { floor_label: "Level 5", label: "Entrance 12",                anchor_type: "entrance" },
    { floor_label: "Level 5", label: "Entrance 22",                anchor_type: "entrance" },
    { floor_label: "Level 5", label: "Entrance 23",                anchor_type: "entrance" },
    { floor_label: "Level 5", label: "Entrance 24",                anchor_type: "entrance" },
    { floor_label: "Level 5", label: "Level 5 North West Parking", anchor_type: "parking"  },
    { floor_label: "Level 5", label: "Level 5 North East Parking", anchor_type: "parking"  },
    { floor_label: "Level 5", label: "Level 5 South East Parking", anchor_type: "parking"  },
    { floor_label: "Level 5", label: "Level 5 South West Parking", anchor_type: "parking"  },
  ],
};

router.post("/seed-map-anchors", async (req: Request, res: Response) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const { mall_id, preset } = req.body as { mall_id: unknown; preset: unknown };

  if (!mall_id || typeof mall_id !== "string" || !mall_id.trim()) {
    return res.status(400).json({ error: "mall_id is required" });
  }
  if (!preset || typeof preset !== "string" || !preset.trim()) {
    return res.status(400).json({
      error: `preset is required. Available: ${Object.keys(MAP_ANCHOR_PRESETS).join(", ")}`,
    });
  }

  const anchors = MAP_ANCHOR_PRESETS[preset];
  if (!anchors) {
    return res.status(400).json({
      error: `Unknown preset "${preset}". Available: ${Object.keys(MAP_ANCHOR_PRESETS).join(", ")}`,
    });
  }

  const rows = anchors.map((a) => ({
    mall_id:          mall_id.trim(),
    map_asset_id:     null,
    floor_label:      a.floor_label,
    label:            a.label,
    anchor_type:      a.anchor_type,
    confidence_score: 0.0,
    source_note:      "preset seed",
    review_status:    "pending",
  }));

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("mall_manual_map_anchors_staged")
    .upsert(rows, { onConflict: "mall_id,floor_label,label", ignoreDuplicates: true })
    .select();

  if (error) return res.status(500).json({ error: error.message });

  fireAuditLog(admin.user.id, "mall_map_anchors_seeded", {
    mall_id: mall_id.trim(), preset, inserted: (data ?? []).length,
  });

  return res.json({
    ok:              true,
    preset,
    total_in_preset: rows.length,
    inserted:        (data ?? []).length,
    skipped:         rows.length - (data ?? []).length,
  });
});

export default router;
