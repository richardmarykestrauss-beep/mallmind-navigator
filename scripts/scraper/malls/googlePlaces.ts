/**
 * Google Places API wrapper for mall and store discovery.
 *
 * Uses the Places API (New) — Text Search + Nearby Search + Place Details.
 * Free tier: $200/mo credit ≈ 5,000 Nearby Search calls free.
 *
 * Docs: https://developers.google.com/maps/documentation/places/web-service
 */

import dotenv from "dotenv";
dotenv.config();

const API_KEY  = process.env.GOOGLE_PLACES_API_KEY ?? "";
const BASE_URL = "https://maps.googleapis.com/maps/api/place";

// Store categories we care about mapping from Google place types
const CATEGORY_MAP: Record<string, string> = {
  clothing_store:         "Clothing",
  shoe_store:             "Clothing",
  jewelry_store:          "Clothing",
  electronics_store:      "Electronics",
  hardware_store:         "Home",
  furniture_store:        "Home",
  home_goods_store:       "Home",
  gym:                    "Sport",
  sporting_goods_store:   "Sport",
  pharmacy:               "Health & Beauty",
  beauty_salon:           "Health & Beauty",
  hair_care:              "Health & Beauty",
  supermarket:            "Grocery",
  grocery_or_supermarket: "Grocery",
  food:                   "Grocery",
  restaurant:             "Food & Beverage",
  cafe:                   "Food & Beverage",
  bakery:                 "Food & Beverage",
  book_store:             "Lifestyle",
  pet_store:              "Lifestyle",
  florist:                "Lifestyle",
  bank:                   "Services",
  atm:                    "Services",
  movie_theater:          "Entertainment",
  amusement_park:         "Entertainment",
  store:                  "General",
  shopping_mall:          "General",
};

function inferCategory(types: string[]): string {
  for (const type of types) {
    if (CATEGORY_MAP[type]) return CATEGORY_MAP[type];
  }
  return "General";
}

export interface PlaceStore {
  googlePlaceId: string;
  name: string;
  category: string;
  googleTypes: string[];
  vicinity?: string;
  rating?: number;
  openNow?: boolean;
  phone?: string;
  website?: string;
  openingHours?: string;
  lat: number;
  lng: number;
}

export interface PlaceMallDetails {
  googlePlaceId: string;
  name: string;
  formattedAddress: string;
  lat: number;
  lng: number;
  phone?: string;
  website?: string;
  openingHours?: string;
  rating?: number;
  photoRef?: string;
}

async function placesGet(path: string, params: Record<string, string>): Promise<unknown> {
  const url = new URL(`${BASE_URL}/${path}/json`);
  url.searchParams.set("key", API_KEY);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`Places API HTTP ${res.status}: ${path}`);
  const data = await res.json() as Record<string, unknown>;
  if (data["status"] !== "OK" && data["status"] !== "ZERO_RESULTS") {
    throw new Error(`Places API error: ${data["status"]} — ${data["error_message"] ?? ""}`);
  }
  return data;
}

/**
 * Resolve a mall's Google Place ID from its name + city.
 * Only needed once per mall — store the result in saMalls.ts placeId field.
 */
export async function findMallPlaceId(mallName: string, city: string): Promise<string | null> {
  const data = await placesGet("findplacefromtext", {
    input: `${mallName} ${city} South Africa`,
    inputtype: "textquery",
    fields: "place_id,name",
  }) as Record<string, unknown>;

  const candidates = data["candidates"] as Array<Record<string, string>> | undefined;
  return candidates?.[0]?.["place_id"] ?? null;
}

/**
 * Get full details for a mall by Place ID.
 */
export async function getMallDetails(placeId: string): Promise<PlaceMallDetails | null> {
  const data = await placesGet("details", {
    place_id: placeId,
    fields: "place_id,name,formatted_address,geometry,formatted_phone_number,website,opening_hours,rating,photos",
  }) as Record<string, unknown>;

  const result = data["result"] as Record<string, unknown> | undefined;
  if (!result) return null;

  const geometry = result["geometry"] as Record<string, Record<string, number>> | undefined;
  const hours = result["opening_hours"] as Record<string, unknown> | undefined;
  const photos = result["photos"] as Array<Record<string, string>> | undefined;

  return {
    googlePlaceId: result["place_id"] as string,
    name: result["name"] as string,
    formattedAddress: result["formatted_address"] as string,
    lat: geometry?.["location"]?.["lat"] ?? 0,
    lng: geometry?.["location"]?.["lng"] ?? 0,
    phone: result["formatted_phone_number"] as string | undefined,
    website: result["website"] as string | undefined,
    openingHours: (hours?.["weekday_text"] as string[] | undefined)?.join(" | "),
    rating: result["rating"] as number | undefined,
    photoRef: photos?.[0]?.["photo_reference"],
  };
}

/**
 * Find all stores within a mall using Nearby Search.
 * Radius of 200m covers most mall footprints.
 */
export async function findStoresNearby(
  lat: number,
  lng: number,
  radiusM = 200,
): Promise<PlaceStore[]> {
  const stores: PlaceStore[] = [];
  let pageToken: string | undefined;

  // Google Nearby Search paginates in groups of 20, max 3 pages (60 results)
  do {
    const params: Record<string, string> = {
      location: `${lat},${lng}`,
      radius: String(radiusM),
      type: "store",
    };
    if (pageToken) {
      params["pagetoken"] = pageToken;
      // Google requires a short delay before using a page token
      await new Promise((r) => setTimeout(r, 2000));
    }

    const data = await placesGet("nearbysearch", params) as Record<string, unknown>;
    const results = data["results"] as Array<Record<string, unknown>> | undefined;

    for (const place of results ?? []) {
      const types = (place["types"] as string[]) ?? [];
      // Skip malls, transit, finance — we want retail stores
      if (types.includes("shopping_mall") || types.includes("transit_station")) continue;

      const geometry = place["geometry"] as Record<string, Record<string, number>> | undefined;
      const openingHours = place["opening_hours"] as Record<string, unknown> | undefined;

      stores.push({
        googlePlaceId: place["place_id"] as string,
        name: place["name"] as string,
        category: inferCategory(types),
        googleTypes: types,
        vicinity: place["vicinity"] as string | undefined,
        rating: place["rating"] as number | undefined,
        openNow: openingHours?.["open_now"] as boolean | undefined,
        lat: geometry?.["location"]?.["lat"] ?? lat,
        lng: geometry?.["location"]?.["lng"] ?? lng,
      });
    }

    pageToken = data["next_page_token"] as string | undefined;
  } while (pageToken);

  return stores;
}

/**
 * Get phone + website + opening hours for a specific store Place ID.
 * Called selectively (costs 1 API call per store) — use on anchor stores only.
 */
export async function getStoreDetails(placeId: string): Promise<Partial<PlaceStore>> {
  const data = await placesGet("details", {
    place_id: placeId,
    fields: "formatted_phone_number,website,opening_hours",
  }) as Record<string, unknown>;

  const result = data["result"] as Record<string, unknown> | undefined;
  if (!result) return {};

  const hours = result["opening_hours"] as Record<string, unknown> | undefined;
  return {
    phone: result["formatted_phone_number"] as string | undefined,
    website: result["website"] as string | undefined,
    openingHours: (hours?.["weekday_text"] as string[] | undefined)?.join(" | "),
  };
}
