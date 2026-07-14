/**
 * Deterministic content hashing for text payloads (prototype).
 *
 * A stable, dependency-free FNV-1a digest over the UTF-8 code units, rendered as
 * a `sha256:`-style marker so the shape matches a future real digest. This is NOT
 * a cryptographic hash — it exists so evidence records carry a STABLE, comparable
 * fingerprint for the same input across runs and machines.
 */

/** 32-bit FNV-1a over the string, returned as 8 hex chars. */
function fnv1a(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i) & 0xff;
    if (input.charCodeAt(i) > 0xff) h ^= (input.charCodeAt(i) >> 8) & 0xff;
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/**
 * Deterministic content hash for a text payload. Normalizes line endings so the
 * same logical content hashes identically regardless of CRLF/LF. Two independent
 * 32-bit passes (forward + salted) widen the fingerprint to reduce collisions.
 */
export function contentHash(text: string): string {
  const norm = text.replace(/\r\n/g, "\n");
  const a = fnv1a(norm);
  const b = fnv1a("mallmind::" + norm + "::" + norm.length);
  return `sha256:txt-${a}${b}-${norm.length}`;
}

/** Stable hash of a JSON-serialisable value (keys sorted for determinism). */
export function structuredHash(value: unknown): string {
  return contentHash(stableStringify(value));
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return "[" + value.map(stableStringify).join(",") + "]";
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + stableStringify(obj[k])).join(",") + "}";
}
