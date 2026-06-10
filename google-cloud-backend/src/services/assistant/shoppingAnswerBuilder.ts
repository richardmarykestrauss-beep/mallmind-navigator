/**
 * shoppingAnswerBuilder.ts — Shopping Assistant Intelligence Engine v1
 *
 * Turns ranked candidates into a structured, shopper-safe answer:
 * best option + backup option + warnings + next action + short message.
 *
 * Honesty rules enforced here (doctrine "Golden Rule"):
 *   - never fabricate a price (null price → "price not confirmed yet")
 *   - never claim stock unless inStock === true
 *   - never offer navigation unless a route and shop actually exist
 *   - empty candidates → honest uncertainty, never an invented option
 *   - internal statuses never appear in shopperMessage (scrubbed as defence)
 */

import {
  AnswerOption,
  BuildAnswerInput,
  NextAction,
  RankedCandidate,
  ShoppingAnswer,
} from "./assistantTypes";
import { classifyShoppingIntent } from "./shoppingIntentClassifier";
import { rankCandidates } from "./productRecommendationRanker";
import { scrubInternalStatus } from "./shopperTrustLabels";

function formatRand(amount: number): string {
  return `R${amount.toLocaleString("en-ZA")}`;
}

function toAnswerOption(c: RankedCandidate): AnswerOption {
  const reason = c.reasons.length ? c.reasons.join(" · ") : c.trustLabel;
  return {
    productId: c.productId,
    productName: c.productName,
    shopName: c.shopName ?? null,
    price: typeof c.price === "number" ? c.price : null,
    trustLabel: c.trustLabel,
    confidenceBand: c.confidenceBand,
    reason,
    routeAvailable: c.routeAvailable === true,
  };
}

/** "Game has the Hisense 43\" TV for R3,499" / honest no-price variant. */
function describeOption(c: RankedCandidate): string {
  const where = c.shopName ? `${c.shopName} has the ${c.productName}` : `I found the ${c.productName}`;
  if (typeof c.price === "number") {
    return `${where} for ${formatRand(c.price)}`;
  }
  return `${where}, but I don't have a confirmed price yet`;
}

/** Trust sentence in shopper language. */
function trustSentence(c: RankedCandidate): string {
  switch (c.confidenceBand) {
    case "high":
      return c.trustLabel === "Live retailer feed"
        ? "The price comes from a live retailer feed."
        : "It is a verified option.";
    case "medium":
      return "The price may need confirmation.";
    default:
      return "It is not confirmed yet — please check with the store.";
  }
}

function buildNextAction(best: RankedCandidate | null): NextAction {
  if (!best) {
    return { type: "search_again", label: "Search again" };
  }
  if (best.routeAvailable === true && best.shopName) {
    return { type: "navigate", label: "Take me there" };
  }
  if (best.confidenceBand !== "high") {
    return { type: "confirm_price", label: "Confirm the price" };
  }
  return { type: "compare", label: "Compare options" };
}

const NO_RESULT_MESSAGE =
  "I couldn't find a confirmed option for that at this mall yet. " +
  "I don't want to guess a price or a shop — try another word for the product, or ask me for likely shops.";

/**
 * Build the full structured shopping answer.
 * Pure: same input → same output.
 */
export function buildShoppingAnswer(input: BuildAnswerInput): ShoppingAnswer {
  const intentResult =
    input.intent ?? classifyShoppingIntent(input.query ?? "");
  const budget = input.budget ?? intentResult.budget;

  const ranked = rankCandidates(input.candidates, {
    budget,
    intent: intentResult.intent,
  });

  const best = ranked[0] ?? null;
  const backup = ranked[1] ?? null;
  const warnings: string[] = [];

  if (!best) {
    return {
      intent: intentResult.intent,
      bestOption: null,
      backupOption: null,
      warnings: ["No matching options were found — nothing was guessed or invented."],
      nextAction: buildNextAction(null),
      shopperMessage: scrubInternalStatus(NO_RESULT_MESSAGE),
    };
  }

  const parts: string[] = [];

  // Best option sentence
  let bestSentence = `Best option: ${describeOption(best)}.`;
  parts.push(bestSentence);

  // Trust + budget fit
  const qualifiers: string[] = [trustSentence(best)];
  if (budget != null && typeof best.price === "number" && best.price <= budget) {
    qualifiers.push("It fits your budget.");
  }
  if (budget != null && typeof best.price === "number" && best.price > budget) {
    qualifiers.push(`Note: it is over your ${formatRand(budget)} budget.`);
    warnings.push("Best match is over your budget.");
  }
  // Stock: only ever mentioned when the data actually confirms it.
  if (best.inStock === true) qualifiers.push("It is listed as available.");
  if (best.inStock === false) {
    qualifiers.push("It is currently listed as unavailable.");
    warnings.push("Best match is listed as unavailable — consider the backup option.");
  }
  if (best.isOpenNow === false) {
    warnings.push(`${best.shopName ?? "The shop"} may be closed right now — check trading hours.`);
  }
  parts.push(qualifiers.join(" "));

  // Walking estimate — only when actually known
  if (typeof best.walkingMinutes === "number" && best.walkingMinutes >= 0) {
    parts.push(`It is about ${Math.max(1, Math.round(best.walkingMinutes))} minutes away on foot.`);
  }

  // Navigation offer — only when a route truly exists
  if (best.routeAvailable === true && best.shopName) {
    parts.push("I can take you there.");
  } else if (best.shopName && best.routeAvailable !== true) {
    parts.push("I can show you the shop, but I don't have a route ready yet.");
  }

  // Backup option
  if (backup) {
    const backupTrust =
      backup.confidenceBand === "high"
        ? "also a solid choice"
        : "but the price may need confirmation";
    parts.push(`Backup: ${describeOption(backup)} — ${backupTrust}.`);
  }

  if (best.confidenceBand === "low") {
    warnings.push("Best match is not confirmed yet — please check with the store before walking over.");
  }
  if (backup && backup.confidenceBand === "low") {
    warnings.push("Backup option is not confirmed yet.");
  }

  return {
    intent: intentResult.intent,
    bestOption: toAnswerOption(best),
    backupOption: backup ? toAnswerOption(backup) : null,
    warnings: warnings.map(scrubInternalStatus),
    nextAction: buildNextAction(best),
    shopperMessage: scrubInternalStatus(parts.join(" ")),
  };
}
