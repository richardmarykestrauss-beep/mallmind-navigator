/**
 * Finding Extractor Bot
 *
 * Sprint 9C · MallMind Navigator
 * Hotfix 12B.1 — Improved shop directory parsing, trading hours detection,
 *               and product price extraction.
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
  fields:       ExtractedField[];
  raw_snippet:  string;
}

export interface FindingExtractorInput {
  raw_text:           string;
  hint_finding_type?: ExtractedFindingType;
}

export interface FindingExtractorResult extends BotOutputBase {
  extracted_findings:    ExtractedFinding[];
  extraction_summary:    string;
  total_signals_found:   number;
  finding_types_detected: ExtractedFindingType[];
}

// ── Floor normalisation ────────────────────────────────────────────────────────

/**
 * Normalise free-form floor descriptions to canonical labels.
 * Avoids duplicates like "Floor Floor" or "Ground ground floor".
 */
export function normalizeFloorLabel(raw: string): string {
  const s = raw.trim().toLowerCase().replace(/\s+/g, " ");
  if (/ground\s+floor/.test(s))     return "Ground Floor";
  if (/upper\s+ground/.test(s))     return "Upper Ground";
  if (/lower\s+ground/.test(s))     return "Lower Ground";
  if (/upper\s+level/.test(s))      return "Upper Level";
  if (/lower\s+level/.test(s))      return "Lower Level";
  if (/first\s+floor/.test(s))      return "First Floor";
  if (/second\s+floor/.test(s))     return "Second Floor";
  if (/third\s+floor/.test(s))      return "Third Floor";
  if (/basement/.test(s))           return "Basement";
  const lvl = s.match(/level\s*(\d{1,2})/);
  if (lvl)                           return `Level ${lvl[1]}`;
  const flr = s.match(/floor\s*(\d{1,2})/);
  if (flr)                           return `Floor ${flr[1]}`;
  // capitalise first letter of each word
  return raw.trim().replace(/\b\w/g, (c) => c.toUpperCase());
}

// ── Regex patterns ────────────────────────────────────────────────────────────

// Price: R999, R 1,299.99, R12 999
const PRICE_REGEX = /R\s*(\d[\d\s,]*(?:\.\d{2})?)/gi;

// Unit code: G12, L2-34, UG001, A2B — at least one letter + at least one digit
const UNIT_REGEX = /\b([A-Z]{1,3}\d{1,4}[A-Z]?(?:-\d{1,4})?)\b/g;

// Floor labels — ordered most-specific first; captured as complete phrases
const FLOOR_REGEX =
  /\b(ground\s+floor|upper\s+ground|lower\s+ground|upper\s+level|lower\s+level|first\s+floor|second\s+floor|third\s+floor|basement(?:\s+level)?|level\s*\d{1,2}|floor\s*\d{1,2})\b/gi;

// Time: 08:00, 08:00–18:00 (en-dash), or AM/PM variants
const TIME_REGEX = /\b(\d{1,2}:\d{2}\s*(?:am|pm)?)\b/gi;

// Day ranges
const DAY_RANGE_REGEX =
  /\b(mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\s*(?:–|-|to)\s*(mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\b/gi;

// "at [Shop Name]" — shop mention in natural language
const AT_SHOP_REGEX =
  /\bat\s+([A-Z][A-Za-z0-9&'.,-]{1,40}(?:\s+[A-Za-z0-9&'.,-]{1,20}){0,2}?)(?=\s+(?:on|in|at|until|from|for|is|was|costs?|price[sd]?|sells?)\b|\s*[.,!?]|$)/g;

// "Shop Name store/shop" — RESTRICTED to 1–3 word names to avoid greedy capture
const STORE_KEYWORD_REGEX =
  /\b([A-Z][A-Za-z0-9&'.]{1,30}(?:\s+[A-Z][A-Za-z0-9&'.]{1,20}){0,2})\s+(?:store|shop|outlet|branch)\b/gi;

// Promotion signals
const PROMO_REGEX =
  /\b(?:sale|special|discount|off|promo(?:tion)?|deal|limited\s+time|weekend\s+only|clearance|markdown)\b/gi;

// "until [day/date]" — for product promotions
const VALID_UNTIL_REGEX = /\buntil\s+([\w]+(?:\s+[\w]+)?)\b/gi;

// ── Mall directory line parsers ────────────────────────────────────────────────

interface ParsedDirectoryLine {
  shop_name?: string;
  unit?:      string;
  floor?:     string;
  category?:  string;
}

/**
 * Parse "X is listed as Shop Y on Z. Category W" patterns.
 * Examples:
 *   Game is listed as Shop G01 on Ground Floor. Category Electronics
 */
function parseListedAsShopLine(text: string): ParsedDirectoryLine | null {
  // Flexible pattern — shop name ends just before "is listed as" / "listed as"
  const m = text.match(
    /^([A-Z][A-Za-z0-9\s&'.,\-]{0,60}?)\s+(?:is\s+)?listed\s+as\s+(?:shop|store|unit)\s*([A-Z]{0,3}\d{1,4}[A-Z]?)?\s*(?:on\s+([\w\s]+?))?\s*[.,]\s*(?:category\s+(.+))?$/i,
  );
  if (!m) return null;
  const shopName = m[1].trim();
  // Safety check — reject if shop name contains connector phrases
  if (/\b(?:is\s+listed|listed\s+as|as\s+shop|on\s+the)\b/i.test(shopName)) return null;
  return {
    shop_name: shopName,
    unit:      m[2]?.trim()  || undefined,
    floor:     m[3]          ? normalizeFloorLabel(m[3].trim()) : undefined,
    category:  m[4]?.trim()  || undefined,
  };
}

/**
 * Parse delimiter-separated mall directory lines.
 * Handles:
 *   Clicks - Shop U12 - Upper Level - Health & Beauty
 *   Woolworths, Ground Floor, Shop G15, Fashion
 *   Dis-Chem Pharmacy | Lower Level | L23 | Pharmacy
 *   Dis-Chem Pharmacy | L23 | Lower Level | Pharmacy
 */
function parseMallDirDelimitedLine(text: string): ParsedDirectoryLine | null {
  // Split on: " - " / " – " (spaced dash — NOT bare hyphens inside brand names like "Dis-Chem")
  //            "|" with optional surrounding spaces
  //            ", " (comma-space)
  const DELIM_RE = /\s+[-–]\s+|\s*\|\s*|(?<=\S),\s+/;
  const delimiterCount = (text.match(new RegExp(DELIM_RE.source, "g")) ?? []).length;
  if (delimiterCount < 1) return null;

  const parts = text
    .split(DELIM_RE)
    .map((p) => p.trim())
    .filter(Boolean);

  if (parts.length < 2) return null;

  const unitPattern = /^(?:shop\s+)?([A-Z]{1,3}\d{1,4}[A-Z]?(?:-\d{1,4})?)$/i;
  const floorKeywords = /\b(floor|level|ground|upper|lower|basement|first|second|third)\b/i;

  const result: ParsedDirectoryLine = {};

  for (const raw of parts) {
    // Strip leading "Shop " / "Unit " prefix before classifying
    const part = raw.replace(/^(?:shop|unit)\s+/i, "").trim();

    if (!result.unit && unitPattern.test(part)) {
      result.unit = part.replace(/^(?:shop|unit)\s+/i, "").trim();
    } else if (!result.floor && floorKeywords.test(raw)) {
      result.floor = normalizeFloorLabel(raw);
    } else if (!result.shop_name && /^[A-Z]/.test(raw) && !floorKeywords.test(raw) && !unitPattern.test(part)) {
      result.shop_name = raw;
    } else if (result.shop_name && !result.category && !floorKeywords.test(raw) && !unitPattern.test(part)) {
      result.category = raw;
    }
  }

  if (!result.shop_name) return null;
  return result;
}

// ── Signal type detectors ─────────────────────────────────────────────────────

function hasShopSignal(text: string): boolean {
  return /\b(?:shop|store|unit|outlet|branch|tenant|listed\s+as|opening\s+at|new\s+store)\b/i.test(text);
}

function hasPriceSignal(text: string): boolean {
  return /R\s*\d/i.test(text);
}

/**
 * Detect trading hours — including bare time-range + day patterns
 * that lack explicit keywords like "opens" / "closes".
 * Handles: "09:00–19:00 Saturday:" and "Saturday 09:00 - 19:00"
 */
function hasHoursSignal(text: string): boolean {
  // Explicit hours keywords
  if (/\b(?:opens?|closes?|trading\s+hours?|open\s+from|closed\s+on|hours?:)\b/i.test(text)) return true;
  // Bare time-range with day name (e.g. "09:00–19:00 Saturday:", "09:00–17:00 Public Holidays:")
  if (/\d{1,2}:\d{2}\s*[–\-]\s*\d{1,2}:\d{2}/i.test(text) &&
      /\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|public\s+holidays?|mon|tue|wed|thu|fri|sat|sun)\b/i.test(text)) {
    return true;
  }
  return false;
}

function hasPromoSignal(text: string): boolean {
  // Reset lastIndex for global regex
  PROMO_REGEX.lastIndex = 0;
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
        value:           String(val),          // numeric string, not "R3499.00"
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
      field:           "unit_number",          // canonical field name for frontend
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
    const normalised = normalizeFloorLabel(m[1]);
    // Avoid duplicate floor entries
    if (!fields.some((f) => f.value === normalised)) {
      fields.push({
        field:           "floor",
        value:           normalised,
        confidence:      75,
        pattern_matched: "FLOOR_REGEX",
      });
    }
  }
  return fields;
}

/**
 * Extract structured trading hours fields from bare time-day patterns.
 * Handles both "09:00–19:00 Saturday:" and "Saturday 09:00 - 19:00".
 */
function extractTradingHoursFields(text: string): ExtractedField[] {
  // Pattern 1: time-range followed by day — "09:00–19:00 Saturday:"
  const m1 = text.match(
    /(\d{1,2}:\d{2})\s*[–\-]\s*(\d{1,2}:\d{2})\s+([\w][\w\s]*)(?::|$)/i,
  );
  if (m1) {
    const day = m1[3].trim().replace(/:$/, "").trim();
    return [
      { field: "open_time",  value: m1[1],  confidence: 90, pattern_matched: "TRADING_HOURS_TIME_FIRST" },
      { field: "close_time", value: m1[2],  confidence: 90, pattern_matched: "TRADING_HOURS_TIME_FIRST" },
      { field: "day",        value: day,    confidence: 85, pattern_matched: "TRADING_HOURS_TIME_FIRST" },
    ];
  }

  // Pattern 2: day followed by time-range — "Saturday 09:00 - 19:00" / "Mon-Fri 09:00-18:00"
  const m2 = text.match(
    /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|public\s+holidays?|mon[-–]fri|monday\s+to\s+friday|mon\s+to\s+fri)\b[\s:]*(\d{1,2}:\d{2})\s*[–\-]\s*(\d{1,2}:\d{2})/i,
  );
  if (m2) {
    return [
      { field: "day",        value: m2[1].trim(), confidence: 85, pattern_matched: "TRADING_HOURS_DAY_FIRST" },
      { field: "open_time",  value: m2[2],        confidence: 90, pattern_matched: "TRADING_HOURS_DAY_FIRST" },
      { field: "close_time", value: m2[3],        confidence: 90, pattern_matched: "TRADING_HOURS_DAY_FIRST" },
    ];
  }

  return [];
}

function extractTimes(text: string): ExtractedField[] {
  const fields: ExtractedField[] = [];
  const regex = new RegExp(TIME_REGEX.source, "gi");
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text)) !== null) {
    if (/^\d{1,2}$/.test(m[1].trim())) continue; // skip bare single digits
    fields.push({
      field:           "time",
      value:           m[1].trim(),
      confidence:      65,
      pattern_matched: "TIME_REGEX",
    });
  }
  return fields;
}

/**
 * Extract shop names — tries structured mall directory parsers first,
 * falls back to generic regex patterns.
 */
function extractShopNames(text: string): ExtractedField[] {
  // ── 1. "Listed as" pattern ────────────────────────────────────────────────
  const listedAs = parseListedAsShopLine(text);
  if (listedAs?.shop_name) {
    const fields: ExtractedField[] = [
      { field: "shop_name", value: listedAs.shop_name, confidence: 90, pattern_matched: "LISTED_AS_SHOP" },
    ];
    if (listedAs.unit)     fields.push({ field: "unit_number", value: listedAs.unit,     confidence: 90, pattern_matched: "LISTED_AS_SHOP" });
    if (listedAs.floor)    fields.push({ field: "floor",       value: listedAs.floor,    confidence: 90, pattern_matched: "LISTED_AS_SHOP" });
    if (listedAs.category) fields.push({ field: "category",    value: listedAs.category, confidence: 85, pattern_matched: "LISTED_AS_SHOP" });
    return fields;
  }

  // ── 2. Delimiter-separated mall directory line ────────────────────────────
  const mallDir = parseMallDirDelimitedLine(text);
  if (mallDir?.shop_name) {
    const fields: ExtractedField[] = [
      { field: "shop_name", value: mallDir.shop_name, confidence: 80, pattern_matched: "MALL_DIR_DELIMITED" },
    ];
    if (mallDir.unit)     fields.push({ field: "unit_number", value: mallDir.unit,     confidence: 80, pattern_matched: "MALL_DIR_DELIMITED" });
    if (mallDir.floor)    fields.push({ field: "floor",       value: mallDir.floor,    confidence: 80, pattern_matched: "MALL_DIR_DELIMITED" });
    if (mallDir.category) fields.push({ field: "category",    value: mallDir.category, confidence: 75, pattern_matched: "MALL_DIR_DELIMITED" });
    return fields;
  }

  // ── 3. Generic regex fallback ─────────────────────────────────────────────
  const fields: ExtractedField[] = [];
  const regexAt    = new RegExp(AT_SHOP_REGEX.source,    "g");
  const regexStore = new RegExp(STORE_KEYWORD_REGEX.source, "gi");
  let m: RegExpExecArray | null;
  while ((m = regexAt.exec(text)) !== null) {
    fields.push({ field: "shop_name", value: m[1].trim(), confidence: 60, pattern_matched: "AT_SHOP_REGEX" });
  }
  while ((m = regexStore.exec(text)) !== null) {
    fields.push({ field: "shop_name", value: m[1].trim(), confidence: 70, pattern_matched: "STORE_KEYWORD_REGEX" });
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

function extractValidUntil(text: string): ExtractedField[] {
  const regex = new RegExp(VALID_UNTIL_REGEX.source, "gi");
  const fields: ExtractedField[] = [];
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text)) !== null) {
    fields.push({ field: "valid_until_text", value: m[1].trim(), confidence: 70, pattern_matched: "VALID_UNTIL_REGEX" });
  }
  return fields;
}

// ── Determine finding type from signals ───────────────────────────────────────

function determineFindingType(
  text: string,
  hint?: ExtractedFindingType,
): ExtractedFindingType {
  if (hint && hint !== "unknown") return hint;
  if (hasHoursSignal(text))                    return "trading_hours";
  if (hasPromoSignal(text) && hasPriceSignal(text)) return "promotion";
  if (hasPriceSignal(text))                    return "price";
  if (hasShopSignal(text))                     return "shop_listing";
  if (hasFloorSignal(text))                    return "floor_layout";
  if (hasProductSignal(text))                  return "product";
  return "unknown";
}

// ── Field deduplication ───────────────────────────────────────────────────────

/**
 * Deduplicate fields: if the same `field` name appears more than once,
 * keep the entry with highest confidence.
 */
function deduplicateFields(fields: ExtractedField[]): ExtractedField[] {
  const best = new Map<string, ExtractedField>();
  for (const f of fields) {
    const existing = best.get(f.field);
    if (!existing || f.confidence > existing.confidence) {
      best.set(f.field, f);
    }
  }
  return [...best.values()];
}

// ── Main export ───────────────────────────────────────────────────────────────

export function runFindingExtractorBot(input: FindingExtractorInput): FindingExtractorResult {
  const now  = new Date().toISOString();
  const text = (input.raw_text ?? "").trim();

  if (!text) {
    return {
      bot_name:                  "FindingExtractorBot",
      processed_at:              now,
      risk_level:                "high",
      recommendation:            "reject",
      live_data_action_safety:   "do_not_apply",
      must_not_update_live_data: true,
      reasoning:                 ["No raw_text provided. Nothing to extract."],
      extracted_findings:        [],
      extraction_summary:        "No input text — nothing extracted.",
      total_signals_found:       0,
      finding_types_detected:    [],
    };
  }

  // Classify finding type
  const findingType = determineFindingType(text, input.hint_finding_type);

  // ── Run appropriate extractors ────────────────────────────────────────────
  let allFields: ExtractedField[] = [];

  switch (findingType) {
    case "shop_listing": {
      // extractShopNames handles mall directory parsing first
      const shopFields = extractShopNames(text);
      const usedMallDir = shopFields.some((f) =>
        f.pattern_matched === "LISTED_AS_SHOP" || f.pattern_matched === "MALL_DIR_DELIMITED"
      );
      if (usedMallDir) {
        // Mall dir parser already extracted floor/unit — avoid duplicates
        allFields = shopFields;
      } else {
        allFields = deduplicateFields([...shopFields, ...extractFloors(text), ...extractUnits(text)]);
      }
      break;
    }
    case "price":
      allFields = deduplicateFields([
        ...extractPrices(text), ...extractShopNames(text), ...extractValidUntil(text),
      ]);
      break;
    case "trading_hours": {
      // Try structured hours extraction first
      const hoursFields = extractTradingHoursFields(text);
      if (hoursFields.length > 0) {
        allFields = deduplicateFields([...hoursFields, ...extractShopNames(text)]);
      } else {
        allFields = deduplicateFields([...extractTimes(text), ...extractShopNames(text), ...extractFloors(text)]);
      }
      break;
    }
    case "promotion":
      allFields = deduplicateFields([
        ...extractPromos(text), ...extractPrices(text), ...extractShopNames(text), ...extractValidUntil(text),
      ]);
      // Add promotion flag
      if (!allFields.some((f) => f.field === "promotion")) {
        allFields.push({ field: "promotion", value: "true", confidence: 70, pattern_matched: "PROMO_SIGNAL" });
      }
      break;
    case "floor_layout":
      allFields = deduplicateFields([...extractFloors(text), ...extractUnits(text), ...extractShopNames(text)]);
      break;
    case "product":
      allFields = deduplicateFields([
        ...extractPrices(text), ...extractPromos(text), ...extractShopNames(text), ...extractValidUntil(text),
      ]);
      // If price found and promo signal, add promotion flag
      if (allFields.some((f) => f.field === "price") && allFields.some((f) => f.field === "promotion_signal")) {
        allFields.push({ field: "promotion", value: "true", confidence: 65, pattern_matched: "INFERRED_PROMO" });
      }
      break;
    default:
      allFields = deduplicateFields([
        ...extractPrices(text), ...extractShopNames(text),
        ...extractFloors(text), ...extractUnits(text), ...extractTimes(text), ...extractPromos(text),
      ]);
  }

  // ── Check for product name in price-type findings ─────────────────────────
  // For "Hisense 43 inch FHD LED TV is R3499 at Game" — extract product name
  if ((findingType === "price" || findingType === "product" || findingType === "promotion") &&
      !allFields.some((f) => f.field === "product_name")) {
    const productNameMatch = text.match(
      /^([A-Z][A-Za-z0-9"'°\s]{3,60}?)\s+(?:is|for|at|costs?|price[sd]?|sells?\s+for|:\s*)\s*R\s*\d/i,
    );
    if (productNameMatch) {
      allFields.unshift({
        field:           "product_name",
        value:           productNameMatch[1].trim(),
        confidence:      75,
        pattern_matched: "PRODUCT_NAME_BEFORE_PRICE",
      });
    }
  }

  const findings: ExtractedFinding[] = [];
  if (allFields.length > 0) {
    findings.push({
      finding_type: findingType,
      fields:       allFields,
      raw_snippet:  text.length > 200 ? text.slice(0, 200) + "…" : text,
    });
  }

  const totalSignals   = allFields.length;
  const typesDetected  = findings.map((f) => f.finding_type);

  const hasPrices = allFields.some((f) => f.field === "price");
  const hasShops  = allFields.some((f) => f.field === "shop_name");
  const riskLevel = totalSignals === 0 ? "high" : (hasPrices && hasShops ? "low" : "medium");
  const safety    = totalSignals === 0 ? "do_not_apply" : "requires_review";

  const reasoning: string[] = [];
  if (totalSignals === 0) {
    reasoning.push("No structured signals found in the raw text.");
    reasoning.push("Manual admin extraction may be needed.");
  } else {
    reasoning.push(`Extracted ${totalSignals} field signal(s) from input text.`);
    reasoning.push(`Primary finding type classified as: ${findingType}.`);
    if (!hasShops) reasoning.push("No shop name detected — admin should confirm which store this relates to.");
    if (allFields.filter((f) => f.field === "price").length > 1)
      reasoning.push(`Multiple price values found — admin should confirm which is correct.`);
    reasoning.push("All extracted fields require admin review before any live data consideration.");
  }

  const summary = totalSignals === 0
    ? "No signals extracted — admin manual review required."
    : `Extracted ${totalSignals} field(s) — finding type: ${findingType}. Requires admin review.`;

  return {
    bot_name:                  "FindingExtractorBot",
    processed_at:              now,
    risk_level:                riskLevel,
    recommendation:            totalSignals === 0 ? "reject" : "needs_admin_review",
    live_data_action_safety:   safety,
    must_not_update_live_data: true,
    reasoning,
    extracted_findings:        findings,
    extraction_summary:        summary,
    total_signals_found:       totalSignals,
    finding_types_detected:    typesDetected,
  };
}
