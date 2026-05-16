/**
 * mallSetupPipelineService.ts — Sprint 13.3
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
  step:     number;
  name:     string;
  status:   PipelineStepStatus;
  message:  string;
  data?:    Record<string, unknown>;
}

export interface MallSetupPipelineResult {
  mall_id:                  string;
  source_id:                string;
  completed_steps:          PipelineStepOutcome[];
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
