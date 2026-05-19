/**
 * mapFactoryExtractionService.ts — Sprint 16
 *
 * Three-layer AI extraction for Map Factory assets:
 *   Layer 1 — Anchor extraction (shops, entrances, parking, landmarks)
 *   Layer 2 — Corridor node extraction
 *   Layer 3 — Layout hint extraction (floor shape, dimensions, orientation)
 *
 * Sprint 16 additions:
 *   • Provider chain: tries configured providers in order; falls back to mock
 *   • Extraction caching: skips re-extraction when content_hash + provider match
 *   • Stores provider_used, provider_chain, content_hash, extraction_version
 *   • forceExtract flag to bypass cache
 *   • Standard disclaimer warnings on every extraction
 */

import { getMapImageExtractionProvider, type ExtractionResult } from "../mapImageExtractionService.js";
import { runGeminiVisionExtraction, runVisionOcr }              from "./googleAiProviderService.js";
import { getExtractionProviderChain }                           from "./mapFactoryProviderRegistry.js";

// ── Standard warnings appended to every extraction ───────────────────────────

const STANDARD_WARNINGS = [
  "AI extraction is approximate — verify anchors against official mall directory before publishing.",
  "Customer-facing navigation uses the generated MallMind floor plan, not the raw source asset.",
];

function maybeAddGoogleAiWarning(warnings: string[], providerUsed: string): string[] {
  if (providerUsed === "mock") {
    return [
      "Google AI provider not configured; using mock extraction. Set MAP_FACTORY_ENABLE_GOOGLE_AI=true and GEMINI_API_KEY to enable real extraction.",
      ...warnings,
      ...STANDARD_WARNINGS,
    ];
  }
  return [...warnings, ...STANDARD_WARNINGS];
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface FactoryExtractionParams {
  jobId:          string;
  mallId:         string;
  assetId:        string;
  assetUrl:       string;
  floorLabel:     string;
  provider?:      string;      // overrides provider chain selection
  forceExtract?:  boolean;     // bypass cache even when content_hash matches
  contentHash?:   string;      // SHA-256 of asset bytes (supplied by harvest stage)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase:       any;
}

export interface FactoryExtractionResult {
  ok:               boolean;
  extractionRowId?: string;
  anchorsFound:     number;
  corridorsFound:   number;
  warnings:         string[];
  providerUsed?:    string;
  cacheHit?:        boolean;
  error?:           string;
}

// ── Provider chain runner ─────────────────────────────────────────────────────

/**
 * Run the provider chain in order, returning the first successful result.
 * Falls back to "mock" if all configured providers fail.
 */
async function runProviderChain(
  assetUrl:     string,
  floorLabel:   string,
  mimeType?:    string,
  explicitProvider?: string,
): Promise<{ result: ExtractionResult; providerUsed: string; providerChain: string[] }> {
  // If an explicit provider was requested, use only that one (+ mock fallback)
  const chain = explicitProvider && explicitProvider !== "auto"
    ? [explicitProvider, "mock"]
    : getExtractionProviderChain(mimeType);

  const attempted: string[] = [];

  for (const providerName of chain) {
    attempted.push(providerName);

    try {
      if (providerName === "gemini_vision_extraction") {
        const r = await runGeminiVisionExtraction(assetUrl, floorLabel);
        if (r.status === "ok" && r.data) {
          // Map GeminiExtractionResult → ExtractionResult
          const extraction: ExtractionResult = {
            floor_label:        r.data.floor_label ?? floorLabel,
            detected_anchors:   r.data.detected_anchors,
            detected_corridors: r.data.detected_corridors,
            warnings:           [],
            provider:           providerName,
          };
          return { result: extraction, providerUsed: providerName, providerChain: attempted };
        }
        if (r.status === "not_configured") {
          // Skip silently to next
          continue;
        }
        // error — log and continue
        console.warn(`[mapFactoryExtraction] ${providerName} error: ${r.error}`);
        continue;
      }

      if (providerName === "google_vision_ocr") {
        const r = await runVisionOcr(assetUrl);
        if (r.status === "ok" && r.data) {
          // Vision OCR gives us text but not structured anchors.
          // Wrap the full_text as a single info warning; fall through to mock for actual anchors.
          // In a future sprint this could be parsed for store names.
          console.info(`[mapFactoryExtraction] google_vision_ocr OK — ${r.data.text_blocks.length} text blocks; falling through to mock for anchor structure.`);
          continue; // let mock run next to produce structured anchors
        }
        if (r.status === "not_configured") continue;
        console.warn(`[mapFactoryExtraction] ${providerName} error: ${r.error}`);
        continue;
      }

      // "mock" or any registered MapImageExtractionProvider
      const provider = getMapImageExtractionProvider(providerName);
      const mockResult = await provider.extract({
        asset_url:       assetUrl,
        floor_label:     floorLabel,
        extraction_mode: "full",
      });
      return { result: mockResult, providerUsed: providerName, providerChain: attempted };

    } catch (err) {
      console.warn(`[mapFactoryExtraction] ${providerName} threw: ${String(err)}`);
    }
  }

  // Unconditional final fallback — "mock" always succeeds
  const mockProvider = getMapImageExtractionProvider("mock");
  const fallbackResult = await mockProvider.extract({
    asset_url:       assetUrl,
    floor_label:     floorLabel,
    extraction_mode: "full",
  });
  return {
    result:       fallbackResult,
    providerUsed: "mock",
    providerChain: [...attempted, "mock"],
  };
}

// ── Extract a single asset ────────────────────────────────────────────────────

export async function extractAsset(params: FactoryExtractionParams): Promise<FactoryExtractionResult> {
  const {
    jobId, mallId, assetId, assetUrl, floorLabel,
    provider,
    forceExtract = false,
    contentHash,
    supabase,
  } = params;

  try {
    // ── Cache check ──────────────────────────────────────────────────────────
    // Skip re-extraction when the same asset+provider previously succeeded.
    if (!forceExtract && contentHash) {
      const { data: cached } = await supabase
        .from("map_factory_extractions")
        .select("id, provider_used, anchors_saved, warnings")
        .eq("job_id",       jobId)
        .eq("content_hash", contentHash)
        .eq("status",       "complete")
        .maybeSingle();

      if (cached) {
        return {
          ok:              true,
          extractionRowId: cached.id,
          anchorsFound:    cached.anchors_saved ?? 0,
          corridorsFound:  0,
          warnings:        cached.warnings ?? [],
          providerUsed:    cached.provider_used ?? "mock",
          cacheHit:        true,
        };
      }
    }

    // ── Run provider chain ───────────────────────────────────────────────────
    const { result, providerUsed, providerChain } = await runProviderChain(
      assetUrl, floorLabel, undefined, provider,
    );

    const warnings = maybeAddGoogleAiWarning(result.warnings, providerUsed);

    // ── Persist extraction record ────────────────────────────────────────────
    const { data: row, error: insertErr } = await supabase
      .from("map_factory_extractions")
      .insert({
        job_id:              jobId,
        asset_id:            assetId,
        mall_id:             mallId,
        floor_label:         floorLabel,
        provider:            providerUsed,
        provider_used:       providerUsed,
        provider_chain:      providerChain,
        extraction_mode:     "full",
        detected_anchors:    result.detected_anchors,
        detected_corridors:  result.detected_corridors,
        warnings:            warnings,
        anchors_saved:       result.detected_anchors.length,
        anchors_skipped:     0,
        content_hash:        contentHash ?? null,
        extraction_version:  1,
        status:              "complete",
      })
      .select("id")
      .single();

    if (insertErr) return {
      ok: false, anchorsFound: 0, corridorsFound: 0, warnings,
      error: insertErr.message,
    };

    // Mark asset's source as extracted
    await supabase
      .from("map_factory_sources")
      .update({ status: "extracted" })
      .eq("job_id",   jobId)
      .eq("asset_id", assetId);

    return {
      ok:              true,
      extractionRowId: row.id,
      anchorsFound:    result.detected_anchors.length,
      corridorsFound:  result.detected_corridors.length,
      warnings,
      providerUsed,
      cacheHit:        false,
    };

  } catch (err) {
    const errMsg = String(err);

    // Record failed extraction
    await supabase.from("map_factory_extractions").insert({
      job_id:          jobId,
      asset_id:        assetId,
      mall_id:         mallId,
      floor_label:     floorLabel,
      provider:        provider ?? "mock",
      provider_used:   provider ?? "mock",
      provider_chain:  [provider ?? "mock"],
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
    .select("id, asset_url, floor_label, content_hash")
    .eq("job_id",          jobId)
    .eq("harvest_status",  "complete");

  if (error) throw new Error(`extractAllAssetsForJob: ${error.message}`);

  let extracted = 0, failed = 0;
  const allWarnings: string[] = [];

  for (const asset of (assets ?? [])) {
    const result = await extractAsset({
      jobId, mallId,
      assetId:     asset.id,
      assetUrl:    asset.asset_url,
      floorLabel:  asset.floor_label ?? "unknown",
      contentHash: asset.content_hash ?? undefined,
      supabase,
    });
    if (result.ok) extracted++;
    else failed++;
    allWarnings.push(...result.warnings);
  }

  return { total: (assets ?? []).length, extracted, failed, warnings: allWarnings };
}
