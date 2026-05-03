/**
 * Debug script — inspect Takealot sections structure + PriceCheck
 * Run: npx tsx debug.ts
 */

import { SmartFetcher, extractJsonLd, extractEmbeddedJson } from "./framework/fetcher.js";

const fetcher = new SmartFetcher({ meanDelay: 800, stdDelay: 200 });

async function main() {
  // ── Takealot: inspect sections structure ─────────────────────────────────
  console.log("▶ Takealot — inspecting sections structure");
  const res = await fetcher.get(
    "https://api.takealot.com/rest/v-1-10-0/searches/products?qsearch=samsung+tv&rows=5&start=0&sort=BestMatch&backend_version=1&filters=available:true",
    { referer: "https://www.takealot.com", extraHeaders: { "Accept": "application/json, */*", "Origin": "https://www.takealot.com" } }
  );

  const data = res.json<Record<string, unknown>>();
  const sectionKeys = data["section_keys"] as string[] | undefined;
  console.log("  section_keys:", sectionKeys);

  const sections = data["sections"] as Record<string, unknown> | undefined;
  if (sections) {
    for (const key of Object.keys(sections)) {
      const section = sections[key] as Record<string, unknown>;
      const results = section["results"] as unknown[] | undefined;
      console.log(`  sections.${key}: type=${section["type"]}, results=${results?.length ?? "none"}`);
      if (results?.length) {
        const first = results[0] as Record<string, unknown>;
        console.log(`    first item keys: ${Object.keys(first).slice(0, 12).join(", ")}`);
        // Check for product data
        if (first["product_views"] || first["buybox"] || first["title"]) {
          console.log("    ✓ Contains product data!");
          console.log("    Sample:", JSON.stringify(first).slice(0, 400));
        }
      }
    }
  }

  // ── PriceCheck: see if it's accessible ───────────────────────────────────
  console.log("\n▶ PriceCheck.co.za — checking accessibility");
  const pcRes = await fetcher.get(
    "https://www.pricecheck.co.za/search/?search=samsung+tv",
    { referer: "https://www.pricecheck.co.za" }
  );
  console.log(`  Status: ${pcRes.status}`);
  const pcText = pcRes.text;
  const isHtml = pcText.trimStart().startsWith("<");
  const ldBlocks = extractJsonLd(pcText);
  const embedded = extractEmbeddedJson(pcText);
  console.log(`  HTML: ${isHtml}, JSON-LD: ${ldBlocks.length}, Embedded: ${embedded.length}`);
  if (pcText.toLowerCase().includes("captcha") || pcText.toLowerCase().includes("robot")) {
    console.log("  ⚠  Bot detection!");
  } else {
    console.log("  ✓ Looks accessible");
    // Show embedded block keys
    for (const block of embedded.slice(0, 3)) {
      const keys = Object.keys(block as object);
      console.log(`  Embedded block keys: ${keys.join(", ")}`);
    }
  }

  // ── PriceCheck JSON API ───────────────────────────────────────────────────
  console.log("\n▶ PriceCheck — JSON API");
  const pcApi = await fetcher.get(
    "https://www.pricecheck.co.za/api/search?search=samsung+tv&type=product",
    { referer: "https://www.pricecheck.co.za", extraHeaders: { "Accept": "application/json" } }
  );
  const isJson = pcApi.text.trimStart().startsWith("{") || pcApi.text.trimStart().startsWith("[");
  console.log(`  Status: ${pcApi.status}, JSON: ${isJson}, Length: ${pcApi.text.length}`);
  if (isJson) {
    const d = pcApi.json<Record<string, unknown>>();
    console.log(`  Keys: ${Object.keys(d).join(", ")}`);
  }
}

main().catch(console.error);
