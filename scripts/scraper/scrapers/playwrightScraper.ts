/**
 * Playwright-based scraper for Cloudflare-protected SA retailers.
 * Handles: Checkers, PnP, Woolworths, Clicks, Game, Mr Price, Sportsmans Warehouse
 *
 * Strategy per page:
 *  1. Navigate to search URL
 *  2. Wait for products to appear in DOM
 *  3. Try window.__NEXT_DATA__ / JSON-LD first (fastest, most structured)
 *  4. Fall back to DOM extraction with CSS selectors
 */

import { Page } from "playwright";
import { getBrowser, newStealthPage, goto, extractWindowData, extractPageJsonLd } from "../framework/browser.js";
import { RETAILER_TARGETS } from "../targets.js";
import type { ScrapedProduct } from "../db.js";

// ── Retailer configurations ───────────────────────────────────────────────────

interface RetailerConfig {
  name: string;
  targetKey: string;
  home: string;
  searchUrl: (query: string) => string;
  /** CSS selector that indicates products have loaded */
  readySelector: string;
  /** Extract products from the live DOM */
  extract: (page: Page, category: string) => Promise<ScrapedProduct[]>;
}

function parsePrice(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const n = parseFloat(raw.replace(/[^0-9.]/g, ""));
  return isNaN(n) || n < 2 ? null : Math.round(n);
}

/** Generic DOM extractor — works across most SA retail sites */
async function domExtract(
  page: Page,
  retailerName: string,
  category: string,
  selectors: {
    card: string;
    name: string;
    price: string;
    originalPrice?: string;
    badge?: string;
    image?: string;
  }
): Promise<ScrapedProduct[]> {
  return page.evaluate(
    ({ retailerName, category, selectors }) => {
      const cards = document.querySelectorAll(selectors.card);
      const results: Array<{
        retailerName: string; name: string; brand: null; category: string;
        price: number; originalPrice: number | null; isOnSpecial: boolean;
        inStock: boolean; imageUrl: string | null;
      }> = [];

      cards.forEach((card) => {
        const nameEl = card.querySelector(selectors.name);
        const priceEl = card.querySelector(selectors.price);
        const name = nameEl?.textContent?.trim();
        const priceText = priceEl?.textContent?.trim();
        if (!name || !priceText) return;

        const n = parseFloat(priceText.replace(/[^0-9.]/g, ""));
        const price = isNaN(n) || n < 2 ? null : Math.round(n);
        if (!price) return;

        const origEl = selectors.originalPrice ? card.querySelector(selectors.originalPrice) : null;
        const origText = origEl?.textContent?.trim();
        const origN = origText ? parseFloat(origText.replace(/[^0-9.]/g, "")) : NaN;
        const originalPrice = !isNaN(origN) && origN > price ? Math.round(origN) : null;

        const badgeEl = selectors.badge ? card.querySelector(selectors.badge) : null;
        const isOnSpecial = !!(badgeEl || originalPrice);

        const imgEl = (selectors.image ? card.querySelector(selectors.image) : card.querySelector("img")) as HTMLImageElement | null;
        const imageUrl = imgEl?.src || imgEl?.getAttribute("data-src") || null;

        results.push({ retailerName, name, brand: null, category, price, originalPrice, isOnSpecial, inStock: true, imageUrl });
      });
      return results;
    },
    { retailerName, category, selectors }
  );
}

// ── Retailer configs ───────────────────────────────────────────────────────────

const RETAILERS: RetailerConfig[] = [
  {
    name: "Checkers",
    targetKey: "checkers",
    home: "https://www.checkers.co.za",
    searchUrl: (q) => `https://www.checkers.co.za/search?q=${encodeURIComponent(q)}`,
    readySelector: ".item-product, .product-item, [class*='ProductItem'], [data-testid='product']",
    extract: async (page, category) => {
      // Try embedded data first
      const data = await extractWindowData(page) as Record<string, unknown> | null;
      if (data) {
        const products = extractFromNextData(data, "Checkers", category);
        if (products.length) return products;
      }
      return domExtract(page, "Checkers", category, {
        card: ".item-product, [class*='ProductCard'], [data-testid='product-list-item']",
        name: ".item-product__name, [class*='ProductName'], [class*='product-name'], h2, h3",
        price: ".price, [class*='Price'], [class*='price'], .item-product__price",
        originalPrice: ".was-price, [class*='WasPrice'], .strikethrough",
        badge: ".badge--sale, [class*='SaveBadge'], .item-product__badge",
        image: "img.item-product__image, img[class*='product']",
      });
    },
  },
  {
    name: "Pick n Pay",
    targetKey: "pnp",
    home: "https://www.pnp.co.za",
    searchUrl: (q) => `https://www.pnp.co.za/search?q=${encodeURIComponent(q)}`,
    readySelector: ".product-item, .grid-product, [class*='ProductCard']",
    extract: async (page, category) => {
      const data = await extractWindowData(page) as Record<string, unknown> | null;
      if (data) {
        const products = extractFromNextData(data, "Pick n Pay", category);
        if (products.length) return products;
      }
      return domExtract(page, "Pick n Pay", category, {
        card: ".product-item, [class*='ProductCard'], .grid-product",
        name: ".product-name, [class*='ProductName'], h2, h3",
        price: ".price, [class*='Price'], .product-price",
        originalPrice: ".was-price, .original-price, .strike",
        badge: ".save-badge, .special, .promotion",
      });
    },
  },
  {
    name: "Woolworths",
    targetKey: "woolworths",
    home: "https://www.woolworths.co.za",
    searchUrl: (q) => `https://www.woolworths.co.za/cat?Ntt=${encodeURIComponent(q)}`,
    readySelector: ".product-list__item, [class*='ProductTile'], [class*='product-tile']",
    extract: async (page, category) => {
      const data = await extractWindowData(page) as Record<string, unknown> | null;
      if (data) {
        const products = extractFromNextData(data, "Woolworths", category);
        if (products.length) return products;
      }
      return domExtract(page, "Woolworths", category, {
        card: ".product-list__item, [class*='ProductTile'], [class*='product-card']",
        name: ".product-card__name, [class*='ProductName'], [class*='product-name'], h2, h3",
        price: ".price, [class*='Price'], .price__selling",
        originalPrice: ".price__was, .was-price",
        badge: "[class*='Promotion'], .badge--sale",
      });
    },
  },
  {
    name: "Clicks",
    targetKey: "clicks",
    home: "https://www.clicks.co.za",
    searchUrl: (q) => `https://www.clicks.co.za/search?q=${encodeURIComponent(q)}`,
    readySelector: ".product-item, [class*='ProductItem'], [data-product-code]",
    extract: async (page, category) => {
      const data = await extractWindowData(page) as Record<string, unknown> | null;
      if (data) {
        const products = extractFromNextData(data, "Clicks", category);
        if (products.length) return products;
      }
      return domExtract(page, "Clicks", category, {
        card: ".product-item, [class*='ProductItem'], [data-product-code]",
        name: ".product-name, [class*='ProductName'], h2, h3",
        price: ".price, [class*='Price'], .item-price",
        originalPrice: ".was-price, .original-price",
        badge: ".badge-sale, .special, .promotion",
      });
    },
  },
  {
    name: "Game",
    targetKey: "game",
    home: "https://www.game.co.za",
    searchUrl: (q) => `https://www.game.co.za/search?q=${encodeURIComponent(q)}`,
    readySelector: ".product-item, [data-sku], [class*='ProductCard']",
    extract: async (page, category) => {
      const data = await extractWindowData(page) as Record<string, unknown> | null;
      if (data) {
        const products = extractFromNextData(data, "Game", category);
        if (products.length) return products;
      }
      return domExtract(page, "Game", category, {
        card: ".product-item, [data-sku], [class*='ProductCard']",
        name: ".product-name, [class*='ProductName'], h2, h3",
        price: ".price, .selling-price, [class*='Price']",
        originalPrice: ".was-price, .original-price",
        badge: ".badge-sale, .on-sale",
      });
    },
  },
  {
    name: "Mr Price",
    targetKey: "mrprice",
    home: "https://www.mrprice.co.za",
    searchUrl: (q) => `https://www.mrprice.co.za/search?q=${encodeURIComponent(q)}`,
    readySelector: ".product-card, .product-tile, [class*='ProductCard']",
    extract: async (page, category) => {
      const data = await extractWindowData(page) as Record<string, unknown> | null;
      if (data) {
        const products = extractFromNextData(data, "Mr Price", category);
        if (products.length) return products;
      }
      return domExtract(page, "Mr Price", category, {
        card: ".product-card, .product-tile, [class*='ProductCard']",
        name: ".product-name, [class*='ProductName'], h2, h3",
        price: ".price, .selling-price, [class*='Price']",
        originalPrice: ".was-price, .compare-at-price, s",
        badge: ".sale, .on-sale, [class*='Sale']",
      });
    },
  },
  {
    name: "Sportsmans Warehouse",
    targetKey: "sportsmans",
    home: "https://www.sportsmanswarehouse.co.za",
    searchUrl: (q) => `https://www.sportsmanswarehouse.co.za/catalogsearch/result/?q=${encodeURIComponent(q)}`,
    readySelector: ".product-item, [class*='ProductCard'], .item",
    extract: async (page, category) => {
      const data = await extractWindowData(page) as Record<string, unknown> | null;
      if (data) {
        const products = extractFromNextData(data, "Sportsmans Warehouse", category);
        if (products.length) return products;
      }
      return domExtract(page, "Sportsmans Warehouse", category, {
        card: ".product-item, [class*='ProductCard']",
        name: ".product-item-name, [class*='ProductName'], h2, h3",
        price: ".price, .special-price .price, [class*='Price']",
        originalPrice: ".old-price .price, .was-price",
        badge: ".sale-badge, .special-price",
      });
    },
  },
];

// ── __NEXT_DATA__ / embedded JSON extractor ──────────────────────────────────

function dig(obj: unknown, ...paths: string[][]): unknown[] {
  const results: unknown[] = [];
  for (const path of paths) {
    let cur: unknown = obj;
    for (const key of path) {
      if (!cur || typeof cur !== "object") { cur = undefined; break; }
      cur = (cur as Record<string, unknown>)[key];
    }
    if (Array.isArray(cur) && cur.length) results.push(...cur);
    else if (cur) results.push(cur);
  }
  return results;
}

function extractFromNextData(data: unknown, retailerName: string, category: string): ScrapedProduct[] {
  // Try common paths in Next.js / embedded JSON structures
  const candidates = dig(
    data,
    ["props", "pageProps", "products"],
    ["props", "pageProps", "initialData", "products"],
    ["props", "pageProps", "searchResults", "products"],
    ["props", "pageProps", "data", "products"],
    ["pageData", "products"],
    ["products"],
    ["results"],
    ["items"],
  );

  const results: ScrapedProduct[] = [];
  for (const item of candidates) {
    if (!item || typeof item !== "object") continue;
    const p = item as Record<string, unknown>;
    const name = (p["name"] ?? p["title"] ?? p["displayName"]) as string | undefined;
    if (!name) continue;
    const price = parsePrice(String(p["price"] ?? p["sellingPrice"] ?? p["currentPrice"] ?? ""));
    if (!price) continue;
    const origPrice = parsePrice(String(p["wasPrice"] ?? p["originalPrice"] ?? p["compareAtPrice"] ?? ""));
    results.push({
      retailerName,
      name,
      brand: (p["brand"] as string) ?? null,
      category,
      price,
      originalPrice: origPrice && origPrice > price ? origPrice : null,
      isOnSpecial: !!(p["onSale"] || p["isSpecial"] || (origPrice && origPrice > price)),
      inStock: p["inStock"] !== false,
      imageUrl: (p["image"] ?? p["imageUrl"] ?? p["thumbnail"]) as string ?? null,
    });
  }
  return results;
}

// ── Main scraper function ─────────────────────────────────────────────────────

export async function scrapeWithPlaywright(retailerName: string): Promise<ScrapedProduct[]> {
  const config = RETAILERS.find((r) => r.name === retailerName);
  if (!config) throw new Error(`Unknown retailer: ${retailerName}`);

  const targets = RETAILER_TARGETS[config.targetKey] ?? [];
  const browser = await getBrowser();
  const { page, context } = await newStealthPage(browser);
  const results: ScrapedProduct[] = [];

  console.log(`  [${config.name.toLowerCase()}] warming up…`);
  try {
    // Warm up on homepage to get cookies + pass Cloudflare challenge
    await goto(page, config.home);
    await page.waitForTimeout(2000 + Math.random() * 1000);
  } catch { /* if homepage fails, try search pages anyway */ }

  for (const target of targets) {
    console.log(`  [${config.name.toLowerCase()}] → "${target.query}"`);
    try {
      await goto(page, config.searchUrl(target.query));

      // Wait for products to appear (up to 15s)
      let selectorFound = false;
      try {
        await page.waitForSelector(config.readySelector, { timeout: 15_000 });
        selectorFound = true;
      } catch {
        // Selector didn't appear — check what we actually got
        const title = await page.title();
        const url   = page.url();
        const html  = await page.content();
        const isBot =
          title.toLowerCase().includes("just a moment") ||
          title.toLowerCase().includes("attention required") ||
          title.toLowerCase().includes("cloudflare") ||
          html.includes("cf-browser-verification") ||
          html.includes("__cf_chl") ||
          html.includes("cf_clearance") ||
          url.includes("challenge");

        if (isBot) {
          console.warn(`    ⚠ Bot check detected on "${target.query}" (title: "${title}") — skipping`);
          continue;
        }
        // Not a bot page — selectors just didn't match, try anyway
        console.warn(`    ⚠ readySelector not found (title: "${title}") — trying extraction anyway`);
      }

      // Extra scroll to trigger lazy-loaded products
      if (selectorFound) {
        await page.evaluate(() => window.scrollBy(0, 600));
        await page.waitForTimeout(800);
      }

      const products = await config.extract(page, target.category);
      if (products.length) {
        console.log(`    ${products.length} products`);
        results.push(...products.slice(0, 8));
      } else {
        // Try JSON-LD as last resort
        const ldBlocks = await extractPageJsonLd(page);
        for (const block of ldBlocks) {
          const arr = Array.isArray(block) ? block : [block];
          for (const item of arr) {
            const p = item as Record<string, unknown>;
            const name = p["name"] as string | undefined;
            const offers = p["offers"] as Record<string, unknown> | undefined;
            const price = parsePrice(String(offers?.["price"] ?? ""));
            if (name && price) {
              results.push({
                retailerName: config.name,
                name,
                brand: null,
                category: target.category,
                price,
                originalPrice: null,
                isOnSpecial: false,
                inStock: offers?.["availability"] !== "OutOfStock",
                imageUrl: (p["image"] as string) ?? null,
              });
            }
          }
        }
        if (!results.length) {
          const title = await page.title();
          console.warn(`    No results for "${target.query}" (page title: "${title}")`);
        }
      }

      // Human-like pause between searches
      await page.waitForTimeout(1500 + Math.random() * 1500);

    } catch (e) {
      console.error(`    Error on "${target.query}":`, (e as Error).message);
    }
  }

  await context.close();
  console.log(`  [${config.name.toLowerCase()}] ${results.length} products collected`);
  return results;
}

// Export individual scraper functions matching the existing pattern
export const scrapeCheckers    = () => scrapeWithPlaywright("Checkers");
export const scrapePnP         = () => scrapeWithPlaywright("Pick n Pay");
export const scrapeWoolworths  = () => scrapeWithPlaywright("Woolworths");
export const scrapeClicks      = () => scrapeWithPlaywright("Clicks");
export const scrapeGame        = () => scrapeWithPlaywright("Game");
export const scrapeMrPrice     = () => scrapeWithPlaywright("Mr Price");
export const scrapeSportsmans  = () => scrapeWithPlaywright("Sportsmans Warehouse");
