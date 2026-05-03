/**
 * Takealot product structure inspector.
 * Run: npx tsx debug.ts
 */

import { SmartFetcher } from "./framework/fetcher.js";

const fetcher = new SmartFetcher({ meanDelay: 800, stdDelay: 200 });

async function main() {
  console.log("▶ Takealot — full product_views structure");

  const res = await fetcher.get(
    "https://api.takealot.com/rest/v-1-10-0/searches/products?qsearch=samsung+tv&rows=3&start=0&sort=BestMatch&backend_version=1&filters=available:true",
    {
      referer: "https://www.takealot.com",
      extraHeaders: { "Accept": "application/json, */*", "Origin": "https://www.takealot.com" },
    }
  );

  const data = res.json<Record<string, unknown>>();
  const results = (data?.sections as Record<string, unknown>)?.["products"] as Record<string, unknown>;
  const items = results?.["results"] as Array<Record<string, unknown>>;

  if (!items?.length) {
    console.log("No items found. Full response keys:", Object.keys(data));
    return;
  }

  console.log(`Got ${items.length} items`);
  const first = items[0];
  console.log("\nTop-level item keys:", Object.keys(first));

  const pv = first["product_views"] as Record<string, unknown>;
  if (pv) {
    console.log("\nproduct_views keys:", Object.keys(pv));
    // Print each top-level field value (truncated)
    for (const [k, v] of Object.entries(pv)) {
      const str = JSON.stringify(v);
      console.log(`  .${k} = ${str.slice(0, 120)}${str.length > 120 ? "..." : ""}`);
    }
  }
}

main().catch(console.error);
