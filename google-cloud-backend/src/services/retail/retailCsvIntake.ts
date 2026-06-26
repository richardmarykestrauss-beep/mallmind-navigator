/**
 * retailCsvIntake.ts — Retail Intelligence Core (Sprint 20A.9)
 *
 * Pure, deterministic CSV intake logic shared by the admin import endpoint and
 * the scripts/retail/import-csv-staging.mjs CLI. Parses CSV safely, validates,
 * sanitises spreadsheet-formula injection, normalises, hashes, de-duplicates
 * within a file, and produces a dry-run summary + normalised observation
 * candidates.
 *
 * DOCTRINE: CSV is untrusted bulk INTAKE evidence, never verification authority.
 *   - Every candidate is destined for review_status = 'pending'.
 *   - A row that DECLARES a verified-tier trust_state but pairs it with a
 *     non-evidence method is DOWNGRADED to 'needs_review' (documented warning).
 *   - A verified-tier declaration with an evidence method is KEPT but flagged
 *     with a caution: the CSV file is bulk evidence, not per-row proof, and the
 *     Sprint 20A.8 verification policy still gates publication.
 *
 * Pure: no Supabase, no env, no network, no fs, no Express, no DB. Uses only
 * node:crypto (deterministic hashing) — no I/O.
 */

import { createHash } from "node:crypto";
import {
  mapTrustStateToProductQuality,
  isVerifiedQuality,
} from "./retailTrustMapper";
import { methodCanVerify } from "./retailVerificationPolicy";

// ── Schema ──────────────────────────────────────────────────────────────────

/** Canonical headers required in every retail intake CSV. */
export const REQUIRED_HEADERS = [
  "mall_id", "shop_id", "product_name", "brand", "model", "category",
  "price", "original_price", "is_on_special", "special_description",
  "in_stock", "trust_state", "verification_method", "valid_to", "source_note",
] as const;

/** Optional headers accepted when present. */
export const OPTIONAL_HEADERS = [
  "product_id", "observed_at", "valid_from", "confidence",
] as const;

/** Allowed observation trust_state values (migration 026). */
export const ALLOWED_TRUST_STATES: ReadonlySet<string> = new Set([
  "verified", "retailer_submitted", "live_feed", "flyer_extracted",
  "user_submitted", "web_observed", "manual_fact_entry", "disputed",
  "needs_review", "expired", "stale",
]);

/** Allowed verification_method values (migration 026); "" = none. */
export const ALLOWED_VERIFICATION_METHODS: ReadonlySet<string> = new Set([
  "phone", "website", "flyer", "receipt", "store_visit", "retailer_confirmation",
  "csv_manual", "affiliate_feed", "partner_feed", "user_submission", "",
]);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── Types ───────────────────────────────────────────────────────────────────

export interface NormalizedObservation {
  mall_id: string;
  shop_id: string;
  product_id: string | null;
  product_name: string;
  brand: string | null;
  model: string | null;
  category: string | null;
  price: number;
  original_price: number | null;
  is_on_special: boolean;
  special_description: string | null;
  in_stock: boolean;
  trust_state: string;
  /** The trust_state the CSV originally declared (before any intake downgrade). */
  declared_trust_state: string;
  verification_method: string | null;
  observed_at: string | null;
  valid_from: string | null;
  valid_to: string | null;
  confidence: number;
  source_note: string | null;
  observation_hash: string;
}

export interface IntakeRowResult {
  /** 1-based CSV line number (header = line 1, first data row = line 2). */
  row_number: number;
  status: "valid" | "blocked";
  observation_hash: string | null;
  /** True when this row's hash duplicates an earlier valid row in this file. */
  duplicate_in_file: boolean;
  normalized: NormalizedObservation | null;
  warnings: string[];
  blockers: string[];
}

export interface IntakeResult {
  ok: boolean;
  /** Set when the file structure itself is unreadable (headers/parse). */
  structural_error: string | null;
  total_rows: number;
  valid_rows: number;
  blocked_rows: number;
  duplicate_rows_in_file: number;
  category_counts: Record<string, number>;
  warnings: string[];
  rows: IntakeRowResult[];
  /** Valid, non-duplicate candidates ready to stage (in file order). */
  candidates: NormalizedObservation[];
}

// ── Primitives ──────────────────────────────────────────────────────────────

/** SHA-256 hex of arbitrary text (e.g. the raw CSV file → snapshot sha). Pure. */
export function sha256Hex(text: string): string {
  return createHash("sha256").update(String(text ?? "")).digest("hex");
}

/**
 * Quote-aware CSV parser (handles "quoted, commas", "escaped""quotes", CRLF/LF).
 * Returns one array per non-blank row. Blank rows are dropped here; their
 * presence is reflected only in raw line counting by the caller if needed.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  const s = String(text ?? "");

  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    const next = s[i + 1];

    if (ch === '"' && inQuotes && next === '"') { cell += '"'; i++; continue; }
    if (ch === '"') { inQuotes = !inQuotes; continue; }
    if (ch === "," && !inQuotes) { row.push(cell); cell = ""; continue; }
    if ((ch === "\n" || ch === "\r") && !inQuotes) {
      if (ch === "\r" && next === "\n") i++;
      row.push(cell);
      if (row.some((v) => v.trim() !== "")) rows.push(row);
      row = [];
      cell = "";
      continue;
    }
    cell += ch;
  }
  if (cell.length || row.length) {
    row.push(cell);
    if (row.some((v) => v.trim() !== "")) rows.push(row);
  }
  return rows;
}

/** Neutralise spreadsheet formula injection (=,+,-,@ prefixes) and trim. */
export function sanitizeCsvText(value: unknown): string {
  const raw = String(value ?? "").trim();
  return /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
}

function normHashPart(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

/**
 * Deterministic observation hash. IDENTICAL formula to the legacy importer so
 * previously-staged observations de-duplicate correctly — do not change.
 */
export function computeObservationHash(o: {
  mall_id: string; shop_id: string; product_name: string;
  brand: string | null; model: string | null; category: string | null;
  price: number; original_price: number | null; valid_to: string | null;
}): string {
  const key = [
    o.mall_id,
    o.shop_id,
    normHashPart(o.product_name),
    normHashPart(o.brand),
    normHashPart(o.model),
    normHashPart(o.category),
    o.price,
    o.original_price ?? "",
    o.valid_to ?? "",
  ].join("|");
  return createHash("sha256").update(key).digest("hex");
}

// ── Field parsers (return {value, error}) ───────────────────────────────────

function parseBool(raw: string): { value: boolean | null; error: string | null } {
  const n = raw.trim().toLowerCase();
  if (n === "true") return { value: true, error: null };
  if (n === "false") return { value: false, error: null };
  return { value: null, error: `must be true or false (got "${raw}")` };
}

function parseNonNegNumber(raw: string): { value: number | null; error: string | null } {
  const r = raw.trim();
  if (!r) return { value: null, error: null }; // empty = null (caller decides if required)
  const n = Number(r);
  if (!Number.isFinite(n)) return { value: null, error: `is not a valid number (got "${raw}")` };
  if (n < 0) return { value: null, error: `must not be negative (got "${raw}")` };
  return { value: n, error: null };
}

/** Accept ISO-8601-ish timestamps / dates. Empty = null. */
function parseTimestamp(raw: string): { value: string | null; error: string | null } {
  const r = raw.trim();
  if (!r) return { value: null, error: null };
  const ms = Date.parse(r);
  if (Number.isNaN(ms)) return { value: null, error: `is not a valid timestamp (got "${raw}")` };
  return { value: r, error: null };
}

// ── Header validation ───────────────────────────────────────────────────────

function validateHeaders(headers: string[]): string | null {
  const seen = new Set<string>();
  for (const h of headers) {
    if (seen.has(h)) return `Duplicate header "${h}".`;
    seen.add(h);
  }
  const missing = REQUIRED_HEADERS.filter((h) => !seen.has(h));
  if (missing.length) return `CSV missing required headers: ${missing.join(", ")}.`;
  return null;
}

// ── Main intake ─────────────────────────────────────────────────────────────

/**
 * Validate + normalise a retail intake CSV. Never throws on bad data rows: a
 * single malformed row is reported with its CSV line number while valid rows
 * are still returned. Only a structurally unreadable file (no data / bad or
 * missing headers) sets ok=false with structural_error.
 */
export function intakeRetailCsv(csvText: string): IntakeResult {
  const empty = (structural_error: string): IntakeResult => ({
    ok: false, structural_error,
    total_rows: 0, valid_rows: 0, blocked_rows: 0, duplicate_rows_in_file: 0,
    category_counts: {}, warnings: [], rows: [], candidates: [],
  });

  const parsed = parseCsv(csvText);
  if (parsed.length < 2) return empty("CSV has no data rows.");

  const headers = parsed[0].map((h) => h.trim());
  const headerError = validateHeaders(headers);
  if (headerError) return empty(headerError);

  const idx: Record<string, number> = Object.fromEntries(headers.map((h, i) => [h, i]));
  const has = (key: string) => key in idx;

  const rows: IntakeRowResult[] = [];
  const seenHashes = new Map<string, number>(); // hash → first row_number
  const candidates: NormalizedObservation[] = [];
  const categoryCounts: Record<string, number> = {};
  let valid = 0, blocked = 0, dupInFile = 0;

  for (let i = 1; i < parsed.length; i++) {
    const rowNumber = i + 1; // CSV line (header = 1)
    const raw = parsed[i];
    const blockers: string[] = [];
    const warnings: string[] = [];
    const get = (key: string) => sanitizeCsvText(raw[idx[key]] ?? "");

    // Excess columns (more cells than headers) — meaningful, soft warning.
    if (raw.length > headers.length) {
      warnings.push(`Row has ${raw.length} columns but the header has ${headers.length}; extra columns ignored.`);
    }

    // Required string fields.
    const mall_id = get("mall_id");
    const shop_id = get("shop_id");
    const product_name = get("product_name");
    if (!mall_id) blockers.push("mall_id is required.");
    else if (!UUID_RE.test(mall_id)) blockers.push(`mall_id is not a valid UUID (got "${mall_id}").`);
    if (!shop_id) blockers.push("shop_id is required.");
    else if (!UUID_RE.test(shop_id)) blockers.push(`shop_id is not a valid UUID (got "${shop_id}").`);
    if (!product_name) blockers.push("product_name is required.");

    const product_id_raw = has("product_id") ? get("product_id") : "";
    let product_id: string | null = product_id_raw || null;
    if (product_id && !UUID_RE.test(product_id)) {
      blockers.push(`product_id is not a valid UUID (got "${product_id}").`);
      product_id = null;
    }

    // Price (required, non-negative).
    const priceP = parseNonNegNumber(get("price"));
    if (priceP.error) blockers.push(`price ${priceP.error}`);
    else if (priceP.value == null) blockers.push("price is required.");
    else if (priceP.value === 0) warnings.push("price is 0 — confirm this is intentional (free / placeholder).");

    const origP = parseNonNegNumber(get("original_price"));
    if (origP.error) blockers.push(`original_price ${origP.error}`);

    const onSpecialP = parseBool(get("is_on_special"));
    if (onSpecialP.error) blockers.push(`is_on_special ${onSpecialP.error}`);
    const inStockP = parseBool(get("in_stock"));
    if (inStockP.error) blockers.push(`in_stock ${inStockP.error}`);

    // Trust state + verification method.
    const trustStateRaw = get("trust_state") || "needs_review";
    if (!ALLOWED_TRUST_STATES.has(trustStateRaw)) blockers.push(`invalid trust_state "${trustStateRaw}".`);
    const methodRaw = get("verification_method");
    if (!ALLOWED_VERIFICATION_METHODS.has(methodRaw)) blockers.push(`invalid verification_method "${methodRaw}".`);

    // Timestamps.
    const validToP = parseTimestamp(get("valid_to"));
    if (validToP.error) blockers.push(`valid_to ${validToP.error}`);
    const observedAtP = has("observed_at") ? parseTimestamp(get("observed_at")) : { value: null, error: null };
    if (observedAtP.error) blockers.push(`observed_at ${observedAtP.error}`);
    const validFromP = has("valid_from") ? parseTimestamp(get("valid_from")) : { value: null, error: null };
    if (validFromP.error) blockers.push(`valid_from ${validFromP.error}`);

    // Confidence (optional, 0..1).
    let confidence = trustStateRaw === "verified" ? 0.9 : 0.7;
    if (has("confidence")) {
      const cRaw = get("confidence");
      if (cRaw) {
        const c = Number(cRaw);
        if (!Number.isFinite(c) || c < 0 || c > 1) blockers.push(`confidence must be between 0 and 1 (got "${cRaw}").`);
        else confidence = c;
      }
    }

    // original/special consistency (warnings only).
    if (origP.value != null && priceP.value != null && origP.value < priceP.value) {
      warnings.push("original_price is less than price; unusual for a discount.");
    }
    if (onSpecialP.value === true) {
      if (origP.value == null) warnings.push("is_on_special is true but original_price is empty.");
      if (!get("special_description")) warnings.push("is_on_special is true but special_description is empty.");
    }

    if (blockers.length) {
      blocked++;
      rows.push({ row_number: rowNumber, status: "blocked", observation_hash: null, duplicate_in_file: false, normalized: null, warnings, blockers });
      continue;
    }

    // ── Trust downgrade (CSV is intake, not verification authority) ─────────
    const declared = trustStateRaw;
    const method = methodRaw || null;
    let trust_state = trustStateRaw;
    const wouldVerify = isVerifiedQuality(mapTrustStateToProductQuality(declared, method));
    if (wouldVerify && !methodCanVerify(method)) {
      trust_state = "needs_review";
      warnings.push(
        `trust_state '${declared}' with method '${method ?? "none"}' overstates a CSV's evidence; ` +
        `staged as 'needs_review'. Publication still requires the verification policy.`,
      );
    } else if (wouldVerify) {
      warnings.push(
        `trust_state '${declared}' is declared verified-tier via '${method}', but a CSV is bulk intake ` +
        `evidence — confirm per-row before approving for publication.`,
      );
    }

    const normalized: NormalizedObservation = {
      mall_id, shop_id, product_id, product_name,
      brand: get("brand") || null,
      model: get("model") || null,
      category: get("category") || null,
      price: priceP.value as number,
      original_price: origP.value,
      is_on_special: onSpecialP.value as boolean,
      special_description: get("special_description") || null,
      in_stock: inStockP.value as boolean,
      trust_state,
      declared_trust_state: declared,
      verification_method: method,
      observed_at: observedAtP.value,
      valid_from: validFromP.value,
      valid_to: validToP.value,
      confidence,
      source_note: get("source_note") || null,
      observation_hash: "",
    };
    normalized.observation_hash = computeObservationHash(normalized);

    // In-file duplicate detection.
    const firstSeen = seenHashes.get(normalized.observation_hash);
    const isDup = firstSeen !== undefined;
    if (isDup) {
      dupInFile++;
      warnings.push(`Duplicate of row ${firstSeen} in this file; it will not be staged twice.`);
    } else {
      seenHashes.set(normalized.observation_hash, rowNumber);
      candidates.push(normalized);
      const catKey = normalized.category || "Uncategorized";
      categoryCounts[catKey] = (categoryCounts[catKey] ?? 0) + 1;
    }

    valid++;
    rows.push({
      row_number: rowNumber, status: "valid", observation_hash: normalized.observation_hash,
      duplicate_in_file: isDup, normalized, warnings, blockers,
    });
  }

  return {
    ok: true,
    structural_error: null,
    total_rows: rows.length,
    valid_rows: valid,
    blocked_rows: blocked,
    duplicate_rows_in_file: dupInFile,
    category_counts: categoryCounts,
    warnings: [],
    rows,
    candidates,
  };
}
