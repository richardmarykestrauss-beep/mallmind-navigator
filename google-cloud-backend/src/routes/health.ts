import { Router, Request, Response } from "express";

const router = Router();

/**
 * GET /health
 * Health check used by Cloud Run to confirm the service is alive.
 * Returns 200 with build metadata — no database calls.
 */
router.get("/", (_req: Request, res: Response) => {
  res.json({
    status: "ok",
    service: "mallmind-cloud-backend",
    version: "0.1.0",
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV ?? "unknown",
    google_cloud_project: process.env.GOOGLE_CLOUD_PROJECT ?? "not-set",
  });
});

export default router;
