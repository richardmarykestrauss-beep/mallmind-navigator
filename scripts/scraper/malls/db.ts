/**
 * Supabase upsert layer for mall and shop data.
 *
 * Schema reference (verified against seed.sql):
 *   malls:  id, name, city, province, lat, lng, address, phone, website,
 *           google_place_id, rating
 *   shops:  id, mall_id, name, category, floor, unit_number,
 *           opening_time, closing_time, is_active,
 *           lat, lng, phone, website, google_place_id
 */

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

export interface MallUpsert {
  name: string;
  city: string;
  province: string;
  lat: number;
  lng: number;
  googlePlaceId?: string;
  address?: string;
  phone?: string;
  website?: string;
  rating?: number;
}

export interface ShopUpsert {
  mallId: string;
  name: string;
  category: string;
  floor: string | null;
  unit: string | null;
  phone: string | null;
  website: string | null;
  /** Raw trading hours string e.g. "Mon-Sat 09:00-21:00" — we parse opening/closing */
  tradingHours: string | null;
  googlePlaceId: string | null;
  lat: number | null;
  lng: number | null;
}

interface Row { id: string }

const mallIdCache = new Map<string, string>();

/** Parse a trading hours string into opening_time and closing_time (HH:MM) */
function parseTimes(raw: string | null): { opening_time: string | null; closing_time: string | null } {
  if (!raw) return { opening_time: null, closing_time: null };
  // Match patterns like "09:00-21:00", "09:00 - 21:00", "9am-9pm"
  const match = raw.match(/(\d{1,2}):?(\d{2})?(?:\s*(?:am|AM))?\s*[-–]\s*(\d{1,2}):?(\d{2})?(?:\s*(?:pm|PM))?/);
  if (!match) return { opening_time: null, closing_time: null };
  const opening_time = `${match[1].padStart(2, "0")}:${match[2] ?? "00"}`;
  const closing_time = `${match[3].padStart(2, "0")}:${match[4] ?? "00"}`;
  return { opening_time, closing_time };
}

/** Upsert a mall row, returns the Supabase UUID */
export async function upsertMall(mall: MallUpsert): Promise<string | null> {
  const cached = mallIdCache.get(mall.name.toLowerCase());
  if (cached) return cached;

  const { data: existing } = await supabase
    .from("malls")
    .select("id")
    .ilike("name", mall.name)
    .limit(1)
    .single();

  if (existing) {
    const id = (existing as Row).id;
    // Update geo + metadata fields that may have been missing
    await supabase.from("malls").update({
      lat: mall.lat,
      lng: mall.lng,
      city: mall.city,
      province: mall.province,
      ...(mall.googlePlaceId && { google_place_id: mall.googlePlaceId }),
      ...(mall.address       && { address: mall.address }),
      ...(mall.phone         && { phone: mall.phone }),
      ...(mall.website       && { website: mall.website }),
      ...(mall.rating        && { rating: mall.rating }),
    }).eq("id", id);
    mallIdCache.set(mall.name.toLowerCase(), id);
    return id;
  }

  // Insert brand-new mall
  const { data: inserted, error } = await supabase
    .from("malls")
    .insert({
      name: mall.name,
      city: mall.city,
      province: mall.province,
      lat: mall.lat,
      lng: mall.lng,
      google_place_id: mall.googlePlaceId ?? null,
      address: mall.address ?? null,
      phone: mall.phone ?? null,
      website: mall.website ?? null,
      rating: mall.rating ?? null,
    })
    .select("id")
    .single();

  if (error) {
    console.error(`    DB error inserting mall "${mall.name}":`, error.message);
    return null;
  }

  const id = (inserted as Row).id;
  mallIdCache.set(mall.name.toLowerCase(), id);
  return id;
}

/** Upsert a shop within a mall. Matches on mall_id + name (case-insensitive). */
export async function upsertShop(shop: ShopUpsert): Promise<"inserted" | "updated" | "skipped"> {
  const { opening_time, closing_time } = parseTimes(shop.tradingHours);

  const { data: existing } = await supabase
    .from("shops")
    .select("id")
    .eq("mall_id", shop.mallId)
    .ilike("name", shop.name)
    .limit(1)
    .single();

  if (existing) {
    await supabase.from("shops").update({
      category: shop.category,
      ...(shop.floor          && { floor: shop.floor }),
      ...(shop.unit           && { unit_number: shop.unit }),
      ...(shop.phone          && { phone: shop.phone }),
      ...(shop.website        && { website: shop.website }),
      ...(opening_time        && { opening_time }),
      ...(closing_time        && { closing_time }),
      ...(shop.googlePlaceId  && { google_place_id: shop.googlePlaceId }),
      ...(shop.lat            && { lat: shop.lat }),
      ...(shop.lng            && { lng: shop.lng }),
    }).eq("id", (existing as Row).id);
    return "updated";
  }

  const { error } = await supabase.from("shops").insert({
    mall_id: shop.mallId,
    name: shop.name,
    category: shop.category,
    floor: shop.floor,
    unit_number: shop.unit,
    phone: shop.phone,
    website: shop.website,
    opening_time,
    closing_time,
    is_active: true,
    google_place_id: shop.googlePlaceId,
    lat: shop.lat,
    lng: shop.lng,
  });

  if (error) {
    console.error(`    DB error inserting shop "${shop.name}":`, error.message);
    return "skipped";
  }
  return "inserted";
}
