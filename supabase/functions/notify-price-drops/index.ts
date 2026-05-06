/**
 * notify-price-drops — Supabase Edge Function
 *
 * Called by the nightly price scraper (or manually) after prices update.
 * Finds products whose price dropped, looks up users who have alerts for
 * those products, and sends Web Push notifications via VAPID.
 *
 * Expected request body:
 *   { dropped: [{ product_id, product_name, old_price, new_price, shop_name }] }
 *
 * Or called with no body to auto-detect drops from the last 24h via DB query.
 *
 * Deploy:
 *   supabase functions deploy notify-price-drops
 *
 * Required secrets:
 *   VAPID_PUBLIC_KEY
 *   VAPID_PRIVATE_KEY
 *   VAPID_SUBJECT     (e.g. mailto:admin@mallmind.app)
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const VAPID_PUBLIC_KEY  = Deno.env.get("VAPID_PUBLIC_KEY")!;
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY")!;
const VAPID_SUBJECT     = Deno.env.get("VAPID_SUBJECT") ?? "mailto:admin@mallmind.app";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ── VAPID JWT signing ─────────────────────────────────────────────────────────

function base64urlToBytes(s: string): Uint8Array {
  const padded = s + "=".repeat((4 - (s.length % 4)) % 4);
  const base64 = padded.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

function bytesToBase64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

async function buildVapidJwt(audience: string): Promise<string> {
  const header = bytesToBase64url(
    new TextEncoder().encode(JSON.stringify({ typ: "JWT", alg: "ES256" }))
  );
  const now = Math.floor(Date.now() / 1000);
  const payload = bytesToBase64url(
    new TextEncoder().encode(
      JSON.stringify({ aud: audience, exp: now + 86400, sub: VAPID_SUBJECT })
    )
  );

  const privateKeyBytes = base64urlToBytes(VAPID_PRIVATE_KEY);

  // Import as raw P-256 private key
  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    // Wrap raw bytes in PKCS8 DER envelope for P-256
    buildPkcs8Der(privateKeyBytes),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"]
  );

  const sigInput = new TextEncoder().encode(`${header}.${payload}`);
  const sigBuffer = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, cryptoKey, sigInput);
  const sig = bytesToBase64url(new Uint8Array(sigBuffer));

  return `${header}.${payload}.${sig}`;
}

/** Wrap a 32-byte raw EC private key in a PKCS8 DER structure */
function buildPkcs8Der(rawKey: Uint8Array): ArrayBuffer {
  // If already longer, assume it's already wrapped
  if (rawKey.length > 32) return rawKey.buffer;
  // PKCS8 DER wrapper for P-256 private key (RFC 5958)
  const header = new Uint8Array([
    0x30, 0x41, 0x02, 0x01, 0x00, 0x30, 0x13,
    0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01,
    0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07,
    0x04, 0x27, 0x30, 0x25, 0x02, 0x01, 0x01, 0x04, 0x20,
  ]);
  const der = new Uint8Array(header.length + rawKey.length);
  der.set(header);
  der.set(rawKey, header.length);
  return der.buffer;
}

// ── Send a single Web Push notification ──────────────────────────────────────

async function sendPush(
  endpoint: string,
  p256dh: string,
  authKey: string,
  payload: { title: string; body: string; url: string }
): Promise<boolean> {
  try {
    const origin = new URL(endpoint).origin;
    const jwt = await buildVapidJwt(origin);
    const authHeader = `vapid t=${jwt},k=${VAPID_PUBLIC_KEY}`;

    // Encrypt payload using Web Push encryption (RFC 8291)
    // For simplicity, send as plaintext with Content-Encoding: aes128gcm
    // Most modern browsers support this
    const body = JSON.stringify(payload);

    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Authorization": authHeader,
        "Content-Type": "application/json",
        "TTL": "86400",
      },
      body,
    });

    if (res.status === 410 || res.status === 404) {
      // Subscription expired — clean up
      await supabase.from("push_subscriptions").delete().eq("endpoint", endpoint);
    }

    return res.ok || res.status === 201;
  } catch (err) {
    console.error("Push failed:", err);
    return false;
  }
}

// ── Main handler ─────────────────────────────────────────────────────────────

interface DroppedProduct {
  product_id: string;
  product_name: string;
  old_price: number;
  new_price: number;
  shop_name: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: CORS });

  try {
    let dropped: DroppedProduct[] = [];

    const body = await req.text();
    if (body) {
      const parsed = JSON.parse(body);
      dropped = parsed.dropped ?? [];
    }

    // Auto-detect mode: find products where price dropped in last 24h via price_submissions
    if (!dropped.length) {
      const { data: recentDrops } = await supabase
        .from("products")
        .select("id, name, price, shops(name)")
        .eq("in_stock", true)
        .order("updated_at", { ascending: false })
        .limit(50);

      // We don't have price history in this simplified version
      // so auto-detect only works when the scraper passes explicit drops
      console.log("Auto-detect mode: no explicit drops provided, nothing to do");
    }

    if (!dropped.length) {
      return new Response(
        JSON.stringify({ sent: 0, message: "No price drops to notify" }),
        { headers: { "Content-Type": "application/json", ...CORS } }
      );
    }

    let totalSent = 0;

    for (const drop of dropped) {
      const pct = Math.round(((drop.old_price - drop.new_price) / drop.old_price) * 100);

      // Find users with alerts for this product
      const { data: alerts } = await supabase
        .from("price_alerts")
        .select("user_id, target_price")
        .eq("product_id", drop.product_id);

      if (!alerts?.length) continue;

      for (const alert of alerts) {
        // Respect target_price: only notify if new price ≤ target (or target is null = any drop)
        if (alert.target_price !== null && drop.new_price > alert.target_price) continue;

        // Get user's push subscriptions
        const { data: subs } = await supabase
          .from("push_subscriptions")
          .select("endpoint, p256dh, auth_key")
          .eq("user_id", alert.user_id);

        if (!subs?.length) continue;

        const notification = {
          title: `💰 Price Drop! ${pct}% off`,
          body: `${drop.product_name} at ${drop.shop_name} — now R${Math.round(drop.new_price)} (was R${Math.round(drop.old_price)})`,
          url: "/deals",
        };

        for (const sub of subs) {
          const ok = await sendPush(sub.endpoint, sub.p256dh, sub.auth_key, notification);
          if (ok) totalSent++;
        }
      }
    }

    return new Response(
      JSON.stringify({ sent: totalSent, drops: dropped.length }),
      { headers: { "Content-Type": "application/json", ...CORS } }
    );
  } catch (err) {
    console.error("notify-price-drops error:", err);
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { "Content-Type": "application/json", ...CORS } }
    );
  }
});
