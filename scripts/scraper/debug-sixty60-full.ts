/**
 * Capture full Sixty60 API request + response for get-products-filter.
 * Run: npx tsx debug-sixty60-full.ts
 */

import { getBrowser, newStealthPage, closeBrowser } from "./framework/browser.js";

async function main() {
  const browser = await getBrowser();
  const { page, context } = await newStealthPage(browser);

  const captured: Array<{
    url: string; method: string; postData: string;
    status: number; body: string;
  }> = [];

  // Capture full request + response for catalogue endpoints
  page.on("request", (req) => {
    const u = req.url();
    if (u.includes("checkers.co.za/api/catalogue") || u.includes("checkers.co.za/api/search")) {
      console.log(`\n→ REQUEST ${req.method()} ${u}`);
      const pd = req.postData();
      if (pd) console.log(`  Body: ${pd.slice(0, 400)}`);
    }
  });

  page.on("response", async (res) => {
    const u = res.url();
    if (!u.includes("checkers.co.za/api/catalogue") && !u.includes("checkers.co.za/api/search")) return;
    try {
      const body = await res.text();
      captured.push({ url: u, method: "GET", postData: "", status: res.status(), body });
      console.log(`\n← RESPONSE [${res.status()}] ${u}`);
      console.log(`  Body (2000): ${body.slice(0, 2000)}`);
    } catch {}
  });

  console.log("▶ Loading homepage to collect catalogue API calls…");
  await page.goto("https://www.checkers.co.za", { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForTimeout(5000);

  // Also try calling the filter endpoint directly with a search query
  console.log("\n▶ Trying direct search API calls from within browser context…");
  const storeId = "5ece6935faafe599532665b2";
  const testUrls = [
    `https://www.checkers.co.za/api/catalogue/get-products-filter?q=bread&storeId=${storeId}`,
    `https://www.checkers.co.za/api/catalogue/get-products-filter?search=bread&storeId=${storeId}`,
    `https://www.checkers.co.za/api/catalogue/search?q=bread&storeId=${storeId}`,
    `https://www.checkers.co.za/api/catalogue/search-products?q=bread&storeId=${storeId}`,
    `https://www.checkers.co.za/api/catalogue/get-search-results?q=bread&storeId=${storeId}`,
  ];

  for (const url of testUrls) {
    const result = await page.evaluate(async (u: string) => {
      try {
        const r = await fetch(u, { credentials: "include" });
        const text = await r.text();
        return { status: r.status, body: text.slice(0, 300) };
      } catch (e) {
        return { status: -1, body: String(e) };
      }
    }, url);
    console.log(`\n[${result.status}] ${url.split("?")[0].split("/").pop()}`);
    console.log(`  ${result.body.slice(0, 200)}`);
  }

  await context.close();
  await closeBrowser();
}

main().catch(console.error);
