/**
 * Mall scraper orchestrator.
 *
 * For each SA mall:
 * 1. Upsert the mall row (with Google Places details if API key set)
 * 2. Find nearby stores via Google Places Nearby Search
 * 3. Scrape the mall's own store directory (floor/unit data)
 * 4. Merge both sources — Google provides category/hours/rating,
 *    directory provides floor/unit which Google doesn't have
 * 5. Upsert all shops into Supabase
 *
 * Run: node --loader ts-node/esm malls/index.ts
 */

import dotenv from "dotenv";
dotenv.config();

import { SA_MALLS } from "./saMalls.js";
import {
  getMallDetails,
  findStoresNearby,
  findMallPlaceId,
} from "./googlePlaces.js";
import { scrapeMallDirectory } from "./mallDirectory.js";
import { upsertMall, upsertShop } from "./db.js";

const HAS_PLACES_API = !!(process.env.GOOGLE_PLACES_API_KEY);

async function processMall(seed: typeof SA_MALLS[number]) {
  console.log(`\n  ▶ ${seed.name} (${seed.city})`);

  // ── 1. Upsert mall row ────────────────────────────────────────────────
  let placeId = seed.placeId;

  if (HAS_PLACES_API && !placeId) {
    try {
      placeId = await findMallPlaceId(seed.name, seed.city) ?? undefined;
      if (placeId) console.log(`    Places: resolved placeId ${placeId}`);
    } catch (e) {
      console.warn(`    Places: findMallPlaceId failed: ${e}`);
    }
  }

  let mallMeta = {
    name: seed.name,
    city: seed.city,
    province: seed.province,
    lat: seed.lat,
    lng: seed.lng,
    googlePlaceId: placeId,
  };

  if (HAS_PLACES_API && placeId) {
    try {
      const details = await getMallDetails(placeId);
      if (details) {
        mallMeta = {
          ...mallMeta,
          lat: details.lat || seed.lat,
          lng: details.lng || seed.lng,
          ...details,
        };
      }
    } catch (e) {
      console.warn(`    Places: getMallDetails failed: ${e}`);
    }
  }

  const mallId = await upsertMall(mallMeta);
  if (!mallId) {
    console.error(`    Skipping — could not upsert mall`);
    return { inserted: 0, updated: 0, skipped: 1 };
  }

  // ── 2. Google Places Nearby Search ────────────────────────────────────
  let googleStores: Awaited<ReturnType<typeof findStoresNearby>> = [];
  if (HAS_PLACES_API) {
    try {
      googleStores = await findStoresNearby(seed.lat, seed.lng, seed.radiusM ?? 200);
      console.log(`    Places: ${googleStores.length} nearby stores`);
    } catch (e) {
      console.warn(`    Places: Nearby Search failed: ${e}`);
    }
  }

  // ── 3. Mall directory scrape ──────────────────────────────────────────
  const directoryStores = await scrapeMallDirectory(seed.name, seed.storesUrl);
  console.log(`    Directory: ${directoryStores.length} stores`);

  // ── 4. Merge: Google provides the base, directory enriches floor/unit ──
  // Build lookup by normalised name from directory
  const dirMap = new Map(directoryStores.map((s) => [s.nameLower, s]));

  const mergedNames = new Set<string>();
  let inserted = 0, updated = 0, skipped = 0;

  // Process Google stores (richer metadata)
  for (const gs of googleStores) {
    const normName = gs.name.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
    const dir = dirMap.get(normName);
    mergedNames.add(normName);

    const result = await upsertShop({
      mallId,
      name: gs.name,
      category: dir?.category ?? gs.category,
      floor: dir?.floor ?? null,
      unit: dir?.unit ?? null,
      phone: dir?.phone ?? null,
      website: gs.website ?? null,
      tradingHours: dir?.tradingHours ?? gs.openingHours ?? null,
      googlePlaceId: gs.googlePlaceId,
      lat: gs.lat,
      lng: gs.lng,
    });

    if (result === "inserted") inserted++;
    else if (result === "updated") updated++;
    else skipped++;
  }

  // Add directory-only stores (Google didn't find them — common for small kiosks)
  for (const ds of directoryStores) {
    if (mergedNames.has(ds.nameLower)) continue; // already processed via Google
    const result = await upsertShop({
      mallId,
      name: ds.name,
      category: ds.category ?? "General",
      floor: ds.floor,
      unit: ds.unit,
      phone: ds.phone,
      website: null,
      tradingHours: ds.tradingHours,
      googlePlaceId: null,
      lat: null,
      lng: null,
    });
    if (result === "inserted") inserted++;
    else if (result === "updated") updated++;
    else skipped++;
  }

  console.log(`    ✓ inserted=${inserted} updated=${updated} skipped=${skipped}`);
  return { inserted, updated, skipped };
}

async function main() {
  const started = new Date();
  console.log("╔══════════════════════════════════════════════════╗");
  console.log("║       MallMind — Mall & Store Scraper            ║");
  console.log("╠══════════════════════════════════════════════════╣");
  console.log(`║  Malls: ${String(SA_MALLS.length).padEnd(42)}║`);
  console.log(`║  Google Places API: ${HAS_PLACES_API ? "enabled" : "disabled (no API key)".padEnd(30)}║`);
  console.log("╚══════════════════════════════════════════════════╝");

  if (!HAS_PLACES_API) {
    console.log("\n  ⚠  No GOOGLE_PLACES_API_KEY — running directory-only mode");
    console.log("     Set the key in .env to enable full Google Places enrichment\n");
  }

  let totalInserted = 0, totalUpdated = 0, totalSkipped = 0;

  for (const mall of SA_MALLS) {
    const stats = await processMall(mall);
    totalInserted += stats.inserted;
    totalUpdated  += stats.updated;
    totalSkipped  += stats.skipped;

    // Polite pause between malls — Google rate limits at 10 QPS
    await new Promise((r) => setTimeout(r, 1500));
  }

  const elapsed = Math.round((Date.now() - started.getTime()) / 1000);
  console.log(`\n${"═".repeat(50)}`);
  console.log(`DONE — ${totalInserted} inserted, ${totalUpdated} updated, ${totalSkipped} skipped`);
  console.log(`Elapsed: ${elapsed}s`);
}

main().catch(console.error);
