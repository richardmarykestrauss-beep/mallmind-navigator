/**
 * Durable intake worker service handlers (Cloud Run internal endpoints).
 *
 * These are pure, testable handlers a thin Express/Fastify app wraps for:
 *   POST /internal/intake/jobs/claim-next
 *   POST /internal/intake/jobs/:jobId/run|pause|resume|cancel
 *   GET  /internal/intake/jobs/:jobId | /events
 *
 * SECURITY: internal only. Every handler requires service-to-service auth; the
 * browser NEVER holds the internal token or a service-role key. `requestedBy` is
 * grounded in the authenticated caller, never trusted from arbitrary JSON. Ids and
 * payloads are validated and every error is sanitized.
 */

import type { SourceAccessPolicy } from "../../types";
import type { DurableIntakeStore, DurableJobRow, CreateJobInputDurable, DurableEventRow } from "./durableTypes";
import { StaleWorkerError, IntegrityError } from "./durableTypes";
import type { IntakeInputStore } from "../types";
import { runDurableJob, claimNextAndRun } from "./worker";

export interface ServiceDeps {
  store: DurableIntakeStore;
  inputStore: IntakeInputStore;
  policyFor: (sourceId: string) => SourceAccessPolicy | undefined;
  now: () => string;
  /** Service-to-service secret (from env/secret manager — never sent to the browser). */
  internalToken: string;
  parseModeFor: (mode: string) => "csv" | "jsonl" | "json";
}

export interface ServiceRequest {
  headers: Record<string, string>;
  params?: Record<string, string>;
  body?: unknown;
  /** The authenticated caller identity (from the auth layer), used for requestedBy grounding. */
  callerId?: string;
}
export interface ServiceResponse { status: number; body: unknown; }

export class UnauthorizedError extends Error { constructor() { super("unauthorized"); this.name = "UnauthorizedError"; } }
export class BadRequestError extends Error { constructor(m: string) { super(m); this.name = "BadRequestError"; } }

const ID_RE = /^[A-Za-z0-9_-]{1,80}$/;

/** Constant-ish check that the caller presented the internal token. */
export function requireServiceAuth(req: ServiceRequest, token: string): void {
  const presented = req.headers["x-internal-token"] ?? req.headers["X-Internal-Token"];
  if (!token || presented !== token) throw new UnauthorizedError();
}

function validId(id: string | undefined, name: string): string {
  if (!id || !ID_RE.test(id)) throw new BadRequestError(`invalid ${name}`);
  return id;
}
function sanitize(err: unknown): string { return (err instanceof Error ? err.message : "error").replace(/\s+/g, " ").slice(0, 160); }

async function guard(fn: () => Promise<ServiceResponse> | ServiceResponse): Promise<ServiceResponse> {
  try { return await fn(); }
  catch (e) {
    if (e instanceof UnauthorizedError) return { status: 401, body: { error: "unauthorized" } };
    if (e instanceof BadRequestError) return { status: 400, body: { error: sanitize(e) } };
    if (e instanceof StaleWorkerError) return { status: 409, body: { error: "stale_worker" } };
    if (e instanceof IntegrityError) return { status: 409, body: { error: "integrity" } };
    return { status: 500, body: { error: sanitize(e) } };   // sanitized, never leaks internals/secrets
  }
}

const publicJob = (j: DurableJobRow) => ({ ...j, /* input_ref is a gs:// reference, never a signed/public URL */ });

export function createIntakeService(deps: ServiceDeps) {
  const workerId = () => `worker_${Math.abs(hashStr(deps.now()))}`; // deterministic-ish per call window

  return {
    /** POST /internal/intake/jobs (create from an authorized input). */
    createJob: (req: ServiceRequest): Promise<ServiceResponse> => guard(() => {
      requireServiceAuth(req, deps.internalToken);
      const b = (req.body ?? {}) as Partial<CreateJobInputDurable>;
      if (!b.id || !b.sourceId || !b.inputRef || !b.inputHash || !b.mode) throw new BadRequestError("missing job fields");
      validId(b.id, "id"); validId(b.sourceId, "sourceId");
      const job = deps.store.createJob({ ...(b as CreateJobInputDurable), requestedBy: req.callerId ?? "service" }, deps.now());
      return { status: 201, body: publicJob(job) };
    }),

    claimNextRun: (req: ServiceRequest): Promise<ServiceResponse> => guard(async () => {
      requireServiceAuth(req, deps.internalToken);
      const claimed = deps.store.claimNextJob(workerId(), 60, deps.now());
      if (!claimed) return { status: 204, body: null };
      const res = await runDurableJob({ store: deps.store, inputStore: deps.inputStore, jobId: claimed.id, workerId: workerId(), policy: deps.policyFor(claimed.sourceId), nowIso: deps.now(), parseMode: deps.parseModeFor(claimed.mode) });
      return { status: 200, body: { jobId: res.job.id, status: res.status } };
    }),

    run: (req: ServiceRequest): Promise<ServiceResponse> => guard(async () => {
      requireServiceAuth(req, deps.internalToken);
      const jobId = validId(req.params?.jobId, "jobId");
      const job = deps.store.getJob(jobId); if (!job) throw new BadRequestError("unknown job");
      const res = await runDurableJob({ store: deps.store, inputStore: deps.inputStore, jobId, workerId: workerId(), policy: deps.policyFor(job.sourceId), nowIso: deps.now(), parseMode: deps.parseModeFor(job.mode) });
      return { status: 200, body: { jobId, status: res.status } };
    }),

    pause: (req: ServiceRequest): Promise<ServiceResponse> => guard(() => { requireServiceAuth(req, deps.internalToken); const id = validId(req.params?.jobId, "jobId"); return { status: 200, body: publicJob(deps.store.requestPause(id, deps.now())) }; }),
    resume: (req: ServiceRequest): Promise<ServiceResponse> => guard(() => { requireServiceAuth(req, deps.internalToken); const id = validId(req.params?.jobId, "jobId"); return { status: 200, body: publicJob(deps.store.requestResume(id, deps.now())) }; }),
    cancel: (req: ServiceRequest): Promise<ServiceResponse> => guard(() => { requireServiceAuth(req, deps.internalToken); const id = validId(req.params?.jobId, "jobId"); return { status: 200, body: publicJob(deps.store.requestCancel(id, deps.now())) }; }),

    getJob: (req: ServiceRequest): Promise<ServiceResponse> => guard(() => {
      requireServiceAuth(req, deps.internalToken);
      const id = validId(req.params?.jobId, "jobId"); const job = deps.store.getJob(id);
      return job ? { status: 200, body: publicJob(job) } : { status: 404, body: { error: "not_found" } };
    }),
    getEvents: (req: ServiceRequest): Promise<ServiceResponse> => guard(() => {
      requireServiceAuth(req, deps.internalToken);
      const id = validId(req.params?.jobId, "jobId");
      const events: DurableEventRow[] = deps.store.listEvents(id).slice(0, 500); // bounded
      return { status: 200, body: { events } };
    }),
  };
}

function hashStr(s: string): number { let h = 0; for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0; return h; }

export { claimNextAndRun };
