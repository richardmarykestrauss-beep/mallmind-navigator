/**
 * Mall website store directory scraper.
 * Each major SA mall has a /stores page with floor numbers and unit numbers.
 * This is the data Google doesn't have — it's MallMind's key differentiator.
 *
 * Returns enriched store data with floor + unit that gets merged with
 * Google Places results in the main orchestrator.
 */

import * as cheerio from "cheerio";
import { SmartFetcher } from "../framework/fetcher.js";

export interface DirectoryStore {
  /** Normalised lowercase name for matching against Google Places results */
  nameLower: string;
  name: string;
  floor: string | null;
  unit: string | null;
  category: string | null;
  phone: string | null;
  tradingHours: string | null;
}

const fetcher = new SmartFetcher({ meanDelay: 2000, stdDelay: 600 });

function normalise(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
}

/** Generic scraper — covers most SA mall store-directory patterns */
async function scrapeGeneric(url: string): Promise<DirectoryStore[]> {
  const stores: DirectoryStore[] = [];
  try {
    const res = await fetcher.get(url, { referer: new URL(url).origin });
    if (!res.ok) return stores;
    const $ = cheerio.load(res.text);

    // Pattern 1: store cards with data attributes (most modern mall sites)
    $("[data-store-name], [data-title], .store-item, .store-card, .retailer-item").each((_, el) => {
      const name =
        $(el).attr("data-store-name") ??
        $(el).attr("data-title") ??
        $(el).find(".store-name, .store-title, h2, h3, .name").first().text().trim();
      if (!name) return;

      const floor =
        $(el).attr("data-floor") ??
        $(el).find(".floor, .level, [class*=floor], [class*=level]").first().text().trim() ??
        null;

      const unit =
        $(el).attr("data-unit") ??
        $(el).find(".unit, .shop-number, [class*=unit]").first().text().trim() ??
        null;

      const category =
        $(el).attr("data-category") ??
        $(el).find(".category, .type").first().text().trim() ??
        null;

      stores.push({
        nameLower: normalise(name),
        name: name.trim(),
        floor: floor?.trim() || null,
        unit: unit?.trim() || null,
        category: category?.trim() || null,
        phone: null,
        tradingHours: null,
      });
    });

    if (stores.length) return stores;

    // Pattern 2: simple list items (older SA mall sites)
    $("li, tr").each((_, el) => {
      const name = $(el).find("a, strong, .store, td:first-child").first().text().trim();
      if (!name || name.length < 3) return;
      const floor = $(el).find("td:nth-child(2), .floor").first().text().trim();
      stores.push({
        nameLower: normalise(name),
        name,
        floor: floor || null,
        unit: null,
        category: null,
        phone: null,
        tradingHours: null,
      });
    });
  } catch (e) {
    console.warn(`    Directory scrape failed for ${url}: ${e}`);
  }
  return stores;
}

/** Sandton City — uses a filterable grid with data-* attributes */
async function scrapeSandtonCity(): Promise<DirectoryStore[]> {
  return scrapeGeneric("https://www.sandtoncity.com/stores");
}

/** Mall of Africa — React-rendered, tries their API endpoint first */
async function scrapeMallOfAfrica(): Promise<DirectoryStore[]> {
  const stores: DirectoryStore[] = [];
  try {
    const res = await fetcher.get(
      "https://www.mallofafrica.co.za/api/stores?pageSize=500",
      { referer: "https://www.mallofafrica.co.za/stores" }
    );
    if (res.ok) {
      const data = res.json() as Record<string, unknown>;
      const items = (data["stores"] ?? data["results"] ?? data["items"] ?? []) as Array<Record<string, unknown>>;
      for (const item of items) {
        const name = item["name"] as string | undefined;
        if (!name) continue;
        stores.push({
          nameLower: normalise(name),
          name,
          floor: (item["floor"] ?? item["level"]) as string | null ?? null,
          unit: (item["unit"] ?? item["shopNumber"]) as string | null ?? null,
          category: item["category"] as string | null ?? null,
          phone: item["phone"] as string | null ?? null,
          tradingHours: item["tradingHours"] as string | null ?? null,
        });
      }
      if (stores.length) return stores;
    }
  } catch { /* fall through to generic */ }
  return scrapeGeneric("https://www.mallofafrica.co.za/stores");
}

/** Gateway Theatre of Shopping — has a well-structured store directory */
async function scrapeGateway(): Promise<DirectoryStore[]> {
  return scrapeGeneric("https://www.gateway.co.za/stores");
}

/** Canal Walk — uses category filter pages */
async function scrapeCanalWalk(): Promise<DirectoryStore[]> {
  return scrapeGeneric("https://www.canalwalk.co.za/stores");
}

/** V&A Waterfront */
async function scrapeVandA(): Promise<DirectoryStore[]> {
  return scrapeGeneric("https://www.waterfront.co.za/shops");
}

// Map from mall name → specialist scraper or generic with URL
const DIRECTORY_SCRAPERS: Record<string, () => Promise<DirectoryStore[]>> = {
  "Sandton City":                    scrapeSandtonCity,
  "Mall of Africa":                  scrapeMallOfAfrica,
  "Gateway Theatre of Shopping":     scrapeGateway,
  "Canal Walk Shopping Centre":      scrapeCanalWalk,
  "V&A Waterfront":                  scrapeVandA,
};

/**
 * Scrape a mall's store directory.
 * Returns [] if no specialist scraper exists and no storesUrl provided.
 */
export async function scrapeMallDirectory(
  mallName: string,
  storesUrl?: string
): Promise<DirectoryStore[]> {
  const specialist = DIRECTORY_SCRAPERS[mallName];
  if (specialist) {
    console.log(`    [directory] ${mallName} — specialist scraper`);
    return specialist();
  }
  if (storesUrl) {
    console.log(`    [directory] ${mallName} — generic: ${storesUrl}`);
    return scrapeGeneric(storesUrl);
  }
  return [];
}
