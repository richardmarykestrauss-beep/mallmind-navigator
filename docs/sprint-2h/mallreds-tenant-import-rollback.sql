-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK — Mall@Reds controlled tenant import (Sprint 2H Gate 2). mallmind-dev ONLY.
-- Deletes ONLY the 113 shops whose ids are the EXACT deterministic ids produced by
-- mallreds-tenant-import.sql, scoped to the deterministic Mall@Reds mall, plus that one
-- mall row. It rebuilds the same 113 canonical ids → uuids used by the import, asserts the
-- expected pre-state, refuses if ANY other/dependent row would be touched (dynamic FK
-- check over CURRENT foreign-key contracts), and aborts (EXCEPTION, never warning) on any
-- count mismatch. Fully atomic. Preserves retail_data_sources, products, and all other data.
-- NOT auto-executed. Run as a role that bypasses RLS.
-- ═══════════════════════════════════════════════════════════════════════════
begin;

do $$
declare
  v_mall_id       uuid := md5('mallmind:mall:mallreds')::uuid;
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
  -- Rebuild the EXACT 113 deterministic imported shop uuids from the SAME canonical ids
  -- the import used (md5('mallmind:shop:'||canonical_store_id)::uuid).
  select array_agg(md5('mallmind:shop:' || cid)::uuid)
    into v_ids
    from unnest(array[
    'mallreds-shop-01a',
    'mallreds-shop-02',
    'mallreds-shop-04',
    'mallreds-shop-05',
    'mallreds-shop-06',
    'mallreds-shop-08',
    'mallreds-shop-09b',
    'mallreds-shop-10',
    'mallreds-shop-101',
    'mallreds-shop-102',
    'mallreds-shop-103',
    'mallreds-shop-105',
    'mallreds-shop-106',
    'mallreds-shop-108',
    'mallreds-shop-109',
    'mallreds-shop-111',
    'mallreds-shop-114',
    'mallreds-shop-115',
    'mallreds-shop-116',
    'mallreds-shop-13',
    'mallreds-shop-14_16',
    'mallreds-shop-142',
    'mallreds-shop-143b',
    'mallreds-shop-144',
    'mallreds-shop-145',
    'mallreds-shop-17',
    'mallreds-shop-18a',
    'mallreds-shop-19',
    'mallreds-shop-19a',
    'mallreds-shop-1b',
    'mallreds-shop-1c',
    'mallreds-shop-2',
    'mallreds-shop-20a',
    'mallreds-shop-21',
    'mallreds-shop-22',
    'mallreds-shop-23',
    'mallreds-shop-24',
    'mallreds-shop-25',
    'mallreds-shop-26',
    'mallreds-shop-28',
    'mallreds-shop-29',
    'mallreds-shop-30b',
    'mallreds-shop-31',
    'mallreds-shop-31a',
    'mallreds-shop-31c',
    'mallreds-shop-31d',
    'mallreds-shop-32',
    'mallreds-shop-33',
    'mallreds-shop-35a',
    'mallreds-shop-35b',
    'mallreds-shop-36',
    'mallreds-shop-39',
    'mallreds-shop-3b',
    'mallreds-shop-3c',
    'mallreds-shop-40',
    'mallreds-shop-40a',
    'mallreds-shop-42',
    'mallreds-shop-43',
    'mallreds-shop-44',
    'mallreds-shop-45',
    'mallreds-shop-47',
    'mallreds-shop-48',
    'mallreds-shop-49',
    'mallreds-shop-50',
    'mallreds-shop-50b',
    'mallreds-shop-51',
    'mallreds-shop-52',
    'mallreds-shop-53',
    'mallreds-shop-55',
    'mallreds-shop-56',
    'mallreds-shop-57',
    'mallreds-shop-59',
    'mallreds-shop-60',
    'mallreds-shop-60a',
    'mallreds-shop-62',
    'mallreds-shop-63',
    'mallreds-shop-68',
    'mallreds-shop-70',
    'mallreds-shop-72',
    'mallreds-shop-73',
    'mallreds-shop-75g',
    'mallreds-shop-76',
    'mallreds-shop-77',
    'mallreds-shop-78',
    'mallreds-shop-80',
    'mallreds-shop-80a',
    'mallreds-shop-80a_2',
    'mallreds-shop-81',
    'mallreds-shop-82',
    'mallreds-shop-83',
    'mallreds-shop-84',
    'mallreds-shop-85',
    'mallreds-shop-86',
    'mallreds-shop-87',
    'mallreds-shop-88',
    'mallreds-shop-88_2',
    'mallreds-shop-92',
    'mallreds-shop-95',
    'mallreds-shop-96',
    'mallreds-shop-98',
    'mallreds-shop-99',
    'mallreds-shop-e402',
    'mallreds-shop-e403',
    'mallreds-shop-e405',
    'mallreds-shop-e408',
    'mallreds-shop-kiosk',
    'mallreds-shop-kiosk_2',
    'mallreds-shop-kiosk_4',
    'mallreds-shop-kiosk_5',
    'mallreds-shop-kiosk_6',
    'mallreds-shop-m5',
    'mallreds-shop-pw2',
    'mallreds-shop-r65'
    ]::text[]) as cid;
  if coalesce(array_length(v_ids, 1), 0) <> 113 then
    raise exception 'ABORT rollback: expected 113 canonical ids, built %.', coalesce(array_length(v_ids, 1), 0);
  end if;

  -- (a) the deterministic Mall@Reds mall row must exist exactly once
  select count(*) into v_mall_count from public.malls where id = v_mall_id;
  if v_mall_count <> 1 then
    raise exception 'ABORT rollback: expected exactly 1 Mall@Reds mall row (id=%), found %.', v_mall_id, v_mall_count;
  end if;

  -- (b) exactly 113 imported shop ids must exist
  select count(*) into v_matching from public.shops where id = any(v_ids);
  if v_matching <> 113 then
    raise exception 'ABORT rollback: expected 113 imported shops, found %.', v_matching;
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

  -- ── Delete ONLY the 113 imported shops, scoped to this mall AND to the exact ids ─────
  delete from public.shops where mall_id = v_mall_id and id = any(v_ids);
  get diagnostics v_shops_deleted = row_count;
  if v_shops_deleted <> 113 then
    raise exception 'ABORT rollback: expected to delete 113 shops, deleted %.', v_shops_deleted;
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
