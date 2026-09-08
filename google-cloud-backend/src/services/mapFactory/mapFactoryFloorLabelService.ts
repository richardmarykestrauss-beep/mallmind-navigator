/**
 * mapFactoryFloorLabelService.ts — Sprint 15.4
 *
 * Canonical floor label resolution for the Map Factory pipeline.
 *
 * Rules:
 *  - Well-formed labels like "Level 3", "Level 5", "Lower Level",
 *    "Ground Floor", "Upper Level" are preserved EXACTLY as-is.
 *  - Short single-letter / single-digit codes (G, L1, B1, "1") are expanded
 *    to canonical forms for display consistency.
 *  - NULL / undefined / empty / "unknown" fall through to a caller-supplied
 *    fallback — default "Unknown".
 *  - Mall-specific overrides are NEVER applied here; a label that comes from
 *    an admin's explicit stage input must survive unchanged end-to-end.
 *
 * Priority for resolveFloorLabel():
 *   1. model's own floor_label (if valid)
 *   2. job/stage floor_label (the explicit admin input)
 *   3. "Unknown"
 */

// ── Labels that are semantically equivalent to NULL ───────────────────────────

export const KNOWN_NULL_LABELS = new Set([
  "", "unknown", "null", "undefined", "n/a", "none", "tbd",
]);

// ── Short-code expansion table ────────────────────────────────────────────────
// Only ambiguous 1–3 char codes are listed.  Anything longer is assumed to be
// already well-formed and is returned as-is.

const SHORT_ALIASES: Record<string, string> = {
  g:    "Ground Floor",
  ug:   "Upper Ground",
  lg:   "Lower Ground",
  b:    "Basement",
  b1:   "Basement 1",
  b2:   "Basement 2",
  l1:   "Level 1",
  l2:   "Level 2",
  l3:   "Level 3",
  l4:   "Level 4",
  l5:   "Level 5",
  l6:   "Level 6",
  "1":  "Level 1",
  "2":  "Level 2",
  "3":  "Level 3",
  "4":  "Level 4",
  "5":  "Level 5",
  "6":  "Level 6",
};

// ── normalizeFloorLabel ───────────────────────────────────────────────────────

/**
 * Normalise a raw floor label string.
 *
 * @param raw      - The raw floor label (may be null/undefined/empty).
 * @param fallback - Returned when the raw value is null-like.  Defaults to "Unknown".
 * @returns        The normalised, non-empty label string.
 *
 * Examples:
 *   normalizeFloorLabel("Level 5")        → "Level 5"    (preserved)
 *   normalizeFloorLabel("Lower Level")    → "Lower Level" (preserved)
 *   normalizeFloorLabel("G")              → "Ground Floor" (expanded)
 *   normalizeFloorLabel("L2")             → "Level 2"    (expanded)
 *   normalizeFloorLabel("unknown")        → "Unknown"    (null-like)
 *   normalizeFloorLabel(null)             → "Unknown"    (null-like)
 *   normalizeFloorLabel("Level 3", "G")   → "Level 3"    (fallback not used)
 */
export function normalizeFloorLabel(
  raw:      string | null | undefined,
  fallback: string = "Unknown",
): string {
  if (!raw) return fallback;

  const trimmed = raw.trim();
  if (KNOWN_NULL_LABELS.has(trimmed.toLowerCase())) return fallback;

  // Only attempt alias expansion for short codes (≤3 chars)
  if (trimmed.length <= 3) {
    const expanded = SHORT_ALIASES[trimmed.toLowerCase()];
    if (expanded) return expanded;
  }

  // Return the label exactly as supplied — "Level 5", "Lower Level", etc.
  return trimmed;
}

// ── resolveFloorLabel ─────────────────────────────────────────────────────────

/**
 * Resolve the canonical floor label to use when creating a mall_node.
 *
 * Priority (highest → lowest):
 *   1. modelFloorLabel — from the layout model row (most specific)
 *   2. jobFloorLabel   — from the admin's explicit stage input
 *   3. "Unknown"
 *
 * This ensures that when an admin runs the graph builder with floor_label =
 * "Level 5", any model that lacks its own floor_label still produces nodes
 * stamped "Level 5" rather than NULL or "unknown".
 */
export function resolveFloorLabel(
  modelFloorLabel: string | null | undefined,
  jobFloorLabel:   string | null | undefined,
): string {
  const fromModel = normalizeFloorLabel(modelFloorLabel);
  if (fromModel !== "Unknown") return fromModel;

  return normalizeFloorLabel(jobFloorLabel);
  // Returns "Unknown" if both are absent / null-like
}

// ── isValidFloorLabel ─────────────────────────────────────────────────────────

/** True iff the label is non-null and not a known-null synonym. */
export function isValidFloorLabel(label: string | null | undefined): label is string {
  if (!label) return false;
  return !KNOWN_NULL_LABELS.has(label.trim().toLowerCase());
}
