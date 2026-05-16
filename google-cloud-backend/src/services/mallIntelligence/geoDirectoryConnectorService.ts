/**
 * GeoDirectory Connector Service — Sprint 12C.2
 *
 * Integrates with WordPress GeoDirectory REST API endpoints
 * (/wp-json/geodir/v2/stores) to pull structured store records and stage them
 * in mall_store_locations_staged.
 *
 * Exports:
 *   detectGeoDirectoryApi          — probe a site for the GeoDirectory API
 *   fetchGeoDirectoryStores        — paginated GET of all store records
 *   normalizeGeoDirectoryStore     — convert raw API record → staging shape
 *   importGeoDirectoryStoresForSource — orchestrator (used by route)
 *   parseGeoDirectoryContent       — exported for unit testing
 *   inferFloorFromStoreCode        — exported for unit testing
 *   stripGeoHtml                   — exported for unit testing
 *
 * Policy:
 *   • Read-only GET requests — no POST / DELETE against the remote API
 *   • Polite User-Agent, 15-second timeout per request, no retry storms
 *   • No writes to live shops / products / mall_nodes tables
 *   • All results staged as review_status = "pending"
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface GeoDirectoryDetectResult {
  detected:        boolean;
  api_url:         string;        // e.g. https://www.menlynpark.co.za/wp-json/geodir/v2
  stores_endpoint: string;        // api_url + /stores
  route_names:     string[];      // geodir route names from discovery doc
  warnings:        string[];
}

export interface GeoDirectoryRawStore {
  id:              number;
  title:           { raw?: string; rendered?: string };
  link:            string;
  modified:        string;
  content:         { raw?: string; rendered?: string };
  post_category?:  Array<{ id: number; name: string; slug: string }>;
  street?:         string;
  latitude?:       number | string | null;
  longitude?:      number | string | null;
  featured_image?: string | null;
  images?:         Array<{ src: string }>;
}

export interface GeoDirectoryFetchResult {
  stores:        GeoDirectoryRawStore[];
  pages_fetched: number;
  total_fetched: number;
  warnings:      string[];
}

export interface GeoDirectoryParsedContent {
  unit_number?:   string;
  floor_label?:   string;
  phone?:         string;
  website?:       string;
  parking_hint?:  string;
  entrance_hint?: string;
  road_name?:     string;
}

export interface NormalizedGeoDirectoryStore {
  // Core staging fields
  shop_name:          string;
  unit_number?:       string;
  floor_label?:       string;
  category?:          string;
  source_url:         string;
  raw_evidence:       string;
  confidence:         number;
  extraction_method:  "geodirectory_api";
  // GeoDirectory enrichment columns (migration 014)
  geodir_store_id:    number;
  phone?:             string;
  website?:           string;
  latitude?:          number;
  longitude?:         number;
  parking_hint?:      string;
  entrance_hint?:     string;
  road_name?:         string;
  source_modified_at?: string;
  image_url?:         string;
  // Per-record warnings (not persisted, used by caller for logging)
  warnings:           string[];
}

export interface GeoDirectoryImportResult {
  source_id:       string;
  detected:        boolean;
  api_url:         string;
  stores_endpoint: string;
  pages_fetched:   number;
  records_found:   number;
  stores_staged:   number;
  stores_updated:  number;
  insert_errors:   string[];
  warnings:        string[];
  sample_stores:   NormalizedGeoDirectoryStore[];
}

// ── Constants ─────────────────────────────────────────────────────────────────

const POLITE_UA  = "MallMind-Intelligence/1.0 (+https://mallmind.co.za/bot)";
const TIMEOUT_MS = 15_000;

/**
 * Safe UI defaults — small enough to complete within Cloud Run's 60-second
 * response timeout even on a cold instance with a slow remote API.
 * Exported so the route can use them as fallback values and the harness
 * can assert them.
 */
export const DEFAULT_IMPORT_PER_PAGE  = 25;
export const DEFAULT_IMPORT_MAX_PAGES = 1;

/** Hard ceilings — the route must clamp caller values to these before calling
 *  importGeoDirectoryStoresForSource. Never raise these without load-testing. */
export const ABSOLUTE_MAX_PER_PAGE = 100;
export const ABSOLUTE_MAX_PAGES    = 10;

/** Records per Supabase upsert batch.  Keeps individual payloads small. */
export const UPSERT_BATCH_SIZE = 25;

// ── HTTP helper ───────────────────────────────────────────────────────────────

async function fetchJson(url: string): Promise<Response> {
  const controller = new AbortController();
  const timer      = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, {
      signal:  controller.signal,
      headers: {
        "User-Agent": POLITE_UA,
        "Accept":     "application/json",
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

// ── Floor label inference from store-code prefix ─────────────────────────────

/**
 * Canonical floor labels derived from GeoDirectory store-code prefixes.
 * Menlyn Park uses codes like "LF 111" (Lower Floor), "GF 042", "UF 019".
 */
const STORE_CODE_FLOOR_MAP: Array<[RegExp, string]> = [
  [/^GF/i,  "Ground Floor"],
  [/^LF/i,  "Lower Ground"],
  [/^UF/i,  "Upper Level"],
  [/^FF/i,  "First Floor"],
  [/^1F/i,  "First Floor"],
  [/^2F/i,  "Second Floor"],
  [/^3F/i,  "Third Floor"],
  [/^BF/i,  "Basement"],
  [/^B\d/i, "Basement"],
];

/**
 * Given a store code like "LF 111", return a canonical floor label.
 * Returns undefined when the prefix is unrecognised.
 * Exported for unit testing.
 */
export function inferFloorFromStoreCode(code: string): string | undefined {
  // Take only the first whitespace-separated token (e.g. "LF 111" → "LF", "1F 007" → "1F")
  // Using a naive regex strip (/\s*\d+.*$/) would eat the leading digit in codes like "1F".
  const codeOnly = code.trim().split(/\s+/)[0] ?? "";
  if (!codeOnly) return undefined;
  for (const [pattern, label] of STORE_CODE_FLOOR_MAP) {
    if (pattern.test(codeOnly)) return label;
  }
  return undefined;
}

// ── HTML / text utilities ─────────────────────────────────────────────────────

/**
 * Strip HTML tags and decode common entities.
 * Exported for unit testing.
 */
export function stripGeoHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g,   "&")
    .replace(/&nbsp;/g,  " ")
    .replace(/&lt;/g,    "<")
    .replace(/&gt;/g,    ">")
    .replace(/&quot;/g,  '"')
    .replace(/&#8211;/g, "–")
    .replace(/\s+/g,     " ")
    .trim();
}

// ── GeoDirectory content parser ───────────────────────────────────────────────

/**
 * Extract structured fields from the content.raw / content.rendered of a
 * GeoDirectory store record.  The content typically looks like:
 *
 *   Website: https://www.example.com
 *   Contact Details: 012 345 6789
 *   How to find us
 *   Road Name: Atterbury Road
 *   Park in the: Yellow Parking
 *   Enter at entrance: 14
 *   Store Code: LF 111
 *
 * Pure function — no DB / HTTP calls.  Exported for unit testing.
 */
export function parseGeoDirectoryContent(rawContent: string): GeoDirectoryParsedContent {
  const text   = stripGeoHtml(rawContent);
  const result: GeoDirectoryParsedContent = {};

  // Store Code: LF 111  (also accepts dash separator)
  const codeM = text.match(/Store\s+Code\s*[:\-]\s*([A-Z]{1,3}\s*\d{1,4}[A-Z]?)/i);
  if (codeM) {
    result.unit_number = codeM[1].trim().toUpperCase();
    result.floor_label = inferFloorFromStoreCode(result.unit_number);
  }

  // Park in the: Yellow Parking  (stop at next keyword or end)
  const parkM = text.match(
    /Park\s+in\s+the\s*[:\-]\s*(.+?)(?=\s+Enter\s+at|\s+Store\s+Code|\s+Road\s+Name|\s+Website|\s+Contact|$)/i,
  );
  if (parkM) result.parking_hint = parkM[1].trim().replace(/\s+/g, " ");

  // Enter at entrance: 14  (stop at next keyword or end)
  const entM = text.match(
    /Enter\s+at\s+entrance\s*[:\-]\s*(.+?)(?=\s+Store\s+Code|\s+Park\s+in|\s+Road\s+Name|\s+Website|\s+Contact|$)/i,
  );
  if (entM) result.entrance_hint = entM[1].trim().replace(/\s+/g, " ");

  // Road Name: Atterbury Road  (stop at next keyword or end)
  const roadM = text.match(
    /Road\s+Name\s*[:\-]\s*(.+?)(?=\s+Park\s+in|\s+Enter\s+at|\s+Store\s+Code|\s+Website|\s+Contact|$)/i,
  );
  if (roadM) result.road_name = roadM[1].trim().replace(/\s+/g, " ");

  // Website: https://...
  const webM = text.match(/Website\s*[:\-]\s*(https?:\/\/[^\s,]+)/i);
  if (webM) result.website = webM[1].trim();

  // Contact Details: 012 345 6789
  const phoneM = text.match(/Contact\s+Details?\s*[:\-]\s*([\d\s\-+()[\]]{7,25})/i);
  if (phoneM) result.phone = phoneM[1].trim();

  return result;
}

// ── Detection ─────────────────────────────────────────────────────────────────

/**
 * Given any page URL on a WordPress + GeoDirectory site, probe the WP REST API
 * namespace discovery document to confirm a /geodir/v2/stores route exists.
 *
 * Example: detectGeoDirectoryApi("https://www.menlynpark.co.za/mall-map/")
 * Will check: https://www.menlynpark.co.za/wp-json/geodir/v2/
 */
export async function detectGeoDirectoryApi(baseUrl: string): Promise<GeoDirectoryDetectResult> {
  const warnings: string[] = [];
  let origin: string;

  try {
    const u = new URL(baseUrl);
    origin  = `${u.protocol}//${u.host}`;
  } catch {
    return {
      detected:        false,
      api_url:         "",
      stores_endpoint: "",
      route_names:     [],
      warnings:        [`Invalid URL: ${baseUrl}`],
    };
  }

  const discoveryUrl   = `${origin}/wp-json/geodir/v2/`;
  const apiUrl         = `${origin}/wp-json/geodir/v2`;
  const storesEndpoint = `${apiUrl}/stores`;

  try {
    const res = await fetchJson(discoveryUrl);

    if (!res.ok) {
      return {
        detected:        false,
        api_url:         apiUrl,
        stores_endpoint: storesEndpoint,
        route_names:     [],
        warnings:        [`GeoDirectory discovery returned HTTP ${res.status}`],
      };
    }

    const body = await res.json() as unknown;
    if (typeof body !== "object" || body === null) {
      return {
        detected:        false,
        api_url:         apiUrl,
        stores_endpoint: storesEndpoint,
        route_names:     [],
        warnings:        ["Discovery response was not a JSON object"],
      };
    }

    const routes     = (body as Record<string, unknown>).routes as
                       Record<string, unknown> | undefined;
    const routeNames = routes ? Object.keys(routes) : [];

    // Accept any route whose path contains both "geodir" and "stores"
    const hasStores  = routeNames.some(
      (r) => r.toLowerCase().includes("geodir") && r.toLowerCase().includes("stores"),
    );

    if (routeNames.length === 0) {
      warnings.push("No routes in GeoDirectory discovery document");
    } else if (!hasStores) {
      warnings.push("/stores not listed in GeoDirectory discovery document");
    }

    return {
      detected:        hasStores,
      api_url:         apiUrl,
      stores_endpoint: storesEndpoint,
      route_names:     routeNames
        .filter((r) => r.toLowerCase().includes("geodir"))
        .slice(0, 20),
      warnings,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      detected:        false,
      api_url:         apiUrl,
      stores_endpoint: storesEndpoint,
      route_names:     [],
      warnings:        [
        msg.toLowerCase().includes("abort")
          ? "Detection timed out after 15 s"
          : `Detection failed: ${msg}`,
      ],
    };
  }
}

// ── Fetching ──────────────────────────────────────────────────────────────────

/**
 * Paginate through the GeoDirectory /stores endpoint.
 * Stops when: page returns empty array, fewer items than per_page, or
 * the safety limit is reached.
 */
export async function fetchGeoDirectoryStores(
  storesEndpoint: string,
  options: { per_page?: number; max_pages?: number } = {},
): Promise<GeoDirectoryFetchResult> {
  const perPage  = options.per_page  ?? DEFAULT_IMPORT_PER_PAGE;
  const maxPages = options.max_pages ?? DEFAULT_IMPORT_MAX_PAGES;
  const warnings: string[] = [];
  const allStores: GeoDirectoryRawStore[] = [];
  let pagesFetched = 0;

  for (let page = 1; page <= maxPages; page++) {
    const url = `${storesEndpoint}?per_page=${perPage}&page=${page}`;
    let stores: GeoDirectoryRawStore[];

    try {
      const res = await fetchJson(url);
      if (!res.ok) {
        warnings.push(`Page ${page}: HTTP ${res.status} — stopping pagination`);
        break;
      }
      const batch = await res.json() as unknown;
      if (!Array.isArray(batch)) {
        warnings.push(`Page ${page}: response was not an array — stopping pagination`);
        break;
      }
      stores = batch as GeoDirectoryRawStore[];
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      warnings.push(
        `Page ${page}: ${msg.toLowerCase().includes("abort") ? "timed out after 15 s" : msg}`,
      );
      break;
    }

    pagesFetched = page;
    allStores.push(...stores);

    // Stop conditions
    if (stores.length === 0 || stores.length < perPage) break;

    if (page === maxPages) {
      warnings.push(
        `Safety limit of ${maxPages} pages reached — additional stores may exist`,
      );
    }
  }

  return {
    stores:        allStores,
    pages_fetched: pagesFetched,
    total_fetched: allStores.length,
    warnings,
  };
}

// ── Normalisation ─────────────────────────────────────────────────────────────

/**
 * Convert a raw GeoDirectory API store record into the normalised shape used
 * for staging in mall_store_locations_staged.
 *
 * Pure function — no DB or HTTP calls.  Exported for unit testing.
 *
 * Confidence:
 *   0.85  — shop_name + source_url (always available from API)
 *   0.90  — above + unit_number extracted from Store Code field
 */
export function normalizeGeoDirectoryStore(
  record:    GeoDirectoryRawStore,
  sourceUrl: string,
): NormalizedGeoDirectoryStore {
  const warnings: string[] = [];

  // Shop name — prefer raw (no HTML entities / tags)
  const shopName = (record.title?.raw ?? record.title?.rendered ?? "").trim();
  if (!shopName) warnings.push(`Store ID ${record.id} has no title`);
  const displayName = shopName
    ? stripGeoHtml(shopName)   // handle any stray HTML in title
    : `GeoDir Store ${record.id}`;

  // Category — first category from post_category array
  const category = record.post_category?.[0]?.name;

  // Parse structured content fields
  const rawContent  = record.content?.raw ?? record.content?.rendered ?? "";
  const rawEvidence = rawContent
    ? stripGeoHtml(rawContent).slice(0, 300)
    : `GeoDirectory store ID ${record.id}`;
  const parsed = parseGeoDirectoryContent(rawContent);

  // GPS coordinates
  const toCoord = (v: number | string | null | undefined): number | undefined => {
    if (v === null || v === undefined || v === "") return undefined;
    const n = typeof v === "number" ? v : parseFloat(String(v));
    return isNaN(n) || n === 0 ? undefined : n;
  };
  const latitude  = toCoord(record.latitude);
  const longitude = toCoord(record.longitude);

  // Image
  const imageUrl = record.featured_image
    ?? record.images?.[0]?.src
    ?? undefined;

  // Confidence
  const confidence = parsed.unit_number ? 0.90 : 0.85;

  if (!parsed.unit_number) {
    warnings.push(`No "Store Code:" found in content for "${displayName}"`);
  }
  if (parsed.unit_number && !parsed.floor_label) {
    warnings.push(
      `Could not infer floor from store code "${parsed.unit_number}" for "${displayName}"`,
    );
  }

  return {
    shop_name:          displayName,
    unit_number:        parsed.unit_number,
    floor_label:        parsed.floor_label,
    category,
    source_url:         record.link || sourceUrl,
    raw_evidence:       rawEvidence,
    confidence,
    extraction_method:  "geodirectory_api",
    geodir_store_id:    record.id,
    phone:              parsed.phone,
    website:            parsed.website,
    latitude,
    longitude,
    parking_hint:       parsed.parking_hint,
    entrance_hint:      parsed.entrance_hint,
    road_name:          parsed.road_name,
    source_modified_at: record.modified || undefined,
    image_url:          imageUrl,
    warnings,
  };
}

// ── Orchestrator ──────────────────────────────────────────────────────────────

/**
 * Full import orchestration for a single mall_source:
 *   1. Load source from DB
 *   2. Use stored geodir_api_url or detect from source URL
 *   3. Fetch store pages (respecting options.maxPages / options.perPage)
 *   4. Normalise each record
 *   5. Batch-upsert into mall_store_locations_staged in chunks of UPSERT_BATCH_SIZE
 *      Deduplication uses the unique index on (mall_source_id, geodir_store_id)
 *      created by migration 015.
 *   6. Return GeoDirectoryImportResult
 *
 * Accepts a SupabaseClient (typed as any) so the route can inject the
 * service-role client without creating a circular import.
 * Does NOT write to live tables.
 *
 * Default options: maxPages = DEFAULT_IMPORT_MAX_PAGES (1),
 *                  perPage  = DEFAULT_IMPORT_PER_PAGE  (25).
 * The route clamps caller values against ABSOLUTE_MAX_* before calling here.
 */
export async function importGeoDirectoryStoresForSource(
  sourceId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  options?: { maxPages?: number; perPage?: number },
): Promise<GeoDirectoryImportResult> {
  const warnings:     string[] = [];
  const insertErrors: string[] = [];

  const maxPages = options?.maxPages ?? DEFAULT_IMPORT_MAX_PAGES;
  const perPage  = options?.perPage  ?? DEFAULT_IMPORT_PER_PAGE;

  // ── Load source ────────────────────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const { data: source, error: loadErr } = await supabase
    .from("mall_sources")
    .select("*")
    .eq("id", sourceId)
    .maybeSingle();

  if (loadErr || !source) {
    return {
      source_id:       sourceId,
      detected:        false,
      api_url:         "",
      stores_endpoint: "",
      pages_fetched:   0,
      records_found:   0,
      stores_staged:   0,
      stores_updated:  0,
      insert_errors:   ["Source not found in mall_sources"],
      warnings:        [],
      sample_stores:   [],
    };
  }

  const src = source as Record<string, unknown>;

  // ── Resolve API endpoint ───────────────────────────────────────────────────
  let apiUrl         = (src.geodir_api_url as string | undefined) ?? "";
  let storesEndpoint = apiUrl ? `${apiUrl}/stores` : "";
  let detected       = !!(src.geodir_detected as boolean | undefined);

  if (!apiUrl) {
    const detectResult = await detectGeoDirectoryApi(src.url as string);
    warnings.push(...detectResult.warnings);
    if (!detectResult.detected) {
      return {
        source_id:       sourceId,
        detected:        false,
        api_url:         detectResult.api_url,
        stores_endpoint: detectResult.stores_endpoint,
        pages_fetched:   0,
        records_found:   0,
        stores_staged:   0,
        stores_updated:  0,
        insert_errors:   [],
        warnings: [
          `GeoDirectory API not detected at ${src.url as string}`,
          ...detectResult.warnings,
        ],
        sample_stores: [],
      };
    }
    apiUrl         = detectResult.api_url;
    storesEndpoint = detectResult.stores_endpoint;
    detected       = true;

    // Persist detection result on source
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    await supabase
      .from("mall_sources")
      .update({ geodir_detected: true, geodir_api_url: apiUrl })
      .eq("id", sourceId);
  }

  // ── Fetch pages ────────────────────────────────────────────────────────────
  const fetchResult = await fetchGeoDirectoryStores(storesEndpoint, {
    max_pages: maxPages,
    per_page:  perPage,
  });
  warnings.push(...fetchResult.warnings);

  const normalized = fetchResult.stores.map((s) =>
    normalizeGeoDirectoryStore(s, src.url as string),
  );

  // Collect per-store warnings (cap at 50 to avoid flooding)
  for (const n of normalized.slice(0, 50)) {
    warnings.push(...n.warnings);
  }

  // ── Batch upsert into staging table ───────────────────────────────────────
  // Uses the unique partial index on (mall_source_id, geodir_store_id)
  // created by migration 015 for conflict detection.
  // stores_updated is not distinguishable from batch upsert — returned as 0.
  let stagesUpserted = 0;
  const mallId       = (src.mall_id as string | undefined) ?? null;

  const payloads = normalized.map((store) => ({
    mall_id:            mallId,
    mall_source_id:     sourceId,
    shop_name:          store.shop_name,
    unit_number:        store.unit_number    ?? null,
    floor_label:        store.floor_label    ?? null,
    category:           store.category       ?? null,
    source_url:         store.source_url,
    raw_evidence:       store.raw_evidence,
    confidence:         store.confidence,
    extraction_method:  store.extraction_method,
    review_status:      "pending",
    geodir_store_id:    store.geodir_store_id,
    phone:              store.phone          ?? null,
    website:            store.website        ?? null,
    latitude:           store.latitude       ?? null,
    longitude:          store.longitude      ?? null,
    parking_hint:       store.parking_hint   ?? null,
    entrance_hint:      store.entrance_hint  ?? null,
    road_name:          store.road_name      ?? null,
    source_modified_at: store.source_modified_at ?? null,
    image_url:          store.image_url      ?? null,
  }));

  for (let i = 0; i < payloads.length; i += UPSERT_BATCH_SIZE) {
    const batch     = payloads.slice(i, i + UPSERT_BATCH_SIZE);
    const batchNum  = Math.floor(i / UPSERT_BATCH_SIZE) + 1;

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const { error: upsertErr } = await supabase
      .from("mall_store_locations_staged")
      .upsert(batch, { onConflict: "mall_source_id,geodir_store_id" });

    if (upsertErr) {
      const e = upsertErr as { message: string };
      console.error(`[geodir-import] batch ${batchNum} upsert error:`, e.message);
      insertErrors.push(`Batch ${batchNum} (records ${i + 1}–${i + batch.length}): ${e.message}`);
    } else {
      stagesUpserted += batch.length;
    }
  }

  if (fetchResult.total_fetched > 0 && stagesUpserted === 0) {
    warnings.push(
      `Fetched ${fetchResult.total_fetched} records but all DB upserts failed — ` +
      `ensure migration 015 has been applied (unique index on mall_source_id, geodir_store_id)`,
    );
  }

  return {
    source_id:       sourceId,
    detected,
    api_url:         apiUrl,
    stores_endpoint: storesEndpoint,
    pages_fetched:   fetchResult.pages_fetched,
    records_found:   fetchResult.total_fetched,
    stores_staged:   stagesUpserted,
    stores_updated:  0,   // not distinguishable with batch upsert
    insert_errors:   insertErrors,
    warnings,
    sample_stores:   normalized.slice(0, 3),
  };
}
