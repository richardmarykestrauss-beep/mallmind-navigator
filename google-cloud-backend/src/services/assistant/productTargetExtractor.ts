/**
 * productTargetExtractor.ts — Shopping Assistant Intelligence Engine v1
 *
 * Separates intent/filler words from the actual product target so retrieval
 * never returns zero products just because a shopper used superlative or
 * question phrasing.
 *
 *   "What is the cheapest TV under R4000?" → product target "tv"
 *   "Show me the cheapest TV"              → "tv"
 *   "Best TV under R4000"                  → "tv"
 *   "cheapest"                             → ""  (no product noun)
 *
 * Pure functions only: no I/O, no Supabase, no env reads. Used by the backend
 * assistant flow to normalise the recommend_products search query.
 */

/**
 * Intent / filler / value / budget words that must not pollute the product
 * search. Deliberately excludes words that double as product nouns (e.g.
 * "top", "watch", "light", "ring") so real products are never stripped.
 */
const NON_PRODUCT_WORDS: ReadonlySet<string> = new Set([
  // question / auxiliary
  "what", "whats", "which", "who", "is", "are", "am", "do", "does", "did",
  "can", "could", "would", "should", "will", "how", "where",
  // pronouns / determiners / filler
  "i", "me", "my", "you", "your", "we", "a", "an", "the", "this", "that",
  "these", "those", "some", "any", "it", "im",
  // asking verbs
  "need", "needs", "want", "wants", "looking", "look", "show", "find",
  "get", "give", "buy", "see", "please", "help",
  // prepositions / connectors
  "for", "to", "of", "with", "in", "on", "at", "under", "below", "over",
  "above", "around", "about", "near", "nearby", "less", "than", "up", "and",
  "or",
  // superlative / value
  "cheapest", "cheap", "cheaper", "best", "better", "lowest", "lower",
  "highest", "affordable", "premium",
  // price / deal
  "price", "priced", "prices", "cost", "costs", "budget", "deal", "deals",
  "special", "specials", "sale", "discount", "save", "value",
  // compare
  "compare", "comparison", "vs", "versus",
  // retail context
  "mall", "store", "stores", "shop", "shops",
  // currency
  "r", "rand", "zar",
]);

/**
 * Strip intent/filler/budget words and numbers, leaving the product target.
 * Returns a lowercased, space-joined product phrase, or "" if nothing
 * product-like remains.
 */
export function extractProductTarget(text: string): string {
  const cleaned = String(text ?? "")
    .toLowerCase()
    .replace(/r\s?\d[\d\s.,]*/g, " ") // "R4000", "r 4 000"
    .replace(/\d[\d.,]*/g, " ")        // any remaining bare numbers
    .replace(/['’]/g, "")              // keep "what's" → "whats"
    .replace(/[^a-z\s-]/g, " ")        // letters, spaces, hyphens only
    .replace(/\s+/g, " ")
    .trim();

  const tokens = cleaned
    .split(" ")
    .filter((t) => t.length > 1 && !NON_PRODUCT_WORDS.has(t));

  return tokens.join(" ").trim();
}

/**
 * Produce the search query to pass to recommend_products.
 *
 * Prefers the product target extracted from the model's tool-call query, but
 * falls back to the target extracted from the shopper's actual message when
 * the model dropped the product noun (e.g. it passed only "cheapest"). This
 * makes retrieval independent of how the model phrased the tool call.
 *
 * Never returns empty: if no product target can be isolated, returns the
 * model query (or the user message) unchanged so behaviour is never worse
 * than before.
 */
export function normalizeAssistantSearchQuery(
  modelQuery: string | null | undefined,
  userMessage: string | null | undefined
): string {
  const fromModel = extractProductTarget(modelQuery ?? "");
  if (fromModel) return fromModel;

  const fromUser = extractProductTarget(userMessage ?? "");
  if (fromUser) return fromUser;

  const rawModel = (modelQuery ?? "").trim();
  if (rawModel) return rawModel;
  return (userMessage ?? "").trim();
}
