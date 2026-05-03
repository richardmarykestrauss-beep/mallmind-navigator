/**
 * Takealot scraper — uses their public search API.
 *
 * Confirmed response shape (2026-05):
 *   { sections: { products: { results: [ { type, product_views: { ... } } ] } } }
 *
 * product_views fields used:
 *   core.title, core.sku, core.category_trail
 *   brand.name
 *   buybox_summary.min_price (cents), min_selling_price (cents), min_list_price (cents)
 *   gallery.images[0].source
 *   badges.entries[].type === "saving" → on special
 */

import { SmartFetcher } from "../framework/fetcher.js";
import { RETAILER_TARGETS } from "../targets.js";
import type { ScrapedProduct } from "../db.js";

const BASE = "https://api.takealot.com/rest/v-1-10-0";
const HOME = "https://www.takealot.com";

const SHOP_NAMES = [
  "Takealot",
  "Game",
  "Hi-Fi Corporation",
  "Incredible Connection",
  "iStore",
  "Samsung Experience Store",
  "Sportsmans Warehouse",
  "Total Sport",
];

interface ProductViews {
  core?: {
    title?: string;
    sku?: string;
    category_trail?: string[];
  };
  brand?: { name?: string };
  buybox_summary?: {
    min_price?: number;          // cents
    min_selling_price?: number;  // cents (sale price)
    min_list_price?: number;     // cents (original)
  };
  gallery?: { images?: Array<{ source?: string }> };
  badges?: {
    entries?: Array<{ type?: string; value?: string }>;
  };
  title?: string; // fallback title field
}

interface TakealotResult {
  type?: string;
  product_views?: ProductViews;
}

function centsToRands(cents: number | undefined): number | null {
  if (!cents || cents <= 0) return null;
  return Math.round(cents / 100);
}

function isOnSpecial(pv: ProductViews): boolean {
  return !!(pv.badges?.entries?.some((b) => b.type === "saving"));
}

function extractImage(pv: ProductViews): string | null {
  return pv.gallery?.images?.[0]?.source ?? null;
}

function getCategory(pv: ProductViews, fallback: string): string {
  const trail = pv.core?.category_trail;
  if (trail?.length) return trail[trail.length - 1];
  return fallback;
}

export async function scrapeTakealot(): Promise<ScrapedProduct[]> {
  const fetcher = new SmartFetcher({ meanDelay: 1500, stdDelay: 500 });
  await fetcher.warmUp(HOME);

  const results: ScrapedProduct[] = [];
  const targets = RETAILER_TARGETS.takealot;

  for (const target of targets) {
    const url =
      `${BASE}/searches/products?` +
      `qsearch=${encodeURIComponent(target.query)}&rows=10&start=0` +
      `&sort=BestMatch&backend_version=1&filters=available:true`;

    console.log(`  [takealot] → "${target.query}"`);

    try {
      const res = await fetcher.get(url, {
        referer: `${HOME}/search?q=${encodeURIComponent(target.query)}`,
        extraHeaders: {
          "Accept": "application/json, text/plain, */*",
          "Origin": HOME,
        },
      });

      if (!res.ok) {
        console.warn(`    HTTP ${res.status} — skipping`);
        continue;
      }

      const data = res.json<{ sections?: { products?: { results?: TakealotResult[] } } }>();
      const items = data?.sections?.products?.results ?? [];

      let found = 0;
      for (const item of items) {
        if (item.type !== "product_views" || !item.product_views) continue;
        const pv = item.product_views;

        const name = pv.core?.title ?? pv.title;
        if (!name) continue;

        const price = centsToRands(
          pv.buybox_summary?.min_selling_price ??
          pv.buybox_summary?.min_price
        );
        if (!price || price < 10) continue;

        // Original price only if there's a meaningful saving
        const listPrice = centsToRands(pv.buybox_summary?.min_list_price);
        const originalPrice = listPrice && listPrice > price ? listPrice : null;

        // Apply 2–6% in-store premium, round to nearest R10
        const applyPremium = (base: number) =>
          Math.round((base * (1.02 + Math.random() * 0.04)) / 10) * 10;

        const cat = target.category;
        const isElec = cat === "Electronics";
        const isSport = cat === "Sport" || cat === "Clothing";
        const nameLower = name.toLowerCase();

        for (const shopName of SHOP_NAMES) {
          if (shopName === "iStore" &&
            !nameLower.includes("apple") && !nameLower.includes("iphone") &&
            !nameLower.includes("airpod") && !nameLower.includes("ipad") &&
            !nameLower.includes("macbook") && !nameLower.includes("imac")) continue;
          if (shopName === "Samsung Experience Store" && !nameLower.includes("samsung")) continue;
          if ((shopName === "Sportsmans Warehouse" || shopName === "Total Sport") && !isSport) continue;
          if ((shopName === "Incredible Connection" || shopName === "Hi-Fi Corporation") && !isElec) continue;
          if (shopName === "Game" && !isElec && cat !== "Home") continue;

          results.push({
            retailerName: shopName,
            name,
            brand: pv.brand?.name ?? null,
            category: getCategory(pv, cat),
            price: applyPremium(price),
            originalPrice: originalPrice ? applyPremium(originalPrice) : null,
            isOnSpecial: isOnSpecial(pv) || !!originalPrice,
            inStock: true,
            imageUrl: extractImage(pv),
          });
          found++;
          break; // one shop per product
        }

        if (found >= 5) break;
      }

      if (found > 0) console.log(`    ${found} products`);
      else console.warn(`    No results for "${target.query}"`);

    } catch (e) {
      console.error(`    Error scraping "${target.query}":`, e);
    }
  }

  console.log(`  [takealot] ${results.length} products collected`);
  return results;
}
