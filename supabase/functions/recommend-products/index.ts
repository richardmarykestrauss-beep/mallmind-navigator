/**
 * recommend-products — MallMind Edge Function
 *
 * Smart product search with scoring. Called by:
 *   - ai-assistant (tool: recommend_products)
 *   - Frontend directly for initial recommendations
 *
 * Input:  { mall_id, query, budget?, category?, user_id? }
 * Output: { recommendations: ScoredProduct[] }
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface ShopRow {
  id: string;
  name: string;
  floor: string | null;
  unit_number: string | null;
  category: string | null;
  opening_hours: string | null;
}

interface ProductRow {
  id: string;
  shop_id: string;
  name: string;
  brand: string | null;
  category: string | null;
  price: number;
  original_price: number | null;
  is_on_special: boolean;
}

interface ScoredProduct {
  product_id: string;
  shop_id: string;
  name: string;
  brand: string | null;
  category: string | null;
  price: number;
  original_price: number | null;
  is_on_special: boolean;
  discount_pct: number | null;
  shop_name: string;
  floor: string | null;
  unit_number: string | null;
  opening_hours: string | null;
  is_open_now: boolean | null;
  score: number;
  reason: string;
}

// SA timezone is UTC+2
function isOpenNow(openingHours: string | null): boolean | null {
  if (!openingHours) return null;
  try {
    const now = new Date();
    const saHour = (now.getUTCHours() + 2) % 24;
    const saDay = now.getUTCDay(); // 0=Sun, 1=Mon ... 6=Sat

    // Common formats: "Mon-Sun 09:00-21:00" or "09:00-21:00"
    const timeMatch = openingHours.match(/(\d{1,2}):(\d{2})\s*[-–]\s*(\d{1,2}):(\d{2})/);
    if (!timeMatch) return null;

    const openH = parseInt(timeMatch[1]);
    const closeH = parseInt(timeMatch[3]);

    // Weekend check if hours differ
    const isWeekend = saDay === 0 || saDay === 6;
    const weekendMatch = openingHours.match(/[Ss]at|[Ss]un/);
    if (isWeekend && !weekendMatch) return null; // can't tell

    return saHour >= openH && saHour < closeH;
  } catch {
    return null;
  }
}

function scoreProduct(
  product: ProductRow,
  shop: ShopRow,
  query: string,
  budget: number | null,
  cheapestPriceForName: Record<string, number>
): { score: number; reason: string } {
  let score = 0;
  const reasons: string[] = [];

  // On special = big boost
  if (product.is_on_special && product.original_price != null) {
    const discPct = Math.round((1 - product.price / product.original_price) * 100);
    score += 30 + Math.min(discPct, 20); // up to +50 for specials
    reasons.push(`${discPct}% off`);
  }

  // Cheapest for this product name
  const nameKey = product.name.toLowerCase().trim();
  if (cheapestPriceForName[nameKey] === product.price) {
    score += 25;
    reasons.push("Cheapest in mall");
  }

  // Within budget headroom
  if (budget != null) {
    if (product.price > budget) {
      score -= 50;
      reasons.push("Over budget");
    } else {
      const headroomPct = ((budget - product.price) / budget) * 100;
      score += Math.min(headroomPct / 5, 15); // up to +15 for good headroom
      reasons.push(`R${Math.round(budget - product.price)} under budget`);
    }
  }

  // Store is open now
  const openNow = isOpenNow(shop.opening_hours);
  if (openNow === true) {
    score += 5;
    reasons.push("Open now");
  } else if (openNow === false) {
    score -= 20;
    reasons.push("Currently closed");
  }

  // Name relevance (exact match boost)
  if (product.name.toLowerCase().includes(query.toLowerCase())) {
    score += 10;
  }

  return {
    score,
    reason: reasons.length > 0 ? reasons.join(" · ") : "Available in mall",
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: CORS });

  try {
    const body = await req.json();
    const {
      mall_id,
      query,
      budget,
      category,
    }: {
      mall_id: string;
      query: string;
      budget?: number | null;
      category?: string | null;
    } = body;

    if (!mall_id || !query?.trim()) {
      return new Response(
        JSON.stringify({ error: "mall_id and query are required" }),
        { status: 400, headers: { "Content-Type": "application/json", ...CORS } }
      );
    }

    // 1. Get all shops for this mall
    const { data: shops, error: shopErr } = await supabase
      .from("shops")
      .select("id, name, floor, unit_number, category, opening_hours")
      .eq("mall_id", mall_id);

    if (shopErr || !shops?.length) {
      return new Response(
        JSON.stringify({ recommendations: [], message: "No shops found for this mall" }),
        { headers: { "Content-Type": "application/json", ...CORS } }
      );
    }

    const shopMap = Object.fromEntries(shops.map((s: ShopRow) => [String(s.id), s]));
    const shopIds = shops.map((s: ShopRow) => s.id);

    // 2. Search products
    let productQuery = supabase
      .from("products")
      .select("id, shop_id, name, brand, category, price, original_price, is_on_special")
      .in("shop_id", shopIds)
      .ilike("name", `%${query.trim()}%`)
      .order("price", { ascending: true })
      .limit(30);

    if (budget != null) productQuery = productQuery.lte("price", budget);
    if (category) productQuery = productQuery.ilike("category", `%${category}%`);

    const { data: products, error: prodErr } = await productQuery;

    if (prodErr || !products?.length) {
      return new Response(
        JSON.stringify({ recommendations: [], message: `No products found for "${query}"` }),
        { headers: { "Content-Type": "application/json", ...CORS } }
      );
    }

    // 3. Build cheapest-per-name map for scoring
    const cheapestPriceForName: Record<string, number> = {};
    for (const p of products as ProductRow[]) {
      const key = p.name.toLowerCase().trim();
      if (cheapestPriceForName[key] === undefined || p.price < cheapestPriceForName[key]) {
        cheapestPriceForName[key] = p.price;
      }
    }

    // 4. Score each product
    const scored: ScoredProduct[] = [];
    for (const p of products as ProductRow[]) {
      const shop = shopMap[String(p.shop_id)] as ShopRow;
      if (!shop) continue;

      const { score, reason } = scoreProduct(p, shop, query, budget ?? null, cheapestPriceForName);
      if (score <= -50) continue; // skip massively over-budget items

      const discountPct =
        p.is_on_special && p.original_price != null
          ? Math.round((1 - p.price / p.original_price) * 100)
          : null;

      scored.push({
        product_id: String(p.id),
        shop_id: String(p.shop_id),
        name: p.name,
        brand: p.brand,
        category: p.category,
        price: p.price,
        original_price: p.original_price,
        is_on_special: p.is_on_special,
        discount_pct: discountPct,
        shop_name: shop.name,
        floor: shop.floor,
        unit_number: shop.unit_number,
        opening_hours: shop.opening_hours,
        is_open_now: isOpenNow(shop.opening_hours),
        score,
        reason,
      });
    }

    // 5. Sort by score descending, deduplicate by shop+product, return top 8
    scored.sort((a, b) => b.score - a.score);
    const seen = new Set<string>();
    const recommendations = scored.filter((p) => {
      const key = `${p.shop_id}:${p.name.toLowerCase().trim()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 8);

    return new Response(
      JSON.stringify({ recommendations, total_found: products.length }),
      { headers: { "Content-Type": "application/json", ...CORS } }
    );
  } catch (err) {
    console.error("recommend-products error:", err);
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { "Content-Type": "application/json", ...CORS } }
    );
  }
});
