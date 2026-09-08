import { getSupabaseClient } from "../lib/supabase.js";
import { haversineKm } from "../lib/haversine.js";
import type { Mall, ShoppingSession } from "../lib/types.js";

const MALL_RADIUS_KM = 1.0; // Within 1 km = user is "at" the mall

export interface DetectMallResult {
  mall: Mall;
  session_id: string | null;
  distance_km: number;
  within_radius: boolean;
}

/**
 * Finds the nearest mall to the user's GPS position using Haversine.
 * If a user_id is provided, creates or resumes an active shopping_session.
 */
export async function detectActiveMall(
  lat: number,
  lng: number,
  user_id: string | null
): Promise<DetectMallResult> {
  const supabase = getSupabaseClient();

  // 1. Fetch all malls that have coordinates
  const { data: malls, error } = await supabase
    .from("malls")
    .select("id, name, city, province, lat, lng")
    .not("lat", "is", null)
    .not("lng", "is", null);

  if (error) throw new Error(`Failed to fetch malls: ${error.message}`);
  if (!malls?.length) throw new Error("No malls with coordinates found in the database.");

  // 2. Find nearest mall
  let nearestMall: Mall | null = null;
  let nearestDist = Infinity;

  for (const mall of malls as Mall[]) {
    if (mall.lat == null || mall.lng == null) continue;
    const dist = haversineKm(lat, lng, mall.lat, mall.lng);
    if (dist < nearestDist) {
      nearestDist = dist;
      nearestMall = mall;
    }
  }

  if (!nearestMall) throw new Error("Could not determine nearest mall.");

  const distance_km = Math.round(nearestDist * 10) / 10;
  const within_radius = nearestDist <= MALL_RADIUS_KM;
  const mallId = String(nearestMall.id);

  // 3. Create or resume shopping session for logged-in users
  let session_id: string | null = null;

  if (user_id) {
    const { data: existing } = await supabase
      .from("shopping_sessions")
      .select("id")
      .eq("user_id", user_id)
      .eq("mall_id", mallId)
      .eq("status", "active")
      .order("last_seen_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existing) {
      await supabase
        .from("shopping_sessions")
        .update({
          last_seen_at: new Date().toISOString(),
          current_lat: lat,
          current_lng: lng,
        })
        .eq("id", existing.id);
      session_id = existing.id;
    } else {
      const { data: created } = await supabase
        .from("shopping_sessions")
        .insert({
          user_id,
          mall_id: mallId,
          status: "active",
          current_lat: lat,
          current_lng: lng,
        })
        .select("id")
        .single();
      session_id = created?.id ?? null;
    }
  }

  return { mall: nearestMall, session_id, distance_km, within_radius };
}

/**
 * Loads an active session by ID. Returns null if not found.
 */
export async function getSession(session_id: string): Promise<ShoppingSession | null> {
  const supabase = getSupabaseClient();
  const { data } = await supabase
    .from("shopping_sessions")
    .select("*")
    .eq("id", session_id)
    .single();
  return (data as ShoppingSession) ?? null;
}
