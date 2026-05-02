/**
 * Takealot price scraper
 * Pulls live SA prices from Takealot's product search API and syncs to Supabase.
 *
 * Run: node --loader ts-node/esm takealot.ts
 */

import { createClient } from "@supabase/supabase-js";
import "dotenv/config";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

// Map Takealot search queries → MallMind shop names they compete with
const SEARCH_TARGETS = [
  { query: "samsung 65 qled tv",        shopNames: ["Game", "Hi-Fi Corporation", "Incredible Connection"] },
  { query: "hisense 55 4k tv",          shopNames: ["Game", "Hi-Fi Corporation", "Incredible Connection"] },
  { query: "samsung galaxy s24",        shopNames: ["Game", "Hi-Fi Corporation", "Incredible Connection", "Samsung Experience Store"] },
  { query: "iphone 16",                 shopNames: ["iStore"] },
  { query: "airpods pro",               shopNames: ["iStore"] },
  { query: "sony playstation 5",        shopNames: ["Game"] },
  { query: "jbl charge 5",              shopNames: ["Game", "Hi-Fi Corporation", "Incredible Connection"] },
  { query: "sony wh-1000xm5",           shopNames: ["Hi-Fi Corporation", "Incredible Connection"] },
  { query: "nike air max 270",          shopNames: ["Sportsmans Warehouse", "Total Sport"] },
  { query: "adidas ultraboost",         shopNames: ["Sportsmans Warehouse", "Total Sport"] },
  { query: "neutrogena hydro boost",    shopNames: ["Dis-Chem", "Clicks"] },
];

interface TakealotProduct {
  title: string;
  buy_box?: { price: number };
  core?: { title: string };
  product_views?: { price?: number; listing_price?: number };
}

async function fetchTakealotPrice(query: string): Promise<{ title: string; price: number } | null> {
  const url = `https://api.takealot.com/rest/v-1-10-0/searches/products?` +
    `qsearch=${encodeURIComponent(query)}&rows=5&start=0&sort=BestMatch&backend_version=1`;

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; MallMindBot/1.0)",
        "Accept": "application/json",
      },
    });

    if (!res.ok) {
      console.warn(`  Takealot returned ${res.status} for "${query}"`);
      return null;
    }

    const data = await res.json() as {
      results?: {
        products?: {
          results?: TakealotProduct[];
        };
      };
    };

    const results = data?.results?.products?.results;
    if (!results?.length) return null;

    const first = results[0];
    const price = first.buy_box?.price
      ?? first.product_views?.listing_price
      ?? first.product_views?.price;

    const title = first.core?.title ?? first.title;

    if (!price || !title) return null;

    // Takealot prices are in cents
    return { title, price: price / 100 };
  } catch (err) {
    console.warn(`  Fetch error for "${query}":`, err);
    return null;
  }
}

async function updateProductPrices(
  productName: string,
  shopNames: string[],
  takealotPrice: number
) {
  // Get all shops with matching names
  const { data: shops, error } = await supabase
    .from("shops")
    .select("id, name")
    .in("name", shopNames);

  if (error || !shops?.length) return;

  const shopIds = shops.map((s) => s.id);

  // Find matching products across those shops
  const { data: products } = await supabase
    .from("products")
    .select("id, name, price, shop_id")
    .in("shop_id", shopIds)
    .ilike("name", `%${productName.split(" ").slice(0, 3).join("%")}%`);

  if (!products?.length) return;

  // Update each matching product's price with a small in-store premium
  // (physical stores typically charge 3–8% more than online)
  for (const product of products) {
    const shop = shops.find((s) => s.id === product.shop_id);
    const storePremium = 1 + (Math.random() * 0.05 + 0.02); // 2-7% premium
    const newPrice = Math.round(takealotPrice * storePremium / 10) * 10; // round to nearest R10

    await supabase
      .from("products")
      .update({ price: newPrice })
      .eq("id", product.id);

    console.log(`  Updated "${product.name}" at ${shop?.name}: R${product.price} → R${newPrice}`);
  }
}

export async function scrapeTakealot() {
  console.log("\n🛍️  Takealot price scraper started");
  console.log("━".repeat(50));

  let updated = 0;
  let failed = 0;

  for (const target of SEARCH_TARGETS) {
    process.stdout.write(`Searching: "${target.query}"... `);

    const result = await fetchTakealotPrice(target.query);

    if (!result) {
      console.log("❌ no result");
      failed++;
      continue;
    }

    console.log(`✅ R${result.price} (${result.title.slice(0, 40)})`);
    await updateProductPrices(target.query, target.shopNames, result.price);
    updated++;

    // Polite delay between requests
    await new Promise((r) => setTimeout(r, 1200));
  }

  console.log("━".repeat(50));
  console.log(`Done. ${updated} queries updated, ${failed} failed.\n`);
  return { updated, failed };
}

// Run directly
scrapeTakealot().then(() => process.exit(0)).catch(console.error);
