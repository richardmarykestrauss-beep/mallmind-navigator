/**
 * mallmind-intake-worker — durable intake worker entrypoint (Cloud Run).
 *
 * A SEPARATE Cloud Run service from `mallmind-backend-dev`, deployed from its own
 * image (Dockerfile.worker) so the API service is untouched by this sprint. It is
 * deployed with --no-allow-unauthenticated: there is no public worker endpoint.
 *
 * Boundaries this process enforces at startup, failing closed on each:
 *   - fixture-only mode (refuses any job or object not marked a generated fixture)
 *   - an explicit bucket allowlist (no allowlist → refuses to start)
 *   - an explicit invoker allowlist for /internal/*
 * It never publishes: a run only ever stages drafts for human review.
 */

import "dotenv/config";
import express from "express";
import helmet from "helmet";
import { createClient } from "@supabase/supabase-js";

import { loadIntakeWorkerConfig, describeConfig, ConfigError } from "./services/intake/config";
import { createLogger } from "./services/intake/logging";
import { InternalAuthenticator } from "./services/intake/authInternal";
import { SupabaseIntakeGateway } from "./services/intake/supabaseGateway";
import { RealGcsBackend } from "./services/intake/realGcsBackend";
import { buildInternalIntakeRouter, buildHealthRouter } from "./routes/internalIntake";
import { PostgresDurableIntakeStore } from "@/lib/fabric/intake/durable/postgresStore";
import { GcsInputStore } from "@/lib/fabric/intake/durable/gcsInputStore";

// ── Config (fail closed before anything is wired) ─────────────────────────────
let config;
try {
  config = loadIntakeWorkerConfig(process.env);
} catch (err) {
  const message = err instanceof ConfigError ? err.message : "Worker configuration failed.";
  console.log(JSON.stringify({ severity: "ERROR", message: `[startup] ${message}`, component: "intake-worker" }));
  process.exit(1);
}

const logger = createLogger(config.logLevel);

// One Cloud Run instance is one worker. K_REVISION + an instance-unique suffix keeps
// the id stable for this process and distinct across concurrent instances, so leases
// and reclaim behave correctly when the service scales past one.
const workerId = `w_${(process.env.K_REVISION ?? "local").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40)}_${process.pid}`;

// ── Dependencies ─────────────────────────────────────────────────────────────
const supabase = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const store = new PostgresDurableIntakeStore({
  gateway: new SupabaseIntakeGateway(supabase),
  fixtureOnlyMode: config.fixtureOnlyMode,
});

// GcsInputStore keeps the allowlist / traversal / generation / size / hash checks;
// RealGcsBackend only does the ADC-authenticated network I/O behind them.
const inputStore = new GcsInputStore(
  new RealGcsBackend({ fixtureOnlyMode: config.fixtureOnlyMode }),
  { allowedBuckets: config.allowedBuckets },
);

const auth = new InternalAuthenticator({
  expectedAudience: config.expectedAudience,
  allowedInvokers: config.allowedInvokers,
});

// ── App ──────────────────────────────────────────────────────────────────────
const app = express();
app.use(helmet());
// Deliberately NO cors(): this service is called service-to-service, never by a
// browser. CORS is not authentication, and serving no CORS headers keeps that plain.
app.use(express.json({ limit: "256kb" }));   // control-plane payloads only; data arrives via GCS

app.use("/health", buildHealthRouter(config));
app.use("/internal/intake", buildInternalIntakeRouter({ config, store, inputStore, auth, logger, workerId, now: () => new Date().toISOString() }));

app.use((_req, res) => res.status(404).json({ error: "not_found" }));

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error("unhandled worker error", { error_code: "internal" });   // never log the error object
  void err;
  res.status(500).json({ error: "internal" });
});

const PORT = parseInt(process.env.PORT ?? "8080", 10);
app.listen(PORT, () => {
  logger.info("intake worker started", { worker_id: workerId, ...describeConfig(config) });
  if (!config.fixtureOnlyMode) {
    logger.warn("fixture-only mode is DISABLED — the worker will accept non-fixture jobs", { fixture_only_mode: false });
  }
});

export default app;
