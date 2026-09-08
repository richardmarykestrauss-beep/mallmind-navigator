/**
 * rateLimitHarness.ts — deterministic tests for lib/rateLimit.ts.
 *
 * Proves the fixed-window limiter as a pure decision (injected clock) and
 * end-to-end through a real express app over HTTP (429 + Retry-After once the
 * window is exhausted, fresh window after it elapses). No Supabase, no network
 * beyond localhost, no secrets.
 *
 * Run: npm run test:rate-limit
 */

export {};

/* eslint-disable @typescript-eslint/no-require-imports */
const express = require("express") as typeof import("express");
const http = require("node:http") as typeof import("node:http");
const { createRateLimiter } = require("../lib/rateLimit") as typeof import("../lib/rateLimit");

let passed = 0, failed = 0;
function assert(cond: boolean, label: string): void {
  if (cond) { console.log(`  ✓ ${label}`); passed++; }
  else      { console.error(`  ✗ ${label}`); failed++; }
}

console.log("\nrate limit — pure decision (injected clock)");
{
  let t = 1_000_000;
  const rl = createRateLimiter({ windowMs: 60_000, max: 3, now: () => t, label: "test" });
  const a = rl.check("ip-a");
  assert(a.allowed && a.remaining === 2, "1st request allowed, 2 remaining");
  rl.check("ip-a");
  const third = rl.check("ip-a");
  assert(third.allowed && third.remaining === 0, "3rd request allowed, 0 remaining");
  const fourth = rl.check("ip-a");
  assert(!fourth.allowed, "4th request in the window is blocked");
  assert(fourth.retryAfterSeconds >= 1 && fourth.retryAfterSeconds <= 60, `retry-after within the window (${fourth.retryAfterSeconds}s)`);
  assert(rl.check("ip-b").allowed, "a different key has its own bucket");
  t += 60_000;
  assert(rl.check("ip-a").allowed, "window elapsed → key is allowed again");
}

console.log("\nrate limit — key pruning bound");
{
  const rl = createRateLimiter({ windowMs: 1000, max: 1, maxKeys: 100 });
  for (let i = 0; i < 500; i++) rl.check(`k${i}`);
  assert(rl.size() <= 100, `tracked keys stay bounded (${rl.size()} ≤ 100)`);
}

console.log("\nrate limit — express middleware over HTTP");
(async () => {
  const app = express();
  app.set("trust proxy", 1);
  const limiter = createRateLimiter({ windowMs: 60_000, max: 2, label: "assistant requests" });
  app.post("/assistant", limiter.middleware, (_req, res) => { res.json({ ok: true }); });

  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const { port } = server.address() as { port: number };
  const base = `http://127.0.0.1:${port}`;

  async function hit(headers: Record<string, string> = {}): Promise<{ status: number; retry: string | null; body: unknown }> {
    const res = await fetch(`${base}/assistant`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: "{}" });
    return { status: res.status, retry: res.headers.get("retry-after"), body: await res.json() };
  }

  const r1 = await hit();
  const r2 = await hit();
  const r3 = await hit();
  assert(r1.status === 200 && r2.status === 200, "first two requests pass");
  assert(r3.status === 429, "third request is rejected with 429");
  assert(r3.retry !== null && Number(r3.retry) >= 1, "429 carries a Retry-After header");
  assert(typeof (r3.body as { error?: string }).error === "string", "429 body explains the limit");

  // Cloud Run appends the true client IP as the LAST X-Forwarded-For entry; with
  // trust proxy = 1 that (rightmost) value is what express reports as req.ip.
  const other = await hit({ "x-forwarded-for": "203.0.113.9" });
  assert(other.status === 200, "a different forwarded client IP has its own bucket");

  server.close();
  console.log(`\nrate limit harness: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(1); });
