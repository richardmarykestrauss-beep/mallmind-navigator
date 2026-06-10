/**
 * shoppingIntentClassifier.ts — Shopping Assistant Intelligence Engine v1
 *
 * Deterministic, regex-based classification of shopper queries. No LLM, no
 * I/O. Unknown phrasing falls back to "product_search" when the query has
 * content, and "unknown" otherwise — never a guess that invents intent.
 */

import { IntentResult, ShoppingIntent } from "./assistantTypes";

/**
 * Parse a rand budget from phrases like "under R4000", "below R 3,500",
 * "less than r2000", "up to R300", "max R1500", "budget of R800".
 * Returns null when no budget phrase is present — never invents one.
 */
export function parseBudget(query: string): number | null {
  const text = String(query ?? "").toLowerCase();

  const match =
    /(?:under|below|less than|up to|max(?:imum)?|budget of|budget is)\s*r?\s?(\d[\d\s,]*(?:\.\d+)?)/.exec(text) ??
    /\br\s?(\d[\d\s,]*(?:\.\d+)?)\s*(?:budget|or less|max)\b/.exec(text);

  if (!match) return null;

  const amount = Number(match[1].replace(/[\s,]/g, ""));
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

const NAVIGATION_RE =
  /\bwhere is\b|\bwhere'?s\b|\btake me\b|\bnavigate\b|\bdirections?\b|\bhow do i get\b|\bway to\b|\bguide me\b|\broute to\b|\bfind my way\b/;

const MISSION_RE =
  /\bgift\b|\bpresent\b|\bgroceries\b|\bschool (?:shoes|supplies|uniform|clothes)\b|\blunch\b|\bback[- ]to[- ]school\b|\berrands?\b|\bshopping list\b|\bmission\b/;

const CHEAPEST_RE = /\bcheapest\b|\blowest price\b|\bbest price\b/;

const BEST_VALUE_RE = /\bbest value\b|\bbest deal\b|\bworth (?:it|the walk|buying)\b|\bbest option\b|\bbest buy\b/;

const CLOSEST_RE = /\bclosest\b|\bnearest\b|\bnear(?:by| me)\b|\bclose by\b|\bshortest walk\b/;

const BUDGET_HINT_RE = /\bbudget\b|\bafford\b|\bunder\s*r?\s?\d|\bbelow\s*r?\s?\d|\bup to\s*r?\s?\d/;

const GREETING_RE = /^(hi|hello|hey|thanks?|thank you|ok(?:ay)?|yes|no)[\s!.?]*$/;

/** Classify a shopper query into a primary intent + secondary intents + budget. */
export function classifyShoppingIntent(query: string): IntentResult {
  const text = String(query ?? "").trim().toLowerCase();
  const budget = parseBudget(text);
  const secondary: ShoppingIntent[] = [];

  if (!text || GREETING_RE.test(text)) {
    return { intent: "unknown", secondary, budget };
  }

  let intent: ShoppingIntent;

  if (NAVIGATION_RE.test(text)) {
    intent = "navigation_request";
  } else if (MISSION_RE.test(text)) {
    intent = "mission_shopping";
  } else if (CHEAPEST_RE.test(text)) {
    intent = "cheapest_option";
  } else if (BEST_VALUE_RE.test(text)) {
    intent = "best_value";
  } else if (CLOSEST_RE.test(text)) {
    intent = "closest_option";
  } else if (budget != null || BUDGET_HINT_RE.test(text)) {
    intent = "budget_search";
  } else {
    intent = "product_search";
  }

  if (budget != null && intent !== "budget_search") secondary.push("budget_search");
  if (intent !== "product_search" && intent !== "navigation_request") {
    secondary.push("product_search");
  }

  return { intent, secondary, budget };
}
