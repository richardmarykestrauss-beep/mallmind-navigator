/**
 * Floor Map Extractor Service — Sprint 12C
 *
 * Extracts store names, unit numbers, floor labels and categories from
 * the raw HTML of a mall directory or floor-map page.
 *
 * Strategies tried in order:
 *   1. JSON-LD schema.org (Store / LocalBusiness blocks)
 *   2. HTML data attributes  (data-unit, data-floor, data-store, …)
 *   3. Table-based directory (thead + tbody column detection)
 *   4. Div / list store cards (class-name heuristics)
 *   5. Text-line fallback    (regex on stripped text — lowest confidence)
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

// ── Strategy 5: Text-line fallback ────────────────────────────────────────────

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

  run("json_ld",          extractJsonLd);
  run("data_attributes",  extractDataAttributes);
  run("html_table",       extractFromTable);
  run("html_card",        extractFromCards);

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
