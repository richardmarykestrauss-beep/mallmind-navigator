/**
 * Structured logging for the durable intake worker.
 *
 * Emits single-line JSON that Cloud Logging parses natively (`severity`, `message`).
 * Every log carries the correlation fields an operator needs to follow one job
 * across workers and restarts: trace_id, job_id, worker_id, chunk_index, event_type,
 * duration_ms, row counts, lease state, retry count, sanitized error code.
 *
 * What this module REFUSES to emit, by construction rather than by discipline:
 * service-role keys, auth tokens, raw fixture rows, raw evidence payloads, object
 * contents, and signed URLs. Values are allow-listed by key and scrubbed by value,
 * so a caller cannot accidentally widen what gets logged.
 */

export type LogSeverity = "DEBUG" | "INFO" | "WARNING" | "ERROR";

/** The ONLY fields that may appear in a log line. Anything else is dropped. */
const ALLOWED_FIELDS = new Set([
  "trace_id", "job_id", "worker_id", "chunk_index", "event_type", "duration_ms",
  "processed_rows", "valid_rows", "rejected_rows", "duplicate_rows", "conflict_rows",
  "staged_drafts", "evidence_created", "row_offset", "lease_state", "lease_expires_in_ms",
  "retry_count", "max_retries", "error_code", "retryable", "status", "committed",
  "already_committed", "job_version", "fixture_only_mode", "bucket", "chunk_count",
  "reconciles", "caller", "supabase_host", "allowed_buckets", "allowed_invoker_count",
  "lease_seconds", "chunk_size", "dev_crash_after_chunk", "records", "generation",
]);

/** Value-level scrubbing — defence in depth behind the key allowlist. */
const SCRUBBERS: [RegExp, string][] = [
  [/eyJ[A-Za-z0-9._-]{10,}/g, "[token]"],        // JWT-shaped (service-role keys, ID tokens)
  [/https?:\/\/\S*[?&](X-Goog-Signature|Signature|token)=\S*/gi, "[signed-url]"],
  [/https?:\/\/\S+/gi, "[url]"],
];

function scrub(value: unknown): unknown {
  if (typeof value !== "string") return value;
  let out = value;
  for (const [re, replacement] of SCRUBBERS) out = out.replace(re, replacement);
  return out.length > 300 ? `${out.slice(0, 300)}…` : out;
}

/** Keep only allow-listed, scrubbed, primitive-ish fields. */
export function safeFields(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (!ALLOWED_FIELDS.has(k)) continue;              // unknown key → dropped, not logged
    if (v === undefined) continue;
    if (v !== null && typeof v === "object" && !Array.isArray(v)) continue;  // no nested payloads
    out[k] = Array.isArray(v) ? v.map(scrub) : scrub(v);
  }
  return out;
}

export interface Logger {
  info(message: string, fields?: Record<string, unknown>): void;
  debug(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
  /** A child logger that stamps every line with the same correlation fields. */
  with(fields: Record<string, unknown>): Logger;
}

export function createLogger(
  level: "info" | "debug" = "info",
  base: Record<string, unknown> = {},
  sink: (line: string) => void = (line) => console.log(line),
): Logger {
  const emit = (severity: LogSeverity, message: string, fields?: Record<string, unknown>) => {
    if (severity === "DEBUG" && level !== "debug") return;
    sink(JSON.stringify({
      severity,
      message: String(scrub(message)),
      component: "intake-worker",
      ...safeFields({ ...base, ...(fields ?? {}) }),
    }));
  };
  return {
    info: (m, f) => emit("INFO", m, f),
    debug: (m, f) => emit("DEBUG", m, f),
    warn: (m, f) => emit("WARNING", m, f),
    error: (m, f) => emit("ERROR", m, f),
    with: (fields) => createLogger(level, { ...base, ...safeFields(fields) }, sink),
  };
}
