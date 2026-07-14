/**
 * Deterministic normalization helpers for product identity.
 *
 * Pure, dependency-free string transforms used by the identity-matching engine.
 * These NEVER perform fuzzy merges — they only canonicalise inputs so exact
 * comparisons are reliable.
 */

/** Trim + collapse internal whitespace to single spaces. */
export function collapseWhitespace(s: string): string {
  return s.trim().replace(/\s+/g, " ");
}

/** Normalise inch/quote marks and unicode quotes to a plain ASCII form. */
export function normalizeQuotes(s: string): string {
  return s
    .replace(/[‘’ʼ′]/g, "'")  // ' ' ʼ ′ → '
    .replace(/[“”″]/g, '"')          // " " ″ → "
    // Inch words converge onto `"`, consuming any space so `43 inch` === `43"`.
    .replace(/\s*\binches\b/gi, '"')
    .replace(/\s*\binch\b/gi, '"');
}

/** Normalise model-number punctuation: strip spaces/dashes/dots between alnum runs. */
export function normalizeModel(s: string): string {
  return collapseWhitespace(s)
    .toUpperCase()
    .replace(/[\s._-]+/g, "");
}

/** Canonical brand form: lowercase, quotes normalised, whitespace collapsed. */
export function normalizeBrand(s: string): string {
  return collapseWhitespace(normalizeQuotes(s)).toLowerCase();
}

/**
 * Canonical product-title form for candidate matching: quotes normalised,
 * lowercased, punctuation softened, whitespace collapsed. Inch marks are kept as
 * `"` so `43"` and `43 inch` converge.
 */
export function normalizeTitle(s: string): string {
  return collapseWhitespace(
    normalizeQuotes(s)
      .toLowerCase()
      .replace(/[,_/\\]+/g, " ")
      .replace(/\s*-\s*/g, " "),
  );
}
