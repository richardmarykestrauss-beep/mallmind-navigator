/**
 * mallSetupPipelineService.ts — Sprint 13.3 / 13.3.1
 *
 * Pure helper functions and types for the Mall Setup Automation Pipeline.
 * All DB orchestration is kept in the route handler; only testable
 * pure functions live here.
 *
 * No DB access. Fully testable in the harness.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export type PipelineStepStatus = "ok" | "skipped" | "warning" | "error";

export interface PipelineStepOutcome {
  step:         number;
  name:         string;
  status:       PipelineStepStatus;
  message:      string;
  /** Wall-clock milliseconds the step took to execute. */
  duration_ms?: number;
  data?:        Record<string, unknown>;
}

export interface MallSetupPipelineResult {
  mall_id:                  string;
  source_id:                string;
  completed_steps:          PipelineStepOutcome[];
  /** Names of steps that were explicitly skipped (derived from completed_steps). */
  skipped_steps:            string[];
  warnings:                 string[];
  errors:                   string[];
  health_report:            unknown | null;
  next_recommended_action:  string;
  generated_at:             string;
}

// ── Input validation ──────────────────────────────────────────────────────────

export interface PipelineInputValidation {
  valid:  boolean;
  error?: string;
}

/**
 * Validate the two required pipeline inputs before any DB access.
 * Pure — no side effects.
 */
export function validatePipelineInput(
  mallId:   unknown,
  sourceId: unknown,
): PipelineInputValidation {
  if (!mallId || typeof mallId !== "string" || !mallId.trim()) {
    return { valid: false, error: "mall_id is required" };
  }
  if (!sourceId || typeof sourceId !== "string" || !sourceId.trim()) {
    return { valid: false, error: "source_id is required" };
  }
  return { valid: true };
}

// ── Floor label normalization ─────────────────────────────────────────────────

/**
 * Known raw-value → canonical label mappings for South African mall floors.
 * Each entry is [pattern (case-insensitive), canonical label].
 */
const FLOOR_LABEL_ALIASES: ReadonlyArray<readonly [RegExp, string]> = [
  // ── Lower Ground ──────────────────────────────────────────────────────────
  [/^(lower\s*ground(\s*floor)?|lg|llg|lgg|basement\s*1?|b1?|sub\s*ground)$/i, "Lower Ground"],
  // ── Ground / G / GF ───────────────────────────────────────────────────────
  [/^(ground(\s*floor)?|gf|g|floor\s*0|level\s*0|ground\s*level|0)$/i, "Ground Floor"],
  // ── Upper Level ───────────────────────────────────────────────────────────
  [/^(upper(\s*(level|floor|ground))?|ul|u|top\s*floor)$/i, "Upper Level"],
  // ── Numeric floors 1–6 ────────────────────────────────────────────────────
  [/^(1st\s*floor|floor\s*1|level\s*1|l1|f1|1)$/i, "Level 1"],
  [/^(2nd\s*floor|floor\s*2|level\s*2|l2|f2|2)$/i, "Level 2"],
  [/^(3rd\s*floor|floor\s*3|level\s*3|l3|f3|3)$/i, "Level 3"],
  [/^(4th\s*floor|floor\s*4|level\s*4|l4|f4|4)$/i, "Level 4"],
  [/^(5th\s*floor|floor\s*5|level\s*5|l5|f5|5)$/i, "Level 5"],
  [/^(6th\s*floor|floor\s*6|level\s*6|l6|f6|6)$/i, "Level 6"],
] as const;

// ── Admin-review-state protection ────────────────────────────────────────────

/**
 * Snapshot of the review-state columns for an existing staged store row.
 * Passed to buildSafeStoreUpdate so it can decide which fields are safe to set.
 */
export interface ExistingStagedStore {
  /** "pending" | "accepted" | "rejected" | "flagged" */
  review_status: string;
  reviewed_at:   string | null;
  reviewed_by:   string | null;
  notes:         string | null;
  x_percent:     number | null;
  y_percent:     number | null;
  floor_label:   string | null;
}

/**
 * The subset of columns that an import/upsert is allowed to SET on an existing
 * staged store row without touching any admin review decision.
 *
 * Deliberately absent (NEVER included by buildSafeStoreUpdate):
 *   review_status, reviewed_at, reviewed_by, notes, x_percent, y_percent
 *
 * floor_label is only present when the existing row has floor_label = null
 * and the incoming data supplies a non-empty value (fill-in only, never overwrite).
 */
export interface SafeImportUpdate {
  phone?:              string | null;
  website?:            string | null;
  parking_hint?:       string | null;
  entrance_hint?:      string | null;
  road_name?:          string | null;
  source_modified_at?: string | null;
  image_url?:          string | null;
  category?:           string | null;
  /** Present only when existing.floor_label is null and incoming has a value. */
  floor_label?:        string;
}

/**
 * Build the subset of fields from an incoming GeoDirectory record that are safe
 * to update on an existing staged store row without touching admin review decisions.
 *
 * Guarantees (Sprint 13.3.1):
 *   • review_status  — NEVER in the returned object.
 *   • reviewed_at    — NEVER in the returned object.
 *   • reviewed_by    — NEVER in the returned object.
 *   • notes          — NEVER in the returned object.
 *   • x_percent      — NEVER in the returned object.
 *   • y_percent      — NEVER in the returned object.
 *   • floor_label    — included ONLY when existing.floor_label is null AND
 *                      incoming.floor_label is a non-empty string (fill-in only).
 *
 * Pure function — no DB or HTTP calls.  Exported for harness testing.
 */
export function buildSafeStoreUpdate(
  existing: ExistingStagedStore,
  incoming: {
    phone?:              string | null;
    website?:            string | null;
    parking_hint?:       string | null;
    entrance_hint?:      string | null;
    road_name?:          string | null;
    source_modified_at?: string | null;
    image_url?:          string | null;
    category?:           string | null;
    floor_label?:        string | null;
  },
): SafeImportUpdate {
  const update: SafeImportUpdate = {
    phone:              incoming.phone              ?? null,
    website:            incoming.website            ?? null,
    parking_hint:       incoming.parking_hint       ?? null,
    entrance_hint:      incoming.entrance_hint      ?? null,
    road_name:          incoming.road_name          ?? null,
    source_modified_at: incoming.source_modified_at ?? null,
    image_url:          incoming.image_url          ?? null,
    category:           incoming.category           ?? null,
  };

  // Fill-in only: only add floor_label to the update when the existing row
  // has no floor label AND the incoming data provides a non-empty one.
  if (
    existing.floor_label === null &&
    incoming.floor_label != null &&
    incoming.floor_label.trim() !== ""
  ) {
    update.floor_label = incoming.floor_label.trim();
  }

  return update;
}

// ── Floor label normalization ─────────────────────────────────────────────────

/**
 * Normalize a raw floor label string to a canonical, title-cased form.
 *
 * Known aliases (e.g. "lg", "gf", "1st floor") are mapped to canonical names.
 * Unknown values are title-cased and returned as-is — no data is discarded.
 *
 * @example
 *   normalizeMallFloorLabel("lg")           → "Lower Ground"
 *   normalizeMallFloorLabel("GROUND FLOOR") → "Ground Floor"
 *   normalizeMallFloorLabel("Food Court")   → "Food Court"   (passthrough)
 *   normalizeMallFloorLabel("")             → ""
 */
export function normalizeMallFloorLabel(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return trimmed;

  for (const [pattern, canonical] of FLOOR_LABEL_ALIASES) {
    if (pattern.test(trimmed)) return canonical;
  }

  // Unknown value — title-case and return as-is
  return trimmed
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
