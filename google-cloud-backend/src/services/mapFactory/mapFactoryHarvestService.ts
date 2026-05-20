/**
 * mapFactoryHarvestService.ts — Sprint 15
 *
 * Fetches, hashes, and deduplicates raw evidence assets for a Map Factory job.
 *
 * Design notes:
 *  - Content hashing (SHA-256) prevents reprocessing the same bytes twice.
 *  - In production, image/PDF bytes would be downloaded and stored in Supabase Storage.
 *  - This mock implementation simulates the harvest without real HTTP fetches.
 *  - The service records harvest results in map_factory_assets.
 */

import crypto from "crypto";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface HarvestParams {
  jobId:       string;
  mallId:      string;
  sourceId:    string;
  url:         string | null;
  assetId?:    string | null;   // existing mall_map_assets row — no fetch needed
  floorLabel?: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase:    any;
}

export interface HarvestResult {
  ok:           boolean;
  assetRowId:   string | null;
  hash:         string | null;
  duplicate:    boolean;
  error?:       string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function hashString(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

/**
 * Mock "fetch" — in production this would download the real bytes from the URL.
 * Returns a deterministic stub so the pipeline can proceed end-to-end.
 */
function mockFetchContent(url: string): { mimeType: string; sizeBytes: number; contentHash: string } {
  const lower = url.toLowerCase();
  const mimeType = lower.endsWith(".pdf") ? "application/pdf"
    : lower.endsWith(".svg")              ? "image/svg+xml"
    : lower.endsWith(".png")             ? "image/png"
    :                                      "image/jpeg";
  const sizeBytes = 200_000 + (url.length * 317);   // deterministic stub size
  const contentHash = hashString(url);               // stable hash from URL
  return { mimeType, sizeBytes, contentHash };
}

// ── Main harvest function ─────────────────────────────────────────────────────

export async function harvestSource(params: HarvestParams): Promise<HarvestResult> {
  const { jobId, mallId, sourceId, url, assetId, floorLabel, supabase } = params;

  try {
    // Case 1: already an existing mall_map_assets row — register directly, no fetch
    if (assetId) {
      const { data: existing, error: assetErr } = await supabase
        .from("mall_map_assets")
        .select("id, asset_url, asset_type")
        .eq("id", assetId)
        .single();

      if (assetErr || !existing) {
        return { ok: false, assetRowId: null, hash: null, duplicate: false, error: `Asset ${assetId} not found` };
      }

      const hash = hashString(existing.asset_url);

      // Dedup check within this job
      const { data: dupRow } = await supabase
        .from("map_factory_assets")
        .select("id")
        .eq("job_id", jobId)
        .eq("hash", hash)
        .maybeSingle();

      if (dupRow) return { ok: true, assetRowId: dupRow.id, hash, duplicate: true };

      const { data: inserted, error: insertErr } = await supabase
        .from("map_factory_assets")
        .insert({
          job_id:         jobId,
          source_id:      sourceId,
          mall_id:        mallId,
          asset_url:      existing.asset_url,
          asset_type:     existing.asset_type ?? "image",
          floor_label:    floorLabel ?? null,
          hash,
          harvest_status: "complete",
        })
        .select("id")
        .single();

      if (insertErr) return { ok: false, assetRowId: null, hash: null, duplicate: false, error: insertErr.message };
      return { ok: true, assetRowId: inserted.id, hash, duplicate: false };
    }

    // Case 2: URL-based source — mock fetch + dedup
    if (!url) return { ok: false, assetRowId: null, hash: null, duplicate: false, error: "No URL or assetId provided" };

    const { mimeType, sizeBytes, contentHash } = mockFetchContent(url);

    // Dedup check across all jobs for this mall
    const { data: dupRow } = await supabase
      .from("map_factory_assets")
      .select("id")
      .eq("mall_id", mallId)
      .eq("hash", contentHash)
      .maybeSingle();

    if (dupRow) return { ok: true, assetRowId: dupRow.id, hash: contentHash, duplicate: true };

    const lower = url.toLowerCase();
    const assetType = mimeType === "application/pdf" ? "pdf"
      : mimeType === "image/svg+xml"                ? "svg"
      :                                               "image";

    const { data: inserted, error: insertErr } = await supabase
      .from("map_factory_assets")
      .insert({
        job_id:          jobId,
        source_id:       sourceId,
        mall_id:         mallId,
        asset_url:       url,
        asset_type:      assetType,
        mime_type:       mimeType,
        file_size_bytes: sizeBytes,
        floor_label:     floorLabel ?? null,
        hash:            contentHash,
        harvest_status:  "complete",
      })
      .select("id")
      .single();

    if (insertErr) return { ok: false, assetRowId: null, hash: null, duplicate: false, error: insertErr.message };

    // Mark the source as harvested
    await supabase
      .from("map_factory_sources")
      .update({ status: "harvested" })
      .eq("id", sourceId);

    void lower; // suppress unused lint warning for the variable shadowed from outer scope
    return { ok: true, assetRowId: inserted.id, hash: contentHash, duplicate: false };

  } catch (err) {
    return { ok: false, assetRowId: null, hash: null, duplicate: false, error: String(err) };
  }
}

/**
 * Harvest all sources for a job in one pass.
 * Returns a summary: { total, harvested, skipped, failed }.
 */
export async function harvestAllSourcesForJob(
  jobId:    string,
  mallId:   string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
): Promise<{ total: number; harvested: number; skipped: number; failed: number; errors: string[] }> {
  const { data: sources, error } = await supabase
    .from("map_factory_sources")
    .select("id, url, asset_id, status")
    .eq("job_id", jobId)
    .in("status", ["discovered", "extraction_queued"]);

  if (error) throw new Error(`harvestAllSourcesForJob: ${error.message}`);

  let harvested = 0, skipped = 0, failed = 0;
  const errors: string[] = [];

  for (const src of (sources ?? [])) {
    const result = await harvestSource({
      jobId, mallId,
      sourceId:  src.id,
      url:       src.url,
      assetId:   src.asset_id,
      supabase,
    });

    if (!result.ok) {
      failed++;
      errors.push(`source ${src.id}: ${result.error}`);
    } else if (result.duplicate) {
      skipped++;
    } else {
      harvested++;
    }
  }

  return { total: (sources ?? []).length, harvested, skipped, failed, errors };
}
