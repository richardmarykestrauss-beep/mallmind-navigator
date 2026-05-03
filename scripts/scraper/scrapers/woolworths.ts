/**
 * Woolworths SA scraper.
 * Woolworths uses their own platform with a REST API backed by Elasticsearch.
 * Endpoint: /api/search/v3?q=...&cat=Food&pageSize=20
 * Falls back to JSON-LD and Cheerio HTML parsing.
 */

import * as cheerio from "cheerio";
import { SmartFetcher, extractJsonLd } from "../framework/fetcher.js";
import { RETAILER_TARGETS } from "../targets.js";
import type { ScrapedProduct } from "../db.js";

const HOME      = "https://www.woolworths.co.za";
const API_BASE  = `${HOME}/api/search/v3`;
const SHOP_NAME = "Woolworths";

interface WoolworthsProduct {
  displayName?: string;
  name?: string;
  brand?: string;
  brandName?: string;
  price?: number | string;
  pricePerUnit?: string;
  wasPrice?: number | string;
  onPromotion?: boolean;
  isAvailable?: boolean;
  primaryImage?: string;
  images?: Array<{ src?: string; url?: string }>;
  category?: string;
  subCategory?: string;
}

function parsePrice(raw: string | number | undefined): number | null {
  if (raw == null) return null;
  if (typeof raw === "number") return Math.round(raw);
  const n = parseFloat(String(raw).replace(/[^0-9.]/g, ""));
  return isNaN(n) ? null : Math.round(n);
}

function extractFromApi(data: unknown): ScrapedProduct[] {
  const root = data as Record<string, unknown>;
  const products: unknown[] =
    (root["products"] as unknown[]) ??
    (root["results"] as unknown[]) ??
    ((root["data"] as Record<string, unknown>)?.["products"] as unknown[]) ??
    [];

  return (Array.isArray(products) ? products : [])
    .map((p): ScrapedProduct | null => {
      const item = p as WoolworthsProduct;
      const name = item.displayName ?? item.name;
      if (!name) return null;
      const price = parsePrice(item.price);
      if (!price || price < 2) return null;

      const originalPrice = item.wasPrice ? parsePrice(item.wasPrice) : null;
      const img = item.primaryImage ?? item.images?.[0]?.src ?? item.images?.[0]?.url ?? null;

      return {
        retailerName: SHOP_NAME,
        name,
        brand: item.brand ?? item.brandName ?? null,
        category: item.category ?? item.subCategory ?? "Grocery",
        price,
        originalPrice: originalPrice && originalPrice > price ? originalPrice : null,
        isOnSpecial: !!(item.onPromotion || (originalPrice && originalPrice > price)),
        inStock: item.isAvailable !== false,
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
      if (!name || !price) continue;
      results.push({
        retailerName: SHOP_NAME,
        name,
        brand: null,
        category: "Grocery",
        price,
        originalPrice: null,
        isOnSpecial: false,
        inStock: offers?.["availability"] !== "OutOfStock",
        imageUrl: (obj["image"] as string | undefined) ?? null,
      });
    }
  }
  return results;
}

function extractFromHtml(html: string): ScrapedProduct[] {
  const $ = cheerio.load(html);
  const results: ScrapedProduct[] = [];

  $(".product-list__item, .product-card, [data-product-id], .product").each((_, el) => {
    const name = $(el).find(".product-card__name, .product-name, h2, h3").first().text().trim();
    const priceText = $(el).find(".price, .product-card__price, .price__selling").first().text().trim();
    const price = parsePrice(priceText);
    if (!name || !price) return;
    const wasText = $(el).find(".price__was, .was-price, .strike").first().text().trim();
    const originalPrice = wasText ? parsePrice(wasText) : null;
    const img = $(el).find("img").first().attr("src") ?? null;
    results.push({
      retailerName: SHOP_NAME,
      name,
      brand: null,
      category: "Grocery",
      price,
      originalPrice,
      isOnSpecial: !!($(el).find(".badge--sale, .promotion, .on-special").length > 0 || (originalPrice && originalPrice > price)),
      inStock: true,
      imageUrl: img,
    });
  });

  return results;
}

export async function scrapeWoolworths(): Promise<ScrapedProduct[]> {
  const fetcher = new SmartFetcher({ meanDelay: 3500, stdDelay: 1200 });
  await fetcher.warmUp(HOME);

  const results: ScrapedProduct[] = [];

  for (const target of RETAILER_TARGETS.woolworths) {
    console.log(`  [woolworths] → "${target.query}"`);

    // Strategy 1: Woolworths search API
    const apiUrl = `${API_BASE}?q=${encodeURIComponent(target.query)}&pageSize=20&start=0`;
    try {
      const res = await fetcher.get(apiUrl, {
        referer: `${HOME}/cat?Ntt=${encodeURIComponent(target.query)}`,
        extraHeaders: { "Accept": "application/json, text/plain, */*" },
      });
      if (res.ok) {
        const data = res.json();
        const products = extractFromApi(data);
        if (products.length) {
          console.log(`    API: ${products.length} products`);
          results.push(...products.slice(0, 8));
          continue;
        }
      }
    } catch { /* fall through */ }

    // Strategy 2: Search page JSON-LD
    const pageUrl = `${HOME}/cat?Ntt=${encodeURIComponent(target.query)}`;
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

  console.log(`  [woolworths] ${results.length} products collected`);
  return results;
}
