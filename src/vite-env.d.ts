/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Optional Google Cloud Run backend URL.
   *
   * When set, the frontend routes detect-active-mall, recommend-products,
   * build-route, and assistant calls to the Cloud Run service instead of
   * the Supabase Edge Functions.
   *
   * Leave unset (or empty) to keep using the existing Supabase Edge Functions.
   * The two paths are fully parallel — setting this variable is the only change
   * required to switch traffic.
   *
   * Example value: https://mallmind-backend-dev-xxxxxxxxxx-ew.a.run.app
   */
  readonly VITE_GOOGLE_BACKEND_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
