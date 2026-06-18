/**
 * deterministicShoppingAnswer.ts — Shopping Assistant Intelligence Engine v1 (20A.6C)
 *
 * Turns deterministic product candidates (already fetched + filtered by the
 * 20A.6B retrieval) into a complete, shopper-safe structured answer using the
 * EXISTING ranker + answer builder. No Gemini, no DB, no route engine.
 *
 *   candidates (ScoredProduct[]) + deterministic intent
 *     → map to ShopperCandidate[]
 *     → buildShoppingAnswer (ranks trust-first / price-first per intent)
 *     → { products, shopping_answer, message }
 *
 * Doctrine preserved by delegating to buildShoppingAnswer: no fabricated price /
 * stock / shop, no internal-status leakage, verified language from the safe
 * trust labels, trust-first for normal/budget searches, price-first (with
 * verified backup + warning) for cheapest_option.
 *
 * No-result rule (this branch): NO candidates → shopping_answer null and message
 * null. We deliberately do NOT call buildShoppingAnswer on an empty set (which
 * would emit its "I couldn't find…" no-result message) — 20A.6D decides whether
 * to fall through to Gemini or use a fallback.
 *
 * Pure: no Supabase, no env, no network, no fs, no Gemini, no side effects.
 */

import type { IntentResult, ShoppingAnswer } from "./assistantTypes";
import type { DeterministicShoppingIntent } from "./deterministicShoppingIntent";
import {
  mapProductRowsToCandidates,
  type MappableProductRow,
} from "./shopperCandidateMapper";
import { buildShoppingAnswer } from "./shoppingAnswerBuilder";

/**
 * Result of the deterministic shopping path. Mirrors the fields geminiService
 * already returns (`products`, `shopping_answer`, `message`) so 20A.6D can build
 * the normal /assistant response from it. `T` carries the caller's row type
 * (e.g. ScoredProduct) through unchanged.
 */
export interface DeterministicShoppingResult<T = MappableProductRow> {
  /** The retrieved candidate products, unchanged. */
  products: T[];
  /** Structured shopper-safe answer, or null when there are no candidates. */
  shopping_answer: ShoppingAnswer | null;
  /** Aligned free-text message (= shopperMessage), or null when no answer. */
  message: string | null;
}

/**
 * Assemble a deterministic shopping answer from already-retrieved candidates.
 *
 * Pure: same input → same output. The `intent` drives ranking via a
 * pre-classified IntentResult (budget_search / cheapest_option / product_search),
 * so behaviour does not depend on re-parsing any query string.
 */
export function assembleDeterministicShoppingAnswer<T extends MappableProductRow>(
  candidates: readonly T[],
  intent: DeterministicShoppingIntent
): DeterministicShoppingResult<T> {
  // No candidates → no answer, no fabricated message (20A.6D decides fallback).
  if (!candidates.length) {
    return { products: [], shopping_answer: null, message: null };
  }

  // No real route is built on the deterministic product path (routeAvailable
  // false); the engine therefore never promises navigation here.
  const shopperCandidates = mapProductRowsToCandidates(candidates, false);

  // Drive the existing builder/ranker with a pre-classified intent so the
  // deterministic intent is honoured exactly (no query-string re-classification).
  const intentResult: IntentResult = {
    intent: intent.intent,
    secondary: [],
    budget: intent.budget,
  };

  const shopping_answer = buildShoppingAnswer({
    candidates: shopperCandidates,
    intent: intentResult,
    budget: intent.budget,
  });

  return {
    products: [...candidates],
    shopping_answer,
    // shopperMessage is already shopper-safe + internal-status-scrubbed; with no
    // route built it is exactly what alignAssistantMessage would return.
    message: shopping_answer.shopperMessage,
  };
}
