/**
 * Pick n Pay scraper.
 * PnP uses SAP Hybris (same as Checkers). Targets their search API + HTML fallback.
 */

import * as cheerio from "cheerio";
import { SmartFetcher, extractJsonLd } from "../framework/fetcher.js";
import { RETAILER_TARGETS } from "../targets.js";
import type { ScrapedProduct } from "../db.js";

const HOME      = "https://www.pnp.co.za";
const SHOP_NAME = "Pick n Pay";

function parsePrice(s: string | number | undefined): number | null {
  if (s == null) return null;
  if (typeof s === "number") return Math.round(s);
  const n = parseFloat(String(s).replace(/[^0-9.]/g, ""));
  return isNaN(n) ? null : Math.round(n);
}

function extractFromHybrisJson(data: unknown): ScrapedProduct[] {
  const raw =
    (data as Record<string, unknown>)?.["products"] ??
    (data as Record<string, unknown>)?.["results"] ?? [];
  const arr = Array.isArray(raw) ? raw : [];

  return arr.map((p: unknown): ScrapedProduct | null => {
    const item = p as Record<string, unknown>;
    const name = item["name"] as string | undefined;
    const priceObj = item["price"] as Record<string, unknown> | undefined;
    const price = parsePrice(priceObj?.["value"] as number | undefined ?? priceObj?.["formattedValue"] as string | undefined);
    if (!name || !price) return null;

    const isSpecial = !!(item["saveAmount"] || (item as Record<string, unknown[]>)["potentialPromotions"]?.length);
    const origObj = item["wasPrice"] as Record<string, unknown> | undefined;
    const originalPrice = origObj ? parsePrice(origObj["value"] as number) : null;
    const images = item["images"] as Array<Record<string, string>> | undefined;
    const img = images?.find((i) => i["format"] === "product")?.["url"] ?? null;

    return {
      retailerName: SHOP_NAME,
      name,
      brand: (item["brand"] as Record<string, string> | undefined)?.["name"] ?? null,
      category: (Array.isArray(item["categories"]) ? (item["categories"][0] as Record<string, string>)?.["name"] : null) ?? "Grocery",
      price,
      originalPrice,
      isOnSpecial: isSpecial,
      inStock: (item["stock"] as Record<string, string> | undefined)?.["stockLevelStatus"] !== "outOfStock",
      imageUrl: img ? (img.startsWith("http") ? img : `${HOME}${img}`) : null,
    };
  }).filter((p): p is ScrapedProduct => p !== null);
}

function extractFromHtml(html: string): ScrapedProduct[] {
  const $ = cheerio.load(html);
  const results: ScrapedProduct[] = [];
  $(".product-item, .product-card, [data-testid='product'], .item-product").each((_, el) => {
    const name = $(el).find(".product-name, .product-title, h2, h3").first().text().trim();
    const priceText = $(el).find(".price, .product-price, [data-testid='price']").first().text().trim();
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
      isOnSpecial: $(el).find(".save-badge, .special, .was-price").length > 0,
      inStock: true,
      imageUrl: img,
    });
  });
  return results;
}

export async function scrapePnP(): Promise<ScrapedProduct[]> {
  const fetcher = new SmartFetcher({ meanDelay: 3200, stdDelay: 1100 });
  await fetcher.warmUp(HOME);

  const results: ScrapedProduct[] = [];

  for (const target of RETAILER_TARGETS.pnp) {
    console.log(`  [pnp] → "${target.query}"`);

    // Strategy 1: Hybris JSON API
    const apiUrl = `${HOME}/pnpstorefront/pnp/en/search?q=${encodeURIComponent(target.query)}&pageSize=20&format=json`;
    try {
      const res = await fetcher.get(apiUrl, {
        referer: `${HOME}/search?q=${encodeURIComponent(target.query)}`,
        extraHeaders: { "Accept": "application/json" },
      });
      if (res.ok) {
        const data = res.json();
        const products = extractFromHybrisJson(data);
        if (products.length) {
          console.log(`    API: ${products.length} products`);
          results.push(...products.slice(0, 8));
          continue;
        }
      }
    } catch { /* fall through */ }

    // Strategy 2: HTML search page
    const pageUrl = `${HOME}/search?q=${encodeURIComponent(target.query)}`;
    try {
      const res = await fetcher.get(pageUrl, { referer: HOME });
      if (res.ok) {
        const ldBlocks = extractJsonLd(res.text);
        for (const block of ldBlocks) {
          const arr = Array.isArray(block) ? block : [block];
          for (const item of arr) {
            const name = (item as Record<string, unknown>)["name"] as string | undefined;
            const price = parsePrice(String(((item as Record<string, unknown>)["offers"] as Record<string, unknown> | undefined)?.["price"] ?? ""));
            if (name && price) {
              results.push({ retailerName: SHOP_NAME, name, brand: null, category: target.category, price, originalPrice: null, isOnSpecial: false, inStock: true, imageUrl: null });
            }
          }
        }
        if (results.length) continue;

        const htmlProducts = extractFromHtml(res.text);
        results.push(...htmlProducts.slice(0, 8));
      }
    } catch (e) {
      console.error(`    Error: ${e}`);
    }
  }

  console.log(`  [pnp] ${results.length} products collected`);
  return results;
}
