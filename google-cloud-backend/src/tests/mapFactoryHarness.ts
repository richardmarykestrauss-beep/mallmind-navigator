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
import { getNextBestStep } from "../services/mapFactory/mapFactoryPublishService.js";

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
      const rows = tables[tableName] ?? [];
      const q: Record<string, unknown> = {};

      let _filters: Array<{ key: string; val: unknown }> = [];
      let _data: MockRow | MockRow[] | null = null;
      let _error: null | { message: string } = null;
      let _selectCols = "*";
      let _single = false;
      let _maybeSingle = false;
      let _countMode = false;
      let _insertPayload: MockRow | null = null;

      const chain = {
        select: (cols = "*", opts?: { count?: string; head?: boolean }) => {
          _selectCols = cols;
          if (opts?.count === "exact") _countMode = true;
          return chain;
        },
        eq: (key: string, val: unknown) => { _filters.push({ key, val }); return chain; },
        in: (_key: string, _vals: unknown[]) => chain,
        order: () => chain,
        limit: () => chain,
        single: () => {
          _single = true;
          const hit = rows.find((r) => _filters.every((f) => r[f.key] === f.val)) ?? null;
          _data = hit;
          _error = hit ? null : { message: `Row not found in ${tableName}` };
          return { data: _data, error: _error };
        },
        maybeSingle: () => {
          _maybeSingle = true;
          const hit = rows.find((r) => _filters.every((f) => r[f.key] === f.val)) ?? null;
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
        update: (_payload: MockRow) => ({
          eq: () => ({ eq: () => ({ error: null }), error: null }),
          error: null,
        }),
        then: (resolve: (v: { data: MockRow[]; error: null; count?: number }) => void) => {
          const matched = _countMode
            ? rows.filter((r) => _filters.every((f) => r[f.key] === f.val))
            : rows.filter((r) => _filters.every((f) => r[f.key] === f.val));
          resolve({ data: matched, error: null, count: matched.length });
        },
      };

      // Make chain awaitable
      Object.assign(chain, {
        [Symbol.asyncIterator]: undefined,
        then: (resolve: (v: { data: MockRow[]; error: null; count?: number }) => void) => {
          const matched = rows.filter((r) => _filters.every((f) => r[f.key] === f.val));
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
