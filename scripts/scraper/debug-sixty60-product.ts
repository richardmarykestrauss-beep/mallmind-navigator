/**
 * Capture ONE full product object + exact request details for get-products-filter.
 * Run: npx tsx debug-sixty60-product.ts
 */

import { getBrowser, newStealthPage, closeBrowser } from "./framework/browser.js";

async function main() {
  const browser = await getBrowser();
  const { page, context } = await newStealthPage(browser);

  let captured = false;

  page.on("request", (req) => {
    const u = req.url();
    if (!u.includes("/api/catalogue/") && !u.includes("/api/search")) return;
    if (captured) return;
    console.log(`\n→ REQUEST`);
    console.log(`  Method: ${req.method()}`);
    console.log(`  URL: ${u}`);
    const headers = req.headers();
    const interestingHeaders = ["content-type", "accept", "authorization", "x-store-id", "x-api-key", "x-request-id", "cookie"];
    for (const h of interestingHeaders) {
      if (headers[h]) console.log(`  ${h}: ${headers[h].slice(0, 200)}`);
    }
    const pd = req.postData();
    if (pd) console.log(`  POST body: ${pd.slice(0, 600)}`);
  });

  page.on("response", async (res) => {
    const u = res.url();
    if (!u.includes("/api/catalogue/get-products-filter")) return;
    if (captured) return;
    captured = true;

    try {
      const text = await res.text();
      console.log(`\n← FULL RESPONSE [${res.status()}]`);
      // Parse and pretty-print first product
      const data = JSON.parse(text) as { products?: unknown[] };
      if (data.products && data.products.length > 0) {
        console.log("\nFirst product (full object):");
        console.log(JSON.stringify(data.products[0], null, 2));
        console.log(`\nTotal products in batch: ${data.products.length}`);
      } else {
        console.log("No products array found. Keys:", Object.keys(data));
        console.log(text.slice(0, 500));
      }
    } catch (e) {
      console.log("Parse error:", e);
    }
  });

  console.log("▶ Loading homepage to trigger get-products-filter…");
  await page.goto("https://www.checkers.co.za", { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForTimeout(5000);

  // Now try the search page and capture what API it calls
  console.log("\n▶ Intercepting search page API calls (waiting 8s)…");
  captured = false; // reset to capture search calls too
  const searchCalls: Array<{ method: string; url: string; postData: string; responseBody: string }> = [];

  // Override with broader capture
  page.on("response", async (res) => {
    const u = res.url();
    if (!u.includes("checkers.co.za/api/")) return;
    if (u.includes("sentry") || u.includes("google")) return;
    const ct = res.headers()["content-type"] ?? "";
    if (!ct.includes("json")) return;
    try {
      const body = await res.text();
      if (body.includes("product") && !searchCalls.find(c => c.url === u)) {
        searchCalls.push({ method: "GET", url: u, postData: "", responseBody: body.slice(0, 300) });
      }
    } catch {}
  });

  await page.goto("https://www.checkers.co.za/search?q=bread", { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForTimeout(8000);

  console.log("\n── API calls on search page ────────────────────────────");
  if (searchCalls.length) {
    for (const c of searchCalls) {
      console.log(`\n${c.method} ${c.url}`);
      console.log(`  ${c.responseBody}`);
    }
  } else {
    console.log("No product API calls captured on search page");
  }

  await context.close();
  await closeBrowser();
}

main().catch(console.error);
