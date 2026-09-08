#!/usr/bin/env node
/**
 * generate-mallreds-import-sql.mjs — Sprint 2H Gate 2
 *
 * Deterministically renders the Mall@Reds tenant import as ONE reviewable SQL
 * transaction (+ a matching rollback) from the verified import preview. This
 * script only reads the preview and writes .sql text — it performs NO database
 * or network I/O. Executing the SQL is a separate, human-approved step.
 *
 * Determinism:
 *   - rows are sorted by canonical_store_id
 *   - mall id = md5('mallmind:mall:mallreds')::uuid       (stable, reproducible)
 *   - shop id = md5('mallmind:shop:'||canonical_store_id)::uuid
 *   Same preview in ⇒ byte-identical SQL out.
 *
 * Modes:
 *   --emit    (re)write docs/sprint-2h/mallreds-tenant-import.sql + *-rollback.sql
 *   (default) validate the committed .sql match the derivation + safety scans
 *
 * Honest mapping (every unknown stays NULL, nothing invented):
 *   floor, category, zone, unit_number, opening_time, closing_time, website,
 *   latitude, longitude → NULL.  store_number / phone / provenance / verification
 *   / confidence come straight from the preview.  There is NO shops column for
 *   an "ingestion status", so none is written (schema does not support it).
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, "..", "..");
const PREVIEW_PATH = resolve(REPO, "docs/sprint-2g/mallreds-tenant-import-preview.json");
const SQL_PATH = resolve(REPO, "docs/sprint-2h/mallreds-tenant-import.sql");
const ROLLBACK_PATH = resolve(REPO, "docs/sprint-2h/mallreds-tenant-import-rollback.sql");
const VERIFY_PATH = resolve(REPO, "docs/sprint-2h/mallreds-tenant-import-verify.sql");

const MALL_ID_EXPR = "md5('mallmind:mall:mallreds')::uuid";
const shopIdExpr = (cid) => `md5('mallmind:shop:${sqlLit(cid, true)}')::uuid`;
const DOCUMENTED_SHARED = new Set(["88", "80A"]);

const fail = (m) => { console.error(`\n✖ ${m}\n`); process.exit(1); };

/** SQL string-literal escaping. `bare` returns inner text (no surrounding quotes). */
function sqlLit(v, bare = false) {
  if (v === null || v === undefined) return bare ? "" : "null";
  const s = String(v).replace(/'/g, "''");
  return bare ? s : `'${s}'`;
}
function sqlNum(v) { return v === null || v === undefined ? "null" : String(v); }

// ── The single evidenced mall row (facts from the official Mall@Reds pages) ────
const MALL = {
  name: "Mall@Reds",
  city: "Centurion",
  province: "Gauteng",
  address: "cnr Rooihuiskraal Road and Hendrik Verwoerd Drive, Rooihuiskraal X15, Centurion, Gauteng, 0157",
  phone: "012 656 8957",                       // mall main line (official homepage)
  website: "https://www.mallatreds.co.za/",
  total_shops: 113,                            // the verified COMPLETE current directory count
  // total_floors, latitude/longitude/lat/lng, google_place_id, rating, image_url → NULL (unverified)
};

function loadRows() {
  const preview = JSON.parse(readFileSync(PREVIEW_PATH, "utf8"));
  const rows = [...preview.rows].sort((a, b) => a.canonical_store_id.localeCompare(b.canonical_store_id));
  return { preview, rows };
}

function buildTransaction(rows) {
  const canonicalArray = rows.map((r) => `    ${sqlLit(r.canonical_store_id)}`).join(",\n");

  const shopValues = rows.map((r) => {
    const c = r.proposed_db_mapping.columns;
    // Column order matches the INSERT column list below.
    return "  (" + [
      shopIdExpr(r.canonical_store_id),          // id
      MALL_ID_EXPR,                              // mall_id
      sqlLit(r.retailer_name),                   // name
      "null",                                    // category  (unknown)
      "null",                                    // floor     (unknown)
      "null",                                    // unit_number (legacy; number lives in store_number)
      sqlLit(r.store_number),                    // store_number
      "null",                                    // zone      (unknown)
      sqlLit(r.phone),                           // phone
      "null",                                    // website   (unknown)
      "null",                                    // opening_time (unknown)
      "null",                                    // closing_time (unknown)
      sqlLit(r.branch_status),                   // branch_status
      sqlLit(r.verification_status),             // verification_status
      sqlNum(r.confidence),                      // confidence_score
      sqlLit(r.observed_at),                     // observed_at
      sqlLit(r.last_verified_at),                // last_verified_at
      sqlLit(r.source_reference.primary_source_url), // primary_source_url
      sqlLit(r.source_reference.source_owner),   // source_owner
      sqlLit(c.contradiction_notes),             // contradiction_notes
      sqlLit(c.normalized_retailer_name),        // normalized_retailer_name
    ].join(", ") + ")";
  }).join(",\n");

  return `-- ═══════════════════════════════════════════════════════════════════════════
-- Mall@Reds controlled tenant import — Sprint 2H Gate 2 (mallmind-dev ONLY)
-- Target project ref: iivmrlgntspbkpfqoboi   (DEV). Production project: FORBIDDEN,
-- ref intentionally omitted from this file.
-- GENERATED from docs/sprint-2g/mallreds-tenant-import-preview.json — do not hand-edit.
-- Regenerate: node scripts/retail/generate-mallreds-import-sql.mjs --emit
--
-- Inserts exactly ONE Mall@Reds mall row and exactly ${rows.length} shops. Every unknown
-- field stays NULL (floor, category, zone, hours, website, coordinates). No products,
-- no route nodes/edges, no publication. It aborts (never silently skips) if a row already
-- exists — there is no upsert clause. Runs as one atomic transaction.
-- Run as a role that bypasses RLS (Dashboard SQL editor = postgres, or service_role).
-- ═══════════════════════════════════════════════════════════════════════════
begin;

-- ── Pre-state guards: refuse (abort) if anything already exists ───────────────
do $$
declare
  v_mall_id uuid := ${MALL_ID_EXPR};
  v_existing_shops int;
begin
  if exists (select 1 from public.malls where id = v_mall_id) then
    raise exception 'ABORT: Mall@Reds mall row already exists (id=%).', v_mall_id;
  end if;
  if exists (select 1 from public.malls where name = ${sqlLit(MALL.name)}) then
    raise exception 'ABORT: a mall named % already exists.', ${sqlLit(MALL.name)};
  end if;
  -- none of the ${rows.length} deterministic shop ids may already exist
  select count(*) into v_existing_shops
    from public.shops
   where id = any (
     select md5('mallmind:shop:' || cid)::uuid
       from unnest(array[
${canonicalArray}
     ]::text[]) as cid
   );
  if v_existing_shops > 0 then
    raise exception 'ABORT: % Mall@Reds shop ids already exist.', v_existing_shops;
  end if;
end $$;

-- ── Insert exactly one mall row ───────────────────────────────────────────────
insert into public.malls
  (id, name, city, province, address, phone, website, total_floors, total_shops,
   latitude, longitude, lat, lng, google_place_id, rating, image_url, is_active)
values
  (${MALL_ID_EXPR}, ${sqlLit(MALL.name)}, ${sqlLit(MALL.city)}, ${sqlLit(MALL.province)},
   ${sqlLit(MALL.address)}, ${sqlLit(MALL.phone)}, ${sqlLit(MALL.website)},
   null, ${MALL.total_shops}, null, null, null, null, null, null, null, true);

-- ── Insert exactly ${rows.length} shops (every unknown NULL) ───────────────────────────
insert into public.shops
  (id, mall_id, name, category, floor, unit_number, store_number, zone, phone, website,
   opening_time, closing_time, branch_status, verification_status, confidence_score,
   observed_at, last_verified_at, primary_source_url, source_owner, contradiction_notes,
   normalized_retailer_name)
values
${shopValues};

-- ── Post-insert assertions (abort the whole transaction on any violation) ─────
do $$
declare
  v_mall_id uuid := ${MALL_ID_EXPR};
  v_shops int;
begin
  select count(*) into v_shops from public.shops where mall_id = v_mall_id;
  if v_shops <> ${rows.length} then raise exception 'ABORT: expected ${rows.length} shops, got %.', v_shops; end if;
  if exists (select 1 from public.shops where mall_id = v_mall_id and floor        is not null) then raise exception 'ABORT: a floor is not NULL.'; end if;
  if exists (select 1 from public.shops where mall_id = v_mall_id and category     is not null) then raise exception 'ABORT: a category is not NULL.'; end if;
  if exists (select 1 from public.shops where mall_id = v_mall_id and zone         is not null) then raise exception 'ABORT: a zone is not NULL.'; end if;
  if exists (select 1 from public.shops where mall_id = v_mall_id and (opening_time is not null or closing_time is not null)) then raise exception 'ABORT: hours not NULL.'; end if;
  if exists (select 1 from public.shops where mall_id = v_mall_id and (store_number is null or primary_source_url is null or source_owner is null or observed_at is null)) then raise exception 'ABORT: missing provenance/store_number.'; end if;
  if exists (select 1 from public.shops where mall_id = v_mall_id and name ~* '(^|[^a-z])game([^a-z]|$)') then raise exception 'ABORT: an excluded tenant (Game) is present.'; end if;
  if exists (select 1 from public.shops where mall_id = v_mall_id and name ~* 'incredible connection') then raise exception 'ABORT: an excluded tenant (Incredible Connection) is present.'; end if;
end $$;

-- ── Return the created mall id + inserted shop count ──────────────────────────
select ${MALL_ID_EXPR} as mall_id,
       (select count(*) from public.shops where mall_id = ${MALL_ID_EXPR}) as shops_inserted;

commit;
`;
}

function buildRollback(rows) {
  const canonicalArray = rows.map((r) => `    ${sqlLit(r.canonical_store_id)}`).join(",\n");
  const n = rows.length;
  return `-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK — Mall@Reds controlled tenant import (Sprint 2H Gate 2). mallmind-dev ONLY.
-- Deletes ONLY the ${n} shops whose ids are the EXACT deterministic ids produced by
-- mallreds-tenant-import.sql, scoped to the deterministic Mall@Reds mall, plus that one
-- mall row. It rebuilds the same ${n} canonical ids → uuids used by the import, asserts the
-- expected pre-state, refuses if ANY other/dependent row would be touched (dynamic FK
-- check over CURRENT foreign-key contracts), and aborts (EXCEPTION, never warning) on any
-- count mismatch. Fully atomic. Preserves retail_data_sources, products, and all other data.
-- NOT auto-executed. Run as a role that bypasses RLS.
-- ═══════════════════════════════════════════════════════════════════════════
begin;

do $$
declare
  v_mall_id       uuid := ${MALL_ID_EXPR};
  v_ids           uuid[];
  v_mall_count    int;
  v_matching      int;
  v_wrong_mall    int;
  v_products      int;
  v_shops_deleted int;
  v_remaining     int;
  v_malls_deleted int;
  fk              record;
  v_dep           bigint;
begin
  -- Rebuild the EXACT ${n} deterministic imported shop uuids from the SAME canonical ids
  -- the import used (md5('mallmind:shop:'||canonical_store_id)::uuid).
  select array_agg(md5('mallmind:shop:' || cid)::uuid)
    into v_ids
    from unnest(array[
${canonicalArray}
    ]::text[]) as cid;
  if coalesce(array_length(v_ids, 1), 0) <> ${n} then
    raise exception 'ABORT rollback: expected ${n} canonical ids, built %.', coalesce(array_length(v_ids, 1), 0);
  end if;

  -- (a) the deterministic Mall@Reds mall row must exist exactly once
  select count(*) into v_mall_count from public.malls where id = v_mall_id;
  if v_mall_count <> 1 then
    raise exception 'ABORT rollback: expected exactly 1 Mall@Reds mall row (id=%), found %.', v_mall_id, v_mall_count;
  end if;

  -- (b) exactly ${n} imported shop ids must exist
  select count(*) into v_matching from public.shops where id = any(v_ids);
  if v_matching <> ${n} then
    raise exception 'ABORT rollback: expected ${n} imported shops, found %.', v_matching;
  end if;

  -- (c) every matching shop must belong to the deterministic Mall@Reds mall
  select count(*) into v_wrong_mall from public.shops where id = any(v_ids) and (mall_id is distinct from v_mall_id);
  if v_wrong_mall <> 0 then
    raise exception 'ABORT rollback: % imported shop(s) are attached to a different mall.', v_wrong_mall;
  end if;

  -- (d) no products may reference this mall or any of these shops
  select count(*) into v_products from public.products where mall_id = v_mall_id or shop_id = any(v_ids);
  if v_products <> 0 then
    raise exception 'ABORT rollback: % product row(s) reference this mall/shops; resolve first.', v_products;
  end if;

  -- (e) no OTHER dependent rows (route/map/staging/sources/jobs/etc.) may reference these
  --     shops or this mall, per the CURRENT foreign-key contracts. Enumerated dynamically
  --     so any FK added later is covered automatically. The shops→malls(mall_id) edge is the
  --     relationship we are deliberately removing, so it is the only one skipped.
  for fk in
    select n.nspname   as child_schema,
           cl.relname  as child_tbl,
           att.attname as child_col,
           pcl.relname as parent_tbl
      from pg_constraint c
      join pg_class     cl  on cl.oid  = c.conrelid
      join pg_namespace n   on n.oid   = cl.relnamespace
      join pg_class     pcl on pcl.oid = c.confrelid
      join pg_attribute att on att.attrelid = c.conrelid and att.attnum = c.conkey[1]
     where c.contype = 'f'
       and c.confrelid in ('public.shops'::regclass, 'public.malls'::regclass)
  loop
    if fk.parent_tbl = 'shops' then
      execute format('select count(*) from %I.%I where %I = any($1)', fk.child_schema, fk.child_tbl, fk.child_col)
        into v_dep using v_ids;
      if v_dep <> 0 then
        raise exception 'ABORT rollback: % row(s) in %.% reference imported shops via %; resolve first.',
          v_dep, fk.child_schema, fk.child_tbl, fk.child_col;
      end if;
    elsif fk.parent_tbl = 'malls' then
      if fk.child_schema = 'public' and fk.child_tbl = 'shops' and fk.child_col = 'mall_id' then
        continue;  -- the shops we are about to delete; handled by the scoped delete below
      end if;
      execute format('select count(*) from %I.%I where %I = $1', fk.child_schema, fk.child_tbl, fk.child_col)
        into v_dep using v_mall_id;
      if v_dep <> 0 then
        raise exception 'ABORT rollback: % row(s) in %.% reference this mall via %; resolve first.',
          v_dep, fk.child_schema, fk.child_tbl, fk.child_col;
      end if;
    end if;
  end loop;

  -- ── Delete ONLY the ${n} imported shops, scoped to this mall AND to the exact ids ─────
  delete from public.shops where mall_id = v_mall_id and id = any(v_ids);
  get diagnostics v_shops_deleted = row_count;
  if v_shops_deleted <> ${n} then
    raise exception 'ABORT rollback: expected to delete ${n} shops, deleted %.', v_shops_deleted;
  end if;

  -- Zero OTHER shops may remain attached to the mall before it is removed.
  select count(*) into v_remaining from public.shops where mall_id = v_mall_id;
  if v_remaining <> 0 then
    raise exception 'ABORT rollback: % non-imported shop(s) still attached to the mall; mall NOT deleted.', v_remaining;
  end if;

  -- Delete the mall row — must remove exactly one.
  delete from public.malls where id = v_mall_id;
  get diagnostics v_malls_deleted = row_count;
  if v_malls_deleted <> 1 then
    raise exception 'ABORT rollback: expected to delete exactly 1 mall row, deleted %.', v_malls_deleted;
  end if;

  raise notice 'Rollback OK: % imported shops + % mall row deleted.', v_shops_deleted, v_malls_deleted;
end $$;

commit;
`;
}

// ── Gate 9 verification SQL (read-only; deterministic preview↔DB parity) ──────
function buildVerify(rows) {
  const expected = rows.map((r) => {
    const c = r.proposed_db_mapping.columns;
    return "    (" + [
      shopIdExpr(r.canonical_store_id),
      sqlLit(r.retailer_name),
      sqlLit(r.store_number),
      sqlLit(r.phone),
      sqlLit(r.branch_status),
      sqlLit(r.verification_status),
      sqlNum(r.confidence),
      sqlLit(r.observed_at),
      sqlLit(r.last_verified_at),
      sqlLit(r.source_reference.primary_source_url),
      sqlLit(r.source_reference.source_owner),
      sqlLit(c.contradiction_notes),
      sqlLit(c.normalized_retailer_name),
    ].join(", ") + ")";
  }).join(",\n");
  const n = rows.length;
  return `-- ═══════════════════════════════════════════════════════════════════════════
-- GATE 9 VERIFICATION — Mall@Reds tenant import (mallmind-dev ONLY). READ-ONLY.
-- Deterministic preview↔database parity, returned as ONE consolidated result row.
-- Embeds all ${n} expected rows (derived from docs/sprint-2g/mallreds-tenant-import-preview.json)
-- and folds the per-row parity check and the reverse "unexpected shop" check into scalar
-- counts. Mutates nothing. Regenerate: node scripts/retail/generate-mallreds-import-sql.mjs --emit
--
-- Expected single row:
--   malls=1  malls_by_name=1  shops=${n}  products_total=0  floor_null=${n}  category_null=${n}
--   zone_null=${n}  opening_null=${n}  closing_null=${n}  provenance_complete=${n}
--   distinct_store_numbers=${n - 2}  game_count=0  incredible_count=0  shops_rls_enabled=t
--   preview_db_mismatch_count=0  unexpected_shops_on_mall=0
-- ═══════════════════════════════════════════════════════════════════════════
with
mall as (select ${MALL_ID_EXPR} as mall_id),

-- The exact ${n} expected rows, derived deterministically from the import preview.
expected(id, name, store_number, phone, branch_status, verification_status,
         confidence_score, observed_at, last_verified_at, primary_source_url,
         source_owner, contradiction_notes, normalized_retailer_name) as (
  values
${expected}
),

-- The exact ${n} expected deterministic shop ids (for the reverse check).
expected_ids as (
  select md5('mallmind:shop:' || cid)::uuid as id
    from unnest(array[
${rows.map((r) => `      ${sqlLit(r.canonical_store_id)}`).join(",\n")}
    ]::text[]) as cid
),

-- Preview↔DB per-row mismatches — SAME comparison logic as before (0 = perfect parity).
mismatches as (
  select e.id
    from expected e
    left join public.shops s on s.id = e.id
   where s.id is null
      or s.mall_id is distinct from (select mall_id from mall)
      or s.name is distinct from e.name
      or s.store_number is distinct from e.store_number
      or s.phone is distinct from e.phone
      or s.branch_status is distinct from e.branch_status
      or s.verification_status is distinct from e.verification_status
      or s.confidence_score is distinct from e.confidence_score
      or s.observed_at::date is distinct from e.observed_at::date
      or s.last_verified_at::date is distinct from e.last_verified_at::date
      or s.primary_source_url is distinct from e.primary_source_url
      or s.source_owner is distinct from e.source_owner
      or s.contradiction_notes is distinct from e.contradiction_notes
      or s.normalized_retailer_name is distinct from e.normalized_retailer_name
      or s.floor is not null or s.category is not null or s.zone is not null
      or s.unit_number is not null or s.website is not null
      or s.opening_time is not null or s.closing_time is not null
),

-- Any shop attached to the mall that is NOT one of the expected imported ids.
unexpected as (
  select s.id
    from public.shops s
   where s.mall_id = (select mall_id from mall)
     and s.id not in (select id from expected_ids)
)

select
  (select count(*) from public.malls where id = (select mall_id from mall))                              as malls,
  (select count(*) from public.malls where name = 'Mall@Reds')                                           as malls_by_name,
  (select count(*) from public.shops where mall_id = (select mall_id from mall))                         as shops,
  (select count(*) from public.products)                                                                 as products_total,
  (select count(*) from public.shops where mall_id = (select mall_id from mall) and floor        is null) as floor_null,
  (select count(*) from public.shops where mall_id = (select mall_id from mall) and category     is null) as category_null,
  (select count(*) from public.shops where mall_id = (select mall_id from mall) and zone         is null) as zone_null,
  (select count(*) from public.shops where mall_id = (select mall_id from mall) and opening_time is null) as opening_null,
  (select count(*) from public.shops where mall_id = (select mall_id from mall) and closing_time is null) as closing_null,
  (select count(*) from public.shops where mall_id = (select mall_id from mall)
     and store_number is not null and primary_source_url is not null
     and source_owner is not null and observed_at is not null)                                           as provenance_complete,
  (select count(distinct store_number) from public.shops where mall_id = (select mall_id from mall))     as distinct_store_numbers,
  (select count(*) from public.shops where mall_id = (select mall_id from mall) and name ~* '(^|[^a-z])game([^a-z]|$)') as game_count,
  (select count(*) from public.shops where mall_id = (select mall_id from mall) and name ~* 'incredible connection')    as incredible_count,
  (select relrowsecurity from pg_class where oid = 'public.shops'::regclass)                             as shops_rls_enabled,
  (select count(*) from mismatches)                                                                      as preview_db_mismatch_count,
  (select count(*) from unexpected)                                                                      as unexpected_shops_on_mall;
`;
}

// ── Safety scan of generated SQL (Gate 6) ─────────────────────────────────────
function scanSql(sql, rows) {
  const checks = [];
  const add = (name, pass, detail = "") => checks.push({ name, pass, detail });

  // Negative token scans run against EXECUTABLE SQL only: strip full-line `--`
  // comments so documentation prose ("no upsert", "production forbidden") can't
  // trip a forbidden-token check.
  const code = sql.split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n");

  const valueRows = (sql.match(/md5\('mallmind:shop:/g) || []).length
    // subtract the guard's single md5('mallmind:shop:' || cid) template occurrence
    - (sql.match(/md5\('mallmind:shop:' \|\| cid\)/g) || []).length;
  add("exactly N shop VALUES rows", valueRows === rows.length, `${valueRows} vs ${rows.length}`);

  const ids = rows.map((r) => r.canonical_store_id);
  add("canonical ids unique", new Set(ids).size === ids.length);

  add("no upsert clause (aborts, never silently skips)", !/on\s+conflict/i.test(code));
  const gameRow = rows.some((r) => /\bgame\b/i.test(r.retailer_name));
  add("no Game tenant row", !gameRow);
  const icRow = rows.some((r) => /incredible connection/i.test(r.retailer_name));
  add("no Incredible Connection tenant row", !icRow);

  // Forbidden concepts must not appear as inserted columns/tables (executable SQL only).
  add("no product/price table touched", !/insert\s+into\s+public\.(products|retail_price_observations|retail_source_snapshots)/i.test(code));
  add("no route graph touched", !/insert\s+into\s+public\.(mall_nodes|mall_edges)/i.test(code));
  add("no publish/offer operation", !/publish|offer|price_observation|discount/i.test(code));
  add("no production ref present (anywhere in file)", !/qspsouemjtcdcfnivpnt/i.test(sql));

  // Every shop VALUES tuple must carry NULL floor/category/zone/hours in the fixed slots.
  // (Structural: the generator always emits null in those positions; assert none carry a
  //  quoted value where NULL is required by counting 'null' occurrences per row is fragile,
  //  so we assert the preview itself has them null — the generator mirrors it 1:1.)
  add("preview floors all NULL", rows.every((r) => r.floor === null));
  add("preview categories all NULL", rows.every((r) => r.proposed_db_mapping.columns.category === null));
  add("preview zones all NULL", rows.every((r) => r.zone === null));
  add("every store_number evidenced", rows.every((r) => r.store_number && r.source_reference.primary_source_url && r.verification_status === "official_directory"));

  return checks;
}

// ── Run ───────────────────────────────────────────────────────────────────────
const emit = process.argv.includes("--emit") || process.argv.includes("--write");
const { rows } = loadRows();
const tx = buildTransaction(rows);
const rb = buildRollback(rows);
const vf = buildVerify(rows);

if (emit) {
  writeFileSync(SQL_PATH, tx);
  writeFileSync(ROLLBACK_PATH, rb);
  writeFileSync(VERIFY_PATH, vf);
  console.log(`Wrote ${SQL_PATH}, ${ROLLBACK_PATH}, and ${VERIFY_PATH} (${rows.length} shops).`);
}

let committedTx, committedRb, committedVf;
try {
  committedTx = readFileSync(SQL_PATH, "utf8");
  committedRb = readFileSync(ROLLBACK_PATH, "utf8");
  committedVf = readFileSync(VERIFY_PATH, "utf8");
} catch {
  fail(`Import SQL not found. Run with --emit first.`);
}
if (committedTx !== tx) fail("Committed import SQL does not match the deterministic derivation. Re-run with --emit.");
if (committedRb !== rb) fail("Committed rollback SQL does not match the deterministic derivation. Re-run with --emit.");
if (committedVf !== vf) fail("Committed verify SQL does not match the deterministic derivation. Re-run with --emit.");

const checks = scanSql(committedTx, rows);
console.log("Mall@Reds import SQL — deterministic generation + safety scan (Sprint 2H)");
console.log("=".repeat(70));
for (const c of checks) console.log(`  ${c.pass ? "PASS" : "FAIL"}  ${c.name}${c.detail ? "  (" + c.detail + ")" : ""}`);
console.log("-".repeat(70));
const failed = checks.filter((c) => !c.pass);
if (failed.length) fail(`${failed.length} SQL safety check(s) FAILED.`);
console.log(`ALL ${checks.length} SQL SAFETY CHECKS PASS — 1 mall + ${rows.length} shops, unknowns NULL, no products/routes/publication.`);
console.log("NO database mutation performed by this script.");
