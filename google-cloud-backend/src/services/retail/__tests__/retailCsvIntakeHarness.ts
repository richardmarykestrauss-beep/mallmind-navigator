/**
 * retailCsvIntakeHarness.ts — Sprint 20A.9
 *
 * Pure test harness for the CSV intake module. No DB, no network, no Express.
 * Run: npm run test:retail-csv-intake
 */

export {};

// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require("fs") as typeof import("fs");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require("path") as typeof import("path");

// eslint-disable-next-line @typescript-eslint/no-require-imports
const intake = require("../retailCsvIntake") as typeof import("../retailCsvIntake");
const { intakeRetailCsv, computeObservationHash, sha256Hex, parseCsv } = intake;

let passed = 0, failed = 0;
function assert(cond: boolean, label: string): void {
  if (cond) { console.log(`  ✓ ${label}`); passed++; }
  else      { console.error(`  ✗ ${label}`); failed++; }
}

const MALL = "f4a2c1b3-8d7e-4f6a-9b0c-1d2e3f4a5b6c";
const SHOP = "a1b2c3d4-0001-4000-8000-100000000001";
const HEADER = "mall_id,shop_id,product_name,brand,model,category,price,original_price,is_on_special,special_description,in_stock,trust_state,verification_method,valid_to,source_note";

// Build a CSV body row with overrides keyed by header name.
function row(over: Record<string, string> = {}): string {
  const base: Record<string, string> = {
    mall_id: MALL, shop_id: SHOP, product_name: "Hisense 43in TV", brand: "Hisense",
    model: "43A4", category: "televisions", price: "3499", original_price: "3999",
    is_on_special: "true", special_description: "Winter sale", in_stock: "true",
    trust_state: "needs_review", verification_method: "csv_manual",
    valid_to: "2026-07-31", source_note: "seed",
  };
  const m = { ...base, ...over };
  return intake.REQUIRED_HEADERS.map((h) => m[h] ?? "").join(",");
}
const csv = (...lines: string[]) => [HEADER, ...lines].join("\n");

console.log("\nCI — retail CSV intake (20A.9)");

// 1. Valid basic row.
{
  const r = intakeRetailCsv(csv(row()));
  assert(r.ok && r.total_rows === 1 && r.valid_rows === 1 && r.blocked_rows === 0, "valid basic row → ok, 1 valid");
  assert(r.candidates.length === 1 && !!r.candidates[0].observation_hash, "candidate produced with a hash");
  assert(r.candidates[0].price === 3499 && r.candidates[0].is_on_special === true, "numeric + boolean normalised");
}

// 2. Quoted commas.
{
  const r = intakeRetailCsv(csv(row({ product_name: '"Big, Wide TV"', special_description: '"a, b, c"' })));
  assert(r.valid_rows === 1 && r.candidates[0].product_name === "Big, Wide TV", "quoted commas preserved");
}

// 3. Escaped quotes.
{
  const r = intakeRetailCsv(csv(row({ product_name: '"He said ""hi"""' })));
  assert(r.candidates[0]?.product_name === 'He said "hi"', "escaped quotes unescaped");
}

// 4. CRLF vs LF parity.
{
  const lf = csv(row(), row({ product_name: "LG 40in" }));
  const crlf = lf.replace(/\n/g, "\r\n");
  const a = intakeRetailCsv(lf), b = intakeRetailCsv(crlf);
  assert(a.valid_rows === 2 && b.valid_rows === 2, "CRLF and LF both parse 2 rows");
  assert(a.candidates[0].observation_hash === b.candidates[0].observation_hash, "CRLF/LF produce identical hashes");
}

// 5. Blank lines ignored.
{
  const r = intakeRetailCsv([HEADER, row(), "", "   ", row({ product_name: "Samsung 32in" })].join("\n"));
  assert(r.ok && r.valid_rows === 2, "blank lines ignored");
}

// 6. Missing required header → structural error.
{
  const r = intakeRetailCsv("mall_id,shop_id,product_name\n" + `${MALL},${SHOP},TV`);
  assert(!r.ok && /missing required headers/i.test(r.structural_error ?? ""), "missing headers → structural error");
}

// 7. Duplicate header → structural error.
{
  const r = intakeRetailCsv((HEADER + ",price") + "\n" + row() + ",1");
  assert(!r.ok && /duplicate header/i.test(r.structural_error ?? ""), "duplicate header → structural error");
}

// 8. Malformed quoting does not crash.
{
  let threw = false; let r: any;
  try { r = intakeRetailCsv(csv(row({ product_name: '"unterminated' }))); } catch { threw = true; }
  assert(!threw && r && typeof r.ok === "boolean", "malformed quoting handled without throwing");
}

// 9. Formula injection sanitised.
{
  const r = intakeRetailCsv(csv(row({ product_name: "=cmd()|calc", brand: "@SUM(A1)" })));
  assert(r.candidates[0].product_name.startsWith("'="), "formula in product_name neutralised");
  assert((r.candidates[0].brand ?? "").startsWith("'@"), "formula in brand neutralised");
}

// 10. Booleans.
{
  assert(intakeRetailCsv(csv(row({ is_on_special: "false", in_stock: "false" }))).valid_rows === 1, "valid booleans accepted");
  const bad = intakeRetailCsv(csv(row({ is_on_special: "yes" })));
  assert(bad.blocked_rows === 1 && bad.rows[0].blockers.some((b) => /is_on_special/.test(b)), "invalid boolean blocked");
}

// 11/12/13. Price.
{
  assert(intakeRetailCsv(csv(row({ price: "-5" }))).rows[0].blockers.some((b) => /price/.test(b)), "negative price blocked");
  assert(intakeRetailCsv(csv(row({ price: "abc" }))).rows[0].blockers.some((b) => /price/.test(b)), "non-numeric price blocked");
  const zero = intakeRetailCsv(csv(row({ price: "0" })));
  assert(zero.valid_rows === 1 && zero.rows[0].warnings.some((w) => /price is 0/i.test(w)), "zero price valid with warning");
  const missing = intakeRetailCsv(csv(row({ price: "" })));
  assert(missing.rows[0].blockers.some((b) => /price is required/i.test(b)), "missing price blocked");
}

// 14. Invalid confidence (optional column).
{
  const r = intakeRetailCsv((HEADER + ",confidence") + "\n" + row() + ",1.7");
  assert(r.rows[0].blockers.some((b) => /confidence/.test(b)), "confidence >1 blocked");
  const ok = intakeRetailCsv((HEADER + ",confidence") + "\n" + row() + ",0.42");
  assert(ok.valid_rows === 1 && ok.candidates[0].confidence === 0.42, "valid confidence accepted");
}

// 15. Invalid timestamp.
{
  assert(intakeRetailCsv(csv(row({ valid_to: "not-a-date" }))).rows[0].blockers.some((b) => /valid_to/.test(b)), "invalid valid_to blocked");
}

// 15b. observed_at — optional; migration 032 defaults a missing one in-DB, but
// the pure intake must keep treating it as an optional nullable field.
{
  // Missing observed_at (not in the base header) stays a valid row → null.
  const missing = intakeRetailCsv(csv(row()));
  assert(missing.valid_rows === 1 && missing.candidates[0].observed_at === null,
    "missing observed_at remains a valid CSV row (null)");

  // An explicit valid observed_at is preserved verbatim.
  const explicitTs = "2026-05-01T10:00:00Z";
  const kept = intakeRetailCsv((HEADER + ",observed_at") + "\n" + row() + "," + explicitTs);
  assert(kept.valid_rows === 1 && kept.candidates[0].observed_at === explicitTs,
    "explicit valid observed_at is preserved");

  // A malformed nonblank observed_at is still blocked (before any DB insert).
  const bad = intakeRetailCsv((HEADER + ",observed_at") + "\n" + row() + ",not-a-date");
  assert(bad.blocked_rows === 1 && bad.rows[0].blockers.some((b) => /observed_at/.test(b)),
    "malformed observed_at remains blocked");
}

// 16/17. Trust state + method validation.
{
  assert(intakeRetailCsv(csv(row({ trust_state: "supertrust" }))).rows[0].blockers.some((b) => /trust_state/.test(b)), "invalid trust_state blocked");
  assert(intakeRetailCsv(csv(row({ verification_method: "magic" }))).rows[0].blockers.some((b) => /verification_method/.test(b)), "invalid verification_method blocked");
}

// 18. Missing mall/shop/product + UUID validation.
{
  assert(intakeRetailCsv(csv(row({ mall_id: "" }))).rows[0].blockers.some((b) => /mall_id is required/.test(b)), "missing mall_id blocked");
  assert(intakeRetailCsv(csv(row({ shop_id: "" }))).rows[0].blockers.some((b) => /shop_id is required/.test(b)), "missing shop_id blocked");
  assert(intakeRetailCsv(csv(row({ product_name: "" }))).rows[0].blockers.some((b) => /product_name is required/.test(b)), "missing product_name blocked");
  assert(intakeRetailCsv(csv(row({ mall_id: "not-a-uuid" }))).rows[0].blockers.some((b) => /mall_id is not a valid UUID/.test(b)), "non-UUID mall_id blocked");
}

// 19. Deterministic hash stability.
{
  const a = intakeRetailCsv(csv(row())).candidates[0].observation_hash;
  const b = intakeRetailCsv(csv(row())).candidates[0].observation_hash;
  assert(a === b && a.length === 64, "hash deterministic + 64 hex");
}

// 20. Hash changes on meaningful change; stable on non-hashed change.
{
  const base = intakeRetailCsv(csv(row())).candidates[0].observation_hash;
  const priceChanged = intakeRetailCsv(csv(row({ price: "2999" }))).candidates[0].observation_hash;
  const noteChanged = intakeRetailCsv(csv(row({ source_note: "different note" }))).candidates[0].observation_hash;
  assert(base !== priceChanged, "hash changes when price changes");
  assert(base === noteChanged, "hash stable when only non-hashed field (source_note) changes");
}

// 21. Duplicate rows inside one file.
{
  const r = intakeRetailCsv(csv(row(), row()));
  assert(r.total_rows === 2 && r.valid_rows === 2 && r.duplicate_rows_in_file === 1, "in-file duplicate counted");
  assert(r.candidates.length === 1, "duplicate not staged twice");
  assert(r.rows[1].duplicate_in_file === true, "second occurrence flagged duplicate");
}

// 22. Mixed valid + invalid rows.
{
  const r = intakeRetailCsv(csv(row(), row({ price: "-1", product_name: "Bad TV" }), row({ product_name: "Good 2" })));
  assert(r.ok && r.total_rows === 3 && r.valid_rows === 2 && r.blocked_rows === 1, "mixed file keeps valid rows, reports blocked");
  assert(r.rows[1].row_number === 3, "blocked row reports its CSV line number");
}

// 23/24. Trust downgrade — CSV cannot self-declare verification.
{
  const r = intakeRetailCsv(csv(row({ trust_state: "verified", verification_method: "csv_manual" })));
  assert(r.valid_rows === 1, "verified+csv_manual still stages (valid)");
  assert(r.candidates[0].trust_state === "needs_review", "verified+csv_manual downgraded to needs_review");
  assert(r.candidates[0].declared_trust_state === "verified", "original declared trust_state preserved");
  assert(r.rows[0].warnings.some((w) => /overstates a CSV's evidence/i.test(w)), "downgrade is documented in a warning");
}

// 25. Valid retailer-supplied staging (kept, not downgraded).
{
  const r = intakeRetailCsv(csv(row({ trust_state: "retailer_submitted", verification_method: "retailer_confirmation" })));
  assert(r.valid_rows === 1 && r.candidates[0].trust_state === "retailer_submitted", "retailer_submitted + evidence method kept");
}

// 26. Summary counts + file sha + category counts.
{
  const text = csv(row({ category: "televisions" }), row({ product_name: "TV2", category: "televisions" }), row({ price: "-1", product_name: "x" }));
  const r = intakeRetailCsv(text);
  assert(r.category_counts["televisions"] === 2, "category_counts correct (valid rows only)");
  assert(sha256Hex(text) === sha256Hex(text) && sha256Hex(text).length === 64, "sha256Hex deterministic");
  assert(sha256Hex("a") !== sha256Hex("b"), "sha256Hex differs on different input");
}

// 27. computeObservationHash matches the legacy importer formula (regression lock).
{
  const h = computeObservationHash({
    mall_id: MALL, shop_id: SHOP, product_name: "Hisense 43in TV", brand: "Hisense",
    model: "43A4", category: "televisions", price: 3499, original_price: 3999, valid_to: "2026-07-31",
  });
  // The same fields routed through the full intake must yield the same hash.
  assert(intakeRetailCsv(csv(row())).candidates[0].observation_hash === h, "intake hash matches direct computeObservationHash");
}

// 28. parseCsv low-level smoke.
{
  const rows = parseCsv('a,b\n1,"x,y"\n');
  assert(rows.length === 2 && rows[1][1] === "x,y", "parseCsv handles quoted field");
}

// ── Purity scan of the intake module ────────────────────────────────────────
console.log("\nCI-PURITY — intake module has no Supabase/env/fs/network/Express");
{
  const src = fs.readFileSync(path.resolve(__dirname, "..", "retailCsvIntake.ts"), "utf8");
  const forbidden = ["@supabase", "createClient", "process.env", "fetch(", "require(\"http", "from \"fs\"", "require(\"fs", "from \"express\"", "require(\"express", "XMLHttpRequest", "axios"];
  for (const token of forbidden) {
    assert(!src.includes(token), `intake module contains no '${token}'`);
  }
}

// ── Migration contract — hardened RPC 029_retail_csv_intake.sql ──────────────
// No DB is available in this pure harness, so this is a static SQL contract scan:
// it asserts the SECURITY DEFINER RPC validates its own inputs and preserves its
// security properties (independent security review, Sprint 20A.9 hardening).
console.log("\nCI-CONTRACT — migration 029 stage_retail_csv_import hardening");
{
  const sqlPath = path.resolve(
    __dirname, "..", "..", "..", "..", "..", "supabase", "migrations", "029_retail_csv_intake.sql"
  );
  const sql = fs.readFileSync(sqlPath, "utf8");
  const has = (needle: string, label: string) => assert(sql.includes(needle), label);
  const hasRe = (re: RegExp, label: string) => assert(re.test(sql), label);
  const lacks = (needle: string, label: string) => assert(!sql.includes(needle), label);

  // 1. JSON container types validated; array type checked BEFORE length.
  has("jsonb_typeof(p_source) is distinct from 'object'", "validates p_source is a JSON object");
  has("jsonb_typeof(p_snapshot) is distinct from 'object'", "validates p_snapshot is a JSON object");
  has("jsonb_typeof(p_batch) is distinct from 'object'", "validates p_batch is a JSON object");
  has("jsonb_typeof(p_observations) is distinct from 'array'", "validates p_observations is a JSON array");
  assert(
    sql.indexOf("jsonb_typeof(p_observations) is distinct from 'array'") <
      sql.indexOf("jsonb_array_length(p_observations)"),
    "array type is checked before jsonb_array_length",
  );
  has("at least one observation is required", "requires at least one observation");

  // 2. Required source fields + enum membership.
  has("source.source_type is required", "rejects missing source_type");
  has("source.name is required", "rejects missing source name");
  has("source.legal_status is required", "rejects missing legal_status");
  hasRe(/source\.source_type % is not a supported enum value/, "source_type checked against enum");
  hasRe(/source\.legal_status % is not a supported enum value/, "legal_status checked against enum");
  has("source.base_trust must be between 0 and 1", "base_trust range enforced");
  has("source.mall_id references an unknown mall", "source mall existence enforced");
  has("source.attribution_required must be a boolean", "attribution_required boolean enforced");

  // 3. Snapshot identity.
  has("snapshot.content_sha256 is required", "rejects blank sha256");
  has("must be exactly 64 lowercase hex chars", "sha256 must be 64 hex");
  has("snapshot requires a ref_label", "requires a deliberate evidence label");
  hasRe(/c_sha_re\s+constant text\s*:=\s*'\^\[0-9a-f\]\{64\}\$'/, "sha256 regex is 64 hex");

  // 4. Per-observation defensive validation.
  has("observation % has a missing or malformed observation_hash", "blank/short observation_hash rejected");
  has("observation % mall_id does not match the source mall", "observation mall mismatch rejected");
  has("observation % shop_id is unknown or not in the source mall", "shop in another mall rejected");
  has("s.mall_id = v_mall_id", "shop coherence joins on the source mall");
  has("observation % has a non-numeric or negative price", "bad numeric price rejected");
  has("observation % has an invalid is_on_special", "malformed boolean rejected");
  has("observation % has an invalid timestamp", "malformed timestamp rejected");
  has("observation % confidence must be between 0 and 1", "confidence bounds enforced");
  has("observation % has an unsupported trust_state", "unsupported trust state rejected");
  has("observation % has an unsupported verification_method", "unsupported method rejected");
  has("observation % product_id is unknown or incoherent", "incoherent product_id rejected");
  has("review_status must be pending (CSV intake stages only)", "non-pending review_status rejected");

  // 5. In-payload dedup + concurrency strategy.
  has("distinct on (h)", "deduplicates incoming payload by hash");
  has("on conflict do nothing", "pending-hash collisions cannot abort the import");
  has("pg_advisory_xact_lock", "source reuse concurrency strategy represented in SQL");
  has("v_skipped := v_unique - v_staged", "skipped_existing is computed from unique-minus-staged");

  // 6. Forced pending + no publication / verification.
  has("-- FORCED: CSV intake never publishes/verifies", "staging forces review_status pending");
  lacks("insert into public.products", "no insert into products");
  lacks("update public.products", "no update of products");
  lacks("publish_verified_observation(", "never calls the publish RPC");

  // 6b. Source identity (shop-aware) + legal eligibility — final-review fixes.
  has("v_source_shop_id uuid;", "declares a validated v_source_shop_id");
  has("lower(coalesce(v_source_shop_id::text, 'mall_wide'))", "source shop identity (mall_wide sentinel) is in the advisory-lock key");
  has("shop_id is not distinct from v_source_shop_id", "source reuse keys on the validated source shop_id");
  hasRe(/v_mall_id,\s*\n\s*v_source_shop_id,\s*\n\s*v_base_trust,/, "source insert uses the validated v_source_shop_id variable");
  lacks("nullif(p_source->>'shop_id', '')::uuid", "source insert no longer re-casts the raw JSON shop_id");
  assert(
    /not legally eligible for CSV staging/.test(sql) && /v_legal in \([^)]*'reference_only'[^)]*\)/.test(sql),
    "reference_only is explicitly rejected for staging",
  );
  assert(
    /not legally eligible for CSV staging/.test(sql) && /v_legal in \([^)]*'needs_legal_review'[^)]*\)/.test(sql),
    "needs_legal_review is explicitly rejected for staging",
  );

  // 7. Security properties preserved.
  has("security definer", "retains SECURITY DEFINER");
  has("set search_path = pg_catalog, public", "retains locked search_path");
  has("public.retail_price_observations", "uses schema-qualified table refs");
  hasRe(/revoke all on function public\.stage_retail_csv_import\([^)]*\) from public/, "revoked from PUBLIC");
  hasRe(/revoke all on function public\.stage_retail_csv_import\([^)]*\) from anon/, "revoked from anon");
  hasRe(/revoke all on function public\.stage_retail_csv_import\([^)]*\) from authenticated/, "revoked from authenticated");
  hasRe(/grant execute on function public\.stage_retail_csv_import\([^)]*\) to service_role/, "granted only to service_role");
}

// ── Migration contract — corrective migration 030 (column ambiguity fix) ─────
// 030 re-creates stage_retail_csv_import with every column reference qualified,
// fixing ERROR 42702 ("column reference \"source_id\" is ambiguous") caused by
// RETURNS TABLE output names shadowing unqualified columns. This is a static scan
// that the dangerous unqualified pattern is gone and the aliased forms are used.
console.log("\nCI-CONTRACT — migration 030 stage_retail_csv_import column qualification");
{
  const sqlPath = path.resolve(
    __dirname, "..", "..", "..", "..", "..", "supabase", "migrations", "030_fix_retail_csv_rpc_ambiguity.sql"
  );
  const sql = fs.readFileSync(sqlPath, "utf8");
  // Executable SQL only — strip "--" comment lines so the dangerous-pattern
  // scan never trips on the header's documentation of the original defect.
  const code = sql.split("\n").filter((l) => !/^\s*--/.test(l)).join("\n");
  const has = (needle: string, label: string) => assert(sql.includes(needle), label);
  const hasRe = (re: RegExp, label: string) => assert(re.test(sql), label);
  const lacks = (needle: string, label: string) => assert(!sql.includes(needle), label);
  const lacksReCode = (re: RegExp, label: string) => assert(!re.test(code), label);

  // Corrective shape: CREATE OR REPLACE, no DROP (return type unchanged).
  has("create or replace function public.stage_retail_csv_import", "030 uses CREATE OR REPLACE FUNCTION");
  lacks("drop function", "030 does not drop the function");

  // The exact dangerous unqualified pattern from the live defect must be gone
  // from the executable body (comments may still quote it for documentation).
  lacksReCode(/where\s+source_id\s*=\s*v_source_id/, "no unqualified 'where source_id = v_source_id'");
  lacksReCode(/where\s+content_sha256\s*=\s*v_sha/, "no unqualified 'where content_sha256 = v_sha'");
  lacksReCode(/where\s+id\s*=\s*v_batch_id/, "no unqualified 'where id = v_batch_id'");

  // Qualified aliases in source / snapshot / observation / batch queries.
  has("from public.retail_data_sources as rds", "source reuse query is aliased (rds)");
  has("returning rds.id into v_source_id", "source insert returns the aliased id");
  hasRe(/rds\.shop_id is not distinct from v_source_shop_id/, "source reuse keys on aliased shop_id");
  has("from public.retail_source_snapshots as rss", "snapshot reuse query is aliased (rss)");
  hasRe(/rss\.source_id\s*=\s*v_source_id/, "snapshot reuse compares rss.source_id (the original ambiguous column)");
  has("returning rss.id into v_snapshot_id", "snapshot insert returns the aliased id");
  has("from public.retail_price_observations as rpo", "observation dedup anti-join is aliased (rpo)");
  hasRe(/rpo\.observation_hash\s*=/, "dedup compares rpo.observation_hash");
  has("update public.retail_import_batches as rib", "batch finalisation update is aliased (rib)");
  hasRe(/where\s+rib\.id\s*=\s*v_batch_id/, "batch finalisation filters on rib.id");
  has("returning rib.id into v_batch_id", "batch insert returns the aliased id");
  hasRe(/from public\.profiles as pr[\s\S]*?pr\.id\s*=\s*p_admin_id/, "admin check is aliased (pr)");
  hasRe(/from public\.malls as m\b[\s\S]*?m\.id\s*=\s*v_mall_id/, "mall existence check is aliased (m)");

  // Unchanged contract: same return columns, security + behaviour preserved.
  has("source_id            uuid,", "030 keeps the exact return columns");
  has("returns table (", "030 keeps the RETURNS TABLE signature");
  has("security definer", "030 retains SECURITY DEFINER");
  has("set search_path = pg_catalog, public", "030 retains locked search_path");
  has("-- FORCED: CSV intake never publishes/verifies", "030 still forces review_status pending");
  has("pg_advisory_xact_lock", "030 retains the advisory lock");
  has("is not legally eligible for CSV staging", "030 retains legal eligibility rejection");
  has("lower(coalesce(v_source_shop_id::text, 'mall_wide'))", "030 retains shop-aware source identity");
  lacks("insert into public.products", "030 still never inserts into products");
  lacks("publish_verified_observation(", "030 still never calls the publish RPC");
  hasRe(/revoke all on function public\.stage_retail_csv_import\([^)]*\) from public/, "030 revokes from PUBLIC");
  hasRe(/revoke all on function public\.stage_retail_csv_import\([^)]*\) from anon/, "030 revokes from anon");
  hasRe(/revoke all on function public\.stage_retail_csv_import\([^)]*\) from authenticated/, "030 revokes from authenticated");
  hasRe(/grant execute on function public\.stage_retail_csv_import\([^)]*\) to service_role/, "030 grants only to service_role");
}

// ── Migration contract — corrective migration 031 (named snapshot conflict) ──
// 031 re-creates stage_retail_csv_import using the NAMED unique constraint for
// the snapshot ON CONFLICT target, fixing a second live ERROR 42702 where the
// column-list target "(source_id, content_sha256)" was shadowed by the
// RETURNS TABLE output variable source_id. Static scan only.
console.log("\nCI-CONTRACT — migration 031 stage_retail_csv_import named snapshot conflict");
{
  const dir = path.resolve(__dirname, "..", "..", "..", "..", "..", "supabase", "migrations");
  const sql = fs.readFileSync(path.join(dir, "031_fix_retail_csv_snapshot_conflict.sql"), "utf8");
  const has = (needle: string, label: string) => assert(sql.includes(needle), label);
  const hasRe = (re: RegExp, label: string) => assert(re.test(sql), label);
  const lacks = (needle: string, label: string) => assert(!sql.includes(needle), label);
  const code = sql.split("\n").filter((l) => !/^\s*--/.test(l)).join("\n");

  // 031 exists, is a CREATE OR REPLACE, and does not drop or edit prior migrations.
  assert(sql.length > 0, "031 migration exists");
  has("create or replace function public.stage_retail_csv_import", "031 uses CREATE OR REPLACE FUNCTION");
  lacks("drop function", "031 does not drop the function");
  // 031 must not contain a CREATE/REPLACE of any function other than the RPC,
  // and must reference no prior migration file.
  assert(!/029_retail_csv_intake|030_fix_retail_csv_rpc_ambiguity/.test(code), "031 does not edit/rerun prior migrations");

  // The exact functional correction.
  has("on conflict on constraint retail_source_snapshots_source_id_content_sha256_key", "031 uses the named snapshot conflict constraint");
  assert(!code.includes("on conflict (source_id, content_sha256)"), "031 no longer uses the column-list snapshot conflict target");
  has("do update set ref_label = rss.ref_label", "031 keeps conflict-safe snapshot reuse");
  has("returning rss.id into v_snapshot_id", "031 keeps RETURNING rss.id");

  // All 030 qualification guarantees remain intact.
  has("from public.retail_data_sources as rds", "031 source reuse stays aliased (rds)");
  hasRe(/rss\.source_id\s*=\s*v_source_id/, "031 snapshot reuse stays aliased (rss.source_id)");
  has("from public.retail_price_observations as rpo", "031 observation dedup stays aliased (rpo)");
  has("update public.retail_import_batches as rib", "031 batch finalisation stays aliased (rib)");
  hasRe(/where\s+rib\.id\s*=\s*v_batch_id/, "031 batch finalisation filters on rib.id");
  // The targetless observation conflict is intentionally retained (safe).
  has("on conflict do nothing", "031 retains the safe targetless observation conflict");

  // Security + behaviour guarantees remain intact.
  has("returns table (", "031 keeps the RETURNS TABLE signature");
  has("source_id            uuid,", "031 keeps the exact return columns");
  has("security definer", "031 retains SECURITY DEFINER");
  has("set search_path = pg_catalog, public", "031 retains locked search_path");
  has("-- FORCED: CSV intake never publishes/verifies", "031 still forces review_status pending");
  has("pg_advisory_xact_lock", "031 retains the advisory lock");
  has("is not legally eligible for CSV staging", "031 retains legal eligibility rejection");
  has("lower(coalesce(v_source_shop_id::text, 'mall_wide'))", "031 retains shop-aware source identity");
  lacks("insert into public.products", "031 still never inserts into products");
  lacks("update public.products", "031 still never updates products");
  lacks("publish_verified_observation(", "031 still never calls the publish RPC");
  hasRe(/revoke all on function public\.stage_retail_csv_import\([^)]*\) from public/, "031 revokes from PUBLIC");
  hasRe(/revoke all on function public\.stage_retail_csv_import\([^)]*\) from anon/, "031 revokes from anon");
  hasRe(/revoke all on function public\.stage_retail_csv_import\([^)]*\) from authenticated/, "031 revokes from authenticated");
  hasRe(/grant execute on function public\.stage_retail_csv_import\([^)]*\) to service_role/, "031 grants only to service_role");

  // Prior applied migrations must remain present and unedited in the tree.
  assert(fs.existsSync(path.join(dir, "029_retail_csv_intake.sql")), "029 migration still present");
  assert(fs.existsSync(path.join(dir, "030_fix_retail_csv_rpc_ambiguity.sql")), "030 migration still present");
}

// ── Migration contract — corrective migration 032 (observed_at default) ──────
// 032 re-creates stage_retail_csv_import coalescing a missing observed_at to
// statement_timestamp(), fixing a live ERROR 23502 (the NOT NULL observed_at
// column was handed an explicit NULL, bypassing its table default). Static scan.
console.log("\nCI-CONTRACT — migration 032 stage_retail_csv_import observed_at default");
{
  const dir = path.resolve(__dirname, "..", "..", "..", "..", "..", "supabase", "migrations");
  const sql = fs.readFileSync(path.join(dir, "032_fix_retail_csv_observed_at_default.sql"), "utf8");
  const has = (needle: string, label: string) => assert(sql.includes(needle), label);
  const hasRe = (re: RegExp, label: string) => assert(re.test(sql), label);
  const lacks = (needle: string, label: string) => assert(!sql.includes(needle), label);
  // Executable SQL only (strip "--" comment lines) for absence checks so the
  // header's documentation of the old expression cannot trip the scan.
  const code = sql.split("\n").filter((l) => !/^\s*--/.test(l)).join("\n");

  // 032 exists, is a CREATE OR REPLACE, and does not drop or edit prior migrations.
  assert(sql.length > 0, "032 migration exists");
  has("create or replace function public.stage_retail_csv_import", "032 uses CREATE OR REPLACE FUNCTION");
  lacks("drop function", "032 does not drop the function");
  assert(!/029_retail_csv_intake|030_fix_retail_csv_rpc_ambiguity|031_fix_retail_csv_snapshot_conflict/.test(code),
    "032 does not edit/rerun prior migrations");

  // The exact functional correction: missing observed_at → statement_timestamp().
  hasRe(/coalesce\(\s*nullif\(btrim\(fresh\.o->>'observed_at'\),\s*''\)::timestamptz,\s*statement_timestamp\(\)\s*\)/,
    "032 coalesces missing observed_at to statement_timestamp()");
  has("statement_timestamp()", "032 uses statement_timestamp() (one deterministic fallback per import)");
  assert(!code.includes("clock_timestamp("), "032 does not use clock_timestamp() (executable SQL)");
  // The old direct nullable insert expression must be gone from EXECUTABLE SQL.
  assert(!code.includes("nullif(btrim(fresh.o->>'observed_at'), '')::timestamptz, nullif(btrim(fresh.o->>'valid_from')"),
    "032 removed the old direct nullable observed_at insert expression");
  // Explicit timestamps still cast as timestamptz (valid_from/valid_to unchanged).
  has("nullif(btrim(fresh.o->>'valid_from'), '')::timestamptz", "032 keeps valid_from as timestamptz");
  has("nullif(btrim(fresh.o->>'valid_to'), '')::timestamptz", "032 keeps valid_to as timestamptz");
  // The per-observation validation that rejects malformed observed_at is retained.
  hasRe(/perform nullif\(btrim\(coalesce\(v_o->>'observed_at', ''\)\), ''\)::timestamptz;/,
    "032 retains observed_at validation that blocks malformed values");

  // 031's named snapshot constraint remains.
  has("on conflict on constraint retail_source_snapshots_source_id_content_sha256_key", "032 keeps the named snapshot conflict constraint");
  assert(!code.includes("on conflict (source_id, content_sha256)"), "032 has no column-list snapshot conflict target");

  // All aliasing remains intact.
  has("from public.retail_data_sources as rds", "032 source reuse stays aliased (rds)");
  hasRe(/rss\.source_id\s*=\s*v_source_id/, "032 snapshot reuse stays aliased (rss.source_id)");
  has("from public.retail_price_observations as rpo", "032 observation dedup stays aliased (rpo)");
  has("update public.retail_import_batches as rib", "032 batch finalisation stays aliased (rib)");
  has("on conflict do nothing", "032 retains the safe targetless observation conflict");

  // Security + behaviour guarantees remain intact.
  has("returns table (", "032 keeps the RETURNS TABLE signature");
  has("source_id            uuid,", "032 keeps the exact return columns");
  has("security definer", "032 retains SECURITY DEFINER");
  has("set search_path = pg_catalog, public", "032 retains locked search_path");
  has("-- FORCED: CSV intake never publishes/verifies", "032 still forces review_status pending");
  has("pg_advisory_xact_lock", "032 retains the advisory lock");
  has("is not legally eligible for CSV staging", "032 retains legal eligibility rejection");
  has("lower(coalesce(v_source_shop_id::text, 'mall_wide'))", "032 retains shop-aware source identity");
  lacks("insert into public.products", "032 still never inserts into products");
  lacks("update public.products", "032 still never updates products");
  lacks("publish_verified_observation(", "032 still never calls the publish RPC");
  hasRe(/revoke all on function public\.stage_retail_csv_import\([^)]*\) from public/, "032 revokes from PUBLIC");
  hasRe(/revoke all on function public\.stage_retail_csv_import\([^)]*\) from anon/, "032 revokes from anon");
  hasRe(/revoke all on function public\.stage_retail_csv_import\([^)]*\) from authenticated/, "032 revokes from authenticated");
  hasRe(/grant execute on function public\.stage_retail_csv_import\([^)]*\) to service_role/, "032 grants only to service_role");

  // Prior applied migrations remain present and unedited.
  assert(fs.existsSync(path.join(dir, "029_retail_csv_intake.sql")), "029 migration still present (032 turn)");
  assert(fs.existsSync(path.join(dir, "030_fix_retail_csv_rpc_ambiguity.sql")), "030 migration still present (032 turn)");
  assert(fs.existsSync(path.join(dir, "031_fix_retail_csv_snapshot_conflict.sql")), "031 migration still present (032 turn)");
}

console.log(`\n===== RETAIL CSV INTAKE HARNESS RESULT: ${passed} passed, ${failed} failed =====`);
if (failed > 0) process.exit(1);
