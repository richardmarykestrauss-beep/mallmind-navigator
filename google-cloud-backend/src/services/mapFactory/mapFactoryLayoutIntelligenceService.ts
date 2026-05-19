/**
 * mapFactoryLayoutIntelligenceService.ts — Sprint 15
 *
 * Merges evidence from multiple extractions into a unified layout model.
 * Handles:
 *  - Confidence-weighted anchor merging (same label across multiple sources)
 *  - Conflict detection (same label, significantly different coordinates)
 *  - Coverage scoring (% of expected anchor types present)
 *
 * Records the merged model in map_factory_layout_models.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

interface RawAnchor {
  label:            string;
  anchor_type:      string;
  x_percent:        number | null;
  y_percent:        number | null;
  confidence_score: number;
  source_note?:     string;
}

export interface MergedAnchor {
  label:            string;
  anchor_type:      string;
  x_percent:        number | null;
  y_percent:        number | null;
  merged_confidence: number;
  source_count:     number;
  conflicts:        ConflictNote[];
}

export interface ConflictNote {
  label:      string;
  field:      "x_percent" | "y_percent";
  values:     number[];
  delta:      number;
  severity:   "low" | "medium" | "high";
}

export interface LayoutMergeResult {
  ok:             boolean;
  layoutModelId?: string;
  mergedCount:    number;
  conflictCount:  number;
  coverageScore:  number;
  error?:         string;
}

// ── Conflict threshold ────────────────────────────────────────────────────────
// Coordinates differing by more than this % are flagged as a conflict.
const CONFLICT_THRESHOLD_LOW    = 5;   // % difference → low severity
const CONFLICT_THRESHOLD_MEDIUM = 15;  // % difference → medium severity
const CONFLICT_THRESHOLD_HIGH   = 30;  // % difference → high severity

// Expected anchor types for a "complete" floor plan (coverage score denominator)
const EXPECTED_ANCHOR_TYPES = ["shop", "entrance", "parking", "lift", "escalator"];

// ── Merge logic ───────────────────────────────────────────────────────────────

function mergeAnchors(allAnchors: RawAnchor[]): { merged: MergedAnchor[]; conflicts: ConflictNote[] } {
  const byLabel = new Map<string, RawAnchor[]>();

  for (const anchor of allAnchors) {
    const key = anchor.label.toLowerCase().trim();
    if (!byLabel.has(key)) byLabel.set(key, []);
    byLabel.get(key)!.push(anchor);
  }

  const merged: MergedAnchor[] = [];
  const conflicts: ConflictNote[] = [];

  for (const [, anchors] of byLabel) {
    const first = anchors[0];

    // Weighted average of coordinates
    let totalWeight = 0;
    let sumX = 0, sumY = 0;
    for (const a of anchors) {
      const w = a.confidence_score;
      totalWeight += w;
      if (a.x_percent != null) sumX += a.x_percent * w;
      if (a.y_percent != null) sumY += a.y_percent * w;
    }
    const avgX = totalWeight > 0 ? sumX / totalWeight : null;
    const avgY = totalWeight > 0 ? sumY / totalWeight : null;

    // Conflict detection
    const anchorConflicts: ConflictNote[] = [];
    if (anchors.length > 1) {
      const xVals = anchors.map((a) => a.x_percent).filter((v) => v != null) as number[];
      const yVals = anchors.map((a) => a.y_percent).filter((v) => v != null) as number[];

      for (const [field, vals] of [["x_percent", xVals], ["y_percent", yVals]] as const) {
        if (vals.length < 2) continue;
        const min = Math.min(...vals), max = Math.max(...vals);
        const delta = max - min;
        if (delta >= CONFLICT_THRESHOLD_LOW) {
          anchorConflicts.push({
            label: first.label,
            field,
            values: vals,
            delta,
            severity: delta >= CONFLICT_THRESHOLD_HIGH   ? "high"
                    : delta >= CONFLICT_THRESHOLD_MEDIUM  ? "medium"
                    :                                       "low",
          });
          conflicts.push(...anchorConflicts.slice(-1));
        }
      }
    }

    const avgConfidence = anchors.reduce((s, a) => s + a.confidence_score, 0) / anchors.length;

    merged.push({
      label:             first.label,
      anchor_type:       first.anchor_type,
      x_percent:         avgX,
      y_percent:         avgY,
      merged_confidence: Math.min(avgConfidence * (1 + (anchors.length - 1) * 0.05), 0.99),
      source_count:      anchors.length,
      conflicts:         anchorConflicts,
    });
  }

  return { merged, conflicts };
}

function computeCoverageScore(merged: MergedAnchor[]): number {
  const presentTypes = new Set(merged.map((a) => a.anchor_type));
  const presentExpected = EXPECTED_ANCHOR_TYPES.filter((t) => presentTypes.has(t));
  const typeScore = (presentExpected.length / EXPECTED_ANCHOR_TYPES.length) * 60;

  // Count score: reward having 10+ anchors
  const countScore = Math.min((merged.length / 10) * 40, 40);

  return Math.round(typeScore + countScore);
}

// ── Main function ─────────────────────────────────────────────────────────────

export async function buildLayoutModel(
  jobId:       string,
  mallId:      string,
  floorLabel:  string | null,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase:    any,
): Promise<LayoutMergeResult> {
  try {
    // Load all extractions for this job (optionally filtered by floor)
    let query = supabase
      .from("map_factory_extractions")
      .select("detected_anchors, detected_corridors")
      .eq("job_id", jobId)
      .eq("status", "complete");

    if (floorLabel) query = query.eq("floor_label", floorLabel);

    const { data: extractions, error } = await query;
    if (error) throw new Error(error.message);

    // Collect all anchors across all extractions
    const allAnchors: RawAnchor[] = [];
    for (const ext of (extractions ?? [])) {
      if (Array.isArray(ext.detected_anchors)) {
        allAnchors.push(...(ext.detected_anchors as RawAnchor[]));
      }
    }

    const { merged, conflicts } = mergeAnchors(allAnchors);
    const coverageScore = computeCoverageScore(merged);

    // Upsert layout model
    const { data: existing } = await supabase
      .from("map_factory_layout_models")
      .select("id")
      .eq("job_id", jobId)
      .eq("floor_label", floorLabel ?? "")
      .maybeSingle();

    let layoutModelId: string;

    if (existing) {
      await supabase
        .from("map_factory_layout_models")
        .update({
          merged_anchors: merged,
          conflicts,
          coverage_score: coverageScore,
          status:         "complete",
          updated_at:     new Date().toISOString(),
        })
        .eq("id", existing.id);
      layoutModelId = existing.id;
    } else {
      const { data: inserted, error: insertErr } = await supabase
        .from("map_factory_layout_models")
        .insert({
          job_id:         jobId,
          mall_id:        mallId,
          floor_label:    floorLabel,
          merged_anchors: merged,
          conflicts,
          coverage_score: coverageScore,
          status:         "complete",
        })
        .select("id")
        .single();

      if (insertErr) throw new Error(insertErr.message);
      layoutModelId = inserted.id;
    }

    return {
      ok:            true,
      layoutModelId,
      mergedCount:   merged.length,
      conflictCount: conflicts.length,
      coverageScore,
    };
  } catch (err) {
    return { ok: false, mergedCount: 0, conflictCount: 0, coverageScore: 0, error: String(err) };
  }
}
