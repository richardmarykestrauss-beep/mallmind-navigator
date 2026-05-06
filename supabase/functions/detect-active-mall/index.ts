/**
 * detect-active-mall — MallMind Edge Function
 *
 * Input:  { lat, lng, user_id? }
 * Output: { mall, session_id, distance_km, within_radius }
 *
 * - Finds nearest mall using Haversine on malls.lat/lng
 * - Creates or resumes an active shopping_session for the user
 * - within_radius = true when user is within MALL_RADIUS_KM of the mall
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Radius in km within which we consider the user "inside" a mall
const MALL_RADIUS_KM = 1.0;

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST")
    return new Response("Method not allowed", { status: 405, headers: CORS });

  try {
    const { lat, lng, user_id } = await req.json();

    if (lat == null || lng == null) {
      return new Response(
        JSON.stringify({ error: "lat and lng are required" }),
        { status: 400, headers: { "Content-Type": "application/json", ...CORS } }
      );
    }

    // 1. Fetch all malls with coordinates
    const { data: malls, error: mallErr } = await supabase
      .from("malls")
      .select("id, name, city, province, lat, lng")
      .not("lat", "is", null)
      .not("lng", "is", null);

    if (mallErr || !malls?.length) {
      return new Response(
        JSON.stringify({ error: "No malls with coordinates found", mall: null }),
        { headers: { "Content-Type": "application/json", ...CORS } }
      );
    }

    // 2. Find nearest mall by haversine
    let nearestMall: (typeof malls)[0] | null = null;
    let nearestDist = Infinity;

    for (const mall of malls) {
      const dist = haversineKm(lat, lng, mall.lat as number, mall.lng as number);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearestMall = mall;
      }
    }

    if (!nearestMall) {
      return new Response(
        JSON.stringify({ error: "Could not determine nearest mall", mall: null }),
        { headers: { "Content-Type": "application/json", ...CORS } }
      );
    }

    const within_radius = nearestDist <= MALL_RADIUS_KM;
    const distance_km = Math.round(nearestDist * 10) / 10;

    // 3. Create or resume active session (only for logged-in users)
    let session_id: string | null = null;

    if (user_id) {
      const mallId = String(nearestMall.id);

      // Check for existing active session at this mall
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
        // Resume: update location + last_seen_at
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
        // Create new session
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

    return new Response(
      JSON.stringify({
        mall: nearestMall,
        session_id,
        distance_km,
        within_radius,
      }),
      { headers: { "Content-Type": "application/json", ...CORS } }
    );
  } catch (err) {
    console.error("detect-active-mall error:", err);
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { "Content-Type": "application/json", ...CORS } }
    );
  }
});
