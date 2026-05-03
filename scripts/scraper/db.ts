/**
 * Supabase DB layer for the scraper.
 * Handles shop resolution and product upserts.
 */

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

export interface ScrapedProduct {
  /** Exact shop name as it appears in the shops table */
  retailerName: string;
  name: string;
  brand: string | null;
  category: string;
  price: number;
  originalPrice: number | null;
  isOnSpecial: boolean;
  inStock: boolean;
  imageUrl: string | null;
  /** Optional — used to disambiguate when retailer has many products */
  model?: string | null;
}

interface ShopRow {
  id: string;
  mall_id: string;
  name: string;
}

// Cache shop lookups to avoid repeated DB round-trips
const shopCache = new Map<string, ShopRow[]>();

async function resolveShops(retailerName: string): Promise<ShopRow[]> {
  const key = retailerName.toLowerCase();
  if (shopCache.has(key)) return shopCache.get(key)!;

  const { data } = await supabase
    .from("shops")
    .select("id, mall_id, name")
    .ilike("name", `%${retailerName}%`);

  const shops = (data ?? []) as ShopRow[];
  shopCache.set(key, shops);
  return shops;
}

/**
 * Upsert a batch of scraped products into Supabase.
 * - Resolves shop IDs by retailer name (updates ALL matching locations)
 * - Inserts new products, updates price if changed > 2%
 * - Skips if price difference is trivial (avoids noisy updates)
 */
export async function upsertProducts(products: ScrapedProduct[]): Promise<{ inserted: number; updated: number; skipped: number }> {
  let inserted = 0, updated = 0, skipped = 0;

  for (const p of products) {
    const shops = await resolveShops(p.retailerName);
    if (!shops.length) {
      console.warn(`    No shops found for retailer: "${p.retailerName}"`);
      skipped++;
      continue;
    }

    for (const shop of shops) {
      // Check if product already exists for this shop
      const { data: existing } = await supabase
        .from("products")
        .select("id, price, name")
        .eq("shop_id", shop.id)
        .ilike("name", `%${p.name.split(" ").slice(0, 3).join("%")}%`)
        .limit(1)
        .single();

      if (existing) {
        // Update only if price changed by more than 2%
        const priceDelta = Math.abs(existing.price - p.price) / existing.price;
        if (priceDelta < 0.02) {
          skipped++;
          continue;
        }
        await supabase
          .from("products")
          .update({
            price: p.price,
            original_price: p.originalPrice,
            is_on_special: p.isOnSpecial,
            in_stock: p.inStock,
            image_url: p.imageUrl ?? undefined,
          })
          .eq("id", existing.id);
        updated++;
      } else {
        // Insert new product
        await supabase.from("products").insert({
          shop_id: shop.id,
          mall_id: shop.mall_id,
          name: p.name,
          brand: p.brand,
          category: p.category,
          model: p.model ?? null,
          price: p.price,
          original_price: p.originalPrice,
          is_on_special: p.isOnSpecial,
          in_stock: p.inStock,
          image_url: p.imageUrl,
          verified: false,
        });
        inserted++;
      }
    }
  }

  return { inserted, updated, skipped };
}

export { supabase };
