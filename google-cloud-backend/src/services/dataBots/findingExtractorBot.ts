/**
 * Finding Extractor Bot
 *
 * Sprint 9C · MallMind Navigator
 *
 * Applies deterministic regex patterns to raw text to extract structured
 * finding candidates: shop names, prices, floor/unit codes, trading hours,
 * promotions, and product details.
 *
 * Deterministic — no external API calls, no DB reads.
 */

import type { BotOutputBase } from "./types.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export type ExtractedFindingType =
  | "shop_listing"
  | "price"
  | "trading_hours"
  | "promotion"
  | "floor_layout"
  | "product"
  | "unknown";

export interface ExtractedField {
  field: string;
  value: string;
  confidence: number; // 0–100
  pattern_matched: string;
}

export interface ExtractedFinding {
  finding_type: ExtractedFindingType;
  fields: ExtractedField[];
  raw_snippet: string;
}

export interface FindingExtractorInput {
  raw_text: string;
  hint_finding_type?: ExtractedFindingType;
}

export interface FindingExtractorResult extends BotOutputBase {
  extracted_findings: ExtractedFinding[];
  extraction_summary: string;
  total_signals_found: number;
  finding_types_detected: ExtractedFindingType[];
}

// ── Regex patterns ────────────────────────────────────────────────────────────

// Price: R999, R 1,299.99, R12 999
const PRICE_REGEX    = /R\s*(\d[\d\s,]*(?:\.\d{2})?)/gi;
// Unit code: G12, L2-34, UG001, A2B
const UNIT_REGEX     = /\b([A-Z]{1,3}\d{1,4}[A-Z]?(?:-\d{1,4})?)\b/g;
// Floor labels: Floor 1, Level 2, Ground Floor, Upper Ground, Lower Ground
const FLOOR_REGEX    = /\b((?:ground|upper\s+ground|lower\s+ground|basement|level|floor)\s*(?:\d{1,2})?)\b/gi;
// Time: 08:00, 9am, 10:30 AM
const TIME_REGEX     = /\b(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\b/gi;
// Day ranges: Mon–Fri, Monday to Friday, Monday - Sunday
const DAY_RANGE_REGEX = /\b(mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\s*(?:–|-|to)\s*(mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\b/gi;
// "at [Shop Name]" — extract store mention from natural language
const AT_SHOP_REGEX  = /\bat\s+([A-Z][A-Za-z0-9\s&'.,-]{1,40}?)(?=\s+(?:on|in|at|until|from|for|is|was|costs?|price[sd]?|sells?)\b|\s*[.,!?]|$)/g;
// "Shop Name store/shop" — trailing keyword hints
const STORE_KEYWORD_REGEX = /\b([A-Z][A-Za-z0-9\s&'.]{1,40}?)\s+(?:store|shop|outlet|branch)\b/gi;
// Promotion signals
const PROMO_REGEX    = /\b(?:sale|special|discount|off|promo(?:tion)?|deal|promotion|limited\s+time|weekend\s+only|clearance|markdown)\b/gi;
// Product + brand signal: Nike Air Max, Samsung 65", etc.
const PRODUCT_REGEX  = /\b([A-Z][A-Za-z0-9]+(?:\s+[A-Za-z0-9"']+){1,5})\b/g;

// ── Signal type detectors ─────────────────────────────────────────────────────

function hasShopSignal(text: string): boolean {
  return /\b(?:shop|store|unit|outlet|branch|tenant|listed\s+as|opening\s+at|new\s+store)\b/i.test(text);
}
function hasPriceSignal(text: string): boolean {
  return /R\s*\d/i.test(text);
}
function hasHoursSignal(text: string): boolean {
  return /\b(?:opens?|closes?|trading\s+hours?|open\s+from|closed\s+on|hours?:)\b/i.test(text);
}
function hasPromoSignal(text: string): boolean {
  return PROMO_REGEX.test(text);
}
function hasFloorSignal(text: string): boolean {
  return /\b(?:floor|level|ground|basement|upper|lower)\b/i.test(text);
}
function hasProductSignal(text: string): boolean {
  return /\b(?:product|brand|model|item|sku|barcode|description)\b/i.test(text);
}

// ── Extraction helpers ────────────────────────────────────────────────────────

function extractPrices(text: string): ExtractedField[] {
  const fields: ExtractedField[] = [];
  const regex = new RegExp(PRICE_REGEX.source, "gi");
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text)) !== null) {
    const raw = m[1].replace(/\s/g, "").replace(/,/g, "");
    const val = parseFloat(raw);
    if (!isNaN(val) && val > 0) {
      fields.push({
        field:           "price",
        value:           `R${val.toFixed(2)}`,
        confidence:      80,
        pattern_matched: "PRICE_REGEX",
      });
    }
  }
  return fields;
}

function extractUnits(text: string): ExtractedField[] {
  const fields: ExtractedField[] = [];
  const regex = new RegExp(UNIT_REGEX.source, "g");
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text)) !== null) {
    fields.push({
      field:           "unit_code",
      value:           m[1],
      confidence:      60,
      pattern_matched: "UNIT_REGEX",
    });
  }
  return fields;
}

function extractFloors(text: string): ExtractedField[] {
  const fields: ExtractedField[] = [];
  const regex = new RegExp(FLOOR_REGEX.source, "gi");
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text)) !== null) {
    fields.push({
      field:           "floor",
      value:           m[1].replace(/\s+/g, " ").trim(),
      confidence:      70,
      pattern_matched: "FLOOR_REGEX",
    });
  }
  return fields;
}

function extractTimes(text: string): ExtractedField[] {
  const fields: ExtractedField[] = [];
  const regex = new RegExp(TIME_REGEX.source, "gi");
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text)) !== null) {
    // Filter noise: single digits with no am/pm
    if (/^\d{1,2}$/.test(m[1].trim())) continue;
    fields.push({
      field:           "time",
      value:           m[1].trim(),
      confidence:      65,
      pattern_matched: "TIME_REGEX",
    });
  }
  return fields;
}

function extractShopNames(text: string): ExtractedField[] {
  const fields: ExtractedField[] = [];
  const regexAt    = new RegExp(AT_SHOP_REGEX.source, "g");
  const regexStore = new RegExp(STORE_KEYWORD_REGEX.source, "gi");
  let m: RegExpExecArray | null;
  while ((m = regexAt.exec(text)) !== null) {
    fields.push({
      field:           "shop_name",
      value:           m[1].trim(),
      confidence:      60,
      pattern_matched: "AT_SHOP_REGEX",
    });
  }
  while ((m = regexStore.exec(text)) !== null) {
    fields.push({
      field:           "shop_name",
      value:           m[1].trim(),
      confidence:      70,
      pattern_matched: "STORE_KEYWORD_REGEX",
    });
  }
  return fields;
}

function extractPromos(text: string): ExtractedField[] {
  const regex = new RegExp(PROMO_REGEX.source, "gi");
  const matches = text.match(regex);
  if (!matches) return [];
  return [{
    field:           "promotion_signal",
    value:           [...new Set(matches.map((m) => m.toLowerCase()))].join(", "),
    confidence:      55,
    pattern_matched: "PROMO_REGEX",
  }];
}

// ── Determine finding type from signals ───────────────────────────────────────

function determineFindingType(
  text: string,
  hint?: ExtractedFindingType
): ExtractedFindingType {
  if (hint && hint !== "unknown") return hint;
  if (hasHoursSignal(text))  return "trading_hours";
  if (hasPromoSignal(text) && hasPriceSignal(text)) return "promotion";
  if (hasPriceSignal(text))  return "price";
  if (hasShopSignal(text))   return "shop_listing";
  if (hasFloorSignal(text))  return "floor_layout";
  if (hasProductSignal(text)) return "product";
  return "unknown";
}

// ── Main export ───────────────────────────────────────────────────────────────

export function runFindingExtractorBot(input: FindingExtractorInput): FindingExtractorResult {
  const now  = new Date().toISOString();
  const text = (input.raw_text ?? "").trim();

  if (!text) {
    return {
      bot_name:                 "FindingExtractorBot",
      processed_at:             now,
      risk_level:               "high",
      recommendation:           "reject",
      live_data_action_safety:  "do_not_apply",
      must_not_update_live_data: true,
      reasoning:                ["No raw_text provided. Nothing to extract."],
      extracted_findings:       [],
      extraction_summary:       "No input text — nothing extracted.",
      total_signals_found:      0,
      finding_types_detected:   [],
    };
  }

  // Run all extractors
  const prices   = extractPrices(text);
  const units    = extractUnits(text);
  const floors   = extractFloors(text);
  const times    = extractTimes(text);
  const shops    = extractShopNames(text);
  const promos   = extractPromos(text);

  // Classify finding type
  const findingType = determineFindingType(text, input.hint_finding_type);

  // Assemble fields for the primary finding
  let allFields: ExtractedField[] = [];
  switch (findingType) {
    case "shop_listing":
      allFields = [...shops, ...floors, ...units];
      break;
    case "price":
      allFields = [...prices, ...shops];
      break;
    case "trading_hours":
      allFields = [...times, ...shops, ...floors];
      break;
    case "promotion":
      allFields = [...promos, ...prices, ...shops];
      break;
    case "floor_layout":
      allFields = [...floors, ...units, ...shops];
      break;
    case "product":
      allFields = [...prices, ...promos];
      break;
    default:
      allFields = [...prices, ...shops, ...floors, ...units, ...times, ...promos];
  }

  const findings: ExtractedFinding[] = [];
  if (allFields.length > 0) {
    findings.push({
      finding_type: findingType,
      fields:       allFields,
      raw_snippet:  text.length > 200 ? text.slice(0, 200) + "…" : text,
    });
  }

  const totalSignals = allFields.length;
  const typesDetected: ExtractedFindingType[] = findings.map((f) => f.finding_type);

  // Risk assessment
  const hasPrices = prices.length > 0;
  const hasShops  = shops.length > 0;
  const riskLevel = totalSignals === 0
    ? "high"
    : (hasPrices && hasShops ? "low" : "medium");

  const safety = totalSignals === 0 ? "do_not_apply" : "requires_review";

  const reasoning: string[] = [];
  if (totalSignals === 0) {
    reasoning.push("No structured signals found in the raw text.");
    reasoning.push("Manual admin extraction may be needed.");
  } else {
    reasoning.push(`Extracted ${totalSignals} field signal(s) from input text.`);
    reasoning.push(`Primary finding type classified as: ${findingType}.`);
    if (!hasShops) reasoning.push("No shop name detected — admin should confirm which store this relates to.");
    if (prices.length > 1) reasoning.push(`${prices.length} price values found — admin should confirm which is the correct/current price.`);
    reasoning.push("All extracted fields require admin review before any live data consideration.");
  }

  const summary = totalSignals === 0
    ? "No signals extracted — admin manual review required."
    : `Extracted ${totalSignals} field(s) — finding type: ${findingType}. Requires admin review.`;

  return {
    bot_name:                 "FindingExtractorBot",
    processed_at:             now,
    risk_level:               riskLevel,
    recommendation:           totalSignals === 0 ? "reject" : "needs_admin_review",
    live_data_action_safety:  safety,
    must_not_update_live_data: true,
    reasoning,
    extracted_findings:       findings,
    extraction_summary:       summary,
    total_signals_found:      totalSignals,
    finding_types_detected:   typesDetected,
  };
}
