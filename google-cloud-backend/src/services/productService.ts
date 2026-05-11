import { getSupabaseClient } from "../lib/supabase.js";
import type { Shop, Product, ScoredProduct } from "../lib/types.js";

// SA timezone UTC+2 — works with "HH:MM:SS" time columns
function isOpenNow(openingTime: string | null, closingTime: string | null): boolean | null {
  if (!openingTime || !closingTime) return null;
  try {
    const now = new Date();
    const saMinutes = ((now.getUTCHours() + 2) % 24) * 60 + now.getUTCMinutes();
    const [oh, om] = openingTime.split(":").map(Number);
    const [ch, cm] = closingTime.split(":").map(Number);
    return saMinutes >= oh * 60 + om && saMinutes < ch * 60 + cm;
  } catch {
    return null;
  }
}

function buildProductSearchTerms(query: string): string[] {
  const raw = query.trim();
  const cleaned = raw
    .toLowerCase()
    .replace(/r\s?\d+([.,]\d+)?/g, " ")
    .replace(/\b(under|below|less|than|find|me|best|cheap|cheapest|looking|need|want|please|for|a|an|the|at|in|mall)\b/g, " ")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const terms = [raw, cleaned];

  for (const token of cleaned.split(" ")) {
    if (token.length < 2) continue;
    if (["tvs", "televisions", "television"].includes(token)) {
      terms.push("tv");
    } else if (token.endsWith("s") && token.length > 3) {
      terms.push(token.slice(0, -1));
    } else {
      terms.push(token);
    }
  }

  return [...new Set(terms.filter(Boolean))];
}

function scoreProduct(
  product: Product,
  shop: Shop,
  budget: number | null,
  cheapestByName: Record<string, number>
): { score: number; reason: string } {
  let score = 0;
  const reasons: string[] = [];

  // On special bonus
  if (product.is_on_special && product.original_price != null) {
    const pct = Math.round((1 - product.price / product.original_price) * 100);
    score += 30 + Math.min(pct, 20);
    reasons.push(`${pct}% off`);
  }

  // Cheapest in mall
  const nameKey = product.name.toLowerCase().trim();
  if (cheapestByName[nameKey] === product.price) {
    score += 25;
    reasons.push("Cheapest in mall");
  }

  // Budget
  if (budget != null) {
    if (product.price > budget) {
      score -= 50;
      reasons.push("Over budget");
    } else {
      const headroom = ((budget - product.price) / budget) * 100;
      score += Math.min(headroom / 5, 15);
      reasons.push(`R${Math.round(budget - product.price)} under budget`);
    }
  }

  // Store hours
  const open = isOpenNow(shop.opening_time, shop.closing_time);
  if (open === true) { score += 5; reasons.push("Open now"); }
  if (open === false) { score -= 20; reasons.push("Currently closed"); }

  // Name match boost
  score += 10; // base relevance (already filtered by ilike)

  return {
    score,
    reason: reasons.length ? reasons.join(" · ") : "Available in mall",
  };
}

export interface RecommendOptions {
  mall_id: string;
  query: string;
  budget?: number | null;
  category?: string | null;
}

/**
 * Searches products for a mall, scores and ranks them.
 * Returns up to 8 deduplicated recommendations.
 */
export async function recommendProducts(opts: RecommendOptions): Promise<ScoredProduct[]> {
  const supabase = getSupabaseClient();
  const { mall_id, query, budget, category } = opts;

  // 1. Get shops for this mall
  const { data: shops, error: shopErr } = await supabase
    .from("shops")
    .select("id, mall_id, name, floor, unit_number, category, opening_time, closing_time")
    .eq("mall_id", mall_id);

  if (shopErr) throw new Error(`Failed to fetch shops: ${shopErr.message}`);
  if (!shops?.length) return [];

  const shopMap = Object.fromEntries((shops as Shop[]).map((s) => [String(s.id), s]));
  const shopIds = (shops as Shop[]).map((s) => s.id);

  // 2. Search products.
  // Gemini may pass natural phrases like "TVs under R5000".
  // Try the raw query first, then cleaner fallback terms such as "tv".
  let products: Product[] = [];

  for (const term of buildProductSearchTerms(query)) {
    let q = supabase
      .from("products")
      .select(
        "id, shop_id, name, brand, category, price, original_price, is_on_special, " +
        "price_verified_at, data_quality_status, price_verification_method, data_source, verified_by"
      )
      .in("shop_id", shopIds)
      .ilike("name", `%${term}%`)
      .order("price", { ascending: true })
      .limit(30);

    if (budget != null) q = q.lte("price", budget);
    if (category) q = q.ilike("category", `%${category}%`);

    const { data, error } = await q;
    if (error) throw new Error(`Failed to fetch products: ${error.message}`);

    if (data?.length) {
      products = data as unknown as Product[];
      break;
    }
  }

  if (!products.length) return [];

  // 3. Build cheapest-per-name map
  const cheapestByName: Record<string, number> = {};
  for (const p of products as unknown as Product[]) {
    const key = p.name.toLowerCase().trim();
    if (cheapestByName[key] === undefined || p.price < cheapestByName[key]) {
      cheapestByName[key] = p.price;
    }
  }

  // 4. Score each product
  const scored: ScoredProduct[] = [];
  for (const p of products as unknown as Product[]) {
    const shop = shopMap[String(p.shop_id)] as Shop | undefined;
    if (!shop) continue;

    const { score, reason } = scoreProduct(p, shop, budget ?? null, cheapestByName);
    if (score <= -50) continue; // hard over-budget exclusion

    const nameKey = p.name.toLowerCase().trim();
    const discountPct =
      p.is_on_special && p.original_price != null
        ? Math.round((1 - p.price / p.original_price) * 100)
        : null;

    scored.push({
      product_id: String(p.id),
      shop_id: String(p.shop_id),
      name: p.name,
      brand: p.brand,
      price: p.price,
      original_price: p.original_price,
      is_on_special: p.is_on_special,
      discount_pct: discountPct,
      shop_name: shop.name,
      floor: shop.floor,
      unit_number: shop.unit_number,
      is_open_now: isOpenNow(shop.opening_time, shop.closing_time),
      is_cheapest: cheapestByName[nameKey] === p.price,
      score,
      reason,
      price_verified_at: p.price_verified_at ?? null,
      data_quality_status: p.data_quality_status ?? "demo",
      price_verification_method: p.price_verification_method ?? null,
      data_source: p.data_source ?? null,
      verified_by: p.verified_by ?? null,
    });
  }

  // 5. Sort, deduplicate, return top 8
  scored.sort((a, b) => b.score - a.score);
  const seen = new Set<string>();
  return scored.filter((p) => {
    const key = `${p.shop_id}:${p.name.toLowerCase().trim()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 8);
}
