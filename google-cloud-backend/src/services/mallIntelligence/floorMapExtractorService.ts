/**
 * Floor Map Extractor Service — Sprint 12C
 *
 * Extracts store names, unit numbers, floor labels and categories from
 * the raw HTML of a mall directory or floor-map page.
 *
 * Strategies tried in order:
 *   1. JSON-LD schema.org       (Store / LocalBusiness blocks)
 *   2. HTML data attributes     (data-unit, data-floor, data-store, …)
 *   3. Table-based directory    (thead + tbody column detection)
 *   4. Div / list store cards   (class-name heuristics)
 *   5. Embedded script data     (window.__STATE__, __NEXT_DATA__, var stores=[…])
 *   6. Text-line fallback       (regex on stripped text — lowest confidence)
 *
 * No external API calls. No DB access. Pure deterministic logic.
 * All results carry source_url for provenance tracing.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ExtractMapInput {
  source_id:          string;
  source_url:         string;
  html_content:       string;
  mall_id?:           string;
  mall_map_asset_id?: string;
}

export interface StagedStoreLocation {
  shop_name:          string;
  unit_number?:       string;
  floor_label?:       string;
  category?:          string;
  x_percent?:         number;
  y_percent?:         number;
  raw_evidence:       string;
  /** 0–1 */
  confidence:         number;
  extraction_method:  string;
  source_url:         string;
}

export interface ExtractMapResult {
  source_id:        string;
  source_url:       string;
  stores_extracted: StagedStoreLocation[];
  total_found:      number;
  strategies_tried: string[];
  warnings:         string[];
  extraction_log:   string[];
}

// ── Floor label normalisation ─────────────────────────────────────────────────

const FLOOR_NORM: Array<[RegExp, string]> = [
  [/ground\s+floor/i,   "Ground Floor"],
  [/lower\s+ground/i,   "Lower Ground"],
  [/upper\s+ground/i,   "Upper Ground"],
  [/upper\s+level/i,    "Upper Level"],
  [/lower\s+level/i,    "Lower Level"],
  [/first\s+floor/i,    "First Floor"],
  [/second\s+floor/i,   "Second Floor"],
  [/third\s+floor/i,    "Third Floor"],
  [/level\s*1\b/i,      "Level 1"],
  [/level\s*2\b/i,      "Level 2"],
  [/level\s*3\b/i,      "Level 3"],
  [/\bbasement\b/i,     "Basement"],
  // Shorter aliases — only after longer phrases have been tried
  [/\bground\b/i,       "Ground Floor"],
  [/\bupper\b/i,        "Upper Level"],
  [/\blower\b/i,        "Lower Ground"],
];

function normaliseFloor(raw: string): string {
  for (const [pattern, label] of FLOOR_NORM) {
    if (pattern.test(raw)) return label;
  }
  return raw.trim();
}

// ── HTML utilities ────────────────────────────────────────────────────────────

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g,  "&")
    .replace(/&lt;/g,   "<")
    .replace(/&gt;/g,   ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g,  "'")
    .replace(/&nbsp;/g, " ");
}

function cleanText(html: string): string {
  return decodeEntities(stripTags(html)).trim();
}

// ── Garbage shop-name filter ──────────────────────────────────────────────────

const JUNK_NAMES = new Set([
  "click", "here", "view", "more", "read", "see", "back", "home", "menu",
  "search", "login", "sign", "next", "prev", "previous", "all", "filter",
  "sort", "category", "floor", "level", "map",
]);

function isJunkName(name: string): boolean {
  return name.length < 2 || JUNK_NAMES.has(name.toLowerCase());
}

// ── Deduplication ─────────────────────────────────────────────────────────────

function deduplicateStores(stores: StagedStoreLocation[]): StagedStoreLocation[] {
  const best = new Map<string, StagedStoreLocation>();
  for (const s of stores) {
    const key = `${s.shop_name.toLowerCase()}|${s.unit_number ?? ""}|${s.floor_label ?? ""}`;
    const existing = best.get(key);
    if (!existing || s.confidence > existing.confidence) {
      best.set(key, s);
    }
  }
  return [...best.values()];
}

// ── Strategy 1: JSON-LD schema.org ────────────────────────────────────────────

function extractJsonLd(html: string, sourceUrl: string): StagedStoreLocation[] {
  const stores: StagedStoreLocation[] = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;

  while ((m = re.exec(html)) !== null) {
    try {
      const parsed = JSON.parse(m[1]) as unknown;
      const items  = Array.isArray(parsed) ? parsed : [parsed];
      for (const item of items) {
        if (typeof item !== "object" || item === null) continue;
        const obj  = item as Record<string, unknown>;
        const type = (obj["@type"] as string | undefined) ?? "";
        if (!/(Store|LocalBusiness|ShoppingCenter|Retail|Shop)/i.test(type)) continue;

        const name = ((obj.name as string | undefined) ?? "").trim();
        if (!name || isJunkName(name)) continue;

        const address = obj.address as Record<string, unknown> | undefined;
        const floorRaw =
          (obj.floor as string | undefined) ??
          (address?.addressLocality as string | undefined);
        const unit =
          (obj.identifier  as string | undefined) ??
          (obj.branchCode  as string | undefined);

        stores.push({
          shop_name:         name,
          unit_number:       unit ? unit.toUpperCase() : undefined,
          floor_label:       floorRaw ? normaliseFloor(floorRaw) : undefined,
          category:          (obj.description as string | undefined)?.slice(0, 60),
          raw_evidence:      JSON.stringify(obj).slice(0, 200),
          confidence:        0.80,
          extraction_method: "json_ld",
          source_url:        sourceUrl,
        });
      }
    } catch {
      // Invalid JSON-LD — skip silently
    }
  }
  return stores;
}

// ── Strategy 2: Data attributes ───────────────────────────────────────────────

function extractDataAttributes(html: string, sourceUrl: string): StagedStoreLocation[] {
  const stores: StagedStoreLocation[] = [];
  // Match opening tags of block elements that carry a data-store / data-name / data-shop attribute.
  // All related data attributes (unit, floor, category) are on the SAME opening tag.
  const openTagRe = /<(?:div|li|article|section)[^>]*data-(?:store|shop|name|tenant)=["']([^"']+)["'][^>]*/gi;
  let m: RegExpExecArray | null;

  while ((m = openTagRe.exec(html)) !== null) {
    const fullTag   = m[0];
    const attrName  = cleanText(m[1]);
    if (!attrName || isJunkName(attrName)) continue;

    // All attributes live on the same opening tag — search fullTag, not inner content
    const unitAttr  = fullTag.match(/data-(?:unit|shopno)=["']([^"']+)["']/i)?.[1];
    const floorAttr = fullTag.match(/data-(?:floor|level)=["']([^"']+)["']/i)?.[1];
    const catAttr   = fullTag.match(/data-categor[^=]*=["']([^"']+)["']/i)?.[1];

    stores.push({
      shop_name:         attrName,
      unit_number:       unitAttr?.toUpperCase(),
      floor_label:       floorAttr ? normaliseFloor(floorAttr) : undefined,
      category:          catAttr,
      raw_evidence:      `${attrName}|${unitAttr ?? ""}|${floorAttr ?? ""}`.slice(0, 200),
      confidence:        0.70,
      extraction_method: "data_attributes",
      source_url:        sourceUrl,
    });
  }
  return stores;
}

// ── Strategy 3: HTML table directory ─────────────────────────────────────────

function extractFromTable(html: string, sourceUrl: string): StagedStoreLocation[] {
  const stores: StagedStoreLocation[] = [];
  const tableRe = /<table[^>]*>([\s\S]*?)<\/table>/gi;
  let tableM: RegExpExecArray | null;

  while ((tableM = tableRe.exec(html)) !== null) {
    const tableHtml = tableM[1];

    // Header row — use thead if present, otherwise first tr
    const headerSrc =
      tableHtml.match(/<thead[^>]*>([\s\S]*?)<\/thead>/i)?.[1] ??
      tableHtml.match(/<tr[^>]*>([\s\S]*?)<\/tr>/i)?.[1] ?? "";

    const headers = [...headerSrc.matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)]
      .map((c) => cleanText(c[1]).toLowerCase());

    const nameCol  = headers.findIndex((h) => /store|shop|name|tenant|retailer/.test(h));
    const unitCol  = headers.findIndex((h) => /\bunit\b|shop\s*no|shop\s*number/.test(h));
    const floorCol = headers.findIndex((h) => /floor|level/.test(h));
    const catCol   = headers.findIndex((h) => /categor|type|sector/.test(h));

    if (nameCol === -1) continue; // Can't identify store name column

    const tbodySrc = tableHtml.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/i)?.[1] ?? tableHtml;
    const rowRe    = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let rowM: RegExpExecArray | null;
    let rowIdx = 0;

    while ((rowM = rowRe.exec(tbodySrc)) !== null) {
      rowIdx++;
      if (rowIdx === 1 && !tableHtml.includes("<tbody")) continue; // skip header row

      const cells = [...rowM[1].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)]
        .map((c) => cleanText(c[1]));

      const name  = cells[nameCol]?.trim();
      if (!name || isJunkName(name) || name.toLowerCase() === (headers[nameCol] ?? "")) continue;

      const unit  = unitCol  !== -1 ? cells[unitCol]?.trim()  : undefined;
      const floor = floorCol !== -1 ? cells[floorCol]?.trim() : undefined;
      const cat   = catCol   !== -1 ? cells[catCol]?.trim()   : undefined;

      stores.push({
        shop_name:         name,
        unit_number:       unit  ? unit.toUpperCase() : undefined,
        floor_label:       floor ? normaliseFloor(floor) : undefined,
        category:          cat,
        raw_evidence:      cells.slice(0, 5).join(" | ").slice(0, 200),
        confidence:        0.75,
        extraction_method: "html_table",
        source_url:        sourceUrl,
      });
    }
  }
  return stores;
}

// ── Strategy 4: Div / list card patterns ─────────────────────────────────────

const STORE_CLASSES = [
  "store", "shop", "tenant", "retailer", "listing", "directory",
  "store-item", "shop-item", "store-card", "tenant-item", "store-listing",
];

function extractFromCards(html: string, sourceUrl: string): StagedStoreLocation[] {
  const stores: StagedStoreLocation[] = [];
  const classJoin = STORE_CLASSES.join("|");

  const cardRe = new RegExp(
    `<(?:div|li|article)[^>]+class=["'][^"']*(?:${classJoin})[^"']*["'][^>]*>([\\s\\S]{10,600}?)</(?:div|li|article)>`,
    "gi",
  );
  let m: RegExpExecArray | null;

  while ((m = cardRe.exec(html)) !== null) {
    const inner = m[1];
    const text  = cleanText(inner);
    if (text.length < 3) continue;

    // Name — prefer heading or strong
    const nameM = inner.match(/<(?:h[2-5]|strong|b)[^>]*>([^<]{2,60})<\/(?:h[2-5]|strong|b)>/i);
    const name  = nameM ? cleanText(nameM[1]) : undefined;
    if (!name || isJunkName(name)) continue;

    // Unit number
    const unitM =
      inner.match(/(?:unit|shop|store)\s*[#:]?\s*([A-Z]{0,3}\d{1,4}[A-Z]?)/i) ??
      inner.match(/\b([A-Z]{1,3}\d{1,4}[A-Z]?)\b/);
    const unit = unitM?.[1]?.toUpperCase();

    // Floor label
    let floor: string | undefined;
    for (const [pattern, label] of FLOOR_NORM) {
      if (pattern.test(text)) { floor = label; break; }
    }

    // Category
    const catM = inner.match(/data-categor[^=]*=["']([^"']+)["']|<span[^>]+class=["'][^"']*categor[^"']*["'][^>]*>([^<]+)<\/span>/i);
    const cat  = catM ? cleanText(catM[1] ?? catM[2] ?? "") : undefined;

    stores.push({
      shop_name:         name,
      unit_number:       unit,
      floor_label:       floor,
      category:          cat || undefined,
      raw_evidence:      text.slice(0, 200),
      confidence:        0.65,
      extraction_method: "html_card",
      source_url:        sourceUrl,
    });
  }
  return stores;
}

// ── Strategy 5: Embedded script data ─────────────────────────────────────────
//
// Inspects <script> tag contents for common JS data-embedding patterns:
//   • window.__INITIAL_STATE__ = { … }
//   • window.__NEXT_DATA__     = { … }
//   • var/const/let stores     = [ … ]
//   • <script type="application/json"> blocks
//   • WordPress wp_localize_script outputs
//
// Uses a character-level balanced-bracket scanner — no eval, no regex JSON.
// Confidence: 0.60 (script data is reliable but field mapping is heuristic).
// ─────────────────────────────────────────────────────────────────────────────

/** Keys that indicate an array is a store directory. All lowercase for comparison. */
const STORE_ARRAY_KEYS = new Set([
  "stores", "tenants", "shops", "retailers", "directory",
  "mallmap", "items", "listings", "storelist", "shoplist",
  "tenantlist", "storedirectory", "storelistings", "tenantlistings",
  "units", "retailers_list", "mallstores", "floordata",
]);

/** Keys used to pick shop name — checked in order, lowercased. */
const NAME_KEYS  = [
  "name", "storename", "shopname", "title", "retailer",
  "store", "shop", "tenant", "tradingname", "brandname",
];
/** Keys used to pick unit number — checked in order, lowercased. */
const UNIT_KEYS  = [
  "unit", "unitnumber", "shopnumber", "shopno", "unit_number",
  "storenumber", "code", "identifier", "shopcode", "tenantcode",
  "store_number",
];
/** Keys used to pick floor label — checked in order, lowercased. */
const FLOOR_KEYS = [
  "floor", "level", "floorname", "levelname", "floorlevel",
  "floor_label", "floornumber", "levelnumber",
];
/** Keys used to pick category — checked in order, lowercased. */
const CAT_KEYS   = [
  "category", "type", "storetype", "shoptype",
  "classification", "sector", "tradecategory",
];

/** Build a lowercase-keyed copy of an object for fast case-insensitive lookups. */
function lowerKeys(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) out[k.toLowerCase()] = v;
  return out;
}

/** Return the first truthy value whose key (lowercase) appears in `keys`. */
function getFirst(lk: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = lk[k];
    if (v !== undefined && v !== null) {
      const s = String(v).trim();
      if (s) return s;
    }
  }
  return undefined;
}

/**
 * Extract the smallest balanced JSON object or array starting at `start`.
 * Character-level scan: handles nested structures and quoted strings without
 * executing JavaScript.  Returns null if extraction fails or cap is hit.
 */
function extractBalancedJson(text: string, start: number): string | null {
  const opener = text[start];
  if (opener !== "{" && opener !== "[") return null;

  let depth    = 0;
  let inString = false;
  let escape   = false;
  const cap    = Math.min(text.length, start + 400_000); // 400 kB guard

  for (let i = start; i < cap; i++) {
    const ch = text[i];
    if (escape)   { escape = false; continue; }
    if (inString) {
      if (ch === "\\") escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"')             { inString = true; continue; }
    if (ch === "{" || ch === "[") depth++;
    else if (ch === "}" || ch === "]") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * Recursively collect arrays that live under store-directory key names.
 * Stops at depth 6 to avoid runaway traversal.
 */
function collectStoreArrays(obj: unknown, depth = 0): unknown[][] {
  if (depth > 6) return [];
  if (Array.isArray(obj)) return [obj]; // top-level array → treat as store list
  if (typeof obj !== "object" || obj === null) return [];

  const result: unknown[][] = [];
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (Array.isArray(value) && (value as unknown[]).length > 0) {
      if (STORE_ARRAY_KEYS.has(key.toLowerCase())) {
        result.push(value as unknown[]);
      }
    } else if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      result.push(...collectStoreArrays(value, depth + 1));
    }
  }
  return result;
}

/**
 * Convert a raw JS object (from parsed script JSON) into StagedStoreLocation entries.
 * Uses case-insensitive key matching via the lowercased-key map.
 */
function parseStoreArray(
  arr:       unknown[],
  evidence:  string,
  sourceUrl: string,
): StagedStoreLocation[] {
  const out: StagedStoreLocation[] = [];
  for (const item of arr) {
    if (typeof item !== "object" || item === null) continue;
    const lk = lowerKeys(item as Record<string, unknown>);

    const name = getFirst(lk, NAME_KEYS);
    if (!name || isJunkName(name)) continue;

    const unit  = getFirst(lk, UNIT_KEYS);
    const floor = getFirst(lk, FLOOR_KEYS);
    const cat   = getFirst(lk, CAT_KEYS);

    const xRaw = lk.x_percent ?? lk.xpercent ?? lk.x_pos ?? lk.xpos;
    const yRaw = lk.y_percent ?? lk.ypercent ?? lk.y_pos ?? lk.ypos;

    out.push({
      shop_name:         name.trim(),
      unit_number:       unit ? unit.toUpperCase() : undefined,
      floor_label:       floor ? normaliseFloor(floor) : undefined,
      category:          cat ? cat.slice(0, 60) : undefined,
      x_percent:         typeof xRaw === "number" ? xRaw : undefined,
      y_percent:         typeof yRaw === "number" ? yRaw : undefined,
      raw_evidence:      evidence.slice(0, 200),
      confidence:        0.60,
      extraction_method: "embedded_script_data",
      source_url:        sourceUrl,
    });
  }
  return out;
}

/** Patterns whose match ends just before the opening `{` or `[`. */
const JS_INJECTION_PATTERNS: RegExp[] = [
  // window.__ANYTHING__ =
  /window\.__[A-Z_]+__\s*=/g,
  // var/const/let <storeKeyword> =
  /(?:var|const|let)\s+(?:stores?|tenants?|shops?|retailers?|directory|storeList|shopList|tenantList|mallData|mallStores?|floorData|storeDirectory|mapData|directoryData)\s*=/gi,
  // WordPress localizeScript: var <anything> = {"stores": [...]}
  /var\s+\w+\s*=\s*(?=\{)/g,
];

function extractEmbeddedScriptData(html: string, sourceUrl: string): StagedStoreLocation[] {
  const stores: StagedStoreLocation[] = [];

  // Collect all script tag contents (skip ld+json — handled by json_ld strategy)
  const scriptRe = /<script(?![^>]*application\/ld\+json)[^>]*>([\s\S]*?)<\/script>/gi;
  const scriptContents: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = scriptRe.exec(html)) !== null) {
    const content = m[1]?.trim() ?? "";
    if (content.length > 30) scriptContents.push(content);
  }

  for (const content of scriptContents) {
    const tried = new Set<number>();

    // ── Attempt 1: the whole script tag might be pure JSON ─────────────────
    const firstCh = content[0];
    if (firstCh === "{" || firstCh === "[") {
      tried.add(0);
      const jsonStr = extractBalancedJson(content, 0);
      if (jsonStr) {
        try {
          const parsed = JSON.parse(jsonStr) as unknown;
          for (const arr of collectStoreArrays(parsed)) {
            stores.push(...parseStoreArray(arr, jsonStr, sourceUrl));
          }
        } catch { /* not valid JSON */ }
      }
    }

    // ── Attempt 2: known injection patterns ───────────────────────────────
    for (const pattern of JS_INJECTION_PATTERNS) {
      pattern.lastIndex = 0;
      while ((m = pattern.exec(content)) !== null) {
        // Skip whitespace after the `=` to find the opening bracket
        let start = m.index + m[0].length;
        while (start < content.length && /\s/.test(content[start])) start++;
        if (start >= content.length) continue;
        const ch = content[start];
        if (ch !== "{" && ch !== "[") continue;
        if (tried.has(start)) continue;
        tried.add(start);

        const jsonStr = extractBalancedJson(content, start);
        if (!jsonStr || jsonStr.length < 10) continue;
        try {
          const parsed = JSON.parse(jsonStr) as unknown;
          for (const arr of collectStoreArrays(parsed)) {
            stores.push(...parseStoreArray(arr, jsonStr, sourceUrl));
          }
        } catch { /* not valid JSON */ }
      }
    }
  }

  return stores;
}

// ── Strategy 6: Text-line fallback ────────────────────────────────────────────

const LINE_UNIT_RE  = /\b([A-Z]{0,3}\d{1,4}[A-Z]?)\b/;
const LINE_FLOOR_RE = /ground\s*floor|upper\s*level|lower\s*level|lower\s*ground|upper\s*ground|first\s*floor|second\s*floor|level\s*\d/i;
const LINE_PRICE_RE = /\bR\s*\d/; // Skip product/price lines

function extractFromTextLines(html: string, sourceUrl: string): StagedStoreLocation[] {
  const stores: StagedStoreLocation[] = [];

  // Strip scripts and styles first
  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi,  " ");

  const text  = cleanText(stripped);
  const lines = text
    .split(/[\n\r|]|(?<=\S)\s{3,}(?=\S)/)
    .map((l) => l.trim())
    .filter((l) => l.length > 3 && l.length < 200);

  for (const line of lines) {
    if (LINE_PRICE_RE.test(line)) continue;

    const unitM  = line.match(LINE_UNIT_RE);
    const floorM = line.match(LINE_FLOOR_RE);
    if (!unitM && !floorM) continue;

    const unit = unitM?.[1];
    let name   = unit
      ? line.slice(0, line.indexOf(unit)).replace(/[-–|,]/g, "").trim()
      : line;
    name = name.replace(/^\s*(?:shop|unit|store)\s*/i, "").trim();
    if (!name || isJunkName(name)) continue;

    const floor = floorM ? normaliseFloor(floorM[0]) : undefined;

    stores.push({
      shop_name:         name,
      unit_number:       unit,
      floor_label:       floor,
      raw_evidence:      line.slice(0, 200),
      confidence:        0.45,
      extraction_method: "text_line",
      source_url:        sourceUrl,
    });
  }
  return stores;
}

// ── Main entry point ──────────────────────────────────────────────────────────

/**
 * Extract store locations from raw HTML of a mall directory / floor-map page.
 * Returns all found stores with provenance (source_url, raw_evidence, method).
 * Never writes to DB — caller handles persistence.
 */
export function extractStoreLocations(input: ExtractMapInput): ExtractMapResult {
  const log:        string[] = [];
  const warnings:   string[] = [];
  const strategies: string[] = [];

  if (!input.html_content || input.html_content.trim().length < 50) {
    return {
      source_id:        input.source_id,
      source_url:       input.source_url,
      stores_extracted: [],
      total_found:      0,
      strategies_tried: [],
      warnings:         ["html_content is empty or too short to parse"],
      extraction_log:   ["Skipped — no content"],
    };
  }

  const html = input.html_content;
  let all:    StagedStoreLocation[] = [];

  function run(
    label: string,
    fn:    (h: string, url: string) => StagedStoreLocation[],
  ): void {
    const found = fn(html, input.source_url);
    if (found.length > 0) {
      strategies.push(label);
      log.push(`${label}: found ${found.length}`);
      all = all.concat(found);
    } else {
      log.push(`${label}: 0`);
    }
  }

  run("json_ld",             extractJsonLd);
  run("data_attributes",     extractDataAttributes);
  run("html_table",          extractFromTable);
  run("html_card",           extractFromCards);
  run("embedded_script_data", extractEmbeddedScriptData);

  // Text-line fallback only when all structured strategies found nothing
  if (all.length === 0) {
    run("text_line", extractFromTextLines);
    if (all.length === 0) {
      warnings.push("No stores found — page may require JavaScript rendering or is not a directory page");
    }
  }

  const deduped  = deduplicateStores(all);
  const removed  = all.length - deduped.length;
  if (removed > 0) log.push(`dedup: removed ${removed} duplicates`);

  const filtered = deduped.filter((s) => !isJunkName(s.shop_name));
  const dropped  = deduped.length - filtered.length;
  if (dropped > 0) log.push(`filter: dropped ${dropped} junk names`);

  log.push(`final: ${filtered.length} stores`);

  return {
    source_id:        input.source_id,
    source_url:       input.source_url,
    stores_extracted: filtered,
    total_found:      filtered.length,
    strategies_tried: strategies,
    warnings,
    extraction_log:   log,
  };
}
