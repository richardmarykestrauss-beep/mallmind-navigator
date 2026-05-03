/**
 * Mr Price scraper.
 * Mr Price Group runs on a custom platform with a REST search API.
 * They expose a JSON endpoint at /api/search that returns product listings.
 * Fallback: embedded Next.js data → JSON-LD → Cheerio HTML.
 */

import * as cheerio from "cheerio";
import { SmartFetcher, extractJsonLd, extractEmbeddedJson, dig } from "../framework/fetcher.js";
import { RETAILER_TARGETS } from "../targets.js";
import type { ScrapedProduct } from "../db.js";

const HOME      = "https://www.mrprice.co.za";
const SHOP_NAME = "Mr Price";

function parsePrice(raw: string | number | undefined): number | null {
  if (raw == null) return null;
  if (typeof raw === "number") return Math.round(raw);
  const n = parseFloat(String(raw).replace(/[^0-9.]/g, ""));
  return isNaN(n) ? null : Math.round(n);
}

function extractFromJson(data: unknown): ScrapedProduct[] {
  const items: unknown[] =
    (dig(data, "products") as unknown[]) ??
    (dig(data, "results") as unknown[]) ??
    (dig(data, "items") as unknown[]) ??
    (dig(data, "data.products") as unknown[]) ??
    [];

  return (Array.isArray(items) ? items : [])
    .map((p): ScrapedProduct | null => {
      const item = p as Record<string, unknown>;
      const name = (item["name"] ?? item["title"] ?? item["productName"]) as string | undefined;
      if (!name) return null;

      const price = parsePrice(
        (item["price"] as number | string) ??
        (item["sellingPrice"] as number | string) ??
        (item["currentPrice"] as number | string) ??
        ((item["priceRange"] as Record<string, unknown>)?.["min"] as number | string)
      );
      if (!price || price < 10) return null;

      const originalPrice = parsePrice(
        (item["wasPrice"] as number | string) ??
        (item["originalPrice"] as number | string) ??
        (item["compareAtPrice"] as number | string)
      );

      const img =
        (item["image"] as string) ??
        (item["imageUrl"] as string) ??
        (item["thumbnail"] as string) ??
        ((item["images"] as Array<Record<string, string>>)?.[0]?.["url"]) ??
        null;

      return {
        retailerName: SHOP_NAME,
        name,
        brand: (item["brand"] as string) ?? null,
        category: (item["category"] as string) ?? "Clothing",
        price,
        originalPrice: originalPrice && originalPrice > price ? originalPrice : null,
        isOnSpecial: !!(item["onSale"] || item["isSpecial"] || (originalPrice && originalPrice > price)),
        inStock: item["inStock"] !== false && item["available"] !== false,
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
        brand: null,
        category: "Clothing",
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

  $(".product-item, .product-card, .product-tile, .product").each((_, el) => {
    const name = $(el).find(".product-name, .product-title, h2, h3, .name").first().text().trim();
    const priceText = $(el).find(".price, .selling-price, .product-price").first().text().trim();
    const price = parsePrice(priceText);
    if (!name || !price || price < 10) return;
    const wasText = $(el).find(".was-price, .original-price, .compare-at-price, s").first().text().trim();
    const originalPrice = wasText ? parsePrice(wasText) : null;
    const img = $(el).find("img").first().attr("src") ?? null;
    results.push({
      retailerName: SHOP_NAME,
      name,
      brand: null,
      category,
      price,
      originalPrice,
      isOnSpecial: !!($(el).find(".sale, .on-sale, .badge-sale, .special").length || (originalPrice && originalPrice > price)),
      inStock: !$(el).find(".out-of-stock, .sold-out").length,
      imageUrl: img,
    });
  });

  return results;
}

export async function scrapeMrPrice(): Promise<ScrapedProduct[]> {
  const fetcher = new SmartFetcher({ meanDelay: 3200, stdDelay: 1100 });
  await fetcher.warmUp(HOME);

  const results: ScrapedProduct[] = [];

  for (const target of RETAILER_TARGETS.mrprice) {
    console.log(`  [mrprice] → "${target.query}"`);

    // Strategy 1: Mr Price JSON API
    const apiUrl = `${HOME}/api/search?q=${encodeURIComponent(target.query)}&pageSize=20&page=1`;
    try {
      const res = await fetcher.get(apiUrl, {
        referer: `${HOME}/search?q=${encodeURIComponent(target.query)}`,
        extraHeaders: {
          "Accept": "application/json",
          "X-Requested-With": "XMLHttpRequest",
        },
      });
      if (res.ok) {
        const data = res.json();
        const products = extractFromJson(data);
        if (products.length) {
          console.log(`    API: ${products.length} products`);
          results.push(...products.slice(0, 8));
          continue;
        }
      }
    } catch { /* fall through */ }

    // Strategy 2: Embedded Next.js data
    const pageUrl = `${HOME}/search?q=${encodeURIComponent(target.query)}`;
    try {
      const res = await fetcher.get(pageUrl, { referer: HOME });
      if (res.ok) {
        const embedded = extractEmbeddedJson(res.text);
        for (const block of embedded) {
          const products = extractFromJson(block);
          if (products.length) {
            console.log(`    Embedded: ${products.length} products`);
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

    console.warn(`    No results for "${target.query}"`);
  }

  console.log(`  [mrprice] ${results.length} products collected`);
  return results;
}
