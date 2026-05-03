/**
 * Incredible Connection scraper.
 * Incredible runs on a custom Magento/hybris stack.
 * Primary: their AJAX search endpoint returns JSON product listings.
 * Fallback: search results page HTML + JSON-LD.
 */

import * as cheerio from "cheerio";
import { SmartFetcher, extractJsonLd, extractEmbeddedJson, dig } from "../framework/fetcher.js";
import { RETAILER_TARGETS } from "../targets.js";
import type { ScrapedProduct } from "../db.js";

const HOME      = "https://www.incredible.co.za";
const SHOP_NAME = "Incredible Connection";

function parsePrice(raw: string | number | undefined): number | null {
  if (raw == null) return null;
  if (typeof raw === "number") return Math.round(raw);
  const n = parseFloat(String(raw).replace(/[^0-9.]/g, ""));
  return isNaN(n) ? null : Math.round(n);
}

function extractFromJson(data: unknown): ScrapedProduct[] {
  const items: unknown[] =
    (dig(data, "products") as unknown[]) ??
    (dig(data, "items") as unknown[]) ??
    (dig(data, "results") as unknown[]) ??
    (Array.isArray(data) ? data : []);

  return (Array.isArray(items) ? items : [])
    .map((p): ScrapedProduct | null => {
      const item = p as Record<string, unknown>;
      const name = (item["name"] ?? item["title"]) as string | undefined;
      if (!name) return null;

      const price = parsePrice(
        (item["price"] as number | string) ??
        (item["final_price"] as number | string) ??
        ((item["price_info"] as Record<string, unknown>)?.["final_price"] as number | string)
      );
      if (!price || price < 50) return null;

      const originalPrice = parsePrice(
        (item["original_price"] as number | string) ??
        (item["regular_price"] as number | string) ??
        ((item["price_info"] as Record<string, unknown>)?.["regular_price"] as number | string)
      );

      const img = (item["image"] ?? item["thumbnail"] ?? item["small_image"]) as string | undefined;
      const brand = (item["brand"] ?? item["manufacturer"]) as string | undefined;

      return {
        retailerName: SHOP_NAME,
        name,
        brand: brand ?? null,
        category: (item["category"] as string) ?? "Electronics",
        price,
        originalPrice: originalPrice && originalPrice > price ? originalPrice : null,
        isOnSpecial: !!(originalPrice && originalPrice > price) || !!(item["is_sale"] || item["special_price"]),
        inStock: item["is_in_stock"] !== false && item["stock_status"] !== "OUT_OF_STOCK",
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
      if (!name || !price || price < 50) continue;
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

  $(".product-item, .product-card, [data-product-sku], .item").each((_, el) => {
    const name = $(el).find(".product-item-name, .product-name, h2, h3, a.product-item-link").first().text().trim();
    const priceText = $(el)
      .find(".price, .price-final_price, .special-price .price, .regular-price .price")
      .first()
      .text()
      .trim();
    const price = parsePrice(priceText);
    if (!name || !price || price < 50) return;
    const oldText = $(el).find(".old-price .price, .was-price").first().text().trim();
    const originalPrice = oldText ? parsePrice(oldText) : null;
    const img = $(el).find("img.product-image-photo, img").first().attr("src") ?? null;
    results.push({
      retailerName: SHOP_NAME,
      name,
      brand: null,
      category,
      price,
      originalPrice,
      isOnSpecial: !!($(el).find(".sale, .special-price, .badge-sale").length || (originalPrice && originalPrice > price)),
      inStock: !$(el).find(".out-of-stock, .unavailable").length,
      imageUrl: img,
    });
  });

  return results;
}

export async function scrapeIncredible(): Promise<ScrapedProduct[]> {
  const fetcher = new SmartFetcher({ meanDelay: 3000, stdDelay: 1000 });
  await fetcher.warmUp(HOME);

  const results: ScrapedProduct[] = [];

  for (const target of RETAILER_TARGETS.incredible) {
    console.log(`  [incredible] → "${target.query}"`);

    // Strategy 1: Magento AJAX search endpoint
    const apiUrl = `${HOME}/catalogsearch/result/index/?q=${encodeURIComponent(target.query)}&ajax=1`;
    try {
      const res = await fetcher.get(apiUrl, {
        referer: `${HOME}/catalogsearch/result/?q=${encodeURIComponent(target.query)}`,
        extraHeaders: {
          "Accept": "application/json, text/plain, */*",
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

    // Strategy 2: Search page with embedded JSON + JSON-LD
    const pageUrl = `${HOME}/catalogsearch/result/?q=${encodeURIComponent(target.query)}`;
    try {
      const res = await fetcher.get(pageUrl, { referer: HOME });
      if (res.ok) {
        const embedded = extractEmbeddedJson(res.text);
        for (const block of embedded) {
          const products = extractFromJson(block);
          if (products.length) {
            console.log(`    Embedded JSON: ${products.length} products`);
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

  console.log(`  [incredible] ${results.length} products collected`);
  return results;
}
