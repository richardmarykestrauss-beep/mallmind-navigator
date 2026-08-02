/**
 * /internal/* — the durable intake worker's private control surface.
 *
 * Deployed on `mallmind-intake-worker-dev` with --no-allow-unauthenticated, so
 * Cloud Run IAM rejects unauthenticated callers before Node sees them. Every route
 * here ALSO verifies a Google-signed identity token in-process (see authInternal).
 *
 * Only /health is unauthenticated, and it reveals nothing but liveness + posture.
 *
 * Nothing on this surface publishes anything. Running a job stages drafts for human
 * review; approval and publication remain separate, human-gated steps elsewhere.
 */

import { Router, type Request, type Response } from "express";
import type { IntakeWorkerConfig } from "../services/intake/config";
import type { Logger } from "../services/intake/logging";
import { InternalAuthenticator, InternalAuthError } from "../services/intake/authInternal";
import type { PostgresDurableIntakeStore } from "@/lib/fabric/intake/durable/postgresStore";
import { DbError } from "@/lib/fabric/intake/durable/postgresStore";
import { StaleWorkerError, IntegrityError } from "@/lib/fabric/intake/durable/durableTypes";
import { GcsRefError } from "@/lib/fabric/intake/durable/gcsInputStore";
import type { IntakeInputStore } from "@/lib/fabric/intake/types";
import { runDurableJob } from "@/lib/fabric/intake/durable/worker";
import { promoteDrafts, type StageRpcCaller, type PromotionSummary } from "../services/intake/retailStagingPromotion";

export interface InternalIntakeDeps {
  config: IntakeWorkerConfig;
  store: PostgresDurableIntakeStore;
  inputStore: IntakeInputStore;
  auth: InternalAuthenticator;
  logger: Logger;
  /** Stable per-instance worker id (one Cloud Run instance = one worker). */
  workerId: string;
  now: () => string;
  /** Optional canonical-funnel promotion (Sprint 3A.3): when BOTH are set, staged drafts are
   *  promoted into pending observations via the stage_retail_feed_observation RPC. When unset,
   *  the worker behaves exactly as before (stages durable drafts only). */
  stagingGateway?: StageRpcCaller;
  stagingActorId?: string | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Map any failure to a status + stable code. The message is never the raw error. */
function toHttpError(err: unknown): { status: number; code: string; message: string } {
  if (err instanceof InternalAuthError) return { status: 401, code: "unauthorized", message: "Unauthorized." };
  if (err instanceof StaleWorkerError) return { status: 409, code: "stale_worker", message: "Another worker owns this job." };
  if (err instanceof IntegrityError) return { status: 409, code: "integrity", message: "Durable state failed an integrity check." };
  if (err instanceof GcsRefError) {
    const status = err.code === "fixture_only" ? 422 : err.code === "not_found" ? 404 : 400;
    return { status, code: err.code, message: err.message };
  }
  if (err instanceof DbError) {
    if (err.code === "fixture_only") return { status: 422, code: "fixture_only", message: err.message };
    if (err.code === "unknown_job") return { status: 404, code: "unknown_job", message: "Unknown job." };
    if (err.code === "invalid_id" || err.code === "invalid_worker") return { status: 400, code: err.code, message: err.message };
    return { status: err.retryable ? 503 : 500, code: err.code, message: "Database operation failed." };
  }
  return { status: 500, code: "internal", message: "Internal error." };
}

export function buildInternalIntakeRouter(deps: InternalIntakeDeps): Router {
  const router = Router();
  const { config, store, inputStore, auth, logger, workerId } = deps;

  /** Authenticate, then run the handler, then translate any failure safely. */
  const handle = (
    name: string,
    fn: (req: Request, caller: { email: string }) => Promise<{ status: number; body: unknown }>,
  ) => async (req: Request, res: Response): Promise<void> => {
    const started = Date.now();
    let caller: { email: string };
    try {
      caller = await auth.authenticate(req.headers as Record<string, unknown>);
    } catch (err) {
      const e = toHttpError(err);
      logger.warn("internal request rejected", { event_type: name, error_code: e.code });
      res.status(e.status).json({ error: e.code, message: e.message });
      return;
    }
    try {
      const out = await fn(req, caller);
      logger.info("internal request completed", { event_type: name, duration_ms: Date.now() - started, status: String(out.status) });
      res.status(out.status).json(out.body);
    } catch (err) {
      const e = toHttpError(err);
      logger.error("internal request failed", {
        event_type: name, error_code: e.code, duration_ms: Date.now() - started,
        retryable: err instanceof DbError ? err.retryable : false,
      });
      res.status(e.status).json({ error: e.code, message: e.message });
    }
  };

  const jobIdOf = (req: Request): string => {
    const id = String(req.params.jobId ?? "");
    if (!UUID_RE.test(id)) throw new DbError("invalid_id", "Invalid jobId.", false);
    return id;
  };

  const parseModeFor = (mode: string): "csv" | "jsonl" | "json" => {
    if (mode === "csv" || mode === "jsonl" || mode === "json") return mode;
    throw new DbError("invalid_mode", `Unsupported intake mode: ${mode}`, false);
  };

  /**
   * The dev crash hook — a REAL process exit after a committed chunk, not a
   * simulated throw, so reclaim is exercised against genuine interruption. It is
   * unreachable unless fixture-only mode is on (enforced again in config loading).
   */
  const crashHooks = config.devCrashAfterChunk === null || !config.fixtureOnlyMode ? undefined : {
    onAfterCommit: (chunkIndex: number) => {
      if (chunkIndex !== config.devCrashAfterChunk) return;
      logger.warn("dev crash hook: exiting after committed chunk", { event_type: "intake.dev_crash", chunk_index: chunkIndex, worker_id: workerId });
      process.exit(137);   // abrupt; the lease must expire and another worker must reclaim
    },
  };

  const runJob = async (jobId: string, sourceId: string, mode: string, traceId: string) => {
    const jobLog = logger.with({ job_id: jobId, worker_id: workerId, trace_id: traceId });
    const started = Date.now();
    jobLog.info("durable run started", { event_type: "intake.job_started" });

    const result = await runDurableJob({
      store, inputStore, jobId, workerId,
      // Dev fixture jobs carry no per-source policy override; the engine applies its
      // own defaults. Nothing here can widen what a source is allowed to do.
      policy: undefined,
      nowIso: deps.now(),
      parseMode: parseModeFor(mode),
      leaseSeconds: config.leaseSeconds,
      chunkSize: config.chunkSize,
      hooks: crashHooks,
    });

    const reconciliation = await store.reconcile(jobId);
    if (!reconciliation.reconciles) {
      // A counter mismatch is a BLOCKER: report it, never round it off to a warning.
      jobLog.error("durable counters do not reconcile", { event_type: "intake.reconcile_failed", reconciles: false, processed_rows: reconciliation.processedRows, staged_drafts: reconciliation.stagedDrafts });
    }

    jobLog.info("durable run finished", {
      event_type: "intake.job_finished", status: result.status, duration_ms: Date.now() - started,
      processed_rows: reconciliation.processedRows, valid_rows: reconciliation.validRows,
      rejected_rows: reconciliation.rejectedRows, duplicate_rows: reconciliation.duplicateRows,
      conflict_rows: reconciliation.conflictRows, staged_drafts: reconciliation.stagedDrafts,
      committed_chunks: reconciliation.committedChunks, reconciles: reconciliation.reconciles,
      chunk_count: reconciliation.committedChunks,
    });

    // ── Canonical funnel promotion (Sprint 3A.3) ──────────────────────────────
    // Promote this run's validated drafts into pending observations via the RPC (the sole
    // row-level staging authority). Optional + additive: only runs when configured. The RPC
    // remains the identity/replay/rights/lifecycle authority; nothing here writes products or
    // inserts observations directly. A per-row failure stays retryable and never aborts.
    let promotion: PromotionSummary | null = null;
    if (deps.stagingGateway && deps.stagingActorId && result.drafts.length > 0) {
      promotion = await promoteDrafts(result.drafts, deps.stagingGateway, {
        actorId: deps.stagingActorId, intakeJobId: jobId, sourceFileName: null,
      });
      jobLog.info("canonical staging promotion finished", {
        event_type: "intake.promotion_finished",
        promoted_total: promotion.total, promoted_staged: promotion.staged, promoted_replayed: promotion.replayed,
        promoted_conflict: promotion.conflict, promoted_mapping_required: promotion.mappingRequired,
        promoted_rejected: promotion.rejected, promoted_errors: promotion.errors,
      });
    }
    return { jobId, status: result.status, reconciliation, sourceId, promotion };
  };

  // ── Create ─────────────────────────────────────────────────────────────────
  router.post("/jobs", handle("intake.create_job", async (req, caller) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const job = await store.createJob({
      id: "",                                    // Postgres generates the id
      sourceId: String(b.sourceId ?? ""),
      inputRef: String(b.inputRef ?? ""),
      inputHash: String(b.inputHash ?? ""),
      inputContentType: String(b.inputContentType ?? "text/csv"),
      mode: String(b.mode ?? "csv") as "csv",
      // Grounded in the AUTHENTICATED caller — never taken from the request body.
      requestedBy: caller.email,
      estimatedRows: b.estimatedRows === undefined ? null : Number(b.estimatedRows),
      totalBytes: b.totalBytes === undefined ? null : Number(b.totalBytes),
      isFixture: b.isFixture === true,
      traceId: typeof b.traceId === "string" ? b.traceId : null,
    }, deps.now());
    return { status: 201, body: { job } };
  }));

  // ── Run / claim-next ───────────────────────────────────────────────────────
  router.post("/jobs/claim-next", handle("intake.claim_next", async () => {
    const claimed = await store.claimNextJob(workerId, config.leaseSeconds, deps.now());
    if (!claimed) return { status: 204, body: null };
    return { status: 200, body: await runJob(claimed.id, claimed.sourceId, claimed.mode, `trace_${claimed.id}`) };
  }));

  router.post("/jobs/:jobId/run", handle("intake.run", async (req) => {
    const jobId = jobIdOf(req);
    const job = await store.getJob(jobId);
    if (!job) return { status: 404, body: { error: "unknown_job" } };
    return { status: 200, body: await runJob(jobId, job.sourceId, job.mode, `trace_${jobId}`) };
  }));

  // ── Control ────────────────────────────────────────────────────────────────
  router.post("/jobs/:jobId/pause",  handle("intake.pause",  async (req) => ({ status: 200, body: { job: await store.requestPause(jobIdOf(req), deps.now()) } })));
  router.post("/jobs/:jobId/resume", handle("intake.resume", async (req) => ({ status: 200, body: { job: await store.requestResume(jobIdOf(req), deps.now()) } })));
  router.post("/jobs/:jobId/cancel", handle("intake.cancel", async (req) => ({ status: 200, body: { job: await store.requestCancel(jobIdOf(req), deps.now()) } })));

  // ── Read ───────────────────────────────────────────────────────────────────
  router.get("/jobs", handle("intake.list_jobs", async () => ({ status: 200, body: { jobs: await store.listJobs() } })));

  router.get("/jobs/:jobId", handle("intake.get_job", async (req) => {
    const jobId = jobIdOf(req);
    const job = await store.getJob(jobId);
    if (!job) return { status: 404, body: { error: "unknown_job" } };
    const [chunks, quarantine, reconciliation] = await Promise.all([
      store.listChunks(jobId), store.listQuarantine(jobId), store.reconcile(jobId),
    ]);
    // input_ref stays a gs:// reference. No signed URL is ever minted here.
    return { status: 200, body: { job, chunks, quarantine, reconciliation } };
  }));

  router.get("/jobs/:jobId/events", handle("intake.get_events", async (req) => ({
    status: 200, body: { events: await store.listEvents(jobIdOf(req)) },
  })));

  router.get("/jobs/:jobId/reconciliation", handle("intake.reconcile", async (req) => ({
    status: 200, body: { reconciliation: await store.reconcile(jobIdOf(req)) },
  })));

  return router;
}

/** Liveness only. No auth, no secrets, no job data — just posture. */
export function buildHealthRouter(config: IntakeWorkerConfig): Router {
  const router = Router();
  router.get("/", (_req, res) => {
    res.json({
      status: "ok",
      service: "mallmind-intake-worker",
      fixtureOnlyMode: config.fixtureOnlyMode,
      mode: config.fixtureOnlyMode ? "Generated fixture — no retailer data" : "unrestricted",
    });
  });
  return router;
}
