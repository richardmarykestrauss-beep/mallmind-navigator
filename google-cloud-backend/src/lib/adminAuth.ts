/**
 * adminAuth.ts — the existing admin authentication model, extracted so routes
 * that predate it (GET /admin-stats) can adopt it without copying it an
 * eleventh time.
 *
 * Model (unchanged from every other /admin route):
 *   Authorization: Bearer <Supabase access token>
 *   → supabase.auth.getUser(token)   (valid, unexpired session)
 *   → profiles.is_admin = true       (server-side lookup with the service role)
 *
 * On failure the helper writes the 401/403 response itself and returns null;
 * the caller simply returns. It never throws for an auth failure.
 */

import type { Request, Response } from "express";
import { getSupabaseClient } from "./supabase.js";

export interface AdminIdentity {
  userId: string;
  email: string | null;
}

export function getBearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  return token.length ? token : null;
}

export async function requireAdmin(req: Request, res: Response): Promise<AdminIdentity | null> {
  const token = getBearerToken(req);
  if (!token) {
    res.status(401).json({ error: "Missing Authorization bearer token" });
    return null;
  }

  const supabase = getSupabaseClient();
  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData?.user) {
    res.status(401).json({ error: "Invalid or expired auth token" });
    return null;
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, is_admin")
    .eq("id", userData.user.id)
    .maybeSingle();

  if (profileError) {
    res.status(500).json({ error: "Failed to check admin profile" });
    return null;
  }
  if (!profile?.is_admin) {
    res.status(403).json({ error: "Not authorized. Admin access required." });
    return null;
  }

  return { userId: userData.user.id, email: userData.user.email ?? null };
}
