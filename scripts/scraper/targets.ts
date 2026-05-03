/**
 * Scrape targets — organised by retailer and category.
 * Add new search terms here to expand coverage without touching scraper logic.
 */

export interface Target {
  query: string;
  category: string;
  maxResults?: number;
}

// ── Electronics ───────────────────────────────────────────────────────────────
export const ELECTRONICS: Target[] = [
  { query: "samsung 65 qled 4k tv", category: "Electronics" },
  { query: "hisense 55 4k smart tv", category: "Electronics" },
  { query: "lg oled 55 tv", category: "Electronics" },
  { query: "samsung galaxy s24", category: "Electronics" },
  { query: "iphone 15 128gb", category: "Electronics" },
  { query: "samsung galaxy a55", category: "Electronics" },
  { query: "sony wh-1000xm5 headphones", category: "Electronics" },
  { query: "jbl charge 5 speaker", category: "Electronics" },
  { query: "airpods pro 2nd generation", category: "Electronics" },
  { query: "sony playstation 5", category: "Electronics" },
  { query: "dell inspiron 15 laptop", category: "Electronics" },
  { query: "hp 15 laptop", category: "Electronics" },
  { query: "samsung 27 monitor", category: "Electronics" },
  { query: "logitech wireless mouse", category: "Electronics" },
  { query: "anker powerbank 20000mah", category: "Electronics" },
];

// ── Clothing & Footwear ───────────────────────────────────────────────────────
export const CLOTHING: Target[] = [
  { query: "nike air max sneakers", category: "Clothing" },
  { query: "adidas ultraboost running shoes", category: "Clothing" },
  { query: "puma rs-x sneakers", category: "Clothing" },
  { query: "levi 501 jeans", category: "Clothing" },
  { query: "cotton on crew neck t-shirt", category: "Clothing" },
  { query: "nike running shorts", category: "Clothing" },
  { query: "adidas tracksuit", category: "Clothing" },
  { query: "mr price cargo pants", category: "Clothing" },
  { query: "women midi dress", category: "Clothing" },
  { query: "formal black shoes men", category: "Clothing" },
];

// ── Health & Beauty ───────────────────────────────────────────────────────────
export const HEALTH_BEAUTY: Target[] = [
  { query: "neutrogena hydro boost moisturiser", category: "Health & Beauty" },
  { query: "loreal revitalift cream", category: "Health & Beauty" },
  { query: "dove shampoo 750ml", category: "Health & Beauty" },
  { query: "panado tablets 24", category: "Health & Beauty" },
  { query: "vitamin c 1000mg tablets", category: "Health & Beauty" },
  { query: "omega 3 fish oil capsules", category: "Health & Beauty" },
  { query: "nivea body lotion 400ml", category: "Health & Beauty" },
  { query: "maybelline fit me foundation", category: "Health & Beauty" },
  { query: "clicks 50 spf sunscreen", category: "Health & Beauty" },
  { query: "oral b electric toothbrush", category: "Health & Beauty" },
  { query: "baby dove body wash", category: "Health & Beauty" },
  { query: "rooibos tea 50 bags", category: "Health & Beauty" },
];

// ── Grocery & Food ────────────────────────────────────────────────────────────
export const GROCERY: Target[] = [
  { query: "sasko white bread loaf", category: "Grocery" },
  { query: "clover full cream milk 2L", category: "Grocery" },
  { query: "nescafe gold instant coffee 200g", category: "Grocery" },
  { query: "tastic rice 2kg", category: "Grocery" },
  { query: "iwisa maize meal 5kg", category: "Grocery" },
  { query: "all gold tomato sauce 700g", category: "Grocery" },
  { query: "simba chips 120g", category: "Grocery" },
  { query: "coca cola 2L", category: "Grocery" },
  { query: "lay's chips salt vinegar", category: "Grocery" },
  { query: "koo baked beans 410g", category: "Grocery" },
];

// ── Sport & Outdoor ───────────────────────────────────────────────────────────
export const SPORT: Target[] = [
  { query: "nike dri-fit running shirt", category: "Sport" },
  { query: "adidas gym bag", category: "Sport" },
  { query: "merrell hiking boots", category: "Sport" },
  { query: "speedo swimming costume", category: "Sport" },
  { query: "wilson tennis racket", category: "Sport" },
  { query: "under armour training shoes", category: "Sport" },
  { query: "garmin watch fitness tracker", category: "Sport" },
];

// ── Home & Appliances ─────────────────────────────────────────────────────────
export const HOME: Target[] = [
  { query: "russell hobbs kettle 1.7L", category: "Home" },
  { query: "defy microwave 20L", category: "Home" },
  { query: "smeg toaster 4 slice", category: "Home" },
  { query: "bosch vacuum cleaner", category: "Home" },
  { query: "samsung washing machine front loader", category: "Home" },
  { query: "sealy single mattress", category: "Home" },
  { query: "game linen duvet set", category: "Home" },
];

// ── Per-retailer target lists ─────────────────────────────────────────────────

export const RETAILER_TARGETS: Record<string, Target[]> = {
  takealot:   [...ELECTRONICS, ...CLOTHING.slice(0, 4), ...HEALTH_BEAUTY.slice(0, 6), ...HOME],
  checkers:   [...GROCERY, ...HEALTH_BEAUTY.slice(0, 6)],
  pnp:        [...GROCERY, ...HEALTH_BEAUTY.slice(0, 6)],
  woolworths: [...GROCERY, ...CLOTHING.slice(4, 8), ...HEALTH_BEAUTY.slice(0, 4)],
  incredible: [...ELECTRONICS],
  game:       [...ELECTRONICS, ...HOME],
  clicks:     [...HEALTH_BEAUTY],
  dischem:    [...HEALTH_BEAUTY, ...GROCERY.slice(0, 3)],
  mrprice:    [...CLOTHING, ...HOME.slice(5, 7)],
  sportsmans: [...SPORT, ...CLOTHING.slice(0, 4)],
};
