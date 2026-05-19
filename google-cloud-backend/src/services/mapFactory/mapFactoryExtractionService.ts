/**
 * mapFactoryExtractionService.ts — Sprint 15
 *
 * Three-layer AI extraction for Map Factory assets:
 *   Layer 1 — Anchor extraction (shops, entrances, parking, landmarks)
 *   Layer 2 — Corridor node extraction
 *   Layer 3 — Layout hint extraction (floor shape, dimensions, orientation)
 *
 * Delegates to the existing MapImageExtractionProvider abstraction (Sprint 14B).
 * Records each extraction in map_factory_extractions.
 */

import { getMapImageExtractionProvider } from "../mapImageExtractionService.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface FactoryExtractionParams {
  jobId:          string;
  mallId:         string;
  assetId:        string;
  assetUrl:       string;
  floorLabel:     string;
  provider?:      string;   // defaults to "mock"
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase:       any;
}

export interface FactoryExtractionResult {
  ok:               boolean;
  extractionRowId?: string;
  anchorsFound:     number;
  corridorsFound:   number;
  warnings:         string[];
  error?:           string;
}

// ── Extract a single asset ────────────────────────────────────────────────────

export async function extractAsset(params: FactoryExtractionParams): Promise<FactoryExtractionResult> {
  const { jobId, mallId, assetId, assetUrl, floorLabel, provider = "mock", supabase } = params;

  try {
    // Layer 1 + 2: use existing provider abstraction in "full" mode
    const extractionProvider = getMapImageExtractionProvider(provider);
    const result = await extractionProvider.extract({
      asset_url:       assetUrl,
      floor_label:     floorLabel,
      extraction_mode: "full",
      mall_id:         mallId,
    });

    // Persist extraction record
    const { data: row, error: insertErr } = await supabase
      .from("map_factory_extractions")
      .insert({
        job_id:             jobId,
        asset_id:           assetId,
        mall_id:            mallId,
        floor_label:        floorLabel,
        provider:           provider,
        extraction_mode:    "full",
        detected_anchors:   result.detected_anchors,
        detected_corridors: result.detected_corridors,
        warnings:           result.warnings,
        anchors_saved:      result.detected_anchors.length,
        anchors_skipped:    0,
        status:             "complete",
      })
      .select("id")
      .single();

    if (insertErr) return {
      ok: false, anchorsFound: 0, corridorsFound: 0, warnings: result.warnings,
      error: insertErr.message,
    };

    // Mark asset's source as extracted
    await supabase
      .from("map_factory_sources")
      .update({ status: "extracted" })
      .eq("job_id", jobId)
      .eq("asset_id", assetId);

    return {
      ok:               true,
      extractionRowId:  row.id,
      anchorsFound:     result.detected_anchors.length,
      corridorsFound:   result.detected_corridors.length,
      warnings:         result.warnings,
    };

  } catch (err) {
    const errMsg = String(err);

    // Record failed extraction
    await supabase.from("map_factory_extractions").insert({
      job_id:          jobId,
      asset_id:        assetId,
      mall_id:         mallId,
      floor_label:     floorLabel,
      provider:        provider,
      extraction_mode: "full",
      status:          "failed",
      error_message:   errMsg,
    });

    return { ok: false, anchorsFound: 0, corridorsFound: 0, warnings: [], error: errMsg };
  }
}

/**
 * Extract all pending assets for a job.
 */
export async function extractAllAssetsForJob(
  jobId:    string,
  mallId:   string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
): Promise<{ total: number; extracted: number; failed: number; warnings: string[] }> {
  const { data: assets, error } = await supabase
    .from("map_factory_assets")
    .select("id, asset_url, floor_label")
    .eq("job_id", jobId)
    .eq("harvest_status", "complete");

  if (error) throw new Error(`extractAllAssetsForJob: ${error.message}`);

  let extracted = 0, failed = 0;
  const allWarnings: string[] = [];

  for (const asset of (assets ?? [])) {
    const result = await extractAsset({
      jobId, mallId,
      assetId:    asset.id,
      assetUrl:   asset.asset_url,
      floorLabel: asset.floor_label ?? "unknown",
      supabase,
    });
    if (result.ok) extracted++;
    else failed++;
    allWarnings.push(...result.warnings);
  }

  return { total: (assets ?? []).length, extracted, failed, warnings: allWarnings };
}
