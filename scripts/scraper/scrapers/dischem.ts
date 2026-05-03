/**
 * Dis-Chem scraper.
 * Dis-Chem uses Magento 2 with a GraphQL API.
 * Primary: GraphQL products query.
 * Fallback: REST search → JSON-LD → Cheerio HTML.
 */

import * as cheerio from "cheerio";
import { SmartFetcher, extractJsonLd, extractEmbeddedJson } from "../framework/fetcher.js";
import { RETAILER_TARGETS } from "../targets.js";
import type { ScrapedProduct } from "../db.js";

const HOME       = "https://www.dischem.co.za";
const GQL_URL    = `${HOME}/graphql`;
const SHOP_NAME  = "Dis-Chem";

function parsePrice(raw: string | number | undefined): number | null {
  if (raw == null) return null;
  if (typeof raw === "number") return Math.round(raw);
  const n = parseFloat(String(raw).replace(/[^0-9.]/g, ""));
  return isNaN(n) ? null : Math.round(n);
}

function gqlProductsQuery(query: string): string {
  return JSON.stringify({
    query: `{
      products(search: ${JSON.stringify(query)}, pageSize: 20, currentPage: 1) {
        items {
          name
          sku
          price_range {
            minimum_price {
              final_price { value currency }
              regular_price { value }
            }
          }
          special_price
          image { url label }
          categories { name }
          ... on PhysicalProductInterface { weight }
        }
      }
    }`,
  });
}

interface GqlPriceRange {
  minimum_price?: {
    final_price?: { value?: number };
    regular_price?: { value?: number };
  };
}

interface GqlProduct {
  name?: string;
  sku?: string;
  price_range?: GqlPriceRange;
  special_price?: number | null;
  image?: { url?: string };
  categories?: Array<{ name?: string }>;
}

function extractFromGraphQL(data: unknown): ScrapedProduct[] {
  const items =
    ((data as Record<string, unknown>)?.["data"] as Record<string, unknown>)
      ?.["products"] as Record<string, unknown>;
  const products = (items?.["items"] as GqlProduct[]) ?? [];

  return products
    .map((p): ScrapedProduct | null => {
      const name = p.name;
      if (!name) return null;
      const finalVal = p.price_range?.minimum_price?.final_price?.value;
      const price = finalVal ? Math.round(finalVal) : null;
      if (!price || price < 2) return null;

      const regularVal = p.price_range?.minimum_price?.regular_price?.value;
      const originalPrice = regularVal && regularVal > finalVal! ? Math.round(regularVal) : null;

      return {
        retailerName: SHOP_NAME,
        name,
        brand: null,
        category: p.categories?.[0]?.name ?? "Health & Beauty",
        price,
        originalPrice,
        isOnSpecial: !!(p.special_price || originalPrice),
        inStock: true,
        imageUrl: p.image?.url ?? null,
      };
    })
    .filter((p): p is ScrapedProduct => p !== null);
}

function extractFromEmbedded(blocks: unknown[]): ScrapedProduct[] {
  for (const block of blocks) {
    const arr = Array.isArray(block) ? block : [];
    const mapped = arr
      .map((p: unknown): ScrapedProduct | null => {
        const item = p as Record<string, unknown>;
        const name = (item["name"] ?? item["title"]) as string | undefined;
        if (!name) return null;
        const price = parsePrice(
          (item["price"] as number | string) ??
          (item["final_price"] as number | string)
        );
        if (!price || price < 2) return null;
        return {
          retailerName: SHOP_NAME,
          name,
          brand: null,
          category: "Health & Beauty",
          price,
          originalPrice: null,
          isOnSpecial: false,
          inStock: true,
          imageUrl: (item["image"] as string) ?? null,
        };
      })
      .filter((p): p is ScrapedProduct => p !== null);
    if (mapped.length) return mapped;
  }
  return [];
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

  $(".product-item, .product-card, .product, [data-product-id]").each((_, el) => {
    const name = $(el).find(".product-item-name, .product-name, h2, h3, .name").first().text().trim();
    const priceText = $(el)
      .find(".price, .price-wrapper, .special-price .price, .regular-price .price")
      .first()
      .text()
      .trim();
    const price = parsePrice(priceText);
    if (!name || !price || price < 2) return;
    const wasText = $(el).find(".old-price .price, .was-price").first().text().trim();
    const originalPrice = wasText ? parsePrice(wasText) : null;
    const img = $(el).find("img.product-image-photo, img").first().attr("src") ?? null;
    results.push({
      retailerName: SHOP_NAME,
      name,
      brand: null,
      category: "Health & Beauty",
      price,
      originalPrice,
      isOnSpecial: !!($(el).find(".sale-badge, .special-price, .on-sale").length || (originalPrice && originalPrice > price)),
      inStock: !$(el).find(".out-of-stock").length,
      imageUrl: img,
    });
  });

  return results;
}

export async function scrapeDischem(): Promise<ScrapedProduct[]> {
  const fetcher = new SmartFetcher({ meanDelay: 3000, stdDelay: 1000 });
  await fetcher.warmUp(HOME);

  const results: ScrapedProduct[] = [];

  for (const target of RETAILER_TARGETS.dischem) {
    console.log(`  [dischem] → "${target.query}"`);

    // Strategy 1: Magento 2 GraphQL
    try {
      const res = await fetcher.post(GQL_URL, gqlProductsQuery(target.query), {
        referer: `${HOME}/catalogsearch/result/?q=${encodeURIComponent(target.query)}`,
        extraHeaders: {
          "Accept": "application/json",
          "Content-Type": "application/json",
        },
      });
      if (res.ok) {
        const data = res.json();
        const products = extractFromGraphQL(data);
        if (products.length) {
          console.log(`    GraphQL: ${products.length} products`);
          results.push(...products.slice(0, 8));
          continue;
        }
      }
    } catch { /* fall through */ }

    // Strategy 2: Search results page with embedded/JSON-LD
    const pageUrl = `${HOME}/catalogsearch/result/?q=${encodeURIComponent(target.query)}`;
    try {
      const res = await fetcher.get(pageUrl, { referer: HOME });
      if (res.ok) {
        const embedded = extractEmbeddedJson(res.text);
        const embProducts = extractFromEmbedded(embedded);
        if (embProducts.length) {
          console.log(`    Embedded: ${embProducts.length} products`);
          results.push(...embProducts.slice(0, 8));
          continue;
        }

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

  console.log(`  [dischem] ${results.length} products collected`);
  return results;
}
