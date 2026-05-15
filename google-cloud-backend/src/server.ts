import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";

import healthRouter          from "./routes/health.js";
import detectActiveMallRouter from "./routes/detectActiveMall.js";
import recommendProductsRouter from "./routes/recommendProducts.js";
import buildRouteRouter      from "./routes/buildRoute.js";
import assistantRouter       from "./routes/assistant.js";
import adminStatsRouter      from "./routes/adminStats.js";
import adminVerifyProductRouter from "./routes/adminVerifyProduct.js";
import analyticsEventRouter      from "./routes/analyticsEvent.js";
import priceCorrectionsRouter    from "./routes/priceCorrections.js";
import mallDataCompilerRouter    from "./routes/mallDataCompiler.js";
import dataGuardianRouter        from "./routes/dataGuardian.js";
import dataBotsRouter            from "./routes/dataBots.js";
import mallResearchBatchesRouter from "./routes/mallResearchBatches.js";
import mallIntelligenceRouter    from "./routes/mallIntelligence.js";

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

// Security headers
app.use(helmet());

// CORS — in production, restrict this to your frontend domain
app.use(
  cors({
    origin: process.env.NODE_ENV === "production"
      ? (process.env.ALLOWED_ORIGIN ?? false)
      : "*",
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// Body parsing
app.use(express.json({ limit: "1mb" }));

// Request logging
app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// ── Routes ────────────────────────────────────────────────────────────────────
app.use("/health",              healthRouter);
app.use("/detect-active-mall",  detectActiveMallRouter);
app.use("/recommend-products",  recommendProductsRouter);
app.use("/build-route",         buildRouteRouter);
app.use("/assistant",           assistantRouter);
app.use("/admin-stats",         adminStatsRouter);
app.use("/admin/mall-data",       mallDataCompilerRouter);
app.use("/admin/data-guardian",   dataGuardianRouter);
app.use("/admin/data-bots",       dataBotsRouter);
app.use("/admin/mall-research",     mallResearchBatchesRouter);
app.use("/admin/mall-intelligence", mallIntelligenceRouter);
app.use("/admin",                 adminVerifyProductRouter);
app.use("/analytics",           analyticsEventRouter);
app.use("/price-corrections",   priceCorrectionsRouter);

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
  console.log(`[startup] Supabase URL: ${process.env.SUPABASE_URL}`);
  console.log(`[startup] Gemini AI: ${process.env.GEMINI_API_KEY ? "configured" : "NOT configured"}`);
  console.log(`[startup] Routes: GET /health | POST /detect-active-mall | POST /recommend-products | POST /build-route | POST /assistant | GET /admin-stats | POST /admin/verify-product-price | POST /analytics/event | POST /price-corrections/report | GET+POST /price-corrections/admin | GET+POST /admin/mall-data/sources | GET+POST /admin/mall-data/findings | POST /admin/mall-data/findings/:id/review | POST /admin/data-guardian/review | POST /admin/data-bots/source-research | POST /admin/data-bots/extract-finding | POST /admin/data-bots/detect-duplicates | POST /admin/data-bots/review-assistant | POST /admin/data-bots/plan-apply | GET+POST /admin/mall-research/batches | GET /admin/mall-research/batches/:id | POST /admin/mall-research/batches/:id/items | PATCH /admin/mall-research/batches/:id/items/:itemId | PATCH /admin/mall-research/batches/:id/status | POST /admin/mall-research/items/:id/run-source-research | POST /admin/mall-research/items/:id/run-finding-extractor | POST /admin/mall-research/items/:id/run-data-guardian | POST /admin/mall-research/items/:id/run-duplicate-check | POST /admin/mall-research/items/:id/run-admin-review | POST /admin/mall-research/items/:id/run-full-pipeline`);
});

export default app;
