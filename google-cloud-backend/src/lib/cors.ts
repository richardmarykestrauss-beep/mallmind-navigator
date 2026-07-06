/**
 * cors.ts — environment-controlled CORS allowlist for the MallMind backend.
 *
 * ROOT CAUSE this replaces: the server previously used
 *   origin: NODE_ENV === "production" ? (ALLOWED_ORIGIN ?? false) : "*"
 * i.e. a SINGLE production origin. That rejected every approved localhost /
 * preview origin, so real end-to-end local QA was impossible (PR #17 had to use
 * a page-only network mock). Meanwhile `.env.example` advertised a
 * `CORS_ORIGINS` comma-list that the code never read.
 *
 * This module makes the allowlist authoritative in ALL environments:
 *   - exact-match browser origins from a comma-separated env allowlist;
 *   - production domain preserved (legacy ALLOWED_ORIGIN is merged in);
 *   - explicit localhost/preview entries only when an operator configures them;
 *   - never a `*` policy, and credentials stay disabled (no cookies) so an
 *     Access-Control-Allow-Credentials:true + wildcard combination is impossible;
 *   - no wildcard subdomain matching (no `*.cloudshell.dev` / `*.vercel.app`);
 *   - requests with NO Origin (server-to-server, health checks, CLI, curl) are
 *     allowed by default — browsers always send Origin, so this does not widen
 *     browser cross-site access — and can be disabled with CORS_ALLOW_NO_ORIGIN=false.
 *
 * Pure and side-effect free (reads only the env object passed to it) so the
 * behaviour is deterministically unit-testable without booting the server.
 */

import type { CorsOptions } from "cors";

export interface CorsEnvLike {
  CORS_ORIGINS?: string;
  /** Legacy single production origin. Merged into the allowlist for back-compat. */
  ALLOWED_ORIGIN?: string;
  /** "false" to reject requests with no Origin header. Default: allow (non-browser callers). */
  CORS_ALLOW_NO_ORIGIN?: string;
}

/** HTTP methods and request headers the browser may use (unchanged from before). */
export const CORS_METHODS = ["GET", "POST", "PATCH", "OPTIONS"] as const;
export const CORS_ALLOWED_HEADERS = ["Content-Type", "Authorization"] as const;

/**
 * Normalise an origin to `scheme://host[:port]`, lower-cased, without a trailing
 * slash — so "HTTP://Localhost:8080/" and "http://localhost:8080" compare equal.
 * Falls back to a trimmed/lower-cased/trailing-slash-stripped string if the value
 * is not a parseable URL (an unparseable value simply won't match a real origin).
 */
export function normalizeOrigin(value: string): string {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return "";
  try {
    const u = new URL(trimmed);
    return `${u.protocol}//${u.host}`.toLowerCase();
  } catch {
    return trimmed.replace(/\/+$/, "").toLowerCase();
  }
}

/**
 * Parse the allowlist from env: merge CORS_ORIGINS (preferred) with the legacy
 * ALLOWED_ORIGIN, split on commas, trim, drop blanks, normalise, and de-duplicate.
 * Whitespace and duplicate entries are absorbed safely.
 */
export function parseAllowlist(env: CorsEnvLike = {}): string[] {
  const raw = [env.CORS_ORIGINS, env.ALLOWED_ORIGIN].filter(Boolean).join(",");
  const normalised = raw
    .split(",")
    .map((s) => normalizeOrigin(s))
    .filter((s) => s.length > 0);
  return [...new Set(normalised)];
}

/** Whether no-Origin requests (server-to-server / health / CLI) are allowed. */
export function allowsNoOrigin(env: CorsEnvLike = {}): boolean {
  return String(env.CORS_ALLOW_NO_ORIGIN ?? "true").trim().toLowerCase() !== "false";
}

/**
 * Exact-match decision for a single origin. A missing/empty Origin (non-browser
 * caller) is governed by `allowNoOrigin`; any present browser origin must match
 * the allowlist exactly (after normalisation). No wildcard/subdomain matching.
 */
export function isOriginAllowed(
  origin: string | undefined | null,
  allowlist: string[],
  allowNoOrigin: boolean,
): boolean {
  if (origin === undefined || origin === null || origin === "") return allowNoOrigin;
  return allowlist.includes(normalizeOrigin(origin));
}

/**
 * Build the `cors` options object from env. The `origin` callback reflects an
 * allowed origin (never "*") and truthfully rejects a disallowed one by emitting
 * NO CORS headers (callback `false`) — the request is not 500'd, but the browser
 * blocks it because no Access-Control-Allow-Origin is returned.
 *
 * An EMPTY allowlist fails safe: every browser origin is rejected (only no-Origin
 * callers, if enabled, get through).
 */
export function buildCorsOptions(env: CorsEnvLike = {}): CorsOptions {
  const allowlist = parseAllowlist(env);
  const allowNoOrigin = allowsNoOrigin(env);
  return {
    origin(requestOrigin, callback) {
      callback(null, isOriginAllowed(requestOrigin, allowlist, allowNoOrigin));
    },
    methods: [...CORS_METHODS],
    allowedHeaders: [...CORS_ALLOWED_HEADERS],
    // No cookies are used (the frontend authenticates with bearer/anon headers),
    // so credentials stay OFF. This makes an ACAC:true + wildcard combination
    // structurally impossible.
    credentials: false,
    optionsSuccessStatus: 204,
  };
}

/** Small, non-secret startup summary (origin values are not secrets; keys/tokens are never logged). */
export function describeCorsConfig(env: CorsEnvLike = {}): string {
  const allowlist = parseAllowlist(env);
  return `CORS allowlist: ${allowlist.length} origin(s); no-Origin requests ${allowsNoOrigin(env) ? "allowed" : "rejected"}`;
}
