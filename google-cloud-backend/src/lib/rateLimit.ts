/**
 * rateLimit.ts — small, dependency-free fixed-window rate limiter.
 *
 * Purpose: public-pilot protection for unauthenticated, cost-bearing endpoints
 * (most importantly POST /assistant, where every request is a Gemini call).
 * Keyed by client IP (Express `req.ip`, which honours `trust proxy`). State is
 * per-process and in-memory: good enough for a small Cloud Run pilot, and it
 * fails OPEN only in the sense that a fresh instance starts with empty buckets.
 * It never fails a legitimate request because of an internal error.
 */

import type { NextFunction, Request, Response } from "express";

export interface RateLimitOptions {
  /** Window length in milliseconds. */
  windowMs: number;
  /** Maximum requests per key per window. */
  max: number;
  /** Human label used in the 429 body and logs. */
  label?: string;
  /** Clock override for deterministic tests. */
  now?: () => number;
  /** Upper bound on tracked keys before the oldest windows are pruned. */
  maxKeys?: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  remaining: number;
  /** Seconds until the window resets (always ≥ 1 when blocked). */
  retryAfterSeconds: number;
}

interface Bucket {
  windowStart: number;
  count: number;
}

export interface RateLimiter {
  check(key: string): RateLimitDecision;
  middleware(req: Request, res: Response, next: NextFunction): void;
  /** Number of keys currently tracked (for tests / diagnostics). */
  size(): number;
}

export function createRateLimiter(opts: RateLimitOptions): RateLimiter {
  const windowMs = Math.max(1, Math.floor(opts.windowMs));
  const max = Math.max(1, Math.floor(opts.max));
  const now = opts.now ?? (() => Date.now());
  const maxKeys = Math.max(100, opts.maxKeys ?? 10_000);
  const label = opts.label ?? "requests";
  const buckets = new Map<string, Bucket>();

  function prune(t: number): void {
    if (buckets.size <= maxKeys) return;
    for (const [key, b] of buckets) {
      if (t - b.windowStart >= windowMs) buckets.delete(key);
      if (buckets.size <= maxKeys) return;
    }
    // Still oversized (all windows live): drop the oldest entries — Map iterates
    // in insertion order, so the first entries are the oldest windows.
    for (const key of buckets.keys()) {
      buckets.delete(key);
      if (buckets.size <= maxKeys) return;
    }
  }

  function check(key: string): RateLimitDecision {
    const t = now();
    let b = buckets.get(key);
    if (!b || t - b.windowStart >= windowMs) {
      b = { windowStart: t, count: 0 };
      buckets.set(key, b);
      prune(t);
    }
    b.count += 1;
    const remaining = Math.max(0, max - b.count);
    const resetIn = Math.max(1, Math.ceil((b.windowStart + windowMs - t) / 1000));
    return { allowed: b.count <= max, remaining, retryAfterSeconds: resetIn };
  }

  function middleware(req: Request, res: Response, next: NextFunction): void {
    let decision: RateLimitDecision;
    try {
      const key = (req.ip && String(req.ip)) || req.socket?.remoteAddress || "unknown";
      decision = check(key);
    } catch (err) {
      // A limiter bug must never take the API down.
      console.error("[rate-limit] internal error, allowing request:", err);
      next();
      return;
    }
    res.setHeader("X-RateLimit-Limit", String(max));
    res.setHeader("X-RateLimit-Remaining", String(decision.remaining));
    if (decision.allowed) {
      next();
      return;
    }
    res.setHeader("Retry-After", String(decision.retryAfterSeconds));
    res.status(429).json({
      error: `Too many ${label}. Please wait and try again.`,
      retry_after_seconds: decision.retryAfterSeconds,
    });
  }

  return { check, middleware, size: () => buckets.size };
}
