/**
 * sourceIngestionService.ts — MallMind Source Ingestion Agent
 *
 * Sprint 9H · MallMind Navigator
 *
 * Safe, admin-requested single-page ingestion from allowed public sources.
 * Fetches a public URL, extracts readable text, splits into candidate findings,
 * and creates mall_research_batch_items for admin review.
 *
 * GUARANTEES:
 * - No writes to shops, products, or mall_nodes — EVER
 * - No auto-approval of findings
 * - No live data updates of any kind
 * - Restricted sources (Google Maps, Yelp, Apple Maps, Foursquare, etc.) are hard-blocked
 * - All created items always have status = 'pending'
 * - No external AI calls — deterministic, rule-based only
 * - Single-page ingestion only — no recursive link following
 */

import { runSourceResearchBot }   from "./dataBots/sourceResearchBot.js";
import { runFindingExtractorBot } from "./dataBots/findingExtractorBot.js";
import { getSupabaseClient }      from "../lib/supabase.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface IngestSourceInput {
  batch_id:     string;
  source_url:   string;
  source_name?: string;
  source_type?: string;
  max_items?:   number;
  run_pipeline?: boolean;
  /**
   * Optional pipeline runner injected by the route handler.
   * Called for each created item when run_pipeline = true.
   * The service does not import routes — the route injects this dependency.
   */
  pipelineFn?: (itemId: string) => Promise<void>;
}

export interface IngestionSummary {
  source_url:          string;
  source_name?:        string;
  allowed_to_ingest:   boolean;
  blocked_reason?:     string;
  fetched:             boolean;
  text_length:         number;
  candidate_count:     number;
  created_item_count:  number;
  skipped_item_count:  number;
  pipeline_run_count:  number;
  warnings:            string[];
}

export interface SkippedCandidate {
  reason:   string;
  raw_text: string;
}

export interface IngestSourceResult {
  ok:                    boolean;
  source_research_result: unknown;
  ingestion_summary:     IngestionSummary;
  created_items:         Array<Record<string, unknown>>;
  skipped_candidates:    SkippedCandidate[];
}

// ── Hard-block URL patterns (same as Source Research Bot + extras) ─────────────

const HARD_BLOCK_PATTERNS: { pattern: RegExp; reason: string }[] = [
  { pattern: /google\.com\/maps/i,    reason: "Google Maps — ToS prohibits data extraction" },
  { pattern: /maps\.google/i,         reason: "Google Maps — ToS prohibits data extraction" },
  { pattern: /google.*places/i,       reason: "Google Places — ToS prohibits data extraction" },
  { pattern: /place_id/i,             reason: "Google Places place_id — restricted" },
  { pattern: /googleapis\.com\/maps/i,reason: "Google Maps API — ToS prohibits redistribution" },
  { pattern: /maps\.apple\.com/i,     reason: "Apple Maps — ToS prohibits data extraction" },
  { pattern: /yelp\.com/i,            reason: "Yelp — requires valid API agreement" },
  { pattern: /foursquare\.com/i,      reason: "Foursquare — requires valid API agreement" },
  { pattern: /tripadvisor\.com/i,     reason: "TripAdvisor — ToS prohibits scraping" },
  { pattern: /waze\.com/i,            reason: "Waze — Google subsidiary, ToS prohibits extraction" },
  { pattern: /mapquest\.com/i,        reason: "MapQuest — ToS prohibits data extraction" },
];

// ── SA known retailer names (for shop candidate detection) ────────────────────

const KNOWN_RETAILERS = [
  "Game", "Clicks", "Woolworths", "Checkers", "Pick n Pay", "Dis-Chem", "Dischem",
  "Mr Price", "MrPrice", "Pep", "Ackermans", "Truworths", "Foschini", "Edgars",
  "HiFi Corp", "Incredible Connection", "Sportscene", "Cotton On",
  "Starbucks", "KFC", "McDonald", "Nando", "Steers", "Wimpy",
  "Capitec", "Nedbank", "FNB", "Standard Bank", "ABSA",
  "Spar", "Shoprite", "Makro", "Builder", "Builders", "Checkers Food",
  "H&M", "Zara", "Mango", "Cotton On", "Factorie", "Typo",
  "Sportsmans Warehouse", "Total Sports", "Nike", "Adidas",
  "Sunglass Hut", "Spec Savers", "Specx", "Optic Warehouse",
];

const KNOWN_RETAILERS_LOWER = new Set(KNOWN_RETAILERS.map((r) => r.toLowerCase()));

// ── Navigation junk lines (skip these) ────────────────────────────────────────

const NAV_JUNK_PATTERNS = [
  /^home$/i, /^contact$/i, /^about$/i, /^privacy policy$/i, /^terms$/i,
  /^terms\s+and\s+conditions?$/i,
  /^cookie/i, /^login$/i, /^sign in$/i, /^sign up$/i, /^register$/i,
  /^facebook$/i, /^instagram$/i, /^twitter$/i, /^linkedin$/i, /^youtube$/i,
  /^subscribe$/i, /^newsletter$/i, /^back$/i, /^next$/i, /^previous$/i,
  /^menu$/i, /^navigation$/i, /^skip to/i, /^share$/i, /^follow us/i,
  /^copyright/i, /^all rights/i, /^\d{4}\s+all rights/i,
  /^powered by/i, /^designed by/i, /^developed by/i,
  /^search$/i, /^cart$/i, /^checkout$/i, /^wishlist$/i,
  /^load more$/i, /^show more$/i, /^view all$/i,
  /^read more$/i, /^click here$/i, /^learn more$/i,
  /^contact us$/i, /^get in touch$/i, /^email us$/i,
  /^back to top$/i, /^scroll to top$/i, /^top$/i,
  /^get directions?$/i, /^directions?$/i,
  /^find us$/i, /^our location$/i,
  /^accept cookies?$/i, /^reject cookies?$/i, /^cookie settings?$/i,
];

// ── Lines that reference restricted mapping services (not the source URL itself) ─
//   e.g. "Find on Google Maps" appearing as a CTA on an otherwise-valid page.
//   These lines are skipped as 'restricted_source_reference'.
const RESTRICTED_REFERENCE_PATTERNS: RegExp[] = [
  /find\s+(?:us\s+)?on\s+google\s+maps/i,
  /view\s+on\s+google\s+maps/i,
  /open\s+in\s+google\s+maps/i,
  /google\s+maps\s+link/i,
  /apple\s+maps/i,
  /view\s+on\s+yelp/i,
  /open\s+in\s+yelp/i,
  /foursquare/i,
  /tripadvisor/i,
  /waze\s+(?:link|directions?|navigation)/i,
  /get\s+directions?\s+(?:on|via|using)\s+google/i,
];

// ── "Keep" patterns (lines containing these are candidate-worthy) ─────────────

const KEEP_PATTERNS = [
  /\bshop\b/i, /\bstore\b/i, /\boutlet\b/i, /\bbranch\b/i,
  /\bunit\b/i, /\bfloor\b/i, /\blevel\b/i,
  /ground\s+floor/i, /first\s+floor/i, /second\s+floor/i,
  /\btrading\s+hours\b/i, /\bopen(?:s|ing)?\b/i, /\bclos(?:es|ing)?\b/i,
  /R\s*\d/,                                             // Price
  /\bcategory\b/i, /\bdirectory\b/i, /\btenant\b/i,
  /\bpromotion\b/i, /\bspecial\b/i, /\bdiscount\b/i, /\bsale\b/i,
  /\d{1,2}:\d{2}/,                                      // Times
  /\b[A-Z]{1,3}\d{1,4}\b/,                              // Unit codes G12, L2-34
];

// ── HTML extraction ───────────────────────────────────────────────────────────

/** Strip HTML tags and decode common entities. Returns plain text. */
function stripHtml(html: string): string {
  // Remove script/style/noscript/svg blocks entirely (including their content)
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
    .replace(/<head[\s\S]*?<\/head>/gi, " ");

  // Preserve line breaks from block elements before stripping
  text = text
    .replace(/<\/?(br|p|div|li|tr|th|td|h[1-6]|section|article|header|main|aside)[^>]*>/gi, "\n");

  // Strip remaining tags
  text = text.replace(/<[^>]+>/g, " ");

  // Decode common HTML entities
  text = text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#\d+;/g, " ")
    .replace(/&[a-z]+;/gi, " ");

  // Collapse multiple spaces (but preserve newlines)
  text = text.replace(/[ \t]+/g, " ");
  // Collapse excessive blank lines (max 2 in a row)
  text = text.replace(/\n{3,}/g, "\n\n");

  return text.trim();
}

// ── Candidate line extraction ─────────────────────────────────────────────────

function normalizeLine(line: string): string {
  return line.toLowerCase().replace(/\s+/g, " ").trim();
}

function isNavJunk(line: string): boolean {
  const trimmed = line.trim();
  return NAV_JUNK_PATTERNS.some((p) => p.test(trimmed));
}

/** Returns a skip reason string if this line references a restricted mapping service,
 *  null otherwise. Distinct from isNavJunk so the caller can record a more specific reason. */
function restrictedReferenceReason(line: string): string | null {
  const trimmed = line.trim();
  return RESTRICTED_REFERENCE_PATTERNS.some((p) => p.test(trimmed))
    ? "restricted_source_reference"
    : null;
}

function isKnownRetailer(line: string): boolean {
  const norm = normalizeLine(line);
  return KNOWN_RETAILERS_LOWER.has(norm) ||
    KNOWN_RETAILERS.some((r) => norm.includes(r.toLowerCase()));
}

function hasKeepSignal(line: string): boolean {
  return KEEP_PATTERNS.some((p) => p.test(line));
}

/**
 * Split extracted plain text into candidate lines/chunks that may contain
 * useful mall data (shops, hours, prices, promotions, etc.).
 */
export function extractCandidateLines(text: string): string[] {
  const lines = text
    .split(/\n+/)
    .map((l) => l.trim())
    .filter((l) => l.length >= 3);

  const seen = new Set<string>();
  const candidates: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Skip very short lines (< 3 chars already filtered)
    // Skip nav junk
    if (isNavJunk(line)) continue;

    // Check if this line or its immediate neighbours contain a keep signal
    const prevLine = i > 0 ? lines[i - 1] : "";
    const nextLine = i < lines.length - 1 ? lines[i + 1] : "";

    const isCandidate =
      hasKeepSignal(line) ||
      isKnownRetailer(line) ||
      // Title-case words with keep signals nearby
      (isKnownRetailer(prevLine) && hasKeepSignal(line)) ||
      (isKnownRetailer(nextLine) && hasKeepSignal(line));

    if (!isCandidate) continue;

    // Build a chunk: include some context from surrounding lines if they are meaningful
    let chunk = line;
    if (nextLine.length > 3 && !isNavJunk(nextLine)) {
      chunk = `${line}\n${nextLine}`;
    }

    // Deduplicate (normalised)
    const norm = normalizeLine(chunk);
    if (seen.has(norm)) continue;
    seen.add(norm);

    candidates.push(chunk.trim());
  }

  return candidates;
}

// ── URL fetch ─────────────────────────────────────────────────────────────────

const FETCH_TIMEOUT_MS  = 15_000;
const MAX_RESPONSE_BYTES = 1_500_000; // 1.5 MB

async function fetchPublicUrl(url: string): Promise<{ ok: boolean; text: string; error?: string }> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(url, {
        method:  "GET",
        signal:  controller.signal,
        headers: {
          "User-Agent": "MallMindResearchBot/0.1 (admin-requested; contact: support@mallmind.co.za)",
          "Accept":     "text/html, text/plain, application/xhtml+xml, */*;q=0.5",
        },
      });
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      return { ok: false, text: "", error: `HTTP ${response.status}: ${response.statusText}` };
    }

    const contentType = response.headers.get("content-type") ?? "";
    const isAllowedType =
      contentType.includes("text/html") ||
      contentType.includes("text/plain") ||
      contentType.includes("application/xhtml+xml");

    if (!isAllowedType) {
      return {
        ok:    false,
        text:  "",
        error: `Content-Type '${contentType}' is not supported. Only text/html, text/plain, application/xhtml+xml are accepted.`,
      };
    }

    // Read response body with size guard
    const reader = response.body?.getReader();
    if (!reader) {
      return { ok: false, text: "", error: "Response body is not readable" };
    }

    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    let truncated = false;

    while (true) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_RESPONSE_BYTES) {
        truncated = true;
        // Keep what we have so far
        chunks.push(value.slice(0, MAX_RESPONSE_BYTES - (totalBytes - value.byteLength)));
        reader.cancel();
        break;
      }
      chunks.push(value);
    }

    const decoder = new TextDecoder("utf-8", { fatal: false });
    const combined = new Uint8Array(chunks.reduce((acc, c) => acc + c.byteLength, 0));
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const rawText = decoder.decode(combined);

    return {
      ok:   true,
      text: truncated ? rawText + "\n[TRUNCATED — response exceeded 1.5 MB]" : rawText,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const isTimeout = msg.includes("abort") || msg.includes("timeout");
    return {
      ok:    false,
      text:  "",
      error: isTimeout ? `Fetch timed out after ${FETCH_TIMEOUT_MS / 1000}s` : `Fetch error: ${msg}`,
    };
  }
}

// ── Determine finding type from extractor output ──────────────────────────────

function bestFindingType(
  extractorFindingTypes: string[],
  candidate: string,
): "shop" | "product" | "trading_hours" | "promotion" | "floor_layout" | "other" {
  if (extractorFindingTypes.includes("shop_listing")) return "shop";
  if (extractorFindingTypes.includes("trading_hours")) return "trading_hours";
  if (extractorFindingTypes.includes("promotion"))     return "promotion";
  if (extractorFindingTypes.includes("price"))         return "product";
  if (extractorFindingTypes.includes("floor_layout"))  return "floor_layout";
  if (extractorFindingTypes.includes("product"))       return "product";
  if (isKnownRetailer(candidate))                      return "shop";
  return "other";
}

// ── Batch item insert ─────────────────────────────────────────────────────────

async function createBatchItem(
  batchId:        string,
  findingType:    string,
  rawText:        string,
  sourceUrl:      string,
  sourceName:     string | undefined,
  extractedData:  Record<string, unknown>,
  botHintsUsed:   Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("mall_research_batch_items")
    .insert({
      batch_id:       batchId,
      finding_type:   findingType,
      raw_text:       rawText,
      source_url:     sourceUrl,
      source_name:    sourceName ?? null,
      status:         "pending",
      extracted_data: Object.keys(extractedData).length ? extractedData : null,
      bot_hints_used: botHintsUsed,
    })
    .select()
    .single();

  if (error) return null;
  return data as unknown as Record<string, unknown>;
}

// ── Deduplication check within batch ─────────────────────────────────────────

async function getExistingNormalisedTexts(batchId: string): Promise<Set<string>> {
  const supabase = getSupabaseClient();
  const { data } = await supabase
    .from("mall_research_batch_items")
    .select("raw_text")
    .eq("batch_id", batchId);

  const existing = new Set<string>();
  for (const row of (data ?? [])) {
    const r = row as Record<string, unknown>;
    if (r.raw_text) {
      existing.add(normalizeLine(r.raw_text as string));
    }
  }
  return existing;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main exported function
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ingestSourceForBatch
 *
 * Admin-requested single-page source ingestion.
 * Fetches a public URL, extracts text, chunks into candidates,
 * and creates mall_research_batch_items for admin review.
 *
 * NEVER writes to shops, products, or mall_nodes.
 * NEVER auto-approves findings.
 * NEVER bypasses the Source Research Bot safety check.
 */
export async function ingestSourceForBatch(
  input: IngestSourceInput,
): Promise<IngestSourceResult> {
  const {
    batch_id,
    source_url,
    source_name,
    source_type,
    max_items     = 50,
    run_pipeline  = false,
    pipelineFn,
  } = input;

  const cappedMax     = Math.min(max_items, 150);
  const warnings:     string[]          = [];
  const createdItems: Record<string, unknown>[] = [];
  const skipped:      SkippedCandidate[] = [];
  const now           = new Date().toISOString();

  // ── Step 0: Pre-flight hard-block check ──────────────────────────────────────
  const urlLower = source_url.toLowerCase();
  for (const { pattern, reason } of HARD_BLOCK_PATTERNS) {
    if (pattern.test(urlLower)) {
      return {
        ok:                     false,
        source_research_result: null,
        ingestion_summary: {
          source_url,
          source_name,
          allowed_to_ingest:   false,
          blocked_reason:      `Hard-blocked by ingestion policy: ${reason}`,
          fetched:             false,
          text_length:         0,
          candidate_count:     0,
          created_item_count:  0,
          skipped_item_count:  0,
          pipeline_run_count:  0,
          warnings:            [`Hard block: ${reason}`],
        },
        created_items:      [],
        skipped_candidates: [],
      };
    }
  }

  // ── Step 1: Source Research Bot ───────────────────────────────────────────────
  const sourceResearchResult = runSourceResearchBot({
    source_url,
    source_name,
    source_description: source_type,
    submitted_by_type:  "admin",
  });

  // Block on restricted or rejected source
  const isBlocked =
    sourceResearchResult.is_restricted ||
    sourceResearchResult.live_data_action_safety === "blocked_by_policy" ||
    sourceResearchResult.recommendation === "reject";

  if (isBlocked) {
    const blockReason =
      sourceResearchResult.restriction_reason ??
      `Source Research Bot: ${sourceResearchResult.recommendation} — ${sourceResearchResult.risk_level} risk`;
    return {
      ok:                     false,
      source_research_result: sourceResearchResult,
      ingestion_summary: {
        source_url,
        source_name,
        allowed_to_ingest:   false,
        blocked_reason:      blockReason,
        fetched:             false,
        text_length:         0,
        candidate_count:     0,
        created_item_count:  0,
        skipped_item_count:  0,
        pipeline_run_count:  0,
        warnings:            [blockReason],
      },
      created_items:      [],
      skipped_candidates: [],
    };
  }

  // Caution: unknown source
  if (sourceResearchResult.source_category === "unknown") {
    warnings.push(
      "Source category is 'unknown'. Proceeding with caution — created items will remain pending. " +
      "Please verify the source before accepting any findings."
    );
  }
  if (sourceResearchResult.recommendation === "proceed_with_caution") {
    warnings.push(
      `Source classified as '${sourceResearchResult.source_category}' with risk level '${sourceResearchResult.risk_level}'. ` +
      "Review each created item carefully."
    );
  }

  // ── Step 2: Fetch the page ────────────────────────────────────────────────────
  const fetchResult = await fetchPublicUrl(source_url);

  if (!fetchResult.ok) {
    warnings.push(`Page fetch failed: ${fetchResult.error ?? "unknown error"}`);
    return {
      ok:                     false,
      source_research_result: sourceResearchResult,
      ingestion_summary: {
        source_url,
        source_name,
        allowed_to_ingest:   true,
        blocked_reason:      fetchResult.error,
        fetched:             false,
        text_length:         0,
        candidate_count:     0,
        created_item_count:  0,
        skipped_item_count:  0,
        pipeline_run_count:  0,
        warnings,
      },
      created_items:      [],
      skipped_candidates: [],
    };
  }

  // ── Step 3: Extract plain text from HTML ──────────────────────────────────────
  const plainText = stripHtml(fetchResult.text);

  if (plainText.length < 50) {
    warnings.push("Extracted text is too short — page may be JavaScript-only or otherwise unreadable.");
    return {
      ok:                     false,
      source_research_result: sourceResearchResult,
      ingestion_summary: {
        source_url,
        source_name,
        allowed_to_ingest: true,
        blocked_reason:    "Extracted text too short to process",
        fetched:           true,
        text_length:       plainText.length,
        candidate_count:   0,
        created_item_count: 0,
        skipped_item_count: 0,
        pipeline_run_count: 0,
        warnings,
      },
      created_items:      [],
      skipped_candidates: [],
    };
  }

  // ── Step 4: Extract candidate lines ──────────────────────────────────────────
  const candidates = extractCandidateLines(plainText).slice(0, cappedMax * 2);

  if (candidates.length === 0) {
    warnings.push("No candidate findings found in extracted text. The page may not contain structured mall data.");
    return {
      ok:                     true,
      source_research_result: sourceResearchResult,
      ingestion_summary: {
        source_url,
        source_name,
        allowed_to_ingest:   true,
        fetched:             true,
        text_length:         plainText.length,
        candidate_count:     0,
        created_item_count:  0,
        skipped_item_count:  0,
        pipeline_run_count:  0,
        warnings,
      },
      created_items:      [],
      skipped_candidates: [],
    };
  }

  // ── Step 5: Load existing batch item texts (for deduplication) ───────────────
  const existingTexts = await getExistingNormalisedTexts(batch_id);

  // ── Step 6: Process candidates — run Finding Extractor, create items ──────────
  let pipelineRunCount = 0;
  const seenThisRun = new Set<string>();

  for (const candidate of candidates) {
    if (createdItems.length >= cappedMax) break;

    const normCandidate = normalizeLine(candidate);

    // Deduplicate against existing batch items and items created in this run
    if (existingTexts.has(normCandidate) || seenThisRun.has(normCandidate)) {
      skipped.push({ reason: "Duplicate raw_text — already exists in batch", raw_text: candidate });
      continue;
    }

    // Skip lines that reference restricted mapping services (e.g. "Find on Google Maps")
    const restrictedRef = restrictedReferenceReason(candidate);
    if (restrictedRef) {
      skipped.push({ reason: restrictedRef, raw_text: candidate });
      continue;
    }

    // Run Finding Extractor
    let extractorResult;
    let extractedData: Record<string, unknown> = {};
    try {
      extractorResult = runFindingExtractorBot({ raw_text: candidate });

      // Build normalised extracted_data from the first finding's fields
      if (extractorResult.extracted_findings?.length) {
        for (const field of extractorResult.extracted_findings[0].fields) {
          // Normalise price to a numeric value
          if (field.field === "price") {
            const num = parseFloat(field.value);
            extractedData["price"] = isNaN(num) ? field.value : num;
          } else {
            extractedData[field.field] = field.value;
          }
        }
        // Ensure shop_name is also stored under the canonical "name" key
        // so the frontend Finding Summary "Entity" row always has a value
        if (extractedData["shop_name"] && !extractedData["name"]) {
          extractedData["name"] = extractedData["shop_name"];
        }
        if (extractedData["product_name"] && !extractedData["name"]) {
          extractedData["name"] = extractedData["product_name"];
        }
      }
    } catch {
      // Extractor failure is non-fatal
      extractorResult = null;
    }

    // Determine finding type
    const findingType = bestFindingType(
      extractorResult?.finding_types_detected ?? [],
      candidate,
    );

    // Skip candidates with no useful signals (unless they look like a known retailer)
    if (
      findingType === "other" &&
      !isKnownRetailer(candidate) &&
      (extractorResult?.total_signals_found ?? 0) === 0
    ) {
      skipped.push({
        reason:   "No structured signals found and not a recognised shop name",
        raw_text: candidate,
      });
      continue;
    }

    // Build bot_hints_used for the new item
    const botHintsUsed: Record<string, unknown> = {
      source_ingestion: {
        source_url,
        source_name,
        created_from_ingestion: true,
        ingested_at:            now,
        candidate_index:        candidates.indexOf(candidate),
      },
      source_research:  sourceResearchResult,
      ...(extractorResult ? { finding_extractor: extractorResult } : {}),
    };

    // Create the batch item
    const newItem = await createBatchItem(
      batch_id,
      findingType,
      candidate,
      source_url,
      source_name,
      extractedData,
      botHintsUsed,
    );

    if (!newItem) {
      warnings.push(`Failed to create item for candidate: "${candidate.slice(0, 60)}..."`);
      continue;
    }

    seenThisRun.add(normCandidate);
    createdItems.push(newItem);

    // ── Step 7: Optionally run the full pipeline ──────────────────────────────
    if (run_pipeline && pipelineFn && newItem.id) {
      try {
        await pipelineFn(newItem.id as string);
        pipelineRunCount++;
      } catch (pipeErr) {
        warnings.push(`Pipeline failed for item ${newItem.id}: ${String(pipeErr)}`);
      }
    }
  }

  return {
    ok: true,
    source_research_result: sourceResearchResult,
    ingestion_summary: {
      source_url,
      source_name,
      allowed_to_ingest:   true,
      fetched:             true,
      text_length:         plainText.length,
      candidate_count:     candidates.length,
      created_item_count:  createdItems.length,
      skipped_item_count:  skipped.length,
      pipeline_run_count:  pipelineRunCount,
      warnings,
    },
    created_items:      createdItems,
    skipped_candidates: skipped,
  };
}
