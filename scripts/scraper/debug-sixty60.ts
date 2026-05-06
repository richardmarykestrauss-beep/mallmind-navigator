/**
 * Diagnose Checkers Sixty60 search page structure.
 * Run: npx tsx debug-sixty60.ts
 *
 * Captures:
 *  1. All API/XHR calls made during a search so we can find the product data endpoint
 *  2. A snippet of the rendered HTML so we can find correct CSS selectors
 */

import { getBrowser, newStealthPage, goto, closeBrowser } from "./framework/browser.js";

async function main() {
  const browser = await getBrowser();
  const { page, context } = await newStealthPage(browser);

  const apiCalls: Array<{ url: string; status: number; contentType: string }> = [];
  const jsonResponses: Array<{ url: string; body: unknown }> = [];

  // Intercept every response — collect JSON ones
  page.on("response", async (response) => {
    const url = response.url();
    const ct  = response.headers()["content-type"] ?? "";
    apiCalls.push({ url, status: response.status(), contentType: ct.slice(0, 80) });

    if (ct.includes("application/json")) {
      try {
        const body = await response.json();
        jsonResponses.push({ url, body });
      } catch { /* binary / empty */ }
    }
  });

  console.log("▶ Warming up on Checkers homepage…");
  await goto(page, "https://www.checkers.co.za");
  await page.waitForTimeout(2000);

  console.log("▶ Navigating to search: 'sasko bread'");
  await goto(page, "https://www.checkers.co.za/search?q=sasko+bread");
  await page.waitForTimeout(4000); // wait for product API calls to complete

  console.log(`\nTitle: "${await page.title()}"`);
  console.log(`URL:   ${page.url()}`);

  // Dump ALL network calls (filter to interesting ones)
  console.log("\n── All API/XHR calls ──────────────────────────────────────");
  for (const c of apiCalls) {
    if (
      c.url.includes("/api/") ||
      c.url.includes("search") ||
      c.url.includes("product") ||
      c.url.includes("catalog") ||
      c.url.includes("query") ||
      c.contentType.includes("json")
    ) {
      console.log(`  [${c.status}] ${c.url.slice(0, 120)}`);
      console.log(`         type: ${c.contentType}`);
    }
  }

  // Show JSON responses that look like product data
  console.log("\n── JSON responses with product-like data ─────────────────");
  for (const r of jsonResponses) {
    const str = JSON.stringify(r.body);
    if (
      str.includes("price") ||
      str.includes("product") ||
      str.includes("name") ||
      str.includes("sku")
    ) {
      console.log(`\nURL: ${r.url.slice(0, 120)}`);
      console.log("Body (first 600 chars):", str.slice(0, 600));
    }
  }

  // Also dump a snippet of the rendered HTML to find CSS selectors
  const html = await page.content();
  const bodyStart = html.indexOf("<body");
  const snippet = html.slice(bodyStart, bodyStart + 4000);
  console.log("\n── HTML snippet (body, first 4000 chars) ─────────────────");
  console.log(snippet);

  await context.close();
  await closeBrowser();
}

main().catch(console.error);
