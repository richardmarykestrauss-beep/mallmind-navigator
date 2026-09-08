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

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { runCsvImport } =
  require("../retailCsvImportService") as typeof import("../retailCsvImportService");

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

  // ── CSV import service (runCsvImport) — 20A.9 ─────────────────────────────
  const MALL = "f4a2c1b3-8d7e-4f6a-9b0c-1d2e3f4a5b6c";
  const SHOP = "a1b2c3d4-0001-4000-8000-100000000001";
  const HEADER = "mall_id,shop_id,product_name,brand,model,category,price,original_price,is_on_special,special_description,in_stock,trust_state,verification_method,valid_to,source_note";
  const CSV = HEADER + "\n" + `${MALL},${SHOP},Hisense 43in TV,Hisense,43A4,televisions,3499,3999,true,Winter,true,needs_review,csv_manual,2026-07-31,seed`;
  const SOURCE = { source_type: "retailer_submission", name: "Woolies June", retailer_name: "Woolworths", legal_status: "retailer_supplied", base_trust: 0.95 };
  const body = (over: Record<string, unknown> = {}) => ({ mode: "apply", file_name: "w.csv", csv_text: CSV, source: SOURCE, ...over });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function makeImportSupabase(cfg: any) {
    cfg.calls = [];
    return {
      from(table: string) {
        cfg.calls.push(table);
        if (table === "malls") return { select: () => ({ eq: () => ({ maybeSingle: async () => cfg.mall ?? { data: { id: MALL }, error: null } }) }) };
        if (table === "shops") return { select: () => ({ in: async () => cfg.shops ?? { data: [{ id: SHOP, mall_id: MALL }], error: null } }) };
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) };
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      rpc: async (name: string, args: any) => { cfg.rpcCall = { name, args }; return cfg.rpc ?? { data: [{ source_id: "s1", snapshot_id: "sn1", batch_id: "b1", staged_rows: 1, skipped_existing: 0, reused_source: false, reused_snapshot: false }], error: null }; },
    };
  }

  console.log("\nRI1 — invalid request → 400 (no DB)");
  {
    const cfg: any = {};
    const r = await runCsvImport(makeImportSupabase(cfg) as never, "admin-1", "a@x.co", body({ mode: "nope" }));
    assert(r.httpStatus === 400 && r.payload.ok === false, "bad mode → 400");
    assert(cfg.calls.length === 0 && !cfg.rpcCall, "invalid request makes no DB calls");
  }

  console.log("\nRI2 — dry_run performs NO writes");
  {
    const cfg: any = {};
    const r = await runCsvImport(makeImportSupabase(cfg) as never, "admin-1", "a@x.co", body({ mode: "dry_run" }));
    assert(r.httpStatus === 200 && r.payload.mode === "dry_run" && r.payload.valid_rows === 1, "dry_run → 200 summary");
    assert(cfg.calls.length === 0 && !cfg.rpcCall, "dry_run makes no DB calls");
    assert(typeof r.payload.file_sha256 === "string" && !("csv_text" in r.payload), "no raw CSV echoed; sha returned");
  }

  console.log("\nRI3 — apply validates mall/shop references");
  {
    const unknownMall: any = { mall: { data: null, error: null } };
    let r = await runCsvImport(makeImportSupabase(unknownMall) as never, "admin-1", "a@x.co", body());
    assert(r.httpStatus === 400 && /Unknown mall_id/.test(r.payload.error), "unknown mall → 400");
    assert(!unknownMall.rpcCall, "no RPC when mall unknown");

    const unknownShop: any = { shops: { data: [], error: null } };
    r = await runCsvImport(makeImportSupabase(unknownShop) as never, "admin-1", "a@x.co", body());
    assert(r.httpStatus === 400 && Array.isArray(r.payload.unknown_shop_ids), "unknown shop → 400");

    const wrongMall: any = { shops: { data: [{ id: SHOP, mall_id: "other-mall" }], error: null } };
    r = await runCsvImport(makeImportSupabase(wrongMall) as never, "admin-1", "a@x.co", body());
    assert(r.httpStatus === 400 && /do not belong to the mall/.test(r.payload.error), "shop in wrong mall → 400");
  }

  console.log("\nRI4 — successful apply");
  {
    const cfg: any = {};
    const r = await runCsvImport(makeImportSupabase(cfg) as never, "admin-1", "a@x.co", body());
    assert(r.httpStatus === 200 && r.payload.ok === true, "valid apply → 200");
    assert(r.payload.staged_rows === 1 && r.payload.review_status === "pending", "returns staged count + pending status");
    assert(cfg.rpcCall?.name === "stage_retail_csv_import" && cfg.rpcCall.args.p_observations.length === 1, "RPC called with 1 observation");
    assert(cfg.rpcCall.args.p_admin_id === "admin-1", "RPC carries the admin id for audit");
  }

  console.log("\nRI5 — repeated apply is idempotent (counts honest)");
  {
    const cfg: any = { rpc: { data: [{ source_id: "s1", snapshot_id: "sn1", batch_id: "b2", staged_rows: 0, skipped_existing: 1, reused_source: true, reused_snapshot: true }], error: null } };
    const r = await runCsvImport(makeImportSupabase(cfg) as never, "admin-1", "a@x.co", body());
    assert(r.httpStatus === 200 && r.payload.staged_rows === 0 && r.payload.skipped_existing_hashes === 1, "re-import → 0 staged, 1 skipped");
    assert(r.payload.reused_source === true && r.payload.reused_snapshot === true, "reuse flags surfaced");
  }

  console.log("\nRI6 — RPC failures: missing migration vs unexpected error");
  {
    const missing: any = { rpc: { data: null, error: { code: "PGRST202", message: "Could not find the function public.stage_retail_csv_import in the schema cache" } } };
    let r = await runCsvImport(makeImportSupabase(missing) as never, "admin-1", "a@x.co", body());
    assert(r.httpStatus === 503 && !/PGRST|schema cache|stage_retail/i.test(r.payload.error), "missing RPC → 503, internals hidden");

    const dbErr: any = { rpc: { data: null, error: { code: "23503", message: "insert or update violates foreign key" } } };
    r = await runCsvImport(makeImportSupabase(dbErr) as never, "admin-1", "a@x.co", body());
    assert(r.httpStatus === 500 && !/foreign key|violat/i.test(r.payload.error), "unexpected DB error → 500, internals hidden");
  }

  console.log("\nRI7 — all-blocked CSV → 400, no staging");
  {
    const badCsv = HEADER + "\n" + `${MALL},${SHOP},,,,,,-5,true,,true,needs_review,csv_manual,,x`;
    const cfg: any = {};
    const r = await runCsvImport(makeImportSupabase(cfg) as never, "admin-1", "a@x.co", body({ csv_text: badCsv }));
    assert(r.httpStatus === 400 && /No stageable rows/.test(r.payload.error), "all-blocked apply → 400");
    assert(!cfg.rpcCall, "no RPC when nothing stageable");
  }

  console.log(`\n===== RETAIL PUBLISHER HARNESS RESULT: ${passed} passed, ${failed} failed =====`);
  if (failed > 0) process.exit(1);
})();
