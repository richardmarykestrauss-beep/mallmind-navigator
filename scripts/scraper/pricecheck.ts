/**
 * PriceCheck.co.za scraper
 * Pulls price comparison data from PriceCheck and syncs new products to Supabase.
 *
 * Run: node --loader ts-node/esm pricecheck.ts
 */

import * as cheerio from "cheerio";
import { createClient } from "@supabase/supabase-js";
import "dotenv/config";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

// PriceCheck category search URLs
const CATEGORIES = [
  {
    name: "Televisions",
    url: "https://www.pricecheck.co.za/browse/electronics/televisions/?sort_by=popularity",
    category: "Electronics",
    shopMap: { "Game": "Game", "Hi-Fi Corporation": "Hi-Fi Corporation", "Incredible Connection": "Incredible Connection" }
  },
  {
    name: "Cell Phones",
    url: "https://www.pricecheck.co.za/browse/electronics/cell-phones/?sort_by=popularity",
    category: "Electronics",
    shopMap: { "iStore": "iStore", "Game": "Game", "Vodacom": "Vodacom" }
  },
  {
    name: "Sneakers",
    url: "https://www.pricecheck.co.za/browse/clothing-shoes/sneakers/?sort_by=popularity",
    category: "Sport",
    shopMap: { "Sportsmans Warehouse": "Sportsmans Warehouse", "Total Sport": "Total Sport" }
  },
];

interface ScrapedProduct {
  name: string;
  price: number;
  retailer: string;
}

async function scrapePriceCheckPage(url: string): Promise<ScrapedProduct[]> {
  const products: ScrapedProduct[] = [];

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "en-ZA,en;q=0.9",
      },
    });

    if (!res.ok) {
      console.warn(`  PriceCheck returned ${res.status} for ${url}`);
      return [];
    }

    const html = await res.text();
    const $ = cheerio.load(html);

    // PriceCheck product listing items
    $("[data-testid='product-card'], .product-item, .listing-item").each((_, el) => {
      const name = $(el).find("[data-testid='product-title'], .product-name, h3").first().text().trim();
      const priceText = $(el).find("[data-testid='price'], .price, .listing-price").first().text().trim();
      const retailer = $(el).find("[data-testid='retailer'], .retailer-name, .store-name").first().text().trim();

      const price = parseFloat(priceText.replace(/[^0-9.]/g, ""));

      if (name && price && price > 0) {
        products.push({ name, price, retailer: retailer || "Unknown" });
      }
    });

    // Fallback: look for JSON-LD structured data
    if (!products.length) {
      $('script[type="application/ld+json"]').each((_, el) => {
        try {
          const json = JSON.parse($(el).html() ?? "{}");
          if (json["@type"] === "Product" && json.offers) {
            const offers = Array.isArray(json.offers) ? json.offers : [json.offers];
            for (const offer of offers) {
              if (offer.price && json.name) {
                products.push({
                  name: json.name,
                  price: parseFloat(offer.price),
                  retailer: offer.seller?.name ?? "Unknown",
                });
              }
            }
          }
        } catch {
          // ignore malformed JSON
        }
      });
    }
  } catch (err) {
    console.warn(`  Scrape error:`, err);
  }

  return products;
}

async function upsertProducts(
  scraped: ScrapedProduct[],
  category: string,
  shopMap: Record<string, string>
) {
  if (!scraped.length) return 0;

  let inserted = 0;

  // Get all relevant shop IDs
  const shopNames = Object.values(shopMap);
  const { data: shops } = await supabase
    .from("shops")
    .select("id, name")
    .in("name", shopNames);

  if (!shops?.length) return 0;

  for (const product of scraped.slice(0, 20)) {
    // Find the closest matching shop
    const matchedShopName = shopNames.find((s) =>
      product.retailer.toLowerCase().includes(s.toLowerCase())
    );
    if (!matchedShopName) continue;

    const shop = shops.find((s) => s.name === matchedShopName);
    if (!shop) continue;

    // Check if product already exists
    const { data: existing } = await supabase
      .from("products")
      .select("id, price")
      .eq("shop_id", shop.id)
      .ilike("name", product.name.slice(0, 30))
      .maybeSingle();

    if (existing) {
      // Update price if it changed by more than 5%
      const diff = Math.abs(existing.price - product.price) / existing.price;
      if (diff > 0.05) {
        await supabase
          .from("products")
          .update({ price: product.price })
          .eq("id", existing.id);
        console.log(`  Updated: ${product.name.slice(0, 40)} → R${product.price}`);
        inserted++;
      }
    } else {
      // Insert new product
      await supabase.from("products").insert({
        shop_id: shop.id,
        name: product.name.slice(0, 120),
        category,
        price: product.price,
        special_price: null,
        is_on_special: false,
      });
      console.log(`  Added: ${product.name.slice(0, 40)} at ${shop.name} R${product.price}`);
      inserted++;
    }
  }

  return inserted;
}

export async function scrapePriceCheck() {
  console.log("\n💰  PriceCheck.co.za scraper started");
  console.log("━".repeat(50));

  let total = 0;

  for (const cat of CATEGORIES) {
    console.log(`\nCategory: ${cat.name}`);
    const products = await scrapePriceCheckPage(cat.url);
    console.log(`  Found ${products.length} products`);

    const inserted = await upsertProducts(products, cat.category, cat.shopMap);
    total += inserted;

    await new Promise((r) => setTimeout(r, 2000));
  }

  console.log("━".repeat(50));
  console.log(`Done. ${total} products inserted/updated.\n`);
  return total;
}

// Run directly
scrapePriceCheck().then(() => process.exit(0)).catch(console.error);
