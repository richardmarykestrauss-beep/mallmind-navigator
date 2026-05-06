/**
 * Quick diagnostic: set a Joburg address in Sixty60, then scrape search results.
 * Run: npx tsx debug-sixty60-address.ts
 */

import { getBrowser, newStealthPage, closeBrowser } from "./framework/browser.js";

async function main() {
  const browser = await getBrowser();
  const { page, context } = await newStealthPage(browser);

  // Re-enable images for this session — we need to see the page working
  await page.unroute("**/*.{png,jpg,jpeg,gif,webp,svg,woff,woff2,ttf,mp4,mp3}");

  console.log("▶ Loading Sixty60 homepage…");
  await page.goto("https://www.checkers.co.za", { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForTimeout(3000);

  console.log("▶ Capturing any product API calls…");

  // Capture all JSON responses
  const apiHits: Array<{ url: string; body: string }> = [];
  page.on("response", async (res) => {
    const ct = res.headers()["content-type"] ?? "";
    if (!ct.includes("json")) return;
    const u = res.url();
    if (u.includes("sentry") || u.includes("google") || u.includes("facebook") || u.includes("insider")) return;
    try {
      const text = await res.text();
      apiHits.push({ url: u, body: text.slice(0, 800) });
    } catch {}
  });

  // Try clicking the address input and typing a Joburg address
  console.log("▶ Trying to set delivery address…");
  try {
    // Look for the address/location input
    const addressInput = await page.$("input[placeholder*='address'], input[placeholder*='delivery'], input[placeholder*='location'], [class*='address-search'] input, [class*='AddressSearch'] input");
    if (addressInput) {
      console.log("  Found address input — clicking…");
      await addressInput.click();
      await page.waitForTimeout(1000);
      await addressInput.type("Sandton City, Sandton, Johannesburg", { delay: 50 });
      await page.waitForTimeout(2000);

      // Look for autocomplete suggestions
      const suggestion = await page.$("[class*='suggestion'], [class*='autocomplete'] li, [role='option'], [class*='place-item']");
      if (suggestion) {
        console.log("  Selecting first suggestion…");
        await suggestion.click();
        await page.waitForTimeout(3000);
      } else {
        console.log("  No suggestion found — trying Enter");
        await page.keyboard.press("Enter");
        await page.waitForTimeout(3000);
      }
    } else {
      console.log("  Address input not found — proceeding without address");
    }
  } catch (e) {
    console.log("  Address setup error:", (e as Error).message);
  }

  // Navigate to search
  console.log("▶ Searching for 'bread'…");
  await page.goto("https://www.checkers.co.za/search?q=bread", { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForTimeout(5000);

  console.log(`  Title: "${await page.title()}"`);
  console.log(`  URL: ${page.url()}`);

  // DOM: look for price elements
  const priceEls = await page.evaluate(function () {
    var results: Array<{ tag: string; cls: string; text: string }> = [];
    var all = document.querySelectorAll("*");
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      var text = (el.textContent || "").trim();
      if (/R\s*\d+/.test(text) && text.length < 150 && el.children.length < 4) {
        results.push({ tag: el.tagName, cls: (el.getAttribute("class") || "").slice(0, 120), text: text.slice(0, 120) });
        if (results.length >= 20) break;
      }
    }
    return results;
  });

  console.log("\n── DOM elements with R price ─────────────────────────────");
  if (priceEls.length) {
    for (const e of priceEls) console.log(`  <${e.tag} class="${e.cls}">\n    "${e.text}"`);
  } else {
    console.log("  None — products did not load");
  }

  // API calls captured
  console.log("\n── JSON API calls captured ───────────────────────────────");
  for (const h of apiHits) {
    if (h.body.includes("price") || h.body.includes("product") || h.body.includes("result")) {
      console.log(`\nURL: ${h.url}`);
      console.log(`Body: ${h.body.slice(0, 400)}`);
    }
  }

  await context.close();
  await closeBrowser();
}

main().catch(console.error);
