/**
 * Checkers / Shoprite scraper.
 * Targets the Sixty60 / Checkers website API (SAP Commerce Cloud).
 * Falls back to JSON-LD structured data embedded in search result pages.
 */

import * as cheerio from "cheerio";
import { SmartFetcher, extractJsonLd, dig } from "../framework/fetcher.js";
import { RETAILER_TARGETS } from "../targets.js";
import type { ScrapedProduct } from "../db.js";

const HOME    = "https://www.checkers.co.za";
const SHOP_NAME = "Checkers";

interface HybrisProduct {
  name?: string;
  brand?: { name?: string };
  price?: { value?: number; formattedValue?: string };
  images?: Array<{ format?: string; url?: string }>;
  categories?: Array<{ name?: string }>;
  stock?: { stockLevelStatus?: string };
  potentialPromotions?: Array<{ description?: string }>;
}

function parsePrice(raw: string | undefined): number | null {
  if (!raw) return null;
  const n = parseFloat(raw.replace(/[^0-9.]/g, ""));
  return isNaN(n) ? null : Math.round(n);
}

function extractFromHybris(data: unknown): ScrapedProduct[] {
  const products: unknown[] =
    (dig(data, "products") as unknown[]) ??
    (dig(data, "searchPageData.results") as unknown[]) ??
    [];

  return products
    .filter(Boolean)
    .map((p): ScrapedProduct | null => {
      const hp = p as HybrisProduct;
      const price = hp.price?.value ?? parsePrice(hp.price?.formattedValue);
      if (!price || price < 2) return null;
      const name = hp.name;
      if (!name) return null;
      const img = hp.images?.find((i) => i.format === "product")?.url;
      return {
        retailerName: SHOP_NAME,
        name,
        brand: hp.brand?.name ?? null,
        category: hp.categories?.[0]?.name ?? "Grocery",
        price,
        originalPrice: null,
        isOnSpecial: (hp.potentialPromotions?.length ?? 0) > 0,
        inStock: hp.stock?.stockLevelStatus !== "outOfStock",
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
      const name = (item as Record<string, unknown>)["name"] as string | undefined;
      const priceSpec = (item as Record<string, unknown>)["offers"] as Record<string, unknown> | undefined;
      const price = parsePrice(String(priceSpec?.["price"] ?? ""));
      if (!name || !price) continue;
      const img = ((item as Record<string, unknown>)["image"] as string | undefined) ?? null;
      results.push({
        retailerName: SHOP_NAME,
        name,
        brand: null,
        category: "Grocery",
        price,
        originalPrice: null,
        isOnSpecial: false,
        inStock: priceSpec?.["availability"] !== "OutOfStock",
        imageUrl: img,
      });
    }
  }
  return results;
}

function extractFromHtml(html: string): ScrapedProduct[] {
  const $ = cheerio.load(html);
  const results: ScrapedProduct[] = [];

  $("[data-product-name], .item-product, .product-item, .product-grid-item").each((_, el) => {
    const name =
      $(el).attr("data-product-name") ??
      $(el).find(".product-name, .item-name, h2, h3").first().text().trim();
    const priceText =
      $(el).find("[data-price], .price, .product-price, .item-price").first().text().trim();
    const price = parsePrice(priceText);
    if (!name || !price) return;
    const img = $(el).find("img").first().attr("src") ?? null;
    results.push({
      retailerName: SHOP_NAME,
      name,
      brand: null,
      category: "Grocery",
      price,
      originalPrice: null,
      isOnSpecial: $(el).find(".badge-sale, .sale-badge, .special").length > 0,
      inStock: true,
      imageUrl: img,
    });
  });

  return results;
}

export async function scrapeCheckers(): Promise<ScrapedProduct[]> {
  const fetcher = new SmartFetcher({ meanDelay: 3000, stdDelay: 1000 });
  await fetcher.warmUp(HOME);

  const results: ScrapedProduct[] = [];
  const targets = RETAILER_TARGETS.checkers;

  for (const target of targets) {
    console.log(`  [checkers] → "${target.query}"`);

    // Strategy 1: SAP Commerce / Hybris JSON API
    const apiUrl = `${HOME}/api/2.0/page/search?q=${encodeURIComponent(target.query)}&pageSize=20&lang=en`;
    try {
      const apiRes = await fetcher.get(apiUrl, {
        referer: `${HOME}/search?q=${encodeURIComponent(target.query)}`,
        extraHeaders: { "Accept": "application/json" },
      });

      if (apiRes.ok) {
        const data = apiRes.json();
        const products = extractFromHybris(data);
        if (products.length) {
          console.log(`    API: ${products.length} products`);
          results.push(...products.slice(0, 8));
          continue;
        }
      }
    } catch { /* fall through */ }

    // Strategy 2: Parse search results page HTML
    const pageUrl = `${HOME}/search?q=${encodeURIComponent(target.query)}`;
    try {
      const pageRes = await fetcher.get(pageUrl, { referer: HOME });
      if (pageRes.ok) {
        const jsonLd = extractJsonLd(pageRes.text);
        const ldProducts = extractFromJsonLd(jsonLd);
        if (ldProducts.length) {
          console.log(`    JSON-LD: ${ldProducts.length} products`);
          results.push(...ldProducts.slice(0, 8));
          continue;
        }

        const htmlProducts = extractFromHtml(pageRes.text);
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

  console.log(`  [checkers] ${results.length} products collected`);
  return results;
}
