/**
 * Checkers Sixty60 scraper — uses their internal POST API.
 *
 * How it works:
 *  1. Playwright loads the homepage to acquire the `storeContexts` session cookie
 *     (the cookie auto-assigns a Joburg fulfilment store)
 *  2. We POST to /api/catalogue/get-products-filter from within the browser context
 *     so the session cookie is automatically included in the request
 *  3. Two strategies per query:
 *     A. Search: productListSource.searchQuery + url "/api/v3/products/search-results"
 *     B. If search returns 0: navigate to search page and intercept product API calls
 *
 * Price fields (confirmed from live response):
 *   product.price            — full/original price in Rands
 *   product.discountedPrice  — actual selling price (lower when on promo)
 *   product.isOnPromotion    — boolean
 *   product.imageProductCardURL — product image URL
 */

import { getBrowser, newStealthPage, goto } from "../framework/browser.js";
import { RETAILER_TARGETS } from "../targets.js";
import type { ScrapedProduct } from "../db.js";

const FILTER_API = "https://www.checkers.co.za/api/catalogue/get-products-filter";

interface Sixty60Product {
  name: string;
  displayName?: string;
  price: number;
  discountedPrice: number;
  isOnPromotion: boolean;
  outOfStock: boolean;
  imageProductCardURL?: string;
  imageURL?: string;
}

function mapProduct(p: Sixty60Product, category: string): ScrapedProduct | null {
  const name = p.displayName ?? p.name;
  if (!name) return null;
  const price = Math.round(p.discountedPrice ?? p.price);
  if (!price || price < 2) return null;
  const originalPrice = p.price > price ? Math.round(p.price) : null;
  return {
    retailerName: "Checkers",
    name,
    brand: null,
    category,
    price,
    originalPrice,
    isOnSpecial: p.isOnPromotion || !!originalPrice,
    inStock: !p.outOfStock,
    imageUrl: p.imageProductCardURL ?? p.imageURL ?? null,
  };
}

async function postFilter(
  page: import("playwright").Page,
  body: unknown
): Promise<Sixty60Product[]> {
  const result = await page.evaluate(
    async ({ url, body }: { url: string; body: unknown }) => {
      try {
        const r = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "*/*" },
          credentials: "include",
          body: JSON.stringify(body),
        });
        if (!r.ok) return { ok: false, status: r.status, text: "" };
        return { ok: true, status: r.status, text: await r.text() };
      } catch (e) {
        return { ok: false, status: -1, text: String(e) };
      }
    },
    { url: FILTER_API, body }
  );

  if (!result.ok) return [];
  try {
    const data = JSON.parse(result.text) as { products?: Sixty60Product[] };
    return data.products ?? [];
  } catch {
    return [];
  }
}

export async function scrapeCheckers(): Promise<ScrapedProduct[]> {
  const browser = await getBrowser();
  const { page, context } = await newStealthPage(browser);
  const results: ScrapedProduct[] = [];

  console.log("  [checkers] warming up — acquiring store session cookie…");
  try {
    await goto(page, "https://www.checkers.co.za");
    await page.waitForTimeout(3000);
  } catch { /* continue */ }

  const targets = RETAILER_TARGETS["checkers"] ?? [];

  for (const target of targets) {
    console.log(`  [checkers] → "${target.query}"`);

    // Strategy A: POST search query directly to the filter API
    const searchBody = {
      storeContexts: [],
      filterData: {
        filter: {
          showAllDisplayVariants: false,
          showNotRangedProducts: false,
          productListSource: { searchQuery: target.query },
          paginationOptions: { page: 0, pageSize: 20 },
          filterOptions: { dealsOnly: false, serviceOptions: [], facetOptions: [] },
          sortOptions: null,
        },
        displayOptions: {},
      },
      forYouBonusBuyIds: [],
      url: "/api/v3/products/search-results",
      isCarousel: false,
    };

    const searchProducts = await postFilter(page, searchBody);
    const mapped = searchProducts
      .map((p) => mapProduct(p, target.category))
      .filter((p): p is ScrapedProduct => p !== null);

    if (mapped.length) {
      console.log(`    ${mapped.length} products (via search API)`);
      results.push(...mapped.slice(0, 8));
      await page.waitForTimeout(800 + Math.random() * 700);
      continue;
    }

    // Strategy B: navigate search page and intercept any product API responses
    const captured: Sixty60Product[] = [];
    const interceptor = async (res: import("playwright").Response) => {
      if (!res.url().includes("/api/catalogue/get-products-filter")) return;
      try {
        const data = (await res.json()) as { products?: Sixty60Product[] };
        if (data.products?.length) captured.push(...data.products);
      } catch { /* ignore */ }
    };
    page.on("response", interceptor);

    try {
      await goto(page, `https://www.checkers.co.za/search?q=${encodeURIComponent(target.query)}`);
      await page.waitForTimeout(4000);
    } catch { /* ignore */ }

    page.off("response", interceptor);

    const interceptMapped = captured
      .map((p) => mapProduct(p, target.category))
      .filter((p): p is ScrapedProduct => p !== null);

    if (interceptMapped.length) {
      console.log(`    ${interceptMapped.length} products (via intercept)`);
      results.push(...interceptMapped.slice(0, 8));
    } else {
      console.warn(`    No results for "${target.query}"`);
    }

    await page.waitForTimeout(1000 + Math.random() * 1000);
  }

  await context.close();
  console.log(`  [checkers] ${results.length} products collected`);
  return results;
}
