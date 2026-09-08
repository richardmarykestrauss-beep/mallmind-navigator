/**
 * /admin/intake/* — the Data Command Center's authenticated door to the durable worker.
 *
 * Why this exists: the durable worker is deployed private (--no-allow-unauthenticated),
 * so the browser cannot reach it, and the browser must NEVER hold a service-role key
 * or mint its own Google identity token. So the dashboard calls this route on the
 * existing API service, which:
 *   1. authenticates the human (Supabase bearer) and checks profiles.is_admin —
 *      the same pattern as retailObservationsAdmin;
 *   2. mints a Google identity token for THIS service's own service account;
 *   3. forwards the call to the private worker and relays the JSON back.
 *
 * The admin's identity gates the call; the API service's identity authorises the
 * hop. A non-admin, or an unauthenticated caller, never reaches the worker.
 *
 * This module deliberately imports NO fabric code, so the API service's build
 * (rootDir: "src") is unaffected and its image needs no frontend sources.
 *
 * When INTAKE_WORKER_URL is unset the route reports "not configured" rather than
 * failing obscurely — the dashboard renders that as an honest disabled state.
 */

import { Router, type Request, type Response } from "express";
import { GoogleAuth } from "google-auth-library";
import { getSupabaseClient } from "../lib/supabase.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Exactly the worker paths the dashboard may reach. Not a general proxy. */
const READ_PATHS = ["", "/events", "/reconciliation"] as const;
const CONTROL_ACTIONS = ["run", "pause", "resume", "cancel"] as const;
type ControlAction = (typeof CONTROL_ACTIONS)[number];

const auth = new GoogleAuth();

function workerUrl(): string | null {
  const url = process.env.INTAKE_WORKER_URL;
  if (!url) return null;
  if (!/^https:\/\/[a-z0-9.-]+\.run\.app$/i.test(url.replace(/\/$/, ""))) return null;  // Cloud Run only
  return url.replace(/\/$/, "");
}

function bearerFrom(req: Request): string | null {
  const m = /^Bearer\s+(\S+)$/.exec(String(req.headers.authorization ?? ""));
  return m ? m[1] : null;
}

/** Authenticate the human and require is_admin. Mirrors retailObservationsAdmin. */
async function requireAdmin(req: Request, res: Response): Promise<boolean> {
  const token = bearerFrom(req);
  if (!token) { res.status(401).json({ error: "Missing bearer token" }); return false; }

  const supabase = getSupabaseClient();
  const { data: userData, error } = await supabase.auth.getUser(token);
  if (error || !userData?.user) { res.status(401).json({ error: "Invalid session" }); return false; }

  const { data: profile } = await supabase.from("profiles").select("is_admin").eq("id", userData.user.id).single();
  if (!profile?.is_admin) { res.status(403).json({ error: "Admin access required" }); return false; }
  return true;
}

/** Call the private worker with an identity token for this service's own SA. */
async function callWorker(
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<{ status: number; body: unknown }> {
  const base = workerUrl();
  if (!base) return { status: 503, body: { error: "not_configured", message: "Dev durable worker is not configured for this environment." } };

  const client = await auth.getIdTokenClient(base);   // audience = the worker service URL
  try {
    const response = await client.request({
      url: `${base}${path}`,
      method,
      data: body,
      // A worker run is synchronous and can be long; keep it bounded anyway.
      timeout: 120_000,
      validateStatus: () => true,
    });
    return { status: response.status ?? 502, body: response.data };
  } catch {
    // Never relay the raw client error: it can quote the identity token.
    return { status: 502, body: { error: "worker_unreachable", message: "Durable worker did not respond." } };
  }
}

const router = Router();

/** Whether durable mode is available at all — lets the UI disable instead of guess. */
router.get("/status", async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const base = workerUrl();
  if (!base) { res.json({ configured: false, mode: "prototype" }); return; }
  const health = await callWorker("GET", "/health");
  res.json({
    configured: true,
    mode: "dev-durable",
    reachable: health.status === 200,
    worker: health.status === 200 ? health.body : null,
  });
});

router.get("/jobs", async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const out = await callWorker("GET", "/internal/intake/jobs");
  res.status(out.status).json(out.body);
});

for (const suffix of READ_PATHS) {
  router.get(`/jobs/:jobId${suffix}`, async (req, res) => {
    if (!(await requireAdmin(req, res))) return;
    const jobId = String(req.params.jobId);
    if (!UUID_RE.test(jobId)) { res.status(400).json({ error: "invalid_job_id" }); return; }
    const out = await callWorker("GET", `/internal/intake/jobs/${jobId}${suffix}`);
    res.status(out.status).json(out.body);
  });
}

/**
 * Control actions. These pause/resume/cancel or run an intake job — they stage
 * drafts for review. Nothing here approves or publishes anything: those remain
 * separate, human-gated steps in the review bridge.
 */
router.post("/jobs/:jobId/:action", async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const jobId = String(req.params.jobId);
  const action = String(req.params.action) as ControlAction;
  if (!UUID_RE.test(jobId)) { res.status(400).json({ error: "invalid_job_id" }); return; }
  if (!CONTROL_ACTIONS.includes(action)) { res.status(400).json({ error: "invalid_action" }); return; }

  const out = await callWorker("POST", `/internal/intake/jobs/${jobId}/${action}`, {});
  res.status(out.status).json(out.body);
});

export default router;
