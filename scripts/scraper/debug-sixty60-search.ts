/**
 * Test the search POST body variations for Sixty60.
 * Run: npx tsx debug-sixty60-search.ts
 */

import { getBrowser, newStealthPage, goto, closeBrowser } from "./framework/browser.js";

const FILTER_API = "https://www.checkers.co.za/api/catalogue/get-products-filter";
const STORE_ID = "5ece6935faafe599532665b2";

async function tryPost(page: import("playwright").Page, label: string, body: unknown) {
  console.log(`\n── ${label} ────────────────────`);
  const result = await page.evaluate(
    async ({ url, body }: { url: string; body: unknown }) => {
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "*/*" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      return { status: r.status, text: await r.text() };
    },
    { url: FILTER_API, body }
  );
  console.log(`Status: ${result.status}`);
  const text = result.text;
  if (text.startsWith("{") || text.startsWith("[")) {
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>;
      const keys = Object.keys(parsed);
      console.log(`Keys: ${keys.join(", ")}`);
      if (Array.isArray(parsed.products)) {
        console.log(`Products: ${(parsed.products as unknown[]).length}`);
        if ((parsed.products as unknown[]).length > 0) {
          const first = parsed.products[0] as Record<string, unknown>;
          console.log(`First product name: ${first.name}`);
          console.log(`First product price: ${first.price}`);
        }
      } else {
        console.log(`Body (400 chars): ${text.slice(0, 400)}`);
      }
    } catch {
      console.log(`Body (400 chars): ${text.slice(0, 400)}`);
    }
  } else {
    console.log(`Non-JSON (400 chars): ${text.slice(0, 400)}`);
  }
}

async function main() {
  const browser = await getBrowser();
  const { page, context } = await newStealthPage(browser);

  console.log("▶ Loading homepage…");
  await goto(page, "https://www.checkers.co.za");
  await page.waitForTimeout(3000);

  // Show what cookies we have
  const cookies = await context.cookies("https://www.checkers.co.za");
  const storeCookie = cookies.find(c => c.name === "storeContexts");
  console.log(`\nstoreContexts cookie: ${storeCookie ? decodeURIComponent(storeCookie.value).slice(0, 200) : "NOT FOUND"}`);

  // Variation 1: searchQuery (our guess)
  await tryPost(page, "searchQuery in productListSource", {
    storeContexts: [],
    filterData: {
      filter: {
        showAllDisplayVariants: false,
        showNotRangedProducts: false,
        productListSource: { searchQuery: "bread" },
        paginationOptions: { page: 0, pageSize: 10 },
        filterOptions: { dealsOnly: false, serviceOptions: [], facetOptions: [] },
        sortOptions: null,
      },
      displayOptions: {},
    },
    forYouBonusBuyIds: [],
    url: "/api/v3/products/search-results",
    isCarousel: false,
  });

  // Variation 2: with explicit storeContexts
  await tryPost(page, "explicit storeContexts + searchQuery", {
    storeContexts: [{ storeId: STORE_ID, serviceOptionIds: ["sixty-min-delivery", "one-day-delivery"] }],
    filterData: {
      filter: {
        showAllDisplayVariants: false,
        showNotRangedProducts: false,
        productListSource: { searchQuery: "bread" },
        paginationOptions: { page: 0, pageSize: 10 },
        filterOptions: { dealsOnly: false, serviceOptions: [], facetOptions: [] },
        sortOptions: null,
      },
      displayOptions: {},
    },
    forYouBonusBuyIds: [],
    url: "/api/v3/products/search-results",
    isCarousel: false,
  });

  // Variation 3: searchTerm instead of searchQuery
  await tryPost(page, "searchTerm instead of searchQuery", {
    storeContexts: [],
    filterData: {
      filter: {
        showAllDisplayVariants: false,
        showNotRangedProducts: false,
        productListSource: { searchTerm: "bread" },
        paginationOptions: { page: 0, pageSize: 10 },
        filterOptions: { dealsOnly: false, serviceOptions: [], facetOptions: [] },
        sortOptions: null,
      },
      displayOptions: {},
    },
    forYouBonusBuyIds: [],
    url: "/api/v3/products/search-results",
    isCarousel: false,
  });

  // Variation 4: different url field
  await tryPost(page, "url: /api/v3/products/search", {
    storeContexts: [],
    filterData: {
      filter: {
        showAllDisplayVariants: false,
        showNotRangedProducts: false,
        productListSource: { searchQuery: "bread" },
        paginationOptions: { page: 0, pageSize: 10 },
        filterOptions: { dealsOnly: false, serviceOptions: [], facetOptions: [] },
        sortOptions: null,
      },
      displayOptions: {},
    },
    forYouBonusBuyIds: [],
    url: "/api/v3/products/search",
    isCarousel: false,
  });

  // Variation 5: try a different top-level search endpoint altogether
  console.log("\n── Trying /api/catalogue/search POST ────────────────────");
  const r2 = await page.evaluate(async ({ storeId }: { storeId: string }) => {
    const r = await fetch("https://www.checkers.co.za/api/catalogue/search", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "*/*" },
      credentials: "include",
      body: JSON.stringify({ query: "bread", storeId, page: 0, pageSize: 10 }),
    });
    return { status: r.status, text: (await r.text()).slice(0, 400) };
  }, { storeId: STORE_ID });
  console.log(`Status: ${r2.status}\nBody: ${r2.text}`);

  await context.close();
  await closeBrowser();
}

main().catch(console.error);
