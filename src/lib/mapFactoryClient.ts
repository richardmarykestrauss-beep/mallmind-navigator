/**
 * mapFactoryClient.ts — Sprint 15
 *
 * Typed frontend client for the Map Factory REST API.
 * All calls require a valid admin bearer token.
 */

// ── Base URL ──────────────────────────────────────────────────────────────────

const _RAW = (import.meta.env.VITE_GOOGLE_BACKEND_URL as string | undefined) ?? "";
const _BASE = _RAW.replace(/\/+$/, "");

function getGoogleBackendUrl() { return _BASE; }

// ── Types ─────────────────────────────────────────────────────────────────────

export type MapFactoryStage =
  | "source_discovery"
  | "asset_harvest"
  | "ai_extraction"
  | "layout_intelligence"
  | "floorplan_generation"
  | "route_graph_build"
  | "qa_review"
  | "publish";

export type MapFactoryJobStatus = "pending" | "running" | "paused" | "complete" | "failed";

export interface MapFactoryJob {
  id:              string;
  mall_id:         string;
  status:          MapFactoryJobStatus;
  stage:           MapFactoryStage;
  readiness_score: number;
  notes:           string | null;
  created_by:      string | null;
  created_at:      string;
  updated_at:      string;
  malls?:          { name: string };
}

export interface MapFactoryNextStep {
  nextStage:   string;
  actionLabel: string;
  canSkip:     boolean;
}

export interface MapFactoryQaCheck {
  check_name: string;
  passed:     boolean;
  severity:   "blocking" | "warning" | "info";
  detail:     string;
}

export interface MapFactoryQaReport {
  id:              string;
  readiness_score: number;
  passed:          boolean;
  blocking_issues: number;
  warnings:        number;
  checks?:         MapFactoryQaCheck[];
  created_at:      string;
}

export interface MapFactoryFloorPlan {
  id:          string;
  floor_label: string;
  version:     number;
  status:      string;
  created_at:  string;
}

export interface MapFactoryJobDetail {
  job:             MapFactoryJob;
  sources:         unknown[];
  assets:          unknown[];
  extractions:     unknown[];
  layout_models:   unknown[];
  floor_plans:     MapFactoryFloorPlan[];
  latest_qa:       MapFactoryQaReport | null;
  latest_publish:  unknown | null;
  next_step:       MapFactoryNextStep;
}

// ── Base fetch helper ─────────────────────────────────────────────────────────

async function apiFetch<T>(
  path:        string,
  method:      "GET" | "POST" | "PATCH",
  accessToken: string,
  body?:       Record<string, unknown>,
): Promise<T> {
  const url = `${getGoogleBackendUrl()}/admin/map-factory${path}`;
  const resp = await fetch(url, {
    method,
    headers: {
      "Content-Type":  "application/json",
      Authorization:   `Bearer ${accessToken}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: resp.statusText }));
    throw new Error((err as { error?: string }).error ?? `HTTP ${resp.status}`);
  }
  return resp.json() as Promise<T>;
}

// ── Public API ────────────────────────────────────────────────────────────────

/** List all jobs, optionally filtered by mall_id */
export function listMapFactoryJobs(accessToken: string, mallId?: string) {
  const qs = mallId ? `?mall_id=${encodeURIComponent(mallId)}` : "";
  return apiFetch<{ ok: boolean; jobs: MapFactoryJob[] }>(`/queue${qs}`, "GET", accessToken);
}

/** Get full detail for a single job */
export function getMapFactoryJob(jobId: string, accessToken: string) {
  return apiFetch<{ ok: boolean } & MapFactoryJobDetail>(`/jobs/${encodeURIComponent(jobId)}`, "GET", accessToken);
}

/** Create a new job for a mall */
export function createMapFactoryJob(mallId: string, notes: string | undefined, accessToken: string) {
  return apiFetch<{ ok: boolean; job: MapFactoryJob }>("/jobs", "POST", accessToken, { mall_id: mallId, notes });
}

/** Stage 1: Discover sources */
export function discoverSources(jobId: string, accessToken: string) {
  return apiFetch<{ ok: boolean; sources_discovered: number; total_found: number }>(
    `/jobs/${encodeURIComponent(jobId)}/discover-sources`, "POST", accessToken);
}

/** Stage 2: Harvest sources */
export function harvestSources(jobId: string, accessToken: string) {
  return apiFetch<{ ok: boolean; total: number; harvested: number; skipped: number; failed: number }>(
    `/jobs/${encodeURIComponent(jobId)}/harvest`, "POST", accessToken);
}

/** Stage 3: AI extract all assets */
export function extractAssets(jobId: string, accessToken: string) {
  return apiFetch<{ ok: boolean; total: number; extracted: number; failed: number }>(
    `/jobs/${encodeURIComponent(jobId)}/extract`, "POST", accessToken);
}

/** Stage 4: Build layout model */
export function buildLayoutModel(jobId: string, floorLabel: string | undefined, accessToken: string) {
  return apiFetch<{ ok: boolean; mergedCount: number; conflictCount: number; coverageScore: number }>(
    `/jobs/${encodeURIComponent(jobId)}/build-layout`, "POST", accessToken,
    floorLabel ? { floor_label: floorLabel } : {});
}

/** Stage 5: Generate floor plan */
export function generateFloorPlan(jobId: string, floorLabel: string, accessToken: string) {
  return apiFetch<{ ok: boolean; floorPlanId: string }>(
    `/jobs/${encodeURIComponent(jobId)}/generate-floorplan`, "POST", accessToken, { floor_label: floorLabel });
}

/** Stage 6: Build route graph */
export function buildRouteGraph(jobId: string, floorLabel: string | undefined, accessToken: string) {
  return apiFetch<{
    ok:                   boolean;
    created_nodes:        number;
    updated_nodes:        number;
    skipped_nodes:        number;
    repaired_floor_nodes: number;
    created_edges:        number;
    skipped_edges:        number;
    node_type_counts:     Record<string, number>;
    floor_counts:         Record<string, number>;
    floors_processed:     string[];
    validation_issues:    string[];
  }>(
    `/jobs/${encodeURIComponent(jobId)}/build-route-graph`, "POST", accessToken,
    floorLabel ? { floor_label: floorLabel } : {});
}

/** Repair stale floor labels (null/G/L1/L2/unknown) for Map Factory-generated nodes */
export function repairNodeFloors(jobId: string, accessToken: string, floorLabel?: string) {
  return apiFetch<{
    ok:              boolean;
    repaired:        number;
    skipped:         number;
    protected_nodes: number;
    mall_id:         string;
    floor_label:     string;
  }>(
    `/jobs/${encodeURIComponent(jobId)}/repair-node-floors`, "POST", accessToken,
    floorLabel ? { floor_label: floorLabel } : {});
}

/** Stage 7: Run QA checks */
export function runQaChecks(jobId: string, accessToken: string) {
  return apiFetch<{ ok: boolean; readinessScore: number; passed: boolean; checks: MapFactoryQaCheck[]; blockingIssues: number; warnings: number }>(
    `/jobs/${encodeURIComponent(jobId)}/run-qa`, "POST", accessToken);
}

/** Stage 8: Publish */
export function publishJob(jobId: string, accessToken: string) {
  return apiFetch<{ ok: boolean; nodesPublished: number; edgesPublished: number; floorPlansPublished: number }>(
    `/jobs/${encodeURIComponent(jobId)}/publish`, "POST", accessToken);
}

/** Run Next Best Step CTA */
export function runNextStep(jobId: string, accessToken: string, floorLabel?: string) {
  return apiFetch<{ ok: boolean; next_stage: string; detail: unknown }>(
    `/jobs/${encodeURIComponent(jobId)}/next-step`, "POST", accessToken,
    floorLabel ? { floor_label: floorLabel } : {});
}
