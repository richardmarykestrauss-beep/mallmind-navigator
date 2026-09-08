/**
 * Intake security controls.
 *
 * CSV formula-injection neutralization, prototype-pollution-safe JSON parsing,
 * payload/row/field limits, and sanitized error excerpts. These run on EVERY
 * inbound record — a hostile file must not execute code, pollute prototypes, or
 * balloon memory.
 */

export const INTAKE_LIMITS = {
  maxBytes: 256 * 1024 * 1024,   // 256 MB payload ceiling
  maxRows: 500_000,              // hard row cap per job
  maxFieldLength: 8_192,         // per-field character cap
  maxFields: 128,                // per-record field cap
  excerptLength: 200,            // sanitized quarantine excerpt cap
};

const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);
/** Control-character matcher built from escapes (no literal control bytes in source). */
const CONTROL_CHARS = new RegExp("[\\u0000-\\u001f\\u007f]", "g");
/** Leading chars that make a spreadsheet treat a cell as a formula. */
const FORMULA_LEAD = new RegExp("^[=+\\-@\\t\\r]");

/** Parse JSON with prototype-pollution protection — dangerous keys are dropped. */
export function safeJsonParse(text: string): unknown {
  return JSON.parse(text, (key, value) => (DANGEROUS_KEYS.has(key) ? undefined : value));
}

/** Recursively strip dangerous keys from an already-parsed object (defence in depth). */
export function scrubObject<T>(value: T): T {
  if (value == null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(scrubObject) as unknown as T;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (DANGEROUS_KEYS.has(k)) continue;
    out[k] = scrubObject(v);
  }
  return out as T;
}

/** Neutralize CSV/spreadsheet formula injection by prefixing risky leading chars. */
export function neutralizeFormula(value: string): string {
  return FORMULA_LEAD.test(value) ? `'${value}` : value;
}

/** Cap + neutralize a string field. Returns the safe value + whether it was truncated. */
export function sanitizeField(value: unknown): { value: string; truncated: boolean } {
  const s = value == null ? "" : String(value);
  const neutral = neutralizeFormula(s);
  if (neutral.length > INTAKE_LIMITS.maxFieldLength) return { value: neutral.slice(0, INTAKE_LIMITS.maxFieldLength), truncated: true };
  return { value: neutral, truncated: false };
}

/** A short, sanitized excerpt for quarantine — never unbounded, never with control chars. */
export function sanitizeExcerpt(value: unknown): string {
  const s = typeof value === "string" ? value : (() => { try { return JSON.stringify(value); } catch { return String(value); } })();
  return s.replace(CONTROL_CHARS, " ").replace(/\s+/g, " ").trim().slice(0, INTAKE_LIMITS.excerptLength);
}

/** Reject records with too many fields or over-long keys (structural guard). */
export function withinFieldLimits(record: Record<string, unknown>): boolean {
  const keys = Object.keys(record);
  if (keys.length > INTAKE_LIMITS.maxFields) return false;
  return keys.every((k) => k.length <= INTAKE_LIMITS.maxFieldLength);
}
