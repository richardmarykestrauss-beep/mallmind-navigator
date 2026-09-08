/**
 * corsHarness.ts — deterministic CORS allowlist tests (RC1 PR 2).
 *
 * Proves the environment-controlled allowlist in lib/cors.ts, both as a pure
 * decision and end-to-end through the real `cors` middleware over HTTP (an
 * ephemeral express app on a random port; no Supabase, no network, no secrets).
 *
 * Run: npm run test:cors
 */

import type { Request, Response } from "express";

export {};

/* eslint-disable @typescript-eslint/no-require-imports */
const express = require("express") as typeof import("express");
const cors = require("cors") as typeof import("cors");
const http = require("node:http") as typeof import("node:http");
const {
  buildCorsOptions, parseAllowlist, isOriginAllowed, normalizeOrigin, allowsNoOrigin,
} = require("../lib/cors") as typeof import("../lib/cors");

let passed = 0, failed = 0;
function assert(cond: boolean, label: string): void {
  if (cond) { console.log(`  ✓ ${label}`); passed++; }
  else      { console.error(`  ✗ ${label}`); failed++; }
}

// Representative origins: a production domain, a localhost dev origin, and a
// preview (Cloud Shell) origin — all configured as EXACT allowlist entries.
const PROD = "https://mallmind.app";
const LOCAL = "http://localhost:8087";
const PREVIEW = "https://8087-cs-abc-default.cloudshell.dev";
const EVIL = "https://evil.example";

// Deliberately messy config: leading/trailing whitespace, a trailing slash, a
// mixed-case duplicate, and a trailing empty entry — all must normalise safely.
const ENV = { CORS_ORIGINS: `  ${PROD} , ${LOCAL} ,${PREVIEW}, HTTPS://MallMind.app/ ,` };

console.log("\nCORS allowlist — pure decision");
{
  const allow = parseAllowlist(ENV);
  assert(allow.length === 3, "8: whitespace + duplicate + empty entries normalise to 3 unique origins");
  assert(allow.includes(PROD) && allow.includes(LOCAL) && allow.includes(PREVIEW), "8: normalised set holds the three real origins");
  assert(normalizeOrigin("HTTPS://MallMind.app/") === PROD, "normalisation lower-cases host + strips trailing slash");

  assert(isOriginAllowed(PROD, allow, true), "1: configured production origin allowed");
  assert(isOriginAllowed(LOCAL, allow, true), "2: configured localhost origin allowed");
  assert(isOriginAllowed(PREVIEW, allow, true), "3: configured preview origin allowed");
  assert(!isOriginAllowed(EVIL, allow, true), "4: unconfigured origin rejected");
  assert(!isOriginAllowed("https://mallmind.app.evil.example", allow, true), "4: look-alike subdomain rejected (exact match only)");

  assert(isOriginAllowed(undefined, allow, true) === true, "7: no-Origin request allowed when enabled (server-to-server/CLI)");
  assert(isOriginAllowed(undefined, allow, false) === false, "7: no-Origin request rejected when disabled");
  assert(allowsNoOrigin({}) === true && allowsNoOrigin({ CORS_ALLOW_NO_ORIGIN: "false" }) === false, "7: no-Origin policy is explicit + configurable");

  const empty = parseAllowlist({});
  assert(empty.length === 0 && !isOriginAllowed(PROD, empty, true), "9: empty configuration fails safe (all browser origins rejected)");
  assert(parseAllowlist({ ALLOWED_ORIGIN: PROD }).includes(PROD), "legacy ALLOWED_ORIGIN is merged in (production preserved)");

  const opts = buildCorsOptions(ENV);
  assert(opts.credentials === false, "6: credentials disabled → Access-Control-Allow-Credentials is never true");
  assert(typeof opts.origin === "function", "origin is a reflecting function, never a '*' policy");
  assert(Array.isArray(opts.methods) && (opts.methods as string[]).includes("OPTIONS"), "methods include OPTIONS for preflight");
  assert(Array.isArray(opts.allowedHeaders) && (opts.allowedHeaders as string[]).includes("Authorization"), "allowed headers include Authorization");
}

// ── Real HTTP: preflight + header emission through the actual middleware ───────
function request(base: string, method: string, path: string, headers: Record<string, string>):
  Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: string }> {
  return new Promise((resolve, reject) => {
    const u = new URL(base + path);
    const r = http.request(
      { hostname: u.hostname, port: u.port, path: u.pathname, method, headers },
      (res) => { let b = ""; res.on("data", (d) => (b += d)); res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: b })); },
    );
    r.on("error", reject);
    r.end();
  });
}

async function httpTests(): Promise<void> {
  console.log("\nCORS allowlist — live middleware (preflight + headers)");
  const app = express();
  app.use(cors(buildCorsOptions(ENV)));
  app.get("/ping", (_req: Request, res: Response) => res.json({ ok: true }));
  app.post("/echo", (_req: Request, res: Response) => res.json({ ok: true }));

  const server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  const base = `http://127.0.0.1:${port}`;
  const acao = (h: Record<string, string | string[] | undefined>) => h["access-control-allow-origin"];

  try {
    let r = await request(base, "GET", "/ping", { Origin: PROD });
    assert(r.status === 200 && acao(r.headers) === PROD, "1: allowed GET reflects the exact origin (not '*')");
    assert(r.headers["access-control-allow-credentials"] !== "true", "6: ACAC header is never 'true'");
    assert(acao(r.headers) !== "*", "no wildcard ACAO is ever emitted");

    r = await request(base, "GET", "/ping", { Origin: EVIL });
    assert(!acao(r.headers), "4: disallowed GET receives no Access-Control-Allow-Origin");

    r = await request(base, "OPTIONS", "/echo", { Origin: LOCAL, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "authorization,content-type" });
    assert(r.status === 204 || r.status === 200, "5: OPTIONS preflight for an allowed origin returns a success status");
    assert(acao(r.headers) === LOCAL, "5: preflight reflects the allowed origin");
    assert(/POST/.test(String(r.headers["access-control-allow-methods"] ?? "")), "5: preflight advertises POST");
    assert(/authorization/i.test(String(r.headers["access-control-allow-headers"] ?? "")), "5: preflight advertises the Authorization header");

    r = await request(base, "OPTIONS", "/echo", { Origin: EVIL, "Access-Control-Request-Method": "POST" });
    assert(!acao(r.headers), "5: preflight for a disallowed origin emits no Access-Control-Allow-Origin");

    r = await request(base, "GET", "/ping", {});
    assert(r.status === 200, "7: no-Origin request is served (server-to-server/health)");

    r = await request(base, "GET", "/ping", { Origin: PREVIEW });
    assert(r.status === 200 && JSON.parse(r.body).ok === true, "10: existing route still responds correctly under the new CORS policy");
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
}

httpTests()
  .then(() => {
    console.log(`\n===== CORS ALLOWLIST: ${passed} passed, ${failed} failed =====`);
    if (failed > 0) process.exit(1);
  })
  .catch((e) => { console.error(e); process.exit(1); });
