/**
 * Browser client for the dev durable intake worker.
 *
 * The browser NEVER holds a service-role key and never talks to Postgres or Cloud
 * Storage directly. It calls `/admin/intake/*` on the Cloud Run API service with
 * the signed-in user's Supabase access token; that route re-checks
 * `profiles.is_admin` server-side and forwards to the private worker using the API
 * service's own Google identity. Being an admin in the UI is a hint — the server
 * decides.
 *
 * When VITE_GOOGLE_BACKEND_URL is unset, `isDurableWorkerConfigured()` returns
 * false and the dashboard renders an honest disabled state instead of a dead
 * button. Durable mode is dev-only and fixture-only; nothing here publishes.
 */

import type { DurableJobRow, ChunkRow, DurableEventRow, ReconciliationSummary } from "./durableTypes";
import type { QuarantineRecord } from "../types";

const RAW_URL = (import.meta.env.VITE_GOOGLE_BACKEND_URL as string | undefined) ?? "";
const BASE_URL = RAW_URL.replace(/\/+$/, "");

export function isDurableWorkerConfigured(): boolean {
  return BASE_URL.length > 0;
}

export interface DurableWorkerStatus {
  configured: boolean;
  mode: "prototype" | "dev-durable";
  reachable?: boolean;
  worker?: { fixtureOnlyMode?: boolean; mode?: string } | null;
}

export interface DurableJobDetail {
  job: DurableJobRow;
  chunks: ChunkRow[];
  quarantine: QuarantineRecord[];
  reconciliation: ReconciliationSummary;
}

export class DurableWorkerError extends Error {
  constructor(public code: string, message: string) { super(message); this.name = "DurableWorkerError"; }
}

/** The caller supplies the current Supabase access token; this module stores none. */
export type AccessTokenProvider = () => Promise<string | null>;

async function call<T>(path: string, getToken: AccessTokenProvider, method: "GET" | "POST" = "GET"): Promise<T> {
  if (!isDurableWorkerConfigured()) {
    throw new DurableWorkerError("not_configured", "Dev durable worker is not configured for this environment.");
  }
  const token = await getToken();
  if (!token) throw new DurableWorkerError("unauthenticated", "Sign in as an admin to use durable mode.");

  let response: Response;
  try {
    response = await fetch(`${BASE_URL}/admin/intake${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: method === "POST" ? "{}" : undefined,
    });
  } catch {
    throw new DurableWorkerError("unreachable", "Could not reach the backend.");
  }

  if (response.status === 204) return undefined as T;

  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    throw new DurableWorkerError(
      String(body.error ?? `http_${response.status}`),
      String(body.message ?? "The durable worker rejected this request."),
    );
  }
  return body as T;
}

export const durableWorkerClient = {
  status: (getToken: AccessTokenProvider) => call<DurableWorkerStatus>("/status", getToken),
  listJobs: (getToken: AccessTokenProvider) => call<{ jobs: DurableJobRow[] }>("/jobs", getToken),
  getJob: (jobId: string, getToken: AccessTokenProvider) => call<DurableJobDetail>(`/jobs/${jobId}`, getToken),
  getEvents: (jobId: string, getToken: AccessTokenProvider) => call<{ events: DurableEventRow[] }>(`/jobs/${jobId}/events`, getToken),
  /** Runs a job: streams the fixture and STAGES drafts for review. Never publishes. */
  run: (jobId: string, getToken: AccessTokenProvider) => call<{ status: string }>(`/jobs/${jobId}/run`, getToken, "POST"),
  pause: (jobId: string, getToken: AccessTokenProvider) => call<{ job: DurableJobRow }>(`/jobs/${jobId}/pause`, getToken, "POST"),
  resume: (jobId: string, getToken: AccessTokenProvider) => call<{ job: DurableJobRow }>(`/jobs/${jobId}/resume`, getToken, "POST"),
  cancel: (jobId: string, getToken: AccessTokenProvider) => call<{ job: DurableJobRow }>(`/jobs/${jobId}/cancel`, getToken, "POST"),
};
