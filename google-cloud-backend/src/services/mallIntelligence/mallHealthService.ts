/**
 * mallHealthService.ts — Sprint 12D.3
 *
 * Aggregates staging-table data for a single mall and returns a structured
 * health report that replaces manual SQL checks after each sprint.
 *
 * Policy:
 *   - READ-ONLY: no writes to any table
 *   - All queries target the five staging tables from migration 013
 *   - mall_id is optional: pass undefined to get an across-all-malls view
 */

import type { SupabaseClient } from "@supabase/supabase-js";

// ── Types ─────────────────────────────────────────────────────────────────────

export type ReadinessStatus = "ready" | "partial" | "blocked";

export interface MallHealthReport {
  mall_id:                        string | null;
  generated_at:                   string;

  // ── Staged store locations ──────────────────────────────────────────────────
  total_staged_stores:            number;
  stores_by_status:               Record<string, number>;
  stores_with_floor_label:        number;
  stores_missing_floor_label:     number;
  stores_with_coordinates:        number;
  accepted_stores:                number;
  accepted_stores_missing_coords: number;

  // ── Route nodes ─────────────────────────────────────────────────────────────
  route_nodes_staged:             number;
  route_nodes_with_coordinates:   number;

  // ── Map assets ──────────────────────────────────────────────────────────────
  map_assets_total:               number;
  map_assets_image:               number;
  map_assets_image_missing_dims:  number;
  duplicate_asset_url_groups:     number;

  // ── Sources ─────────────────────────────────────────────────────────────────
  sources_linked:                 number;
  sources_missing_mall_id:        number;

  // ── Summary ─────────────────────────────────────────────────────────────────
  warnings:                       string[];
  readiness_status:               ReadinessStatus;
  next_recommended_action:        string;
}

// ── Readiness logic ───────────────────────────────────────────────────────────

/**
 * Derive readiness_status and next_recommended_action from the raw counts.
 * Pure function — no DB access.
 */
export function deriveReadiness(report: Omit<MallHealthReport,
  "readiness_status" | "next_recommended_action" | "generated_at">
): Pick<MallHealthReport, "readiness_status" | "next_recommended_action"> {

  // BLOCKED conditions — hard stops
  if (report.total_staged_stores === 0) {
    return {
      readiness_status:        "blocked",
      next_recommended_action: "No stores staged. Run GeoDirectory import or Extract Stores on a source.",
    };
  }

  if (report.accepted_stores === 0) {
    return {
      readiness_status:        "blocked",
      next_recommended_action:
        `${report.total_staged_stores} stores staged but none accepted. ` +
        "Review staged locations and accept at least one anchor store.",
    };
  }

  if (report.route_nodes_staged === 0) {
    return {
      readiness_status:        "blocked",
      next_recommended_action:
        `${report.accepted_stores} accepted store(s) but no route nodes. ` +
        "Run 'Stage Route Nodes' in the Coordinate Placement section.",
    };
  }

  // PARTIAL conditions — progress made but gaps remain
  const missingFloorPct =
    report.total_staged_stores > 0
      ? report.stores_missing_floor_label / report.total_staged_stores
      : 0;

  const nodesPlacedPct =
    report.route_nodes_staged > 0
      ? report.route_nodes_with_coordinates / report.route_nodes_staged
      : 0;

  if (report.accepted_stores_missing_coords > 0) {
    return {
      readiness_status:        "partial",
      next_recommended_action:
        `${report.accepted_stores_missing_coords} accepted store(s) missing map coordinates. ` +
        "Use the Coordinate Placement tool to pin them on the floor map.",
    };
  }

  if (nodesPlacedPct < 1) {
    const placed  = report.route_nodes_with_coordinates;
    const total   = report.route_nodes_staged;
    return {
      readiness_status:        "partial",
      next_recommended_action:
        `${placed}/${total} route nodes have coordinates. ` +
        "Pin the remaining nodes on the floor map.",
    };
  }

  if (report.map_assets_image_missing_dims > 0) {
    return {
      readiness_status:        "partial",
      next_recommended_action:
        `${report.map_assets_image_missing_dims} image asset(s) missing pixel dimensions. ` +
        "Re-run 'Scan Website' so the dimension enrichment step fetches them.",
    };
  }

  if (missingFloorPct > 0.3) {
    const n = report.stores_missing_floor_label;
    return {
      readiness_status:        "partial",
      next_recommended_action:
        `${n} stores (${Math.round(missingFloorPct * 100)}%) are missing floor labels. ` +
        "Review staged locations and assign floor labels.",
    };
  }

  // READY — all critical fields populated
  return {
    readiness_status:        "ready",
    next_recommended_action:
      "Mall data looks complete. Proceed to Sprint 13 route graph construction.",
  };
}

// ── Main aggregator ───────────────────────────────────────────────────────────

/**
 * Run all health queries for a mall and return the structured report.
 *
 * @param mallId  UUID of the mall to check, or null for a cross-mall view.
 * @param supabase Supabase client with service-role key (read-only queries).
 */
export async function getMallHealth(
  mallId:   string | null,
  supabase: SupabaseClient,
): Promise<MallHealthReport> {
  const warnings: string[] = [];

  // ── Helper to build a query filtered by mall_id ───────────────────────────
  function forMall(table: string, columns: string) {
    let q = supabase.from(table).select(columns);
    if (mallId) q = q.eq("mall_id", mallId);
    return q;
  }

  // ── 1. Staged store locations ─────────────────────────────────────────────
  const { data: allStores, error: storesErr } = await forMall(
    "mall_store_locations_staged",
    "review_status, floor_label, x_percent, y_percent",
  );

  if (storesErr) warnings.push(`Stores query failed: ${storesErr.message}`);

  const stores = (allStores ?? []) as unknown as Array<{
    review_status: string;
    floor_label:   string | null;
    x_percent:     number | null;
    y_percent:     number | null;
  }>;

  const storesByStatus: Record<string, number> = {};
  for (const s of stores) {
    storesByStatus[s.review_status] = (storesByStatus[s.review_status] ?? 0) + 1;
  }

  const totalStaged             = stores.length;
  const withFloor               = stores.filter((s) => s.floor_label != null && s.floor_label !== "").length;
  const missingFloor            = totalStaged - withFloor;
  const withCoords              = stores.filter((s) => s.x_percent != null && s.y_percent != null).length;
  const acceptedStores          = storesByStatus["accepted"] ?? 0;
  const acceptedMissingCoords   = stores.filter(
    (s) => s.review_status === "accepted" && (s.x_percent == null || s.y_percent == null),
  ).length;

  // ── 2. Route nodes ────────────────────────────────────────────────────────
  const { data: allNodes, error: nodesErr } = await forMall(
    "mall_route_nodes_staged",
    "x_percent, y_percent",
  );

  if (nodesErr) warnings.push(`Route nodes query failed: ${nodesErr.message}`);

  const nodes = (allNodes ?? []) as unknown as Array<{ x_percent: number | null; y_percent: number | null }>;
  const routeNodesStaged          = nodes.length;
  const routeNodesWithCoords      = nodes.filter((n) => n.x_percent != null && n.y_percent != null).length;

  // ── 3. Map assets ─────────────────────────────────────────────────────────
  const { data: allAssets, error: assetsErr } = await forMall(
    "mall_map_assets",
    "asset_type, asset_url, page_width_px, page_height_px",
  );

  if (assetsErr) warnings.push(`Assets query failed: ${assetsErr.message}`);

  const mapAssets = (allAssets ?? []) as unknown as Array<{
    asset_type:    string;
    asset_url:     string;
    page_width_px: number | null;
    page_height_px:number | null;
  }>;

  const imageAssets         = mapAssets.filter((a) => a.asset_type === "image");
  const imageMissingDims    = imageAssets.filter((a) => a.page_width_px == null).length;

  // Detect duplicate asset URLs (same URL saved more than once)
  const urlCounts = new Map<string, number>();
  for (const a of mapAssets) {
    urlCounts.set(a.asset_url, (urlCounts.get(a.asset_url) ?? 0) + 1);
  }
  const duplicateGroups = [...urlCounts.values()].filter((c) => c > 1).length;
  if (duplicateGroups > 0) {
    warnings.push(
      `${duplicateGroups} duplicate asset URL group(s) detected — consider deduplication.`,
    );
  }

  // ── 4. Sources ────────────────────────────────────────────────────────────
  //
  // "sources_linked" = sources that have mall_id = this mall (or all sources
  //   when no mall_id filter is applied).
  // "sources_missing_mall_id" = sources with mall_id IS NULL (always across-all).

  const { data: linkedSources, error: srcLinkedErr } = mallId
    ? await supabase.from("mall_sources").select("id").eq("mall_id", mallId)
    : await supabase.from("mall_sources").select("id");

  if (srcLinkedErr) warnings.push(`Sources query failed: ${srcLinkedErr.message}`);

  const { data: orphanSources, error: srcOrphanErr } = await supabase
    .from("mall_sources")
    .select("id")
    .is("mall_id", null);

  if (srcOrphanErr) warnings.push(`Orphan sources query failed: ${srcOrphanErr.message}`);

  const sourcesLinked      = (linkedSources ?? []).length;
  const sourcesMissingMall = (orphanSources ?? []).length;

  if (sourcesMissingMall > 0) {
    warnings.push(
      `${sourcesMissingMall} source(s) have no mall_id — link them via Discover Sources.`,
    );
  }

  // ── 5. Assemble partial report then derive readiness ──────────────────────
  const partial = {
    mall_id:                        mallId,
    total_staged_stores:            totalStaged,
    stores_by_status:               storesByStatus,
    stores_with_floor_label:        withFloor,
    stores_missing_floor_label:     missingFloor,
    stores_with_coordinates:        withCoords,
    accepted_stores:                acceptedStores,
    accepted_stores_missing_coords: acceptedMissingCoords,
    route_nodes_staged:             routeNodesStaged,
    route_nodes_with_coordinates:   routeNodesWithCoords,
    map_assets_total:               mapAssets.length,
    map_assets_image:               imageAssets.length,
    map_assets_image_missing_dims:  imageMissingDims,
    duplicate_asset_url_groups:     duplicateGroups,
    sources_linked:                 sourcesLinked,
    sources_missing_mall_id:        sourcesMissingMall,
    warnings,
  };

  const { readiness_status, next_recommended_action } = deriveReadiness(partial);

  return {
    ...partial,
    generated_at:            new Date().toISOString(),
    readiness_status,
    next_recommended_action,
  };
}
