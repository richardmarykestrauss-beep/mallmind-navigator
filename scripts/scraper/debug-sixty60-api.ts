/**
 * Find the Sixty60 product search API endpoint.
 * Strategy: intercept ALL fetch/XHR calls, wait 15s for the search to fire.
 * Run: npx tsx debug-sixty60-api.ts
 */

import { getBrowser, newStealthPage, closeBrowser } from "./framework/browser.js";
import { Page } from "playwright";

async function trySearchAndCapture(page: Page, query: string) {
  const captured: Array<{ url: string; method: string; status: number; body: string }> = [];

  page.on("request", (req) => {
    const u = req.url();
    if (!u.includes("google") && !u.includes("facebook") && !u.includes("insider") && !u.includes("sentry") && !u.includes("analytics")) {
      // console.log(`  REQ ${req.method()} ${u}`);
    }
  });

  page.on("response", async (res) => {
    const u = res.url();
    // Skip noise
    if (u.includes("google") || u.includes("facebook") || u.includes("insider") || u.includes("sentry") || u.includes("analytics") || u.includes("awswaf")) return;
    // Skip images/fonts
    const ct = res.headers()["content-type"] ?? "";
    if (ct.includes("image") || ct.includes("font") || ct.includes("javascript") || ct.includes("css")) return;

    try {
      const text = await res.text();
      captured.push({ url: u, method: "GET", status: res.status(), body: text.slice(0, 1000) });
    } catch { /* ignore */ }
  });

  // Navigate with human-like behaviour
  console.log(`\n▶ Navigating to search: "${query}"`);
  await page.goto(`https://www.checkers.co.za/search?q=${encodeURIComponent(query)}`, {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  });

  console.log("  Waiting 15s for client-side search API calls…");
  await page.waitForTimeout(15_000);

  console.log("\n── All non-image JSON/text API calls ────────────────────");
  for (const c of captured) {
    console.log(`[${c.status}] ${c.url}`);
    if (c.body.includes("price") || c.body.includes("product") || c.body.includes("name")) {
      console.log("       ↳ Body (600): " + c.body.slice(0, 600));
    }
  }

  // ── DOM probe: find price-bearing elements ─────────────────────────────────
  console.log("\n── DOM: elements containing 'R' price pattern ────────────");
  const priceEls = await page.evaluate(function() {
    var results = [];
    var els = document.querySelectorAll("*");
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      var text = (el.textContent || "").trim();
      if (/R\s*\d+/.test(text) && text.length < 150 && el.children.length < 4) {
        results.push({
          tag: el.tagName,
          cls: (el.getAttribute("class") || "").slice(0, 100),
          text: text.slice(0, 100)
        });
        if (results.length >= 15) break;
      }
    }
    return results;
  });

  if (priceEls.length) {
    for (const e of priceEls) {
      console.log(`  <${e.tag} class="${e.cls}">`);
      console.log(`    "${e.text}"`);
    }
  } else {
    console.log("  None found — search likely requires a store/address");
  }

  // ── Try directly calling the likely API endpoints ──────────────────────────
  console.log("\n── Trying likely Sixty60 API endpoints directly ────────────");
  const candidates = [
    `https://www.checkers.co.za/api/catalogue/search?q=${encodeURIComponent(query)}`,
    `https://www.checkers.co.za/api/catalogue/search-products?q=${encodeURIComponent(query)}`,
    `https://www.checkers.co.za/api/products/search?q=${encodeURIComponent(query)}`,
    `https://www.checkers.co.za/api/catalogue/get-products?q=${encodeURIComponent(query)}`,
    `https://www.checkers.co.za/api/search?q=${encodeURIComponent(query)}`,
  ];

  for (const url of candidates) {
    try {
      const resp = await page.evaluate(async function(u: string) {
        const r = await fetch(u, { credentials: "include" });
        const text = await r.text();
        return { status: r.status, body: text.slice(0, 400) };
      }, url);
      console.log(`  [${resp.status}] ${url}`);
      if (resp.body.trim().startsWith("{") || resp.body.trim().startsWith("[")) {
        console.log(`         ↳ ${resp.body.slice(0, 300)}`);
      }
    } catch (e) {
      console.log(`  [ERR]  ${url}: ${(e as Error).message.slice(0, 80)}`);
    }
  }
}

async function main() {
  const browser = await getBrowser();
  const { page, context } = await newStealthPage(browser);

  // Warm up on homepage first to get cookies
  console.log("▶ Warming up on homepage (collecting cookies)…");
  await page.goto("https://www.checkers.co.za", { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForTimeout(3_000);

  // Check what cookies/localStorage we got
  const cookies = await context.cookies();
  console.log("Cookies:", cookies.map(c => c.name).join(", "));

  await trySearchAndCapture(page, "bread");

  await context.close();
  await closeBrowser();
}

main().catch(console.error);
