/**
 * env.ts — Centralised environment variable access for the MallMind frontend.
 *
 * WHY THIS FILE EXISTS
 * ─────────────────────
 * Vite replaces `import.meta.env.VITE_*` at build time. Without this module,
 * every file that needs Supabase config would either hardcode the values or
 * independently read from import.meta.env — both patterns caused the keys to
 * proliferate across the codebase in plain text.
 *
 * HOW TO USE
 * ───────────
 * import { SUPABASE_URL, SUPABASE_ANON_KEY } from "@/lib/env";
 *
 * WHAT BELONGS HERE
 * ──────────────────
 * ✅  Public config that must vary per deployment (URL, anon key, VAPID public key)
 * ✅  Optional feature flags (Cloud Run URL)
 * ❌  SUPABASE_SERVICE_ROLE_KEY  — backend only, never frontend
 * ❌  GEMINI_API_KEY             — backend only, never frontend
 * ❌  Any private key or secret
 *
 * SECURITY NOTE: The Supabase anon key and VAPID public key are intentionally
 * "public" values — they are safe to ship in the JS bundle. Security comes from
 * Supabase RLS policies, not from keeping the anon key secret. Still, reading
 * them from env vars (rather than hardcoding) keeps config manageable across
 * environments and avoids cluttering git history with live project references.
 */

// ── Internal helper ───────────────────────────────────────────────────────────

function getVar(key: string, required: boolean): string {
  // import.meta.env is replaced at build time by Vite — this is not a runtime lookup.
  const value = (import.meta.env as Record<string, string | undefined>)[key];
  if (!value) {
    if (required) {
      console.error(
        `[MallMind] Missing required environment variable: ${key}\n` +
        `Copy .env.example → .env.local and fill in the value.\n` +
        `See docs/SECURITY_ENVIRONMENT_CHECKLIST.md for details.`
      );
    }
    return "";
  }
  return value;
}

// ── Supabase (PUBLIC — safe for frontend) ────────────────────────────────────

/**
 * Your Supabase project URL.
 * Reads VITE_SUPABASE_URL from the environment.
 * Format: https://<ref>.supabase.co
 */
export const SUPABASE_URL = getVar("VITE_SUPABASE_URL", true);

/**
 * Supabase anon (publishable) key.
 * Reads VITE_SUPABASE_ANON_KEY from the environment.
 * This key is public — it enforces Row Level Security policies, not secrecy.
 * NEVER use the service_role key here.
 */
export const SUPABASE_ANON_KEY = getVar("VITE_SUPABASE_ANON_KEY", true);

// ── Google Cloud Run (optional) ───────────────────────────────────────────────

/**
 * Cloud Run backend URL. When set, AI / route / admin calls go here instead
 * of Supabase Edge Functions. Leave empty to stay on the Supabase path.
 * Reads VITE_GOOGLE_BACKEND_URL from the environment.
 */
export const GOOGLE_BACKEND_URL = getVar("VITE_GOOGLE_BACKEND_URL", false);

// ── Web Push (PUBLIC — the private VAPID key lives in Supabase secrets only) ──

/**
 * VAPID public key for Web Push subscriptions.
 * The matching private key is stored in Supabase secrets / Cloud Run env.
 * Reads VITE_VAPID_PUBLIC_KEY from the environment.
 */
export const VAPID_PUBLIC_KEY = getVar("VITE_VAPID_PUBLIC_KEY", false);
