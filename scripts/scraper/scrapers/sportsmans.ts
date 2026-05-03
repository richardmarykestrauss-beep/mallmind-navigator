/**
 * Sportsmans Warehouse scraper.
 * Sportsmans uses Magento 2 with a REST API and GraphQL endpoint.
 * Primary: Magento 2 REST search API.
 * Fallback: embedded JSON → JSON-LD → Cheerio HTML.
 */

import * as cheerio from "cheerio";
import { SmartFetcher, extractJsonLd, extractEmbeddedJson, dig } from "../framework/fetcher.js";
import { RETAILER_TARGETS } from "../targets.js";
import type { ScrapedProduct } from "../db.js";

const HOME      = "https://www.sportsmanswarehouse.co.za";
const SHOP_NAME = "Sportsmans Warehouse";

function parsePrice(raw: string | number | undefined): number | null {
  if (raw == null) return null;
  if (typeof raw === "number") return Math.round(raw);
  const n = parseFloat(String(raw).replace(/[^0-9.]/g, ""));
  return isNaN(n) ? null : Math.round(n);
}

interface MagentoProduct {
  name?: string;
  sku?: string;
  price?: number;
  final_price?: number;
  special_price?: number | null;
  original_price?: number;
  image?: string | { url?: string };
  thumbnail?: string | { url?: string };
  extension_attributes?: Record<string, unknown>;
  custom_attributes?: Array<{ attribute_code: string; value: unknown }>;
}

function getCustomAttr(product: MagentoProduct, code: string): unknown {
  return product.custom_attributes?.find((a) => a.attribute_code === code)?.value;
}

function imageUrl(raw: string | { url?: string } | undefined): string | null {
  if (!raw) return null;
  if (typeof raw === "string") return raw.startsWith("http") ? raw : `${HOME}${raw}`;
  return raw.url ?? null;
}

function extractFromMagento(data: unknown): ScrapedProduct[] {
  const items: MagentoProduct[] =
    (dig(data, "items") as MagentoProduct[]) ??
    (dig(data, "products.items") as MagentoProduct[]) ??
    (dig(data, "data.products.items") as MagentoProduct[]) ??
    [];

  return (Array.isArray(items) ? items : [])
    .map((p): ScrapedProduct | null => {
      const name = p.name;
      if (!name) return null;
      const price = parsePrice(p.final_price ?? p.price);
      if (!price || price < 10) return null;
      const originalPrice = p.special_price
        ? parsePrice(p.original_price ?? p.price)
        : null;
      const img = imageUrl(p.image ?? p.thumbnail);
      const brand = getCustomAttr(p, "manufacturer") as string | undefined;
      const category = getCustomAttr(p, "category_name") as string | undefined;

      return {
        retailerName: SHOP_NAME,
        name,
        brand: brand ?? null,
        category: category ?? "Sport",
        price,
        originalPrice: originalPrice && originalPrice > price ? originalPrice : null,
        isOnSpecial: !!(p.special_price || (originalPrice && originalPrice > price)),
        inStock: true,
        imageUrl: img,
      };
    })
    .filter((p): p is ScrapedProduct => p !== null);
}

function extractFromJsonData(data: unknown): ScrapedProduct[] {
  // Generic JSON that might come from embedded scripts or API fallback
  const items: unknown[] =
    (dig(data, "products") as unknown[]) ??
    (dig(data, "results") as unknown[]) ??
    (Array.isArray(data) ? data : []);

  return (Array.isArray(items) ? items : [])
    .map((p): ScrapedProduct | null => {
      const item = p as Record<string, unknown>;
      const name = (item["name"] ?? item["title"]) as string | undefined;
      if (!name) return null;
      const price = parsePrice((item["price"] as number | string) ?? (item["final_price"] as number | string));
      if (!price || price < 10) return null;
      const img = (item["image"] as string) ?? (item["thumbnail"] as string) ?? null;
      return {
        retailerName: SHOP_NAME,
        name,
        brand: (item["brand"] as string) ?? null,
        category: "Sport",
        price,
        originalPrice: null,
        isOnSpecial: false,
        inStock: true,
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
        category: "Sport",
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

  $(".product-item, .product-card, .product, [data-product-id]").each((_, el) => {
    const name = $(el).find(".product-item-name, .product-name, h2, h3, a.product-link").first().text().trim();
    const priceText = $(el)
      .find(".price, .price-wrapper, .special-price .price, .regular-price .price")
      .first()
      .text()
      .trim();
    const price = parsePrice(priceText);
    if (!name || !price || price < 10) return;
    const wasText = $(el).find(".old-price .price, .was-price, .original-price").first().text().trim();
    const originalPrice = wasText ? parsePrice(wasText) : null;
    const img = $(el).find("img.product-image-photo, img").first().attr("src") ?? null;
    results.push({
      retailerName: SHOP_NAME,
      name,
      brand: null,
      category,
      price,
      originalPrice,
      isOnSpecial: !!($(el).find(".sale-badge, .special-price, .on-sale, .badge-sale").length || (originalPrice && originalPrice > price)),
      inStock: !$(el).find(".out-of-stock, .unavailable").length,
      imageUrl: img,
    });
  });

  return results;
}

export async function scrapeSportsmans(): Promise<ScrapedProduct[]> {
  const fetcher = new SmartFetcher({ meanDelay: 3000, stdDelay: 1100 });
  await fetcher.warmUp(HOME);

  const results: ScrapedProduct[] = [];

  for (const target of RETAILER_TARGETS.sportsmans) {
    console.log(`  [sportsmans] → "${target.query}"`);

    // Strategy 1: Magento 2 REST search API
    const apiUrl = `${HOME}/rest/V1/products?` +
      `searchCriteria[filter_groups][0][filters][0][field]=name` +
      `&searchCriteria[filter_groups][0][filters][0][value]=%25${encodeURIComponent(target.query)}%25` +
      `&searchCriteria[filter_groups][0][filters][0][condition_type]=like` +
      `&searchCriteria[pageSize]=20&searchCriteria[currentPage]=1`;
    try {
      const res = await fetcher.get(apiUrl, {
        referer: `${HOME}/catalogsearch/result/?q=${encodeURIComponent(target.query)}`,
        extraHeaders: { "Accept": "application/json" },
      });
      if (res.ok) {
        const data = res.json();
        const products = extractFromMagento(data);
        if (products.length) {
          console.log(`    Magento REST: ${products.length} products`);
          results.push(...products.slice(0, 8));
          continue;
        }
      }
    } catch { /* fall through */ }

    // Strategy 2: Search page — embedded + JSON-LD + HTML
    const pageUrl = `${HOME}/catalogsearch/result/?q=${encodeURIComponent(target.query)}`;
    try {
      const res = await fetcher.get(pageUrl, { referer: HOME });
      if (res.ok) {
        const embedded = extractEmbeddedJson(res.text);
        for (const block of embedded) {
          const products = extractFromMagento(block);
          if (products.length) {
            console.log(`    Embedded Magento: ${products.length} products`);
            results.push(...products.slice(0, 8));
            break;
          }
          const generic = extractFromJsonData(block);
          if (generic.length) {
            console.log(`    Embedded generic: ${generic.length} products`);
            results.push(...generic.slice(0, 8));
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

  console.log(`  [sportsmans] ${results.length} products collected`);
  return results;
}
