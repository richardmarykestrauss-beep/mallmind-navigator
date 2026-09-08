import { createClient, SupabaseClient } from "@supabase/supabase-js";

let _client: SupabaseClient | null = null;

/**
 * Returns a singleton Supabase client using the service role key.
 * This module is server-side only — the service role key must never
 * reach the frontend or be committed to version control.
 *
 * Required env vars:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */
export function getSupabaseClient(): SupabaseClient {
  if (_client) return _client;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      "Missing required environment variables: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must both be set."
    );
  }

  _client = createClient(url, key, {
    auth: {
      // Disable session persistence — this is a server-side service client
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  return _client;
}
