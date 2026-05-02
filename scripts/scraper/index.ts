/**
 * MallMind data scraper — runs all scrapers in sequence
 *
 * Setup:
 *   cp .env.example .env
 *   # Fill in SUPABASE_SERVICE_KEY from Supabase → Settings → API → service_role key
 *   npm install
 *   npm run all
 */

import { scrapeTakealot } from "./takealot.js";
import { scrapePriceCheck } from "./pricecheck.js";

async function main() {
  console.log("🏪 MallMind Data Scraper");
  console.log("=".repeat(50));
  console.log(`Started at: ${new Date().toLocaleString("en-ZA")}\n`);

  // 1. Takealot — live prices from SA's largest online retailer
  const takealotResult = await scrapeTakealot();

  // 2. PriceCheck — SA price comparison, discovers new products
  const priceCheckTotal = await scrapePriceCheck();

  console.log("\n" + "=".repeat(50));
  console.log("Summary:");
  console.log(`  Takealot: ${takealotResult.updated} price updates`);
  console.log(`  PriceCheck: ${priceCheckTotal} products added/updated`);
  console.log(`Finished at: ${new Date().toLocaleString("en-ZA")}`);
}

main().catch(console.error);
