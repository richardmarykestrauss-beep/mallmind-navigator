/**
 * Deterministic retry policy. Retries apply ONLY to retryable/transient errors,
 * are bounded, and carry exponential-backoff METADATA (no real sleeping is
 * required in pure tests). Retry never bypasses policy/review/publication gates.
 */

import type { QuarantineErrorClass, QuarantineRecord } from "./types";

export const MAX_RETRIES = 3;
const RETRYABLE: ReadonlySet<QuarantineErrorClass> = new Set<QuarantineErrorClass>(["transient", "storage"]);

export function isRetryable(errorClass: QuarantineErrorClass): boolean {
  return RETRYABLE.has(errorClass);
}

/** Exponential backoff in ms for a given attempt (metadata only; nothing sleeps). */
export function backoffMs(attempt: number, baseMs = 200): number {
  return baseMs * Math.pow(2, Math.max(0, attempt - 1));
}

export interface RetryDecision { retry: boolean; attempt: number; backoffMs: number; reason: string; }

/** Decide whether a quarantined record may be retried again (bounded + retryable-only). */
export function planRetry(q: QuarantineRecord): RetryDecision {
  const attempt = q.attempts + 1;
  if (!q.retryable) return { retry: false, attempt, backoffMs: 0, reason: "not_retryable" };
  if (q.disposition === "permanently_rejected") return { retry: false, attempt, backoffMs: 0, reason: "permanently_rejected" };
  if (attempt > MAX_RETRIES) return { retry: false, attempt, backoffMs: 0, reason: "max_retries_exceeded" };
  return { retry: true, attempt, backoffMs: backoffMs(attempt), reason: "retryable" };
}
