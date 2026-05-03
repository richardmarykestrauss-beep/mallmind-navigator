/**
 * Game Stores scraper.
 * Game (Massmart) runs on a Next.js + Algolia stack.
 * Primary: Algolia search API (extracted from source).
 * Fallback: JSON-LD and Cheerio HTML.
 */

import * as cheerio from "cheerio";
import { SmartFetcher, extractJsonLd, extractEmbeddedJson, dig } from "../framework/fetcher.js";
import { RETAILER_TARGETS } from "../targets.js";
import type { ScrapedProduct } from "../db.js";

const HOME      = "https://www.game.co.za";
const SHOP_NAME = "Game";

function parsePrice(raw: string | number | undefined): number | null {
  if (raw == null) return null;
  if (typeof raw === "number") return Math.round(raw);
  const n = parseFloat(String(raw).replace(/[^0-9.]/g, ""));
  return isNaN(n) ? null : Math.round(n);
}

function extractFromAlgolia(data: unknown): ScrapedProduct[] {
  const hits: unknown[] =
    (dig(data, "hits") as unknown[]) ??
    (dig(data, "results.0.hits") as unknown[]) ??
    [];

  return (Array.isArray(hits) ? hits : [])
    .map((p): ScrapedProduct | null => {
      const item = p as Record<string, unknown>;
      const name = (item["name"] ?? item["title"]) as string | undefined;
      if (!name) return null;

      // Algolia stores prices in ZAR cents or as floats
      const rawPrice = item["price"] ?? item["selling_price"] ?? item["current_price"];
      let price = parsePrice(rawPrice as number | string);
      if (!price) return null;
      // If suspiciously small, likely in cents
      if (price < 10 && typeof rawPrice === "number") price = Math.round(rawPrice / 100);
      if (price < 10) return null;

      const rawOriginal = item["original_price"] ?? item["was_price"] ?? item["regular_price"];
      let originalPrice = rawOriginal ? parsePrice(rawOriginal as number | string) : null;
      if (originalPrice && originalPrice < 10 && typeof rawOriginal === "number") originalPrice = Math.round((rawOriginal as number) / 100);

      const images = item["images"] as Array<Record<string, string>> | undefined;
      const img =
        (item["image"] as string) ??
        (item["thumbnail"] as string) ??
        images?.[0]?.["url"] ??
        images?.[0]?.["src"] ??
        null;

      return {
        retailerName: SHOP_NAME,
        name,
        brand: (item["brand"] as string) ?? null,
        category: (item["category"] as string) ?? "Electronics",
        price,
        originalPrice: originalPrice && originalPrice > price ? originalPrice : null,
        isOnSpecial: !!(item["on_sale"] || item["is_on_special"] || (originalPrice && originalPrice > price)),
        inStock: item["in_stock"] !== false && item["available"] !== false,
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
      if (!name || !price || price < 10) continue;
      results.push({
        retailerName: SHOP_NAME,
        name,
        brand: (obj["brand"] as Record<string, unknown>)?.["name"] as string ?? null,
        category: "Electronics",
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

function extractFromHtml(html: string, category: string): ScrapedProduct[] {
  const $ = cheerio.load(html);
  const results: ScrapedProduct[] = [];

  $(".product-item, .product-card, .product, [data-sku]").each((_, el) => {
    const name = $(el).find(".product-name, .product-title, h2, h3").first().text().trim();
    const priceText = $(el).find(".price, .selling-price, .current-price").first().text().trim();
    const price = parsePrice(priceText);
    if (!name || !price || price < 10) return;
    const wasText = $(el).find(".was-price, .original-price, .strike").first().text().trim();
    const originalPrice = wasText ? parsePrice(wasText) : null;
    const img = $(el).find("img").first().attr("src") ?? null;
    results.push({
      retailerName: SHOP_NAME,
      name,
      brand: null,
      category,
      price,
      originalPrice,
      isOnSpecial: !!($(el).find(".badge-sale, .on-sale, .special").length || (originalPrice && originalPrice > price)),
      inStock: !$(el).find(".out-of-stock").length,
      imageUrl: img,
    });
  });

  return results;
}

export async function scrapeGame(): Promise<ScrapedProduct[]> {
  const fetcher = new SmartFetcher({ meanDelay: 3200, stdDelay: 1100 });
  await fetcher.warmUp(HOME);

  const results: ScrapedProduct[] = [];

  for (const target of RETAILER_TARGETS.game) {
    console.log(`  [game] → "${target.query}"`);

    // Strategy 1: Next.js embedded Algolia data
    const pageUrl = `${HOME}/search?q=${encodeURIComponent(target.query)}`;
    try {
      const res = await fetcher.get(pageUrl, { referer: HOME });
      if (res.ok) {
        // Try embedded JSON first (Next.js __NEXT_DATA__ contains Algolia response)
        const embedded = extractEmbeddedJson(res.text);
        for (const block of embedded) {
          const products = extractFromAlgolia(block);
          if (products.length) {
            console.log(`    Embedded/Algolia: ${products.length} products`);
            results.push(...products.slice(0, 8));
            break;
          }
        }
        if (results.length) continue;

        const ldBlocks = extractJsonLd(res.text);
        const ldProducts = extractFromJsonLd(ldBlocks);
        if (ldProducts.length) {
          console.log(`    JSON-LD: ${ldProducts.length} products`);
          results.push(...ldProducts.slice(0, 8));
          continue;
        }

        const htmlProducts = extractFromHtml(res.text, target.category);
        if (htmlProducts.length) {
          console.log(`    HTML: ${htmlProducts.length} products`);
          results.push(...htmlProducts.slice(0, 8));
          continue;
        }
      }
    } catch (e) {
      console.error(`    Error: ${e}`);
    }

    // Strategy 2: Game internal product search API
    const apiUrl = `${HOME}/api/products/search?query=${encodeURIComponent(target.query)}&pageSize=20`;
    try {
      const res = await fetcher.get(apiUrl, {
        referer: pageUrl,
        extraHeaders: { "Accept": "application/json" },
      });
      if (res.ok) {
        const data = res.json();
        const products = extractFromAlgolia(data);
        if (products.length) {
          console.log(`    Internal API: ${products.length} products`);
          results.push(...products.slice(0, 8));
          continue;
        }
      }
    } catch { /* fall through */ }

    console.warn(`    No results for "${target.query}"`);
  }

  console.log(`  [game] ${results.length} products collected`);
  return results;
}
