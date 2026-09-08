/**
 * routeIntentExtractor.ts — Shopping Assistant Intelligence Engine v1
 *
 * Detects explicit, unambiguous navigation commands and extracts the
 * destination shop-name candidate, so the backend can route deterministically
 * WITHOUT calling Gemini.
 *
 *   "Take me to Game"              → "Game"
 *   "Where is Game?"              → "Game"
 *   "Directions to Dis-Chem"      → "Dis-Chem"
 *   "Take me to the cheapest TV"  → null   (product-dependent → needs Gemini)
 *   "Where can I buy a TV?"       → null
 *
 * Routes to explicit shop names are deterministic mall operations, not AI
 * operations. Vague / product-dependent requests return null and fall through
 * to the AI flow. The destination returned here is only a CANDIDATE — the
 * caller must still confirm it against real shops in the selected mall before
 * building a route (never hallucinate a shop).
 *
 * Pure functions only: no I/O, no Supabase, no env reads.
 */

/** Clear navigation command patterns. Group 1 captures the destination tail. */
const ROUTE_COMMAND_PATTERNS: readonly RegExp[] = [
  /\btake me to\s+(.+)$/i,
  /\bwhere(?:'s|s| is| are)\s+(.+)$/i,
  /\bdirections?\s+to\s+(.+)$/i,
  /\broute\s+to\s+(.+)$/i,
  /\bnavigate\s+to\s+(.+)$/i,
  /\bshow me (?:the way|directions)\s+to\s+(.+)$/i,
  /\bhow do i get to\s+(.+)$/i,
  /\bfind\s+(.+)$/i,
];

/**
 * Signals that the destination is vague or product-dependent (needs Gemini),
 * not a concrete shop name. Keeps "take me to the cheapest TV" / "find me a
 * gift" out of the deterministic route path.
 */
const NON_SHOP_SIGNALS =
  /\b(cheapest|cheaper|cheap|best|lowest|highest|nearest|closest|something|anything|gift|deal|deals|to buy|can i buy|i can buy|shop with|store with|place with|place that|somewhere|a shop|a store)\b/i;

/**
 * Return the destination shop-name candidate for an explicit navigation
 * command, or null when the message is not a direct route request.
 */
export function extractDirectRouteDestination(text: string): string | null {
  const raw = String(text ?? "").trim();
  if (!raw) return null;

  for (const pattern of ROUTE_COMMAND_PATTERNS) {
    const match = pattern.exec(raw);
    if (!match?.[1]) continue;

    const dest = match[1]
      .replace(/[?.!,]+$/g, "")          // trailing punctuation
      .replace(/^(?:the|a|an)\s+/i, "")  // leading article
      .trim();

    if (!dest) return null;
    // Vague / product-dependent phrasing → not a deterministic route.
    if (NON_SHOP_SIGNALS.test(dest)) return null;
    // Shop names are short; long tails are descriptions, not names.
    if (dest.split(/\s+/).length > 4) return null;

    return dest;
  }

  return null;
}
