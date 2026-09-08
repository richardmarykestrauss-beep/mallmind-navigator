/**
 * durableWorkerAdminApi — the Data Command Center's ONLY door to the durable worker.
 *
 * Why this module exists (Sprint 2E CI fix + architecture boundary):
 *   - The dev-durable panel must be IMPORT-SAFE with no Supabase frontend env vars.
 *     The browser Supabase singleton (`@/lib/supabaseClient`) calls createClient at
 *     module-eval time and throws "supabaseUrl is required" when the env is absent
 *     (as in CI). So this module NEVER imports it statically — it pulls the session
 *     in lazily, at request time, via a dynamic import, so merely importing a panel
 *     (or the whole Command Center) can never trigger client construction.
 *   - Durable requests go through the authenticated backend admin proxy
 *     (`/admin/intake/*`), never to Supabase directly and never via a service-role
 *     key. The proxy re-checks profiles.is_admin server-side.
 *
 * Everything returns typed, sanitized results; the worker-not-configured case is a
 * first-class value, not an exception. Nothing here approves or publishes.
 */

import {
  durableWorkerClient, isDurableWorkerConfigured, DurableWorkerError,
  type AccessTokenProvider, type DurableWorkerStatus, type DurableJobDetail,
} from "@/lib/fabric/intake/durable/durableWorkerClient";
import type { DurableJobRow, DurableEventRow } from "@/lib/fabric/intake/durable/durableTypes";

export { DurableWorkerError };
export type { DurableWorkerStatus, DurableJobDetail };

/**
 * Lazily resolve the signed-in admin's access token. The dynamic import means
 * `@/lib/supabaseClient` is only evaluated when a request is actually made (and
 * only ever when the worker is configured), never at module import. This is the
 * "session abstraction, used lazily at request time" the boundary requires.
 *
 * It is never a service-role key — it is the browser user's own anon-scoped
 * session token, which the backend proxy validates and gates on is_admin.
 */
const getAdminAccessToken: AccessTokenProvider = async () => {
  const { supabase } = await import("@/lib/supabaseClient");
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
};

export type ControlAction = "run" | "pause" | "resume" | "cancel";

/** The typed surface the dashboard uses. Every method proxies through the backend. */
export const durableWorkerAdminApi = {
  /** True only when VITE_GOOGLE_BACKEND_URL is set. Drives the honest disabled state. */
  isConfigured(): boolean {
    return isDurableWorkerConfigured();
  },
  status(): Promise<DurableWorkerStatus> {
    return durableWorkerClient.status(getAdminAccessToken);
  },
  listJobs(): Promise<{ jobs: DurableJobRow[] }> {
    return durableWorkerClient.listJobs(getAdminAccessToken);
  },
  getJob(jobId: string): Promise<DurableJobDetail> {
    return durableWorkerClient.getJob(jobId, getAdminAccessToken);
  },
  getEvents(jobId: string): Promise<{ events: DurableEventRow[] }> {
    return durableWorkerClient.getEvents(jobId, getAdminAccessToken);
  },
  /** Control actions stage drafts for review; they never approve or publish. */
  control(jobId: string, action: ControlAction): Promise<{ job?: DurableJobRow; status?: string }> {
    return durableWorkerClient[action](jobId, getAdminAccessToken);
  },
};

/** Turn any failure into a short, safe message for the dashboard (no secrets, no URLs). */
export function describeDurableError(err: unknown, fallback: string): string {
  return err instanceof DurableWorkerError ? err.message : fallback;
}
