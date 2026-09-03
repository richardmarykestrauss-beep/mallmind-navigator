import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";

import { buildCorsOptions, describeCorsConfig } from "./lib/cors.js";
import { createRateLimiter } from "./lib/rateLimit.js";

import healthRouter          from "./routes/health.js";
import detectActiveMallRouter from "./routes/detectActiveMall.js";
import recommendProductsRouter from "./routes/recommendProducts.js";
import buildRouteRouter      from "./routes/buildRoute.js";
import indoorMapModelRouter  from "./routes/indoorMapModel.js";
import assistantRouter       from "./routes/assistant.js";
import adminStatsRouter      from "./routes/adminStats.js";
import adminVerifyProductRouter from "./routes/adminVerifyProduct.js";
import analyticsEventRouter      from "./routes/analyticsEvent.js";
import priceCorrectionsRouter    from "./routes/priceCorrections.js";
import rewardsRouter             from "./routes/rewards.js";
import mallDataCompilerRouter    from "./routes/mallDataCompiler.js";
import dataGuardianRouter        from "./routes/dataGuardian.js";
import dataBotsRouter            from "./routes/dataBots.js";
import mallResearchBatchesRouter from "./routes/mallResearchBatches.js";
import mallIntelligenceRouter    from "./routes/mallIntelligence.js";
import mapFactoryRouter          from "./routes/mapFactory.js";
import retailObservationsAdminRouter from "./routes/retailObservationsAdmin.js";
import adminIntakeProxyRouter from "./routes/adminIntakeProxy.js";

// ── Validate required environment variables at startup ────────────────────────
const REQUIRED_ENV = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];
const missing = REQUIRED_ENV.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`[startup] Missing required environment variables: ${missing.join(", ")}`);
  console.error("[startup] Copy .env.example to .env and fill in the values.");
  process.exit(1);
}

// AI assistant uses Vertex AI via Application Default Credentials — no API key needed.

// ── App ───────────────────────────────────────────────────────────────────────
const app = express();

// Cloud Run sits behind one Google front end, which appends the real client IP
// as the LAST X-Forwarded-For entry. Trusting exactly one hop makes req.ip that
// value (unspoofable by the client) — required for per-IP rate limiting.
app.set("trust proxy", 1);

// Security headers
app.use(helmet());

// CORS — environment-controlled exact-match allowlist (see lib/cors.ts).
// The allowlist governs ALL environments (no wildcard fork). Configure the
// deployed backend with CORS_ORIGINS to include the production domain plus any
// approved preview/localhost origins. Never a "*" policy; credentials stay off.
app.use(cors(buildCorsOptions(process.env)));

// Body parsing
app.use(express.json({ limit: "1mb" }));

// Request logging
app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// ── Public-pilot abuse protection ─────────────────────────────────────────────
// The shopper experience stays login-free, so cost-bearing public endpoints are
// rate limited per client IP instead. /assistant is the expensive one (every
// request is a Gemini call): a short burst window plus an hourly ceiling. The
// other unauthenticated write endpoints get a lighter shared limit.
const assistantBurst  = createRateLimiter({ windowMs: 60_000,        max: 20,  label: "assistant requests" });
const assistantHourly = createRateLimiter({ windowMs: 60 * 60_000,   max: 200, label: "assistant requests this hour" });
const publicWrites    = createRateLimiter({ windowMs: 60_000,        max: 60,  label: "requests" });

// ── Routes ────────────────────────────────────────────────────────────────────
app.use("/health",              healthRouter);
app.use("/detect-active-mall",  publicWrites.middleware, detectActiveMallRouter);
app.use("/recommend-products",  publicWrites.middleware, recommendProductsRouter);
app.use("/build-route",         publicWrites.middleware, buildRouteRouter);
app.use("/indoor-map-model",   indoorMapModelRouter);
app.use("/assistant",           assistantBurst.middleware, assistantHourly.middleware, assistantRouter);
app.use("/admin-stats",         adminStatsRouter);
app.use("/admin/mall-data",       mallDataCompilerRouter);
app.use("/admin/data-guardian",   dataGuardianRouter);
app.use("/admin/data-bots",       dataBotsRouter);
app.use("/admin/mall-research",     mallResearchBatchesRouter);
app.use("/admin/mall-intelligence", mallIntelligenceRouter);
app.use("/admin/map-factory",      mapFactoryRouter);
app.use("/admin/retail-observations", retailObservationsAdminRouter);
app.use("/admin/intake",              adminIntakeProxyRouter);
app.use("/admin",                 adminVerifyProductRouter);
app.use("/analytics",           publicWrites.middleware, analyticsEventRouter);
app.use("/price-corrections",   publicWrites.middleware, priceCorrectionsRouter);
app.use("/rewards",             publicWrites.middleware, rewardsRouter);

// 404 catch-all
app.use((_req, res) => {
  res.status(404).json({ error: "Route not found" });
});

// Global error handler
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("[unhandled error]", err);
  res.status(500).json({ error: "Internal server error" });
});

// ── Start ─────────────────────────────────────────────────────────────────────
// Cloud Run injects PORT=8080. Default to 8080 for local dev too.
const PORT = parseInt(process.env.PORT ?? "8080", 10);

app.listen(PORT, () => {
  console.log(`[startup] MallMind Cloud Backend running on port ${PORT}`);
  console.log(`[startup] Environment: ${process.env.NODE_ENV ?? "development"}`);
  console.log(`[startup] ${describeCorsConfig(process.env)}`);
  console.log(`[startup] Supabase URL: ${process.env.SUPABASE_URL}`);
  console.log(`[startup] Gemini AI: ${process.env.GEMINI_API_KEY ? "configured" : "NOT configured"}`);
  console.log(`[startup] Routes: GET /health | POST /detect-active-mall | POST /recommend-products | POST /build-route | POST /assistant | GET /admin-stats | POST /admin/verify-product-price | GET+POST /admin/retail-observations | POST /admin/retail-observations/import-csv | POST /analytics/event | POST /price-corrections/report | GET+POST /price-corrections/admin | GET+POST /admin/mall-data/sources | GET+POST /admin/mall-data/findings | POST /admin/mall-data/findings/:id/review | POST /admin/data-guardian/review | POST /admin/data-bots/source-research | POST /admin/data-bots/extract-finding | POST /admin/data-bots/detect-duplicates | POST /admin/data-bots/review-assistant | POST /admin/data-bots/plan-apply | GET+POST /admin/mall-research/batches | GET /admin/mall-research/batches/:id | POST /admin/mall-research/batches/:id/items | PATCH /admin/mall-research/batches/:id/items/:itemId | PATCH /admin/mall-research/batches/:id/status | POST /admin/mall-research/items/:id/run-source-research | POST /admin/mall-research/items/:id/run-finding-extractor | POST /admin/mall-research/items/:id/run-data-guardian | POST /admin/mall-research/items/:id/run-duplicate-check | POST /admin/mall-research/items/:id/run-admin-review | POST /admin/mall-research/items/:id/run-full-pipeline`);
});

export default app;
