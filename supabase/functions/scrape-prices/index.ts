/**
 * MallMind — Daily Price Scraper Edge Function
 * Runs every night at 03:00 SA time via Supabase cron.
 *
 * Deploy:
 *   supabase functions deploy scrape-prices
 *
 * Schedule (in Supabase Dashboard → Edge Functions → scrape-prices → Schedules):
 *   Cron: 0 1 * * *   (1am UTC = 3am SAST)
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

// Products to check on Takealot nightly
const TAKEALOT_SEARCHES = [
  { query: "samsung 65 qled tv 4k",     shops: ["Game", "Hi-Fi Corporation", "Incredible Connection"] },
  { query: "hisense 55 4k smart tv",    shops: ["Game", "Hi-Fi Corporation", "Incredible Connection"] },
  { query: "samsung galaxy s24 128gb",  shops: ["Game", "Samsung Experience Store", "Incredible Connection"] },
  { query: "iphone 16 128gb",           shops: ["iStore"] },
  { query: "airpods pro 2nd gen",       shops: ["iStore"] },
  { query: "sony playstation 5",        shops: ["Game"] },
  { query: "jbl charge 5",             shops: ["Game", "Hi-Fi Corporation", "Incredible Connection"] },
  { query: "sony wh-1000xm5",          shops: ["Hi-Fi Corporation", "Incredible Connection"] },
  { query: "nike air max 270",          shops: ["Sportsmans Warehouse", "Total Sport"] },
  { query: "adidas ultraboost 22",      shops: ["Sportsmans Warehouse", "Total Sport"] },
];

async function fetchTakealot(query: string): Promise<number | null> {
  try {
    const url = `https://api.takealot.com/rest/v-1-10-0/searches/products?` +
      `qsearch=${encodeURIComponent(query)}&rows=3&start=0&sort=BestMatch&backend_version=1`;

    const res = await fetch(url, {
      headers: { "User-Agent": "MallMindBot/1.0" },
    });
    if (!res.ok) return null;

    const data = await res.json();
    const first = data?.results?.products?.results?.[0];
    const price = first?.buy_box?.price ?? first?.product_views?.listing_price;
    return price ? price / 100 : null;
  } catch {
    return null;
  }
}

async function updatePrices(query: string, shopNames: string[], takealotPrice: number) {
  const { data: shops } = await supabase
    .from("shops")
    .select("id, name")
    .in("name", shopNames);

  if (!shops?.length) return 0;

  const { data: products } = await supabase
    .from("products")
    .select("id, name, price, shop_id")
    .in("shop_id", shops.map((s) => s.id))
    .ilike("name", `%${query.split(" ").slice(0, 2).join("%")}%`);

  if (!products?.length) return 0;

  let updated = 0;
  for (const product of products) {
    // Store premium: 2–6% above online price
    const premium = 1.02 + Math.random() * 0.04;
    const newPrice = Math.round((takealotPrice * premium) / 10) * 10;

    if (Math.abs(newPrice - product.price) > 50) {
      await supabase.from("products").update({ price: newPrice }).eq("id", product.id);
      updated++;
    }
  }
  return updated;
}

Deno.serve(async (req: Request) => {
  // Allow manual trigger via POST
  if (req.method !== "POST" && req.method !== "GET") {
    return new Response("Method not allowed", { status: 405 });
  }

  const log: string[] = [];
  let totalUpdated = 0;

  log.push(`MallMind price scrape started: ${new Date().toISOString()}`);

  for (const target of TAKEALOT_SEARCHES) {
    const price = await fetchTakealot(target.query);
    if (!price) {
      log.push(`  SKIP "${target.query}" — no price found`);
      continue;
    }

    const updated = await updatePrices(target.query, target.shops, price);
    totalUpdated += updated;
    log.push(`  OK "${target.query}" — R${price} online → ${updated} products updated`);

    await new Promise((r) => setTimeout(r, 500));
  }

  log.push(`Done. ${totalUpdated} total products updated.`);

  // Log run to a scrape_logs table if it exists (optional)
  try {
    await supabase.from("scrape_logs").insert({
      run_at: new Date().toISOString(),
      products_updated: totalUpdated,
      log: log.join("\n"),
    });
  } catch {
    // table may not exist yet — ignore
  }

  return new Response(JSON.stringify({ success: true, updated: totalUpdated, log }), {
    headers: { "Content-Type": "application/json" },
  });
});
