/**
 * Supabase upsert layer for mall and shop data.
 * Upserts malls by name, shops by (mall_id + name).
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
  openingHours?: string;
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
  openingHours: string | null;
  googlePlaceId: string | null;
  lat: number | null;
  lng: number | null;
}

interface MallRow { id: string; name: string }

const mallIdCache = new Map<string, string>();

/** Upsert a mall row, returns the Supabase UUID */
export async function upsertMall(mall: MallUpsert): Promise<string | null> {
  const cached = mallIdCache.get(mall.name);
  if (cached) return cached;

  // Try update first
  const { data: existing } = await supabase
    .from("malls")
    .select("id")
    .ilike("name", mall.name)
    .limit(1)
    .single();

  if (existing) {
    await supabase
      .from("malls")
      .update({
        lat: mall.lat,
        lng: mall.lng,
        city: mall.city,
        province: mall.province,
        ...(mall.googlePlaceId && { google_place_id: mall.googlePlaceId }),
        ...(mall.address && { address: mall.address }),
        ...(mall.phone && { phone: mall.phone }),
        ...(mall.website && { website: mall.website }),
        ...(mall.openingHours && { opening_hours: mall.openingHours }),
        ...(mall.rating && { rating: mall.rating }),
      })
      .eq("id", (existing as MallRow).id);

    mallIdCache.set(mall.name, (existing as MallRow).id);
    return (existing as MallRow).id;
  }

  // Insert new mall
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
      opening_hours: mall.openingHours ?? null,
      rating: mall.rating ?? null,
    })
    .select("id")
    .single();

  if (error) {
    console.error(`    DB error inserting mall "${mall.name}":`, error.message);
    return null;
  }

  const id = (inserted as MallRow).id;
  mallIdCache.set(mall.name, id);
  return id;
}

/** Upsert a shop within a mall. Matches on mall_id + name (case-insensitive). */
export async function upsertShop(shop: ShopUpsert): Promise<"inserted" | "updated" | "skipped"> {
  const { data: existing } = await supabase
    .from("shops")
    .select("id")
    .eq("mall_id", shop.mallId)
    .ilike("name", shop.name)
    .limit(1)
    .single();

  if (existing) {
    await supabase
      .from("shops")
      .update({
        category: shop.category,
        ...(shop.floor && { floor: shop.floor }),
        ...(shop.unit && { unit_number: shop.unit }),
        ...(shop.phone && { phone: shop.phone }),
        ...(shop.website && { website: shop.website }),
        ...(shop.openingHours && { opening_hours: shop.openingHours }),
        ...(shop.googlePlaceId && { google_place_id: shop.googlePlaceId }),
        ...(shop.lat && { lat: shop.lat }),
        ...(shop.lng && { lng: shop.lng }),
      })
      .eq("id", (existing as MallRow).id);
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
    opening_hours: shop.openingHours,
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
