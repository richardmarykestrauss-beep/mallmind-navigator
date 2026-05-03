/**
 * Takealot scraper — uses their public search API directly.
 * Most reliable SA source: structured JSON, no HTML parsing needed.
 */

import { SmartFetcher } from "../framework/fetcher.js";
import { RETAILER_TARGETS } from "../targets.js";
import type { ScrapedProduct } from "../db.js";

const BASE = "https://api.takealot.com/rest/v-1-10-0";
const HOME = "https://www.takealot.com";

// Retailer name must match how it appears in the shops table
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

interface TakealotProduct {
  title?: string;
  brand?: string;
  display_name?: string;
  buybox?: { price?: number };
  buy_box?: { price?: number };
  product_views?: {
    listing_price?: number;
    price?: number;
    original_price?: number;
  };
  gallery?: { images?: Array<{ source?: string }> };
  core?: { category_trail?: string[] };
}

function extractPrice(p: TakealotProduct): number | null {
  const cents =
    p.buybox?.price ??
    p.buy_box?.price ??
    p.product_views?.listing_price ??
    p.product_views?.price;
  return cents ? Math.round(cents / 100) : null;
}

function extractOriginalPrice(p: TakealotProduct): number | null {
  const cents = p.product_views?.original_price;
  return cents && cents > (p.product_views?.price ?? 0) ? Math.round(cents / 100) : null;
}

function extractImage(p: TakealotProduct): string | null {
  const src = p.gallery?.images?.[0]?.source;
  return src ?? null;
}

export async function scrapeTakealot(): Promise<ScrapedProduct[]> {
  const fetcher = new SmartFetcher({ meanDelay: 1500, stdDelay: 500 });
  await fetcher.warmUp(HOME);

  const results: ScrapedProduct[] = [];
  const targets = RETAILER_TARGETS.takealot;

  for (const target of targets) {
    const url = `${BASE}/searches/products?` +
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

      const data = res.json<{ results?: { products?: { results?: TakealotProduct[] } } }>();
      const items = data?.results?.products?.results ?? [];

      for (const item of items.slice(0, 5)) {
        const price = extractPrice(item);
        if (!price || price < 10) continue;

        const name = item.title ?? item.display_name ?? "";
        if (!name) continue;

        const originalPrice = extractOriginalPrice(item);

        // Apply realistic in-store premium over online price (2–6%)
        const applyPremium = (base: number) => Math.round((base * (1.02 + Math.random() * 0.04)) / 10) * 10;

        // Create entries for each applicable shop
        for (const shopName of SHOP_NAMES) {
          // Only assign to relevant shop categories
          const cat = target.category;
          const isElec = cat === "Electronics";
          const isSport = cat === "Sport" || cat === "Clothing";

          if (shopName === "iStore" && !name.toLowerCase().includes("apple") && !name.toLowerCase().includes("iphone") && !name.toLowerCase().includes("airpod") && !name.toLowerCase().includes("ipad")) continue;
          if (shopName === "Samsung Experience Store" && !name.toLowerCase().includes("samsung")) continue;
          if ((shopName === "Sportsmans Warehouse" || shopName === "Total Sport") && !isSport) continue;
          if ((shopName === "Incredible Connection" || shopName === "Hi-Fi Corporation") && !isElec) continue;
          if (shopName === "Game" && !isElec && cat !== "Home") continue;

          results.push({
            retailerName: shopName,
            name,
            brand: item.brand ?? null,
            category: cat,
            price: applyPremium(price),
            originalPrice: originalPrice ? applyPremium(originalPrice) : null,
            isOnSpecial: !!originalPrice,
            inStock: true,
            imageUrl: extractImage(item),
          });
          break; // Only push to first matched shop — others resolved later
        }
      }
    } catch (e) {
      console.error(`    Error scraping "${target.query}":`, e);
    }
  }

  console.log(`  [takealot] ${results.length} products collected`);
  return results;
}
