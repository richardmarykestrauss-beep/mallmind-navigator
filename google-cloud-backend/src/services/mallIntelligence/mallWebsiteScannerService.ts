/**
 * Mall Website Scanner Service — Sprint 12C
 *
 * Fetches a mall source URL and extracts links to floor maps, PDFs,
 * images, and store directory pages.  Uses native fetch (Node 20+).
 *
 * Policy:
 *   - 15-second fetch timeout, single request, no retries
 *   - User-Agent identifies the bot
 *   - First 200 kB of response body only
 *   - No cookies stored, no login attempts
 *   - No JavaScript execution
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export type AssetType = "image" | "pdf" | "svg" | "html_embed";

export interface DiscoveredAsset {
  url:          string;
  asset_type:   AssetType;
  floor_label?: string;
  link_text?:   string;
}

export interface ScanWebsiteInput {
  source_id: string;
  url:       string;
}

export interface ScanWebsiteResult {
  source_id:          string;
  page_title?:        string;
  /** Truncated HTML (max 200 kB) — available for immediate extraction. */
  raw_html?:          string;
  discovered_assets:  DiscoveredAsset[];
  scan_duration_ms:   number;
  warnings:           string[];
  error?:             string;
}

// ── Floor-label keyword hints ─────────────────────────────────────────────────

const FLOOR_HINTS: Array<[string, string]> = [
  ["ground floor", "Ground Floor"],
  ["lower ground",  "Lower Ground"],
  ["upper ground",  "Upper Ground"],
  ["upper level",   "Upper Level"],
  ["lower level",   "Lower Level"],
  ["first floor",   "First Floor"],
  ["second floor",  "Second Floor"],
  ["third floor",   "Third Floor"],
  ["level 1",       "Level 1"],
  ["level 2",       "Level 2"],
  ["level 3",       "Level 3"],
  ["basement",      "Basement"],
  ["ground",        "Ground Floor"],
  ["upper",         "Upper Level"],
  ["lower",         "Lower Ground"],
];

function inferFloorLabel(text: string): string | undefined {
  const lower = text.toLowerCase();
  for (const [hint, label] of FLOOR_HINTS) {
    if (lower.includes(hint)) return label;
  }
  return undefined;
}

// URL patterns that suggest floor map or store directory content
const MAP_URL_PATTERNS: RegExp[] = [
  /mall.?map/i,
  /floor.?plan/i,
  /floorplan/i,
  /store.?dir/i,
  /directory/i,
  /tenant/i,
  /shop.?list/i,
  /find.?store/i,
  /store.?guide/i,
];

function resolveUrl(base: string, href: string): string | null {
  try {
    const resolved = new URL(href, base).href;
    // Only allow http/https
    return resolved.startsWith("http") ? resolved : null;
  } catch {
    return null;
  }
}

function extractPageTitle(html: string): string | undefined {
  const m = html.match(/<title[^>]*>([^<]{1,120})<\/title>/i);
  return m ? m[1].trim() : undefined;
}

// ── Asset extraction ──────────────────────────────────────────────────────────

function extractAssets(baseUrl: string, html: string): DiscoveredAsset[] {
  const assets: DiscoveredAsset[] = [];
  const seen   = new Set<string>();

  function add(url: string, type: AssetType, text?: string) {
    if (seen.has(url)) return;
    seen.add(url);
    assets.push({
      url,
      asset_type:  type,
      floor_label: text ? inferFloorLabel(text) : inferFloorLabel(url),
      link_text:   text?.slice(0, 80).trim(),
    });
  }

  let m: RegExpExecArray | null;

  // ── PDF links ──
  const pdfRe = /<a[^>]+href=["']([^"']+\.pdf[^"']*)["'][^>]*>([^<]*)/gi;
  while ((m = pdfRe.exec(html)) !== null) {
    const resolved = resolveUrl(baseUrl, m[1]);
    if (resolved) add(resolved, "pdf", m[2]);
  }

  // ── SVG embeds ──
  const svgRe = /<(?:img|embed|object)[^>]+src=["']([^"']+\.svg[^"']*)["'][^>]*/gi;
  while ((m = svgRe.exec(html)) !== null) {
    const resolved = resolveUrl(baseUrl, m[1]);
    if (resolved) add(resolved, "svg");
  }

  // ── Map/floor images ──
  const imgRe = /<img[^>]+src=["']([^"']*(?:map|floor|plan|level)[^"']*\.(?:jpg|jpeg|png|webp)[^"']*)["'][^>]*/gi;
  while ((m = imgRe.exec(html)) !== null) {
    const resolved = resolveUrl(baseUrl, m[1]);
    if (resolved) add(resolved, "image");
  }

  // ── Directory/map page links ──
  const anchorRe = /<a[^>]+href=["']([^"'#][^"']*)["'][^>]*>([^<]{3,80})<\/a>/gi;
  while ((m = anchorRe.exec(html)) !== null) {
    const href = m[1];
    const text = m[2].trim();
    if (MAP_URL_PATTERNS.some((p) => p.test(href) || p.test(text))) {
      const resolved = resolveUrl(baseUrl, href);
      if (resolved && resolved !== baseUrl) add(resolved, "html_embed", text);
    }
  }

  return assets;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Fetch a mall source URL and extract floor map / directory asset links.
 * Returns the truncated raw HTML so the caller can immediately run extraction.
 */
export async function scanMallWebsite(input: ScanWebsiteInput): Promise<ScanWebsiteResult> {
  const start    = Date.now();
  const warnings: string[] = [];

  const controller = new AbortController();
  const timeoutId  = setTimeout(() => controller.abort(), 15_000);

  let html = "";

  try {
    const response = await fetch(input.url, {
      signal:  controller.signal,
      headers: {
        "User-Agent":      "MallMindBot/1.0 (research-only; +https://mallmind.co.za/bot)",
        "Accept":          "text/html,application/xhtml+xml",
        "Accept-Language": "en-ZA,en;q=0.9",
      },
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return {
        source_id:         input.source_id,
        discovered_assets: [],
        scan_duration_ms:  Date.now() - start,
        warnings,
        error:             `HTTP ${response.status} from ${input.url}`,
      };
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html") && !contentType.includes("application/xhtml")) {
      warnings.push(`Unexpected content-type: ${contentType} — may not be HTML`);
    }

    const fullText = await response.text();
    html           = fullText.slice(0, 204_800); // 200 kB cap

    if (fullText.length > html.length) {
      warnings.push(`Page truncated at 200 kB (full: ${fullText.length.toLocaleString()} bytes)`);
    }
  } catch (e) {
    clearTimeout(timeoutId);
    const message = e instanceof Error ? e.message : String(e);
    return {
      source_id:         input.source_id,
      discovered_assets: [],
      scan_duration_ms:  Date.now() - start,
      warnings,
      error:             message.includes("abort") ? "Fetch timed out after 15 s" : message,
    };
  }

  const pageTitle = extractPageTitle(html);
  const assets    = extractAssets(input.url, html);

  if (assets.length === 0) {
    warnings.push("No floor-map or directory assets detected on this page — page may use JavaScript rendering");
  }

  return {
    source_id:         input.source_id,
    page_title:        pageTitle,
    raw_html:          html,
    discovered_assets: assets,
    scan_duration_ms:  Date.now() - start,
    warnings,
  };
}
