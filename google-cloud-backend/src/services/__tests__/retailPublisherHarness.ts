/**
 * retailPublisherHarness.ts — Sprint 20A.8 pre-commit hardening
 *
 * Focused mocked harness for publishApprovedObservation (the DB glue between the
 * verification policy and the atomic RPC). No real Supabase: a tiny fake client
 * returns canned responses so we can prove the error/status mapping:
 *   - successful publication
 *   - eligibility rejection (no RPC call)
 *   - missing RPC / pending migration → 503 (internals hidden)
 *   - unexpected DB failure → 500 (NOT mislabelled as a migration issue)
 *   - observation not found / load error
 *
 * Run: npm run test:retail-publisher
 */

export {};

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { publishApprovedObservation } =
  require("../retailObservationPublisher") as typeof import("../retailObservationPublisher");

let passed = 0;
let failed = 0;
function assert(cond: boolean, label: string): void {
  if (cond) { console.log(`  ✓ ${label}`); passed++; }
  else      { console.error(`  ✗ ${label}`); failed++; }
}

const NOW = "2026-06-21T00:00:00.000Z";

// A fully eligible approved phone-verification observation (joined source+snapshot).
const ELIGIBLE_OBS = {
  id: "obs-1", mall_id: "mall-1", shop_id: "shop-1", product_id: "prod-1",
  product_name: 'Hisense 43" FHD LED TV', price: 3499,
  observed_at: "2026-06-20T00:00:00.000Z", valid_to: "2026-07-01T00:00:00.000Z",
  trust_state: "verified", verification_method: "phone", confidence: 0.9,
  review_status: "approved", published_product_id: null, published_at: null,
  source_id: "src-1", snapshot_id: "snap-1",
  retail_data_sources: { id: "src-1", source_type: "manual", legal_status: "manual_fact_entry", is_active: true },
  retail_source_snapshots: { id: "snap-1" },
};
const MATCH_PRODUCT = { id: "prod-1", shop_id: "shop-1", mall_id: "mall-1", name: 'Hisense 43" FHD LED TV', data_quality_status: "demo" };

// Minimal Supabase test double covering only the calls the publisher makes.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeSupabase(cfg: any) {
  return {
    from(table: string) {
      if (table === "retail_price_observations") {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => cfg.observation }) }) };
      }
      if (table === "products") {
        return { select: () => ({ eq: () => ({ is: async () => cfg.products ?? { data: [MATCH_PRODUCT], error: null } }) }) };
      }
      return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) };
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rpc: async (_name: string, _args: any) => { cfg._rpcCalled = true; return cfg.rpc; },
  };
}

(async () => {
  console.log("\nRP1 — successful publication");
  {
    const cfg = { observation: { data: ELIGIBLE_OBS, error: null }, rpc: { data: [{ published_product_id: "prod-1", action: "update" }], error: null } };
    const r = await publishApprovedObservation(makeSupabase(cfg) as never, "obs-1", "admin-1", "Tester", NOW);
    assert(r.ok === true && r.httpStatus === 200, "eligible obs + RPC success → ok 200");
    assert(r.published_product_id === "prod-1" && r.action === "update", "returns published_product_id + action");
    assert(cfg._rpcCalled === true, "RPC was invoked");
  }

  console.log("\nRP2 — eligibility rejection (RPC never called)");
  {
    const cfg = { observation: { data: { ...ELIGIBLE_OBS, review_status: "pending" }, error: null }, rpc: { data: null, error: null } };
    const r = await publishApprovedObservation(makeSupabase(cfg) as never, "obs-1", "admin-1", "Tester", NOW);
    assert(r.ok === false && r.httpStatus === 422, "ineligible obs → 422");
    assert((r.blockers ?? []).some((b) => /not 'approved'/i.test(b)), "blockers explain ineligibility");
    assert(cfg._rpcCalled !== true, "RPC NOT called when ineligible");
  }

  console.log("\nRP3 — missing RPC (pending migration → 503)");
  {
    const cfg = { observation: { data: ELIGIBLE_OBS, error: null }, rpc: { data: null, error: { code: "PGRST202", message: "Could not find the function public.publish_verified_observation(...) in the schema cache" } } };
    const r = await publishApprovedObservation(makeSupabase(cfg) as never, "obs-1", "admin-1", "Tester", NOW);
    assert(r.ok === false && r.httpStatus === 503, "missing RPC → 503");
    assert(!/PGRST|schema cache|function|publish_verified/i.test(r.error ?? ""), "503 message hides internals");
  }

  console.log("\nRP4 — unexpected DB failure (→ 500, not mislabelled 503)");
  {
    const cfg = { observation: { data: ELIGIBLE_OBS, error: null }, rpc: { data: null, error: { code: "40P01", message: "deadlock detected" } } };
    const r = await publishApprovedObservation(makeSupabase(cfg) as never, "obs-1", "admin-1", "Tester", NOW);
    assert(r.ok === false && r.httpStatus === 500, "unrelated DB error → 500 (not 503)");
    assert(!/deadlock/i.test(r.error ?? ""), "500 message hides internals");
  }

  console.log("\nRP5 — observation not found / load error");
  {
    const notFound = await publishApprovedObservation(makeSupabase({ observation: { data: null, error: null } }) as never, "x", "admin-1", null, NOW);
    assert(notFound.ok === false && notFound.httpStatus === 404, "missing observation → 404");
    const loadErr = await publishApprovedObservation(makeSupabase({ observation: { data: null, error: { message: "connection reset" } } }) as never, "x", "admin-1", null, NOW);
    assert(loadErr.ok === false && loadErr.httpStatus === 500, "load error → 500");
    assert(!/connection reset/i.test(loadErr.error ?? ""), "load-error message hides internals");
  }

  console.log(`\n===== RETAIL PUBLISHER HARNESS RESULT: ${passed} passed, ${failed} failed =====`);
  if (failed > 0) process.exit(1);
})();
