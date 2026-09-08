/**
 * deterministicShoppingIntent.ts — Shopping Assistant Intelligence Engine v1
 *
 * Extracts a CLEAR, deterministic shopping intent from shopper text, so the
 * backend can answer clear product/budget/cheapest queries from MallMind's own
 * product data BEFORE calling Gemini.
 *
 *   "I need a TV under R4000"            → tv  / 4000 / budget_search  / null
 *   "What is the cheapest TV under R4000?" → tv / 4000 / cheapest_option / null
 *   "Show me verified TVs only"          → tv  / null / product_search / verified_only
 *   "Where can I buy a TV?"              → tv  / null / product_search / null
 *
 * Vague / mission / navigation requests return null so the caller can fall back
 * to Gemini:
 *
 *   "Find me a gift for my dad"          → null
 *   "I need something nice for my apartment" → null
 *   "What should I buy?"                 → null
 *
 * Pure: no Supabase, no env, no network, no fs, no Gemini, no side effects.
 * Composes the existing pure helpers classifyShoppingIntent + extractProductTarget.
 */

import { classifyShoppingIntent } from "./shoppingIntentClassifier";
import { extractProductTarget } from "./productTargetExtractor";

export type DeterministicShoppingIntent = {
  productTarget: string;
  budget: number | null;
  intent: "budget_search" | "cheapest_option" | "product_search";
  trustPreference: "verified_only" | null;
};

/**
 * Words signalling a vague / gift / mission request with no concrete product
 * noun — these need Gemini, not the deterministic product engine.
 */
const VAGUE_SIGNALS =
  /\b(something|anything|whatever|stuff|thing|things|item|items|present|presents|gift|gifts|surprise|idea|ideas|recommendation|recommendations|suggest|suggestion)\b/i;

/** Light singularisation so "TVs" → "tv" (mirrors downstream search-term logic). */
function singularizeTarget(target: string): string {
  return target
    .split(/\s+/)
    .map((t) => {
      if (["tvs", "televisions", "television"].includes(t)) return "tv";
      if (t.endsWith("s") && t.length > 3) return t.slice(0, -1);
      return t;
    })
    .join(" ")
    .trim();
}

/**
 * Return a deterministic shopping intent for a clear product/budget/cheapest
 * query, or null when the request is vague / mission / navigation / unknown.
 */
export function extractDeterministicShoppingIntent(
  text: string
): DeterministicShoppingIntent | null {
  const raw = String(text ?? "").trim();
  if (!raw) return null;

  const classified = classifyShoppingIntent(raw);

  // Not a deterministic shopping query: mission ("gift for my dad"),
  // navigation ("take me to …" — handled by the route bypass), spatial
  // ("nearest …"), or unrecognised → fall back to Gemini.
  if (
    classified.intent === "mission_shopping" ||
    classified.intent === "navigation_request" ||
    classified.intent === "closest_option" ||
    classified.intent === "unknown"
  ) {
    return null;
  }

  // Vague phrasing with no concrete product → Gemini.
  if (VAGUE_SIGNALS.test(raw)) return null;

  const trustPreference: "verified_only" | null = /\bverified\b/i.test(raw)
    ? "verified_only"
    : null;

  // Strip trust qualifier words so they don't pollute the product target
  // ("verified TVs only" → product "tv", not "verified tv only").
  const targetSource = raw.replace(/\b(verified|only)\b/gi, " ");
  const productTarget = singularizeTarget(extractProductTarget(targetSource));

  // No concrete product noun ("What should I buy?") → Gemini.
  if (!productTarget) return null;

  // Map the classifier's intent onto the deterministic shopping set. A budget
  // present on a plain product/value query makes it a budget_search.
  let intent: DeterministicShoppingIntent["intent"];
  switch (classified.intent) {
    case "cheapest_option":
      intent = "cheapest_option";
      break;
    case "budget_search":
      intent = "budget_search";
      break;
    case "product_search":
    case "best_value":
    default:
      intent = classified.budget != null ? "budget_search" : "product_search";
      break;
  }

  return {
    productTarget,
    budget: classified.budget,
    intent,
    trustPreference,
  };
}
