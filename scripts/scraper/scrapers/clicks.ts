/**
 * Clicks scraper.
 * Clicks SA pharmacy/health/beauty chain.
 * Uses their hybris-based search API.
 * Fallback: JSON-LD and Cheerio HTML.
 */

import * as cheerio from "cheerio";
import { SmartFetcher, extractJsonLd, dig } from "../framework/fetcher.js";
import { RETAILER_TARGETS } from "../targets.js";
import type { ScrapedProduct } from "../db.js";

const HOME      = "https://www.clicks.co.za";
const SHOP_NAME = "Clicks";

interface ClicksProduct {
  name?: string;
  brand?: string | { name?: string };
  price?: { value?: number; formattedValue?: string };
  wasPrice?: { value?: number };
  promotions?: Array<{ description?: string }>;
  potentialPromotions?: Array<unknown>;
  images?: Array<{ format?: string; url?: string }>;
  categories?: Array<{ name?: string }>;
  stock?: { stockLevelStatus?: string };
}

function parsePrice(raw: string | number | undefined): number | null {
  if (raw == null) return null;
  if (typeof raw === "number") return Math.round(raw);
  const n = parseFloat(String(raw).replace(/[^0-9.]/g, ""));
  return isNaN(n) ? null : Math.round(n);
}

function extractFromHybris(data: unknown): ScrapedProduct[] {
  const products: unknown[] =
    (dig(data, "products") as unknown[]) ??
    (dig(data, "results") as unknown[]) ??
    (dig(data, "data.products") as unknown[]) ??
    [];

  return (Array.isArray(products) ? products : [])
    .map((p): ScrapedProduct | null => {
      const item = p as ClicksProduct;
      const name = item.name;
      if (!name) return null;

      const price = item.price?.value ?? parsePrice(item.price?.formattedValue);
      if (!price || price < 2) return null;

      const originalPrice = item.wasPrice?.value ?? null;
      const isOnSpecial =
        !!(item.promotions?.length) ||
        !!(item.potentialPromotions?.length) ||
        !!(originalPrice && originalPrice > price);

      const img = item.images?.find((i) => i.format === "product")?.url ?? null;
      const brand = typeof item.brand === "string" ? item.brand : item.brand?.name ?? null;

      return {
        retailerName: SHOP_NAME,
        name,
        brand,
        category: item.categories?.[0]?.name ?? "Health & Beauty",
        price,
        originalPrice: originalPrice && originalPrice > price ? originalPrice : null,
        isOnSpecial,
        inStock: item.stock?.stockLevelStatus !== "outOfStock",
        imageUrl: img ? (img.startsWith("http") ? img : `${HOME}${img}`) : null,
      };
    })
    .filter((p): p is ScrapedProduct => p !== null);
}

function extractFromJsonLd(blocks: unknown[]): ScrapedProduct[] {
  const results: ScrapedProduct[] = [];
  for (const block of blocks) {
    const arr = Array.isArray(block) ? block : [block];
    for (const item of arr) {
      const obj = item as Record<string, unknown>;
      const name = obj["name"] as string | undefined;
      const offers = obj["offers"] as Record<string, unknown> | undefined;
      const price = parsePrice(String(offers?.["price"] ?? ""));
      if (!name || !price || price < 2) continue;
      results.push({
        retailerName: SHOP_NAME,
        name,
        brand: null,
        category: "Health & Beauty",
        price,
        originalPrice: null,
        isOnSpecial: false,
        inStock: offers?.["availability"] !== "OutOfStock",
        imageUrl: (obj["image"] as string) ?? null,
      });
    }
  }
  return results;
}

function extractFromHtml(html: string): ScrapedProduct[] {
  const $ = cheerio.load(html);
  const results: ScrapedProduct[] = [];

  $(".product-item, .product-card, .product, [data-product-code]").each((_, el) => {
    const name = $(el).find(".product-name, .item-name, h2, h3").first().text().trim();
    const priceText = $(el).find(".price, .item-price, [data-price]").first().text().trim();
    const price = parsePrice(priceText);
    if (!name || !price || price < 2) return;
    const wasText = $(el).find(".was-price, .strike, .original-price").first().text().trim();
    const originalPrice = wasText ? parsePrice(wasText) : null;
    const img = $(el).find("img").first().attr("src") ?? null;
    results.push({
      retailerName: SHOP_NAME,
      name,
      brand: null,
      category: "Health & Beauty",
      price,
      originalPrice,
      isOnSpecial: !!($(el).find(".badge-sale, .special, .promotion").length || (originalPrice && originalPrice > price)),
      inStock: !$(el).find(".out-of-stock").length,
      imageUrl: img,
    });
  });

  return results;
}

export async function scrapeClicks(): Promise<ScrapedProduct[]> {
  const fetcher = new SmartFetcher({ meanDelay: 3000, stdDelay: 1000 });
  await fetcher.warmUp(HOME);

  const results: ScrapedProduct[] = [];

  for (const target of RETAILER_TARGETS.clicks) {
    console.log(`  [clicks] → "${target.query}"`);

    // Strategy 1: Hybris search API
    const apiUrl = `${HOME}/c/store/en/search?q=${encodeURIComponent(target.query)}&pageSize=20&format=json`;
    try {
      const res = await fetcher.get(apiUrl, {
        referer: `${HOME}/search?q=${encodeURIComponent(target.query)}`,
        extraHeaders: { "Accept": "application/json" },
      });
      if (res.ok) {
        const data = res.json();
        const products = extractFromHybris(data);
        if (products.length) {
          console.log(`    API: ${products.length} products`);
          results.push(...products.slice(0, 8));
          continue;
        }
      }
    } catch { /* fall through */ }

    // Strategy 2: AJAX search endpoint
    const ajaxUrl = `${HOME}/search/autocomplete/SearchBox/?q=${encodeURIComponent(target.query)}&max=10`;
    try {
      const res = await fetcher.get(ajaxUrl, {
        referer: `${HOME}/search?q=${encodeURIComponent(target.query)}`,
        extraHeaders: {
          "Accept": "application/json",
          "X-Requested-With": "XMLHttpRequest",
        },
      });
      if (res.ok) {
        const data = res.json();
        const products = extractFromHybris(data);
        if (products.length) {
          console.log(`    AJAX: ${products.length} products`);
          results.push(...products.slice(0, 8));
          continue;
        }
      }
    } catch { /* fall through */ }

    // Strategy 3: HTML search page
    const pageUrl = `${HOME}/search?q=${encodeURIComponent(target.query)}`;
    try {
      const res = await fetcher.get(pageUrl, { referer: HOME });
      if (res.ok) {
        const ldBlocks = extractJsonLd(res.text);
        const ldProducts = extractFromJsonLd(ldBlocks);
        if (ldProducts.length) {
          console.log(`    JSON-LD: ${ldProducts.length} products`);
          results.push(...ldProducts.slice(0, 8));
          continue;
        }

        const htmlProducts = extractFromHtml(res.text);
        if (htmlProducts.length) {
          console.log(`    HTML: ${htmlProducts.length} products`);
          results.push(...htmlProducts.slice(0, 8));
          continue;
        }
      }
    } catch (e) {
      console.error(`    Error: ${e}`);
    }

    console.warn(`    No results for "${target.query}"`);
  }

  console.log(`  [clicks] ${results.length} products collected`);
  return results;
}
