/**
 * MallMind data scraper — orchestrates all SA retailer scrapers.
 *
 * Setup:
 *   cp .env.example .env
 *   # Fill in SUPABASE_URL + SUPABASE_SERVICE_KEY from Supabase → Settings → API
 *   npm install
 *   npm run all
 *
 * Run individual scrapers:
 *   npm run takealot
 *   npm run checkers
 *   npm run pnp
 *   ...etc
 */

import { scrapeTakealot }   from "./scrapers/takealot.js";
import { scrapeCheckers }   from "./scrapers/checkers.js";
import { scrapeIncredible } from "./scrapers/incredible.js";
import { scrapeDischem }    from "./scrapers/dischem.js";
import {
  scrapePnP,
  scrapeWoolworths,
  scrapeGame,
  scrapeClicks,
  scrapeMrPrice,
  scrapeSportsmans,
} from "./scrapers/playwrightScraper.js";
import { closeBrowser }     from "./framework/browser.js";
import { upsertProducts }   from "./db.js";

interface ScraperResult {
  name: string;
  inserted: number;
  updated: number;
  skipped: number;
  errors: number;
}

async function runScraper(
  name: string,
  fn: () => Promise<import("./db.js").ScrapedProduct[]>
): Promise<ScraperResult> {
  console.log(`\n${"─".repeat(50)}`);
  console.log(`▶  ${name}`);
  console.log(`${"─".repeat(50)}`);

  try {
    const products = await fn();
    if (!products.length) {
      console.log(`   No products returned.`);
      return { name, inserted: 0, updated: 0, skipped: 0, errors: 0 };
    }
    const stats = await upsertProducts(products);
    console.log(`   ✓ inserted=${stats.inserted} updated=${stats.updated} skipped=${stats.skipped}`);
    return { name, ...stats, errors: 0 };
  } catch (err) {
    console.error(`   ✗ Fatal error in ${name}:`, err);
    return { name, inserted: 0, updated: 0, skipped: 0, errors: 1 };
  }
}

async function main() {
  const started = new Date();
  console.log("╔══════════════════════════════════════════════════╗");
  console.log("║         MallMind Retail Price Scraper            ║");
  console.log("╠══════════════════════════════════════════════════╣");
  console.log(`║  Started: ${started.toLocaleString("en-ZA").padEnd(38)}║`);
  console.log("╚══════════════════════════════════════════════════╝");

  // Run scrapers sequentially to respect rate limits per domain
  const results: ScraperResult[] = [];

  results.push(await runScraper("Takealot",               scrapeTakealot));
  results.push(await runScraper("Checkers",               scrapeCheckers));
  results.push(await runScraper("Pick n Pay",             scrapePnP));
  results.push(await runScraper("Woolworths",             scrapeWoolworths));
  results.push(await runScraper("Incredible Connection",  scrapeIncredible));
  results.push(await runScraper("Game",                   scrapeGame));
  results.push(await runScraper("Clicks",                 scrapeClicks));
  results.push(await runScraper("Dis-Chem",               scrapeDischem));
  results.push(await runScraper("Mr Price",               scrapeMrPrice));
  results.push(await runScraper("Sportsmans Warehouse",   scrapeSportsmans));

  const finished = new Date();
  const elapsed = Math.round((finished.getTime() - started.getTime()) / 1000);

  console.log(`\n${"═".repeat(50)}`);
  console.log("SUMMARY");
  console.log("═".repeat(50));

  let totalInserted = 0, totalUpdated = 0, totalSkipped = 0;
  for (const r of results) {
    const status = r.errors ? "✗" : "✓";
    console.log(
      `  ${status} ${r.name.padEnd(26)} ` +
      `+${String(r.inserted).padStart(3)} ` +
      `~${String(r.updated).padStart(3)} ` +
      `=${String(r.skipped).padStart(3)}`
    );
    totalInserted += r.inserted;
    totalUpdated  += r.updated;
    totalSkipped  += r.skipped;
  }

  console.log("─".repeat(50));
  console.log(`  Total: ${totalInserted} inserted, ${totalUpdated} updated, ${totalSkipped} skipped`);
  console.log(`  Duration: ${elapsed}s`);
  console.log(`  Finished: ${finished.toLocaleString("en-ZA")}`);

  await closeBrowser();
}

main().catch(console.error);
