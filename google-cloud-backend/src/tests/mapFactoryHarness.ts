/**
 * mapFactoryHarness.ts — Sprint 15
 *
 * End-to-end test harness for all Map Factory services.
 * Runs in-memory with a mock Supabase stub — no real DB required.
 *
 * Usage:
 *   npx ts-node --esm src/tests/mapFactoryHarness.ts
 *
 * Output: PASS / FAIL per test suite, summary at end.
 */

import { classifySourceUrl, discoverSourcesForMall } from "../services/mapFactory/mapFactorySourceDiscoveryService.js";
import { harvestSource } from "../services/mapFactory/mapFactoryHarvestService.js";
import { getNextBestStep, publishJob } from "../services/mapFactory/mapFactoryPublishService.js";
import { canonicalNodeType, nodeTypeFromLabel } from "../services/mapFactory/mapFactoryNodeTypeMapper.js";
import { buildRouteGraph, repairNodeFloors, isStaleFloor, isRepairable } from "../services/mapFactory/mapFactoryRouteGraphBuilderService.js";
import { normalizeFloorLabel, resolveFloorLabel } from "../services/mapFactory/mapFactoryFloorLabelService.js";
import { getProviderStatus, getExtractionProviderChain, getActiveExtractionProvider } from "../services/mapFactory/mapFactoryProviderRegistry.js";
import { isGoogleAiEnabled, isGeminiConfigured, isVisionConfigured } from "../services/mapFactory/googleAiProviderService.js";
import { extractAsset } from "../services/mapFactory/mapFactoryExtractionService.js";

// ── Colours ───────────────────────────────────────────────────────────────────
const GREEN  = "\x1b[32m";
const RED    = "\x1b[31m";
const YELLOW = "\x1b[33m";
const RESET  = "\x1b[0m";
const BOLD   = "\x1b[1m";

// ── Tiny assertion helpers ────────────────────────────────────────────────────
let passed = 0, failed = 0;

function assert(condition: boolean, name: string, detail?: string) {
  if (condition) {
    console.log(`  ${GREEN}✓${RESET} ${name}`);
    passed++;
  } else {
    console.log(`  ${RED}✗${RESET} ${name}${detail ? `  — ${detail}` : ""}`);
    failed++;
  }
}

function assertEqual<T>(actual: T, expected: T, name: string) {
  assert(actual === expected, name, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function section(title: string) {
  console.log(`\n${BOLD}${YELLOW}▶ ${title}${RESET}`);
}

// ── Mock Supabase builder ─────────────────────────────────────────────────────

interface MockRow { [k: string]: unknown }

function makeMockSupabase(tables: Record<string, MockRow[]>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase: any = {
    from: (tableName: string) => {
      // Auto-create the table array so inserts into new tables are tracked
      if (!tables[tableName]) tables[tableName] = [];
      const rows = tables[tableName];
      const q: Record<string, unknown> = {};

      let _eqFilters:  Array<{ key: string; val: unknown }> = [];
      let _isFilters:  Array<{ key: string; val: null }>    = [];
      let _data: MockRow | MockRow[] | null = null;
      let _error: null | { message: string } = null;
      let _selectCols = "*";
      let _single = false;
      let _maybeSingle = false;
      let _countMode = false;
      let _insertPayload: MockRow | null = null;

      /** Apply all accumulated filters to a row array. */
      function applyFilters(source: MockRow[]) {
        return source.filter((r) => {
          const eqOk = _eqFilters.every((f) => r[f.key] === f.val);
          // .is("col", null) → match rows where r[col] is null or undefined
          const isOk = _isFilters.every((f) => r[f.key] == null);
          return eqOk && isOk;
        });
      }

      const chain = {
        select: (cols = "*", opts?: { count?: string; head?: boolean }) => {
          _selectCols = cols;
          if (opts?.count === "exact") _countMode = true;
          return chain;
        },
        eq:    (key: string, val: unknown) => { _eqFilters.push({ key, val }); return chain; },
        is:    (key: string, val: null)    => { _isFilters.push({ key, val }); return chain; },
        in:    (_key: string, _vals: unknown[]) => chain,
        order: () => chain,
        limit: () => chain,
        single: () => {
          _single = true;
          const hit = applyFilters(rows)[0] ?? null;
          _data = hit;
          _error = hit ? null : { message: `Row not found in ${tableName}` };
          return { data: _data, error: _error };
        },
        maybeSingle: () => {
          _maybeSingle = true;
          const hit = applyFilters(rows)[0] ?? null;
          return { data: hit, error: null };
        },
        insert: (payload: MockRow) => {
          _insertPayload = payload;
          const newRow = { id: `mock-${Date.now()}-${Math.random().toString(36).slice(2)}`, ...payload };
          rows.push(newRow);
          return {
            select: () => ({
              single: () => ({ data: newRow, error: null }),
            }),
            error: null,
          };
        },
        update: (updatePayload: MockRow) => {
          // Accumulate eq filters, then apply all on terminal call or await
          const updateFilters: Array<{ key: string; val: unknown }> = [];
          function applyUpdate() {
            for (const row of rows) {
              const match = updateFilters.every((f) => row[f.key] === f.val);
              if (match) Object.assign(row, updatePayload);
            }
          }
          const updateChain: Record<string, unknown> = {
            eq: (eqKey: string, eqVal: unknown) => {
              updateFilters.push({ key: eqKey, val: eqVal });
              return updateChain; // supports chained .eq().eq()
            },
            error: null,
            then: (resolve: (v: { error: null }) => void) => {
              applyUpdate();
              resolve({ error: null });
            },
          };
          return updateChain;
        },
        then: (resolve: (v: { data: MockRow[]; error: null; count?: number }) => void) => {
          const matched = applyFilters(rows);
          resolve({ data: matched, error: null, count: matched.length });
        },
      };

      // Make chain awaitable
      Object.assign(chain, {
        [Symbol.asyncIterator]: undefined,
        then: (resolve: (v: { data: MockRow[]; error: null; count?: number }) => void) => {
          const matched = applyFilters(rows);
          resolve({ data: matched, error: null, count: matched.length });
        },
      });

      // Make auth stub
      q.auth = {
        getUser: async (_token: string) => ({ data: { user: { id: "user-1" } }, error: null }),
      };

      return chain;
    },
    auth: {
      getUser: async (_token: string) => ({ data: { user: { id: "user-1" } }, error: null }),
    },
  };

  return supabase;
}

// ═════════════════════════════════════════════════════════════════════════════
// RUN ALL SUITES
// ═════════════════════════════════════════════════════════════════════════════

(async () => {

// ═════════════════════════════════════════════════════════════════════════════
// SUITE 1 — Source Discovery Service
// ═════════════════════════════════════════════════════════════════════════════

section("Source Discovery — classifySourceUrl");

{
  const r1 = classifySourceUrl("https://example.com/evacuation-map.png");
  assertEqual(r1.source_type, "evacuation_map_image", "evacuation URL classified correctly");
  assert(r1.confidence >= 0.7, "evacuation confidence ≥ 0.70");

  const r2 = classifySourceUrl("https://example.com/directory.pdf");
  assertEqual(r2.source_type, "directory_pdf", "PDF URL classified correctly");

  const r3 = classifySourceUrl("https://maps.google.com/maps?q=sandton");
  assertEqual(r3.source_type, "google_maps_screenshot", "Google Maps URL classified correctly");

  const r4 = classifySourceUrl("https://instagram.com/p/abc123");
  assertEqual(r4.source_type, "social_media_image", "Instagram URL classified correctly");

  const r5 = classifySourceUrl("https://mallofafrica.co.za");
  assertEqual(r5.source_type, "mall_website", "Generic URL defaults to mall_website");

  const r6 = classifySourceUrl("https://leasing.example.com/floor-plan");
  assertEqual(r6.source_type, "lease_plan", "Leasing URL classified correctly");
}

section("Source Discovery — discoverSourcesForMall");

{
  const tables: Record<string, MockRow[]> = {
    mall_map_assets: [
      { id: "asset-1", mall_id: "mall-1", asset_url: "https://cdn/map.jpg", asset_type: "image", floor_label: "Level 3", notes: "evacuation map" },
      { id: "asset-2", mall_id: "mall-1", asset_url: "https://cdn/floor.pdf", asset_type: "pdf",   floor_label: "Level 5", notes: "directory" },
    ],
  };
  const supabase = makeMockSupabase(tables);

  const discovered = await discoverSourcesForMall("mall-1", supabase);
  assert(discovered.length >= 2, `Discovered ${discovered.length} sources (≥2 expected)`);
  assert(discovered.some((s) => s.source_type === "evacuation_map_image"), "Evacuation map source detected");
  assert(discovered.some((s) => s.source_type === "directory_pdf"), "Directory PDF source detected");
}

// ═════════════════════════════════════════════════════════════════════════════
// SUITE 2 — Harvest Service
// ═════════════════════════════════════════════════════════════════════════════

section("Harvest Service — harvestSource (URL-based)");

{
  const tables: Record<string, MockRow[]> = {
    map_factory_assets: [],
    map_factory_sources: [{ id: "src-1", job_id: "job-1", status: "discovered" }],
  };
  const supabase = makeMockSupabase(tables);

  const r1 = await harvestSource({
    jobId:    "job-1",
    mallId:   "mall-1",
    sourceId: "src-1",
    url:      "https://cdn/image.jpg",
    supabase,
  });
  assert(r1.ok,       "URL harvest returns ok=true");
  assert(!r1.duplicate, "First harvest is not a duplicate");
  assert(r1.hash != null, "Hash returned");

  // Same URL again → duplicate
  const r2 = await harvestSource({
    jobId:    "job-1",
    mallId:   "mall-1",
    sourceId: "src-1",
    url:      "https://cdn/image.jpg",
    supabase,
  });
  assert(r2.ok,        "Duplicate harvest returns ok=true");
  assert(r2.duplicate, "Duplicate flag is true for identical URL");
}

section("Harvest Service — harvestSource (existing asset)");

{
  const tables: Record<string, MockRow[]> = {
    mall_map_assets:     [{ id: "asset-99", asset_url: "https://cdn/existing.jpg", asset_type: "image" }],
    map_factory_assets:  [],
    map_factory_sources: [{ id: "src-2", job_id: "job-2", status: "discovered" }],
  };
  const supabase = makeMockSupabase(tables);

  const r = await harvestSource({
    jobId:    "job-2",
    mallId:   "mall-1",
    sourceId: "src-2",
    url:      null,
    assetId:  "asset-99",
    supabase,
  });
  assert(r.ok,           "Asset-based harvest returns ok=true");
  assert(!r.duplicate,   "First asset harvest is not a duplicate");
}

// ═════════════════════════════════════════════════════════════════════════════
// SUITE 3 — Publish Service — getNextBestStep
// ═════════════════════════════════════════════════════════════════════════════

section("Publish Service — getNextBestStep");

{
  const s1 = getNextBestStep("source_discovery", 0);
  assertEqual(s1.nextStage, "asset_harvest", "source_discovery → asset_harvest");

  const s2 = getNextBestStep("qa_review", 85);
  assert(s2.actionLabel.toLowerCase().includes("publish"), "qa_review with score 85 → publish label");

  const s3 = getNextBestStep("qa_review", 50);
  assert(s3.actionLabel.toLowerCase().includes("fix"), "qa_review with score 50 → fix label");

  const s4 = getNextBestStep("publish", 100);
  assertEqual(s4.nextStage, "complete", "publish → complete");
}

// ═════════════════════════════════════════════════════════════════════════════
// SUITE 4 — Node Type Mapper + Route Graph Builder
// ═════════════════════════════════════════════════════════════════════════════

section("Node Type Mapper — canonicalNodeType");

{
  // anchor_type-level resolution
  assertEqual(canonicalNodeType("shop",     "Game"),                  "shop",     "shop anchor_type → shop");
  assertEqual(canonicalNodeType("entrance", "Entrance 13"),           "entrance", "entrance anchor_type → entrance");
  assertEqual(canonicalNodeType("parking",  "Level 5 North East Parking"), "parking", "parking anchor_type → parking");
  assertEqual(canonicalNodeType("landmark", "Town Square"),           "landmark", "landmark anchor_type → landmark");
  assertEqual(canonicalNodeType("corridor_node", "Main Corridor"),   "corridor", "corridor_node anchor_type → corridor");
  assertEqual(canonicalNodeType("escalator", "Up Escalator"),        "escalator","escalator anchor_type → escalator");
  assertEqual(canonicalNodeType("lift",      "Lift A"),              "lift",     "lift anchor_type → lift");
  assertEqual(canonicalNodeType("toilet",    "Restroom"),            "toilet",   "toilet anchor_type → toilet");
  assertEqual(canonicalNodeType("stairs",    "Stairwell 1"),         "stairs",   "stairs anchor_type → stairs");
}

section("Node Type Mapper — nodeTypeFromLabel (SA retailers + heuristics)");

{
  assertEqual(nodeTypeFromLabel("Edgars"),     "shop",    "Edgars → shop");
  assertEqual(nodeTypeFromLabel("H&M"),        "shop",    "H&M → shop");
  assertEqual(nodeTypeFromLabel("Woolworths"), "shop",    "Woolworths → shop");
  assertEqual(nodeTypeFromLabel("Checkers"),   "shop",    "Checkers → shop");
  assertEqual(nodeTypeFromLabel("Clicks"),     "shop",    "Clicks → shop");
  assertEqual(nodeTypeFromLabel("entrance north"), "entrance", "entrance north → entrance");
  assertEqual(nodeTypeFromLabel("Parking Deck P3"), "parking", "Parking Deck P3 → parking");
  // Food Court maps to "landmark" — "food_court" is not in the DB CHECK constraint (mall_nodes.type)
  assertEqual(nodeTypeFromLabel("Food Court"),  "landmark",   "Food Court → landmark");
  assertEqual(nodeTypeFromLabel("Toilet Block"), "toilet",    "Toilet Block → toilet");
}

section("Route Graph Builder — Mall of Africa mock layout");

{
  // Mock layout model with SA store labels + entrance + parking
  const MOA_ANCHORS = [
    { label: "Game",         anchor_type: "shop",     x_percent: 20, y_percent: 30, confidence_score: 0.9 },
    { label: "Edgars",       anchor_type: "shop",     x_percent: 40, y_percent: 30, confidence_score: 0.85 },
    { label: "Woolworths",   anchor_type: "shop",     x_percent: 60, y_percent: 30, confidence_score: 0.9 },
    { label: "Entrance North", anchor_type: "entrance", x_percent: 50, y_percent: 5,  confidence_score: 0.95 },
    { label: "Entrance South", anchor_type: "entrance", x_percent: 50, y_percent: 95, confidence_score: 0.9 },
    { label: "Parking P1",   anchor_type: "parking",  x_percent: 10, y_percent: 50, confidence_score: 0.8 },
    { label: "Main Corridor A", anchor_type: "corridor_node", x_percent: 40, y_percent: 50, confidence_score: 0.85 },
    { label: "Main Corridor B", anchor_type: "corridor_node", x_percent: 60, y_percent: 50, confidence_score: 0.85 },
  ];

  const moaTables: Record<string, MockRow[]> = {
    map_factory_layout_models: [
      { id: "model-1", job_id: "job-moa", mall_id: "mall-moa", floor_label: "Level 1", status: "complete", merged_anchors: MOA_ANCHORS },
    ],
    mall_nodes: [],
    mall_edges: [],
  };

  const moaSupabase = makeMockSupabase(moaTables);
  const result = await buildRouteGraph("job-moa", "mall-moa", null, moaSupabase);

  assert(result.ok, `buildRouteGraph ok=true (error: ${result.error ?? "none"})`);

  const shopCount     = moaTables.mall_nodes.filter((n) => n.type === "shop").length;
  const entranceCount = moaTables.mall_nodes.filter((n) => n.type === "entrance").length;
  const edgeCount     = moaTables.mall_edges.length;

  assert(shopCount >= 3,     `≥3 shop nodes created (got ${shopCount})`);
  assert(entranceCount >= 1, `≥1 entrance node created (got ${entranceCount})`);
  assert(edgeCount >= 2,     `≥2 edges created (got ${edgeCount})`);
  assert((result.floors_processed ?? []).includes("Level 1"), "Level 1 in floors_processed");
  assert((result.created_nodes + result.repaired_floor_nodes) >= 6,
    `≥6 nodes created/repaired total (got ${result.created_nodes} + ${result.repaired_floor_nodes})`);
}

section("Route Graph Builder — fallback spine (no corridor nodes)");

{
  const SPINE_ANCHORS = [
    { label: "Nike",   anchor_type: "shop", x_percent: 15, y_percent: 50, confidence_score: 0.9 },
    { label: "Zara",   anchor_type: "shop", x_percent: 45, y_percent: 50, confidence_score: 0.9 },
    { label: "H&M",    anchor_type: "shop", x_percent: 75, y_percent: 50, confidence_score: 0.9 },
    { label: "Main Entrance", anchor_type: "entrance", x_percent: 50, y_percent: 5, confidence_score: 0.95 },
    // Intentionally NO corridor_node anchors
  ];

  const spineTables: Record<string, MockRow[]> = {
    map_factory_layout_models: [
      { id: "model-spine", job_id: "job-spine", mall_id: "mall-spine", floor_label: "Ground", status: "complete", merged_anchors: SPINE_ANCHORS },
    ],
    mall_nodes: [],
    mall_edges: [],
  };

  const spineSupabase = makeMockSupabase(spineTables);
  const sr = await buildRouteGraph("job-spine", "mall-spine", null, spineSupabase);

  assert(sr.ok, `fallback spine buildRouteGraph ok=true (error: ${sr.error ?? "none"})`);

  const spineNodes = spineTables.mall_nodes.filter((n) => n.type === "corridor");
  const spineEdges = spineTables.mall_edges.length;

  assert(spineNodes.length >= 3, `≥3 synthetic spine (corridor) nodes created (got ${spineNodes.length})`);
  assert(spineEdges >= 2,        `≥2 edges created via fallback spine (got ${spineEdges})`);
  assert(sr.created_nodes >= 4,  `≥4 nodes total (shops + entrance + spine) (got ${sr.created_nodes})`);
}

// ═════════════════════════════════════════════════════════════════════════════
// SUITE 5 — Floor Label Service + Floor Preservation End-to-End
// ═════════════════════════════════════════════════════════════════════════════

section("Floor Label Service — normalizeFloorLabel");

{
  // Well-formed labels must be preserved verbatim
  assertEqual(normalizeFloorLabel("Level 5"),      "Level 5",      "Level 5 preserved");
  assertEqual(normalizeFloorLabel("Level 3"),      "Level 3",      "Level 3 preserved");
  assertEqual(normalizeFloorLabel("Lower Level"),  "Lower Level",  "Lower Level preserved");
  assertEqual(normalizeFloorLabel("Upper Level"),  "Upper Level",  "Upper Level preserved");
  assertEqual(normalizeFloorLabel("Ground Floor"), "Ground Floor", "Ground Floor preserved");

  // Short codes should expand
  assertEqual(normalizeFloorLabel("G"),   "Ground Floor", "G expands to Ground Floor");
  assertEqual(normalizeFloorLabel("L1"),  "Level 1",      "L1 expands to Level 1");
  assertEqual(normalizeFloorLabel("l2"),  "Level 2",      "l2 expands to Level 2 (case-insensitive)");
  assertEqual(normalizeFloorLabel("B1"),  "Basement 1",   "B1 expands to Basement 1");
  assertEqual(normalizeFloorLabel("5"),   "Level 5",      "\"5\" expands to Level 5");

  // Null-like values return fallback
  assertEqual(normalizeFloorLabel(null),       "Unknown", "null → Unknown");
  assertEqual(normalizeFloorLabel(undefined),  "Unknown", "undefined → Unknown");
  assertEqual(normalizeFloorLabel(""),         "Unknown", "empty string → Unknown");
  assertEqual(normalizeFloorLabel("unknown"),  "Unknown", "\"unknown\" → Unknown");
  assertEqual(normalizeFloorLabel("NULL"),     "Unknown", "\"NULL\" → Unknown");

  // Custom fallback
  assertEqual(normalizeFloorLabel(null, "Ground Floor"), "Ground Floor", "custom fallback used when null");

  // "Level 3" must NOT be converted to any short code
  assert(normalizeFloorLabel("Level 3") !== "L3", "Level 3 not shortened to L3");
  assert(normalizeFloorLabel("Level 5") !== "L5", "Level 5 not shortened to L5");
  assert(normalizeFloorLabel("Level 5") !== "G",  "Level 5 not converted to G");
}

section("Floor Label Service — resolveFloorLabel");

{
  // Model label wins when valid
  assertEqual(resolveFloorLabel("Level 3", "Level 5"), "Level 3", "model label wins over job label");
  assertEqual(resolveFloorLabel("Ground Floor", null),  "Ground Floor", "model label used when job null");

  // Fall back to job label when model is null/unknown
  assertEqual(resolveFloorLabel(null,      "Level 5"), "Level 5", "null model → job label");
  assertEqual(resolveFloorLabel("unknown", "Level 5"), "Level 5", "unknown model → job label");
  assertEqual(resolveFloorLabel("",        "Level 5"), "Level 5", "empty model → job label");

  // Both null → Unknown
  assertEqual(resolveFloorLabel(null, null),       "Unknown", "both null → Unknown");
  assertEqual(resolveFloorLabel(undefined, null),  "Unknown", "both undefined → Unknown");
}

section("Route Graph Builder — floor_label preservation with job floor_label");

{
  // Layout model has floor_label = null; job floor_label = "Level 5"
  // Nodes must be created with floor = "Level 5", not NULL or "unknown"
  const LEVEL5_ANCHORS = [
    { label: "Game",            anchor_type: "shop",     x_percent: 20, y_percent: 30, confidence_score: 0.9 },
    { label: "Woolworths",      anchor_type: "shop",     x_percent: 50, y_percent: 30, confidence_score: 0.9 },
    { label: "Entrance Main",   anchor_type: "entrance", x_percent: 50, y_percent: 5,  confidence_score: 0.95 },
    { label: "Level 5 Corridor A", anchor_type: "corridor_node", x_percent: 40, y_percent: 50, confidence_score: 0.8 },
  ];

  const l5Tables: Record<string, MockRow[]> = {
    map_factory_layout_models: [
      // floor_label deliberately null to simulate missing/unset model floor
      { id: "model-l5", job_id: "job-l5", mall_id: "mall-l5", floor_label: null, status: "complete", merged_anchors: LEVEL5_ANCHORS },
    ],
    mall_nodes: [],
    mall_edges: [],
  };

  const l5Supabase = makeMockSupabase(l5Tables);
  // Pass "Level 5" as the explicit job floor_label
  const l5Result = await buildRouteGraph("job-l5", "mall-l5", "Level 5", l5Supabase);

  assert(l5Result.ok, `Level 5 graph build ok (error: ${l5Result.error ?? "none"})`);

  const nullFloorNodes = l5Tables.mall_nodes.filter((n) => n.floor == null);
  const level5Nodes    = l5Tables.mall_nodes.filter((n) => n.floor === "Level 5");

  assert(nullFloorNodes.length === 0, `No NULL floor nodes (got ${nullFloorNodes.length})`);
  assert(level5Nodes.length >= 3,     `≥3 nodes stamped "Level 5" (got ${level5Nodes.length})`);
  assert(l5Result.floors_processed?.includes("Level 5"), "floors_processed includes \"Level 5\"");
}

section("Route Graph Builder — explicit label not silently overridden");

{
  // Layout model has floor_label = "Level 3"; job also passes "Level 3"
  // Nodes must NOT be converted to G/L1/L2 by any normalisation
  const L3_ANCHORS = [
    { label: "Edgars",         anchor_type: "shop",     x_percent: 30, y_percent: 40, confidence_score: 0.9 },
    { label: "Truworths",      anchor_type: "shop",     x_percent: 60, y_percent: 40, confidence_score: 0.85 },
    { label: "Entrance East",  anchor_type: "entrance", x_percent: 80, y_percent: 5,  confidence_score: 0.9 },
    { label: "Level 3 Main Corridor", anchor_type: "corridor_node", x_percent: 50, y_percent: 50, confidence_score: 0.8 },
  ];

  const l3Tables: Record<string, MockRow[]> = {
    map_factory_layout_models: [
      { id: "model-l3", job_id: "job-l3", mall_id: "mall-l3", floor_label: "Level 3", status: "complete", merged_anchors: L3_ANCHORS },
    ],
    mall_nodes: [],
    mall_edges: [],
  };

  const l3Supabase = makeMockSupabase(l3Tables);
  const l3Result = await buildRouteGraph("job-l3", "mall-l3", "Level 3", l3Supabase);

  assert(l3Result.ok, `Level 3 graph build ok (error: ${l3Result.error ?? "none"})`);

  const wrongFloorNodes = l3Tables.mall_nodes.filter((n) => n.floor !== "Level 3");
  const level3Nodes     = l3Tables.mall_nodes.filter((n) => n.floor === "Level 3");

  assert(wrongFloorNodes.length === 0,
    `No nodes with wrong floor (got ${wrongFloorNodes.length} non-Level-3: ${wrongFloorNodes.map((n) => n.floor).join(", ")})`);
  assert(level3Nodes.length >= 3, `≥3 nodes stamped "Level 3" (got ${level3Nodes.length})`);
}

section("Publish Service — edge count from mall_edges (not mall_node_edges)");

{
  // Set up a mall with pre-existing nodes and edges, a passing QA report,
  // and a draft floor plan.  publishJob must return edgesPublished = 43.
  const EDGE_COUNT = 43;

  const pubTables: Record<string, MockRow[]> = {
    map_factory_qa_reports: [
      { id: "qa-1", job_id: "job-pub", readiness_score: 90, passed: true, created_at: new Date().toISOString() },
    ],
    mall_nodes: Array.from({ length: 24 }, (_, i) => ({
      id: `node-${i}`, mall_id: "mall-pub", name: `Node ${i}`, type: "shop", floor: "Level 5",
    })),
    mall_edges: Array.from({ length: EDGE_COUNT }, (_, i) => ({
      id: `edge-${i}`, mall_id: "mall-pub", from_node_id: `node-${i % 24}`, to_node_id: `node-${(i + 1) % 24}`,
    })),
    map_factory_generated_floorplans: [
      { id: "fp-1", job_id: "job-pub", status: "draft" },
    ],
    map_factory_publish_records: [],
    map_factory_jobs: [
      { id: "job-pub", mall_id: "mall-pub", status: "paused", stage: "publish", readiness_score: 90 },
    ],
  };

  const pubSupabase = makeMockSupabase(pubTables);
  const pubResult = await publishJob("job-pub", "mall-pub", "Test Admin", pubSupabase);

  assert(pubResult.ok, `publishJob ok=true (error: ${pubResult.error ?? "none"})`);
  assert(pubResult.nodesPublished === 24,         `nodesPublished = 24 (got ${pubResult.nodesPublished})`);
  assert(pubResult.edgesPublished === EDGE_COUNT,  `edgesPublished = ${EDGE_COUNT} (got ${pubResult.edgesPublished})`);
  assert(pubResult.floorPlansPublished === 1,      `floorPlansPublished = 1 (got ${pubResult.floorPlansPublished})`);
}

// ═════════════════════════════════════════════════════════════════════════════
// SUITE 6 — Node Floor Repair (Sprint 15.5)
// ═════════════════════════════════════════════════════════════════════════════

section("Route Graph Builder — helpers (isStaleFloor / isRepairable)");

{
  // Stale floor detection
  assert(isStaleFloor(null),         "null → stale");
  assert(isStaleFloor(undefined),    "undefined → stale");
  assert(isStaleFloor(""),           "empty string → stale");
  assert(isStaleFloor("unknown"),    "\"unknown\" → stale");
  assert(isStaleFloor("G"),          "\"G\" → stale");
  assert(isStaleFloor("L1"),         "\"L1\" → stale");
  assert(isStaleFloor("L2"),         "\"L2\" → stale");
  assert(isStaleFloor("B1"),         "\"B1\" → stale");
  assert(!isStaleFloor("Level 5"),   "\"Level 5\" → NOT stale");
  assert(!isStaleFloor("Level 3"),   "\"Level 3\" → NOT stale");
  assert(!isStaleFloor("Ground Floor"), "\"Ground Floor\" → NOT stale");
  assert(!isStaleFloor("Lower Level"),  "\"Lower Level\" → NOT stale");

  // Repairability
  assert(isRepairable({ source: null }),           "null source → repairable");
  assert(isRepairable({ source: "" }),             "empty source → repairable");
  assert(isRepairable({ source: "map_factory" }),  "map_factory → repairable");
  assert(!isRepairable({ source: "geodirectory" }), "geodirectory → NOT repairable");
  assert(!isRepairable({ source: "admin" }),       "admin → NOT repairable");
  assert(!isRepairable({ source: "manual" }),      "manual → NOT repairable");
}

section("Route Graph Builder — repair stale floors on re-run");

{
  // Pre-existing nodes with stale floors (simulating old dev data)
  const REPAIR_ANCHORS = [
    { label: "Game",          anchor_type: "shop",     x_percent: 20, y_percent: 30, confidence_score: 0.9 },
    { label: "Edgars",        anchor_type: "shop",     x_percent: 40, y_percent: 30, confidence_score: 0.85 },
    { label: "Entrance North",anchor_type: "entrance", x_percent: 50, y_percent: 5,  confidence_score: 0.95 },
    { label: "Main Corridor", anchor_type: "corridor_node", x_percent: 50, y_percent: 50, confidence_score: 0.8 },
  ];

  const repairTables: Record<string, MockRow[]> = {
    map_factory_layout_models: [
      { id: "model-rep", job_id: "job-rep", mall_id: "mall-rep", floor_label: null, status: "complete",
        merged_anchors: REPAIR_ANCHORS },
    ],
    // Pre-existing nodes with stale floors (old dev data)
    mall_nodes: [
      { id: "n-game",    mall_id: "mall-rep", name: "Game",          type: "shop",     floor: null, x_coordinate: 20, y_coordinate: 30, source: null },
      { id: "n-edgars",  mall_id: "mall-rep", name: "Edgars",        type: "entrance", floor: "G",  x_coordinate: 40, y_coordinate: 30, source: "map_factory" },
      { id: "n-corridor",mall_id: "mall-rep", name: "Main Corridor", type: "shop",     floor: "L1", x_coordinate: 50, y_coordinate: 50, source: null },
    ],
    mall_edges: [],
  };

  const repairSupabase = makeMockSupabase(repairTables);
  const repResult = await buildRouteGraph("job-rep", "mall-rep", "Level 5", repairSupabase);

  assert(repResult.ok, `repair graph build ok (error: ${repResult.error ?? "none"})`);

  // 3 anchors matched stale nodes → repaired; 1 new → created (Entrance North)
  assert(repResult.repaired_floor_nodes >= 3,
    `≥3 nodes repaired (got ${repResult.repaired_floor_nodes})`);
  assert(repResult.created_nodes >= 1,
    `≥1 new node (Entrance North) created (got ${repResult.created_nodes})`);

  // All nodes must now be on "Level 5"
  const stillStale = repairTables.mall_nodes.filter((n) => isStaleFloor(n.floor as string | null));
  assert(stillStale.length === 0,
    `No stale floor nodes remaining (got ${stillStale.length}: ${stillStale.map((n) => `${n.name}→${n.floor}`).join(", ")})`);

  // floor_counts must record Level 5
  assert((repResult.floor_counts["Level 5"] ?? 0) >= 3,
    `floor_counts["Level 5"] ≥ 3 (got ${repResult.floor_counts["Level 5"] ?? 0})`);

  // floors_processed must include Level 5
  assert(repResult.floors_processed.includes("Level 5"),
    "floors_processed includes \"Level 5\"");
}

section("Route Graph Builder — protected nodes not overwritten");

{
  const ADMIN_ANCHORS = [
    { label: "Admin Store",   anchor_type: "shop",     x_percent: 30, y_percent: 30, confidence_score: 0.9 },
    { label: "Geodir Shop",   anchor_type: "shop",     x_percent: 50, y_percent: 30, confidence_score: 0.9 },
    { label: "Map Store",     anchor_type: "shop",     x_percent: 70, y_percent: 30, confidence_score: 0.9 },
    { label: "Entrance Main", anchor_type: "entrance", x_percent: 50, y_percent: 5,  confidence_score: 0.95 },
    { label: "Hub Corridor",  anchor_type: "corridor_node", x_percent: 50, y_percent: 50, confidence_score: 0.8 },
  ];

  const adminTables: Record<string, MockRow[]> = {
    map_factory_layout_models: [
      { id: "model-adm", job_id: "job-adm", mall_id: "mall-adm", floor_label: null, status: "complete",
        merged_anchors: ADMIN_ANCHORS },
    ],
    mall_nodes: [
      // Protected — must not be modified
      { id: "n-admin",  mall_id: "mall-adm", name: "Admin Store",  type: "shop", floor: null, x_coordinate: 30, y_coordinate: 30, source: "admin" },
      { id: "n-geodir", mall_id: "mall-adm", name: "Geodir Shop",  type: "shop", floor: "G",  x_coordinate: 50, y_coordinate: 30, source: "geodirectory" },
      // Safe to repair
      { id: "n-map",    mall_id: "mall-adm", name: "Map Store",    type: "shop", floor: "L2", x_coordinate: 70, y_coordinate: 30, source: "map_factory" },
    ],
    mall_edges: [],
  };

  const adminSupabase = makeMockSupabase(adminTables);
  const admResult = await buildRouteGraph("job-adm", "mall-adm", "Level 5", adminSupabase);

  assert(admResult.ok, `admin-protected graph build ok (error: ${admResult.error ?? "none"})`);

  // Admin and geodirectory nodes must keep their original floor
  const adminNode  = adminTables.mall_nodes.find((n) => n.name === "Admin Store");
  const geodirNode = adminTables.mall_nodes.find((n) => n.name === "Geodir Shop");
  assert(adminNode?.floor  == null,  `Admin Store floor unchanged (null) — got ${adminNode?.floor}`);
  assert(geodirNode?.floor === "G",  `Geodir Shop floor unchanged (G) — got ${geodirNode?.floor}`);

  // Map Store (map_factory source) must be repaired
  const mapNode = adminTables.mall_nodes.find((n) => n.name === "Map Store");
  assert(mapNode?.floor === "Level 5", `Map Store repaired to "Level 5" — got ${mapNode?.floor}`);

  // Exactly 1 repaired (Map Store only)
  assert(admResult.repaired_floor_nodes === 1,
    `repaired_floor_nodes = 1 (got ${admResult.repaired_floor_nodes})`);

  // Protected nodes skipped (Admin Store + Geodir Shop)
  assert(admResult.skipped_nodes >= 2,
    `≥2 skipped_nodes for protected nodes (got ${admResult.skipped_nodes})`);

  // New nodes: Entrance Main + Hub Corridor (no duplicates for Admin/Geodir)
  assert(admResult.created_nodes >= 2,
    `≥2 new nodes created (Entrance + Corridor) without duplicating protected (got ${admResult.created_nodes})`);
}

section("repairNodeFloors — standalone repair endpoint function");

{
  const repairFloorTables: Record<string, MockRow[]> = {
    mall_nodes: [
      // Stale + repairable
      { id: "r1", mall_id: "mall-rf", name: "Game",        floor: null, source: null },
      { id: "r2", mall_id: "mall-rf", name: "Woolworths",  floor: "G",  source: "map_factory" },
      // Stale + protected
      { id: "r3", mall_id: "mall-rf", name: "Menlyn Shop", floor: "L1", source: "geodirectory" },
      { id: "r4", mall_id: "mall-rf", name: "Admin Node",  floor: null, source: "admin" },
      // Already correct floor — skipped
      { id: "r5", mall_id: "mall-rf", name: "Entrance A",  floor: "Level 5", source: null },
    ],
  };

  const rfSupabase = makeMockSupabase(repairFloorTables);
  const rfResult   = await repairNodeFloors("mall-rf", "Level 5", rfSupabase);

  assert(rfResult.ok, `repairNodeFloors ok (error: ${rfResult.error ?? "none"})`);
  assert(rfResult.repaired === 2,        `repaired = 2 (got ${rfResult.repaired})`);
  assert(rfResult.protected_nodes === 2, `protected_nodes = 2 (got ${rfResult.protected_nodes})`);
  assert(rfResult.skipped === 1,         `skipped = 1 (already correct floor) (got ${rfResult.skipped})`);

  // Verify actual DB values changed for repaired nodes
  const game      = repairFloorTables.mall_nodes.find((n) => n.name === "Game");
  const woolworths = repairFloorTables.mall_nodes.find((n) => n.name === "Woolworths");
  assert(game?.floor      === "Level 5", `Game floor repaired to "Level 5" (got ${game?.floor})`);
  assert(woolworths?.floor === "Level 5", `Woolworths floor repaired to "Level 5" (got ${woolworths?.floor})`);

  // Protected nodes must be unchanged
  const menlyn = repairFloorTables.mall_nodes.find((n) => n.name === "Menlyn Shop");
  const admin  = repairFloorTables.mall_nodes.find((n) => n.name === "Admin Node");
  assert(menlyn?.floor === "L1",  `Menlyn Shop floor unchanged "L1" (got ${menlyn?.floor})`);
  assert(admin?.floor  == null,   `Admin Node floor unchanged null (got ${admin?.floor})`);
}

// ═════════════════════════════════════════════════════════════════════════════
// SUITE 7 — Sprint 16: Google AI Provider Registry & Extraction Cache
// ═════════════════════════════════════════════════════════════════════════════

section("Suite 7 — Provider Registry: defaults with no env vars");

{
  // In the harness environment MAP_FACTORY_ENABLE_GOOGLE_AI is not set
  // All Google providers should report not configured
  const status = getProviderStatus();

  assert(status.mock === true, "mock provider always ready");
  assert(isGoogleAiEnabled() === false || status.gemini_vision_extraction === false,
    "gemini_vision_extraction off when ENABLE_GOOGLE_AI not set or GEMINI_API_KEY absent");
  assert(isGoogleAiEnabled() === false || status.google_vision_ocr === false,
    "google_vision_ocr off when ENABLE_GOOGLE_AI not set or VISION_API_KEY absent");
  assert(isGoogleAiEnabled() === false || status.google_document_ai_layout === false,
    "google_document_ai_layout off when ENABLE_GOOGLE_AI not set or project vars absent");

  // mock is always configured regardless
  assert(status.mock, "mock is true regardless of env");
}

section("Suite 7 — Provider Chain: mock is always the terminal fallback");

{
  const defaultChain = getExtractionProviderChain();
  assert(defaultChain.length >= 1, `Chain has ≥1 entry (got ${defaultChain.length})`);
  assert(defaultChain[defaultChain.length - 1] === "mock",
    `Last entry in chain is "mock" (got "${defaultChain[defaultChain.length - 1]}")`);

  const imageChain = getExtractionProviderChain("image/jpeg");
  assert(imageChain.includes("mock"), `image/jpeg chain includes "mock" fallback`);

  const pdfChain = getExtractionProviderChain("application/pdf");
  assert(pdfChain.includes("mock"), `PDF chain includes "mock" fallback`);
  // Vision OCR should NOT be in PDF chain (images only)
  if (!isVisionConfigured()) {
    assert(!pdfChain.includes("google_vision_ocr"),
      `google_vision_ocr not in PDF chain when not configured`);
  }
}

section("Suite 7 — Active Provider: defaults to mock when env var absent");

{
  const saved = process.env.MAP_FACTORY_AI_PROVIDER;
  delete process.env.MAP_FACTORY_AI_PROVIDER;

  const active = getActiveExtractionProvider();
  assertEqual(active, "mock", "Default active provider is mock");

  // Requesting an unconfigured provider falls back to mock
  process.env.MAP_FACTORY_AI_PROVIDER = "gemini_vision_extraction";
  // Unless ENABLE_GOOGLE_AI is true AND GEMINI_API_KEY is set, this must resolve to mock
  const fallback = getActiveExtractionProvider();
  assert(
    fallback === "mock" || (isGeminiConfigured() && fallback === "gemini_vision_extraction"),
    `Unconfigured provider falls back to mock (got "${fallback}")`,
  );

  // Restore
  if (saved !== undefined) process.env.MAP_FACTORY_AI_PROVIDER = saved;
  else delete process.env.MAP_FACTORY_AI_PROVIDER;
}

section("Suite 7 — Provider Status: no secrets in response shape");

{
  const status = getProviderStatus();
  const statusStr = JSON.stringify(status);

  // API keys must not appear in status output
  const sensitivePatterns = [
    process.env.GEMINI_API_KEY,
    process.env.GOOGLE_CLOUD_VISION_API_KEY,
    process.env.GOOGLE_CLOUD_PROJECT,
    process.env.GOOGLE_DOCUMENT_AI_PROCESSOR_ID,
  ].filter(Boolean);

  let noSecretsLeaked = true;
  for (const secret of sensitivePatterns) {
    if (statusStr.includes(secret as string)) {
      noSecretsLeaked = false;
      break;
    }
  }
  assert(noSecretsLeaked, "getProviderStatus() does not leak API keys or project IDs");

  // Shape check: all expected keys present
  assert("mock"                      in status, "status has 'mock' key");
  assert("gemini_vision_extraction"  in status, "status has 'gemini_vision_extraction' key");
  assert("google_vision_ocr"         in status, "status has 'google_vision_ocr' key");
  assert("google_document_ai_layout" in status, "status has 'google_document_ai_layout' key");
  assert("gemini_embedding"          in status, "status has 'gemini_embedding' key");
  assert(typeof status.mock === "boolean", "mock value is boolean");
}

section("Suite 7 — Extraction Service: mock fallback works end-to-end");

{
  const ext7Tables: Record<string, MockRow[]> = {
    map_factory_extractions: [],
    map_factory_sources:     [
      { id: "src-7a", job_id: "job-7", asset_id: "asset-7a", status: "discovered" },
    ],
  };
  const supabase7 = makeMockSupabase(ext7Tables);

  const r = await extractAsset({
    jobId:      "job-7",
    mallId:     "mall-7",
    assetId:    "asset-7a",
    assetUrl:   "https://cdn/level3-map.jpg",
    floorLabel: "level 3",
    provider:   "mock",
    supabase:   supabase7,
  });

  assert(r.ok,                `extractAsset ok (error: ${r.error ?? "none"})`);
  assert(r.anchorsFound > 0,  `anchorsFound > 0 (got ${r.anchorsFound})`);
  assert(r.cacheHit === false, "first extraction is not a cache hit");
  assertEqual(r.providerUsed, "mock", "provider_used = mock");

  // Extraction row persisted
  const rows = ext7Tables.map_factory_extractions;
  assert(rows.length === 1, `1 extraction row persisted (got ${rows.length})`);
  assertEqual(rows[0].provider_used as string, "mock", "extraction row.provider_used = mock");
  assert(Array.isArray(rows[0].provider_chain), "provider_chain is array");
  assert((rows[0].provider_chain as string[]).includes("mock"), "provider_chain contains 'mock'");

  // Standard warnings are appended
  const warnings = rows[0].warnings as string[];
  assert(Array.isArray(warnings), "warnings is array");
  assert(warnings.some((w: string) => w.includes("Google AI provider not configured")),
    "mock extraction has 'Google AI provider not configured' warning");
  assert(warnings.some((w: string) => w.includes("AI extraction is approximate")),
    "mock extraction has standard accuracy disclaimer");
}

section("Suite 7 — Extraction Cache: cache hit skips re-extraction");

{
  const cacheHash = "sha256-abc123";

  const cacheTables: Record<string, MockRow[]> = {
    map_factory_extractions: [
      {
        id:            "cached-row-1",
        job_id:        "job-cache",
        content_hash:  cacheHash,
        provider_used: "mock",
        status:        "complete",
        anchors_saved: 10,
        warnings:      ["AI extraction is approximate"],
      },
    ],
    map_factory_sources: [],
  };
  const cacheSupabase = makeMockSupabase(cacheTables);

  const cached = await extractAsset({
    jobId:       "job-cache",
    mallId:      "mall-cache",
    assetId:     "asset-cache",
    assetUrl:    "https://cdn/level5-map.jpg",
    floorLabel:  "Level 5",
    contentHash: cacheHash,
    supabase:    cacheSupabase,
  });

  assert(cached.ok,           `cache hit ok (error: ${cached.error ?? "none"})`);
  assert(cached.cacheHit === true, "cacheHit = true when content_hash matches");
  assertEqual(cached.anchorsFound, 10, "cached anchorsFound matches stored anchors_saved");

  // No new extraction row should have been inserted
  const allRows = cacheTables.map_factory_extractions;
  assertEqual(allRows.length, 1, "No new extraction row inserted for cache hit");
}

section("Suite 7 — Extraction Cache: forceExtract bypasses cache");

{
  const forceHash = "sha256-force-test";

  const forceTables: Record<string, MockRow[]> = {
    map_factory_extractions: [
      {
        id:            "old-row-1",
        job_id:        "job-force",
        content_hash:  forceHash,
        provider_used: "mock",
        status:        "complete",
        anchors_saved: 5,
        warnings:      [],
      },
    ],
    map_factory_sources: [
      { id: "src-force", job_id: "job-force", asset_id: "asset-force", status: "discovered" },
    ],
  };
  const forceSupabase = makeMockSupabase(forceTables);

  const forced = await extractAsset({
    jobId:        "job-force",
    mallId:       "mall-force",
    assetId:      "asset-force",
    assetUrl:     "https://cdn/level3-map.jpg",
    floorLabel:   "level 3",
    contentHash:  forceHash,
    forceExtract: true,
    supabase:     forceSupabase,
  });

  assert(forced.ok,             `forceExtract ok (error: ${forced.error ?? "none"})`);
  assert(forced.cacheHit === false, "cacheHit = false when forceExtract=true");
  assert(forced.anchorsFound > 0,   `forceExtract produced anchors (got ${forced.anchorsFound})`);

  // A new row should have been inserted (total = 2: old + new)
  const afterRows = forceTables.map_factory_extractions;
  assert(afterRows.length === 2, `New extraction row created on forceExtract (total rows: ${afterRows.length})`);
}

// ═════════════════════════════════════════════════════════════════════════════
// SUMMARY
// ═════════════════════════════════════════════════════════════════════════════

console.log(`\n${BOLD}═══════════════════════════════════════${RESET}`);
console.log(`${BOLD}Map Factory Harness — Results${RESET}`);
console.log(`${GREEN}Passed: ${passed}${RESET}  ${RED}Failed: ${failed}${RESET}`);
if (failed === 0) {
  console.log(`${GREEN}${BOLD}ALL TESTS PASSED ✓${RESET}`);
} else {
  console.log(`${RED}${BOLD}${failed} TEST(S) FAILED ✗${RESET}`);
  process.exit(1);
}

})().catch((err) => { console.error(err); process.exit(1); });
