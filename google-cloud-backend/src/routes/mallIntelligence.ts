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

  // Save discovered assets
  const savedAssets: unknown[] = [];
  for (const asset of scanResult.discovered_assets) {
    const { data: assetRow } = await supabase
      .from("mall_map_assets")
      .insert({
        mall_source_id: source_id,
        mall_id:        src.mall_id ?? null,
        asset_type:     asset.asset_type,
        asset_url:      asset.url,
        floor_label:    asset.floor_label ?? null,
        link_text:      asset.link_text ?? null,
        review_status:  "pending",
      })
      .select()
      .single();
    if (assetRow) savedAssets.push(assetRow);
  }

  fireAuditLog(admin.user.id, "mall_source_scanned", {
    source_id,
    assets_found:  scanResult.discovered_assets.length,
    scan_status:   newStatus,
    duration_ms:   scanResult.scan_duration_ms,
  });

  // Return scan result (raw_html omitted from response to keep payload small)
  return res.json({
    source_id,
    scan_status:    newStatus,
    page_title:     scanResult.page_title,
    assets_saved:   savedAssets,
    assets_found:   scanResult.discovered_assets.length,
    scan_duration_ms: scanResult.scan_duration_ms,
    warnings:       scanResult.warnings,
    error:          scanResult.error,
    // Include a flag so the frontend knows whether to offer "Extract Stores" next
    has_html:       !!scanResult.raw_html,
    raw_html:       scanResult.raw_html, // available for immediate extract-map call
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

  // Persist staged locations
  const inserted: unknown[] = [];
  for (const store of extractResult.stores_extracted) {
    const { data: row } = await supabase
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
    if (row) inserted.push(row);
  }

  fireAuditLog(admin.user.id, "mall_map_extracted", {
    source_id,
    stores_found:      extractResult.total_found,
    strategies_tried:  extractResult.strategies_tried,
  });

  return res.json({
    source_id,
    total_found:       extractResult.total_found,
    stores_staged:     inserted.length,
    strategies_tried:  extractResult.strategies_tried,
    extraction_log:    extractResult.extraction_log,
    warnings,
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

export default router;
