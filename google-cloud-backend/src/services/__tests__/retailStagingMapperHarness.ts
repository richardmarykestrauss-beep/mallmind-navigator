/**
 * retailStagingMapperHarness — Sprint 3A.3 unit proof (no DB, no network).
 *
 * Run: `npx ts-node --transpile-only src/services/__tests__/retailStagingMapperHarness.ts`
 * Asserts the OfferDraft → stage_retail_feed_observation mapping + the promotion outcome
 * handling. Type-only imports are erased at runtime, so this needs no path alias / Supabase.
 */

import {
  offerDraftToStageArgs, normalizeObservedAtUtcSeconds, canonicalIdentityTuple,
  priceScopeFromGeographic, availabilityScopeFromGeographic, stockStatusFromAvailability, toCents,
} from "../intake/canonicalStagingMapper";
import { promoteDrafts, type StageRpcCaller, type StageOutcomeRow } from "../intake/retailStagingPromotion";

let failures = 0;
const ok = (cond: boolean, msg: string) => { if (!cond) { failures++; console.error("FAIL:", msg); } };
const eq = (a: unknown, b: unknown, msg: string) => ok(JSON.stringify(a) === JSON.stringify(b), `${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

// A synthetic online-national draft (only the fields the mapper reads matter).
const draft = (over: Record<string, unknown> = {}) => ({
  id: "draft_1", sourceId: "11111111-1111-1111-1111-111111111111",
  retailerSku: "SKU-1", gtin: "6001000000019", productTitle: "Widget A", brand: "BrandX",
  category: "Home", price: 79.99, currency: "ZAR", originalPrice: null, promoText: null,
  availabilityStatus: "known_available", geographicScope: "national", observedAt: "2026-07-31T10:00:00.500Z",
  warnings: [] as string[], ...over,
}) as unknown as Parameters<typeof offerDraftToStageArgs>[0];

const ctx = { actorId: "actor-1", intakeJobId: "job-1", draftRef: "draft_1" };

// 1. observed_at normalized to UTC second precision.
eq(normalizeObservedAtUtcSeconds("2026-07-31T10:00:00.500Z"), "2026-07-31T10:00:00Z", "normalize ms→sec");
eq(normalizeObservedAtUtcSeconds("2026-07-31T12:00:00+02:00"), "2026-07-31T10:00:00Z", "normalize tz→UTC");

// 2. Decimal-safe cents.
eq(toCents(79.99), 7999, "toCents 79.99");
eq(toCents(89.9), 8990, "toCents 89.9");

// 3. Scope + stock mappings — honest, never asserting branch availability.
eq(priceScopeFromGeographic("branch"), "branch_specific", "branch→branch_specific");
eq(priceScopeFromGeographic("national"), "online_national", "national→online_national");
eq(priceScopeFromGeographic("online_only"), "online_national", "online_only→online_national");
eq(priceScopeFromGeographic("mall"), "unknown", "mall→unknown (no fabrication)");
eq(availabilityScopeFromGeographic("branch"), "unknown", "branch avail never branch_confirmed");
eq(availabilityScopeFromGeographic("national"), "online", "national avail→online");
eq(stockStatusFromAvailability("known_available"), "in_stock", "avail→in_stock");
eq(stockStatusFromAvailability("inferred"), "unknown", "inferred never asserted as stock");

// 4. Full mapping of an online-national draft.
const args = offerDraftToStageArgs(draft(), ctx);
eq(args.p_source_id, "11111111-1111-1111-1111-111111111111", "source_id");
eq(args.p_current_price_cents, 7999, "current_price_cents");
eq(args.p_price_scope, "online_national", "price_scope");
eq(args.p_availability_scope, "online", "availability_scope");
ok(args.p_availability_scope !== "branch_confirmed", "never branch_confirmed from retailer presence");
eq(args.p_observed_at, "2026-07-31T10:00:00Z", "observed_at normalized");
eq(args.p_intake_job_id, "job-1", "trace job id");
eq(args.p_intake_draft_ref, "draft_1", "trace draft ref");
ok(args.p_barcode === null && args.p_pack_size === null && args.p_price_condition === null, "unknown optionals stay null (no guessing)");

// 5. Canonical tuple order matches the RPC (ADR-C).
eq(canonicalIdentityTuple(args), ["11111111-1111-1111-1111-111111111111", "SKU-1", "2026-07-31T10:00:00Z", "online_national", "", "7999"], "canonical tuple");

// 6. A branch-scoped draft expresses branch INTENT via price_scope (RPC will demand a mapping),
//    but NEVER asserts branch availability.
const b = offerDraftToStageArgs(draft({ geographicScope: "branch" }), ctx);
eq(b.p_price_scope, "branch_specific", "branch intent");
ok(b.p_availability_scope !== "branch_confirmed", "branch draft still not branch_confirmed");
ok(b.p_branch_external_id === null, "no fabricated branch code");

// 7. Promotion outcome handling with a fake caller (proves counts + per-row error isolation).
async function main() {
  const scripted: Record<string, StageOutcomeRow["outcome"] | "throw"> = {
    d_staged: "staged", d_replayed: "replayed", d_conflict: "conflict",
    d_mapreq: "mapping_required", d_rejected: "rejected", d_boom: "throw",
  };
  const fake: StageRpcCaller = {
    async stage(a) {
      const which = scripted[a.p_intake_draft_ref ?? ""];
      if (which === "throw") throw new Error("db down");
      return { outcome: which as StageOutcomeRow["outcome"], observation_id: which === "staged" ? "obs-1" : null,
        listing_id: null, review_status: "pending", mapping_outcome: "not_applicable", observation_identity: "id", explanation: null };
    },
  };
  const drafts = Object.keys(scripted).map((k) => draft({ id: k })) as Parameters<typeof promoteDrafts>[0];
  const sum = await promoteDrafts(drafts, fake, { actorId: "a", intakeJobId: "job-1" });
  eq(sum.total, 6, "promotion total");
  eq(sum.staged, 1, "promotion staged");
  eq(sum.replayed, 1, "promotion replayed");
  eq(sum.conflict, 1, "promotion conflict");
  eq(sum.mappingRequired, 1, "promotion mapping_required");
  eq(sum.rejected, 1, "promotion rejected");
  eq(sum.errors, 1, "promotion error isolated (batch not aborted)");

  if (failures > 0) { console.error(`\nretail-staging-mapper harness: ${failures} FAILURE(S)`); process.exit(1); }
  console.log("retail-staging-mapper harness: ALL MAPPING + PROMOTION CASES PASSED");
}
void main();
