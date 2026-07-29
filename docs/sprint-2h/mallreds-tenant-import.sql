-- ═══════════════════════════════════════════════════════════════════════════
-- Mall@Reds controlled tenant import — Sprint 2H Gate 2 (mallmind-dev ONLY)
-- Target project ref: iivmrlgntspbkpfqoboi   (DEV). Production project: FORBIDDEN,
-- ref intentionally omitted from this file.
-- GENERATED from docs/sprint-2g/mallreds-tenant-import-preview.json — do not hand-edit.
-- Regenerate: node scripts/retail/generate-mallreds-import-sql.mjs --emit
--
-- Inserts exactly ONE Mall@Reds mall row and exactly 113 shops. Every unknown
-- field stays NULL (floor, category, zone, hours, website, coordinates). No products,
-- no route nodes/edges, no publication. It aborts (never silently skips) if a row already
-- exists — there is no upsert clause. Runs as one atomic transaction.
-- Run as a role that bypasses RLS (Dashboard SQL editor = postgres, or service_role).
-- ═══════════════════════════════════════════════════════════════════════════
begin;

-- ── Pre-state guards: refuse (abort) if anything already exists ───────────────
do $$
declare
  v_mall_id uuid := md5('mallmind:mall:mallreds')::uuid;
  v_existing_shops int;
begin
  if exists (select 1 from public.malls where id = v_mall_id) then
    raise exception 'ABORT: Mall@Reds mall row already exists (id=%).', v_mall_id;
  end if;
  if exists (select 1 from public.malls where name = 'Mall@Reds') then
    raise exception 'ABORT: a mall named % already exists.', 'Mall@Reds';
  end if;
  -- none of the 113 deterministic shop ids may already exist
  select count(*) into v_existing_shops
    from public.shops
   where id = any (
     select md5('mallmind:shop:' || cid)::uuid
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
  (md5('mallmind:mall:mallreds')::uuid, 'Mall@Reds', 'Centurion', 'Gauteng',
   'cnr Rooihuiskraal Road and Hendrik Verwoerd Drive, Rooihuiskraal X15, Centurion, Gauteng, 0157', '012 656 8957', 'https://www.mallatreds.co.za/',
   null, 113, null, null, null, null, null, null, null, true);

-- ── Insert exactly 113 shops (every unknown NULL) ───────────────────────────
insert into public.shops
  (id, mall_id, name, category, floor, unit_number, store_number, zone, phone, website,
   opening_time, closing_time, branch_status, verification_status, confidence_score,
   observed_at, last_verified_at, primary_source_url, source_owner, contradiction_notes,
   normalized_retailer_name)
values
  (md5('mallmind:shop:mallreds-shop-01a')::uuid, md5('mallmind:mall:mallreds')::uuid, 'Ola Milky Lane', null, null, null, '01A', null, '012 656 0362', null, null, null, 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'ola_milky_lane'),
  (md5('mallmind:shop:mallreds-shop-02')::uuid, md5('mallmind:mall:mallreds')::uuid, 'Kung-Fu Kitchen', null, null, null, '02', null, '012 656 7234', null, null, null, 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'kung_fu_kitchen'),
  (md5('mallmind:shop:mallreds-shop-04')::uuid, md5('mallmind:mall:mallreds')::uuid, 'Legends Barber', null, null, null, '04', null, '069 676 4487', null, null, null, 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'legends_barber'),
  (md5('mallmind:shop:mallreds-shop-05')::uuid, md5('mallmind:mall:mallreds')::uuid, 'Del Forno', null, null, null, '05', null, '012 004 0962', null, null, null, 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'del_forno'),
  (md5('mallmind:shop:mallreds-shop-06')::uuid, md5('mallmind:mall:mallreds')::uuid, 'Mugg & Bean', null, null, null, '06', null, '012 656 8987', null, null, null, 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'mugg_bean'),
  (md5('mallmind:shop:mallreds-shop-08')::uuid, md5('mallmind:mall:mallreds')::uuid, 'Wimpy', null, null, null, '08', null, '012 656 8865', null, null, null, 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'wimpy'),
  (md5('mallmind:shop:mallreds-shop-09b')::uuid, md5('mallmind:mall:mallreds')::uuid, 'The Good Masala', null, null, null, '09B', null, '084 777 0880', null, null, null, 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'the_good_masala'),
  (md5('mallmind:shop:mallreds-shop-10')::uuid, md5('mallmind:mall:mallreds')::uuid, 'Cell World/SmartFix', null, null, null, '10', null, '012 656 3066', null, null, null, 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'cell_world_smartfix'),
  (md5('mallmind:shop:mallreds-shop-101')::uuid, md5('mallmind:mall:mallreds')::uuid, 'WAXIT', null, null, null, '101', null, '010 140 2926', null, null, null, 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'waxit'),
  (md5('mallmind:shop:mallreds-shop-102')::uuid, md5('mallmind:mall:mallreds')::uuid, 'Nedbank', null, null, null, '102', null, '012 656 6700', null, null, null, 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'nedbank'),
  (md5('mallmind:shop:mallreds-shop-103')::uuid, md5('mallmind:mall:mallreds')::uuid, 'PEP Home', null, null, null, '103', null, '012 656 1614', null, null, null, 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'pep_home'),
  (md5('mallmind:shop:mallreds-shop-105')::uuid, md5('mallmind:mall:mallreds')::uuid, 'Farrah Quartz', null, null, null, '105', null, '012 656 7540', null, null, null, 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'farrah_quartz'),
  (md5('mallmind:shop:mallreds-shop-106')::uuid, md5('mallmind:mall:mallreds')::uuid, 'Exclusive Hair', null, null, null, '106', null, '071 092 8529 / 076 848 4179', null, null, null, 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'exclusive_hair'),
  (md5('mallmind:shop:mallreds-shop-108')::uuid, md5('mallmind:mall:mallreds')::uuid, 'Mr Price', null, null, null, '108', null, '087 049 3669', null, null, null, 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'mr_price'),
  (md5('mallmind:shop:mallreds-shop-109')::uuid, md5('mallmind:mall:mallreds')::uuid, 'Mr Price Home', null, null, null, '109', null, '012 656 9607', null, null, null, 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'mr_price_home'),
  (md5('mallmind:shop:mallreds-shop-111')::uuid, md5('mallmind:mall:mallreds')::uuid, 'Woolworths', null, null, null, '111', null, '012 656 6800', null, null, null, 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'woolworths'),
  (md5('mallmind:shop:mallreds-shop-114')::uuid, md5('mallmind:mall:mallreds')::uuid, 'Nando''s', null, null, null, '114', null, '012 656 1426', null, null, null, 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'nando_s'),
  (md5('mallmind:shop:mallreds-shop-115')::uuid, md5('mallmind:mall:mallreds')::uuid, 'McDonald''s', null, null, null, '115', null, '012 656 1386', null, null, null, 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'mcdonald_s'),
  (md5('mallmind:shop:mallreds-shop-116')::uuid, md5('mallmind:mall:mallreds')::uuid, 'Virgin Active', null, null, null, '116', null, '012 656 0920', null, null, null, 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'virgin_active'),
  (md5('mallmind:shop:mallreds-shop-13')::uuid, md5('mallmind:mall:mallreds')::uuid, 'Pizza Hut', null, null, null, '13', null, '072 742 7854', null, null, null, 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'pizza_hut'),
  (md5('mallmind:shop:mallreds-shop-14_16')::uuid, md5('mallmind:mall:mallreds')::uuid, 'Vodashop', null, null, null, '14-16', null, '012 653 2883 / 012 653 9569', null, null, null, 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'vodashop'),
  (md5('mallmind:shop:mallreds-shop-142')::uuid, md5('mallmind:mall:mallreds')::uuid, 'Ocean Basket', null, null, null, '142', null, '012 656 0526', null, null, null, 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'ocean_basket'),
  (md5('mallmind:shop:mallreds-shop-143b')::uuid, md5('mallmind:mall:mallreds')::uuid, 'Rasam Tandoori Indian Restaurant', null, null, null, '143B', null, '083 328 3491', null, null, null, 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'rasam_tandoori_indian_restaurant'),
  (md5('mallmind:shop:mallreds-shop-144')::uuid, md5('mallmind:mall:mallreds')::uuid, 'Barcelos', null, null, null, '144', null, '012 884 6030', null, null, null, 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'barcelos'),
  (md5('mallmind:shop:mallreds-shop-145')::uuid, md5('mallmind:mall:mallreds')::uuid, 'Hogshead', null, null, null, '145', null, '087 160 0283', null, null, null, 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'hogshead'),
  (md5('mallmind:shop:mallreds-shop-17')::uuid, md5('mallmind:mall:mallreds')::uuid, 'Telkom', null, null, null, '17', null, '012 664 1179', null, null, null, 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'telkom'),
  (md5('mallmind:shop:mallreds-shop-18a')::uuid, md5('mallmind:mall:mallreds')::uuid, 'Delhi Delicious', null, null, null, '18a', null, '083 786 1760', null, null, null, 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'delhi_delicious'),
  (md5('mallmind:shop:mallreds-shop-19')::uuid, md5('mallmind:mall:mallreds')::uuid, 'Sheet Street', null, null, null, '19', null, '087 750 1977', null, null, null, 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'sheet_street'),
  (md5('mallmind:shop:mallreds-shop-19a')::uuid, md5('mallmind:mall:mallreds')::uuid, 'Lovisa', null, null, null, '19A', null, '010 143 0772', null, null, null, 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'lovisa'),
  (md5('mallmind:shop:mallreds-shop-1b')::uuid, md5('mallmind:mall:mallreds')::uuid, 'Fish & Chips', null, null, null, '1B', null, '061 411 9302', null, null, null, 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'fish_chips'),
  (md5('mallmind:shop:mallreds-shop-1c')::uuid, md5('mallmind:mall:mallreds')::uuid, 'Mochachos', null, null, null, '1C', null, '076 616 7866', null, null, null, 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'mochachos'),
  (md5('mallmind:shop:mallreds-shop-2')::uuid, md5('mallmind:mall:mallreds')::uuid, 'One and Only Flower Shop', null, null, null, '2', null, '076 066 1549', null, null, null, 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'one_and_only_flower_shop'),
  (md5('mallmind:shop:mallreds-shop-20a')::uuid, md5('mallmind:mall:mallreds')::uuid, 'Party City', null, null, null, '20A', null, '012 656 8982', null, null, null, 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'party_city'),
  (md5('mallmind:shop:mallreds-shop-21')::uuid, md5('mallmind:mall:mallreds')::uuid, 'Amazing Tobacco', null, null, null, '21', null, '078 699 0450', null, null, null, 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'amazing_tobacco'),
  (md5('mallmind:shop:mallreds-shop-22')::uuid, md5('mallmind:mall:mallreds')::uuid, 'Ru''s African Art', null, null, null, '22', null, '073 835 6900', null, null, null, 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'ru_s_african_art'),
  (md5('mallmind:shop:mallreds-shop-23')::uuid, md5('mallmind:mall:mallreds')::uuid, 'Boutique Istanbul', null, null, null, '23', null, '082 221 7769', null, null, null, 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'boutique_istanbul'),
  (md5('mallmind:shop:mallreds-shop-24')::uuid, md5('mallmind:mall:mallreds')::uuid, 'The Little Cake Shop', null, null, null, '24', null, '012 656 1246', null, null, null, 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'the_little_cake_shop'),
  (md5('mallmind:shop:mallreds-shop-25')::uuid, md5('mallmind:mall:mallreds')::uuid, 'Sorbet', null, null, null, '25', null, '012 656 0567', null, null, null, 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'sorbet'),
  (md5('mallmind:shop:mallreds-shop-26')::uuid, md5('mallmind:mall:mallreds')::uuid, 'Torga Optical', null, null, null, '26', null, '012 656 8952 / 012 656 8953', null, null, null, 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'torga_optical'),
  (md5('mallmind:shop:mallreds-shop-28')::uuid, md5('mallmind:mall:mallreds')::uuid, 'De Rovers', null, null, null, '28', null, '074 395 1843', null, null, null, 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'de_rovers'),
  (md5('mallmind:shop:mallreds-shop-29')::uuid, md5('mallmind:mall:mallreds')::uuid, 'Miladys', null, null, null, '29', null, '087 750 8827', null, null, null, 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'miladys'),
  (md5('mallmind:shop:mallreds-shop-30b')::uuid, md5('mallmind:mall:mallreds')::uuid, 'fbo', null, null, null, '30B', null, '012 944 1061', null, null, null, 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'fbo'),
  (md5('mallmind:shop:mallreds-shop-31')::uuid, md5('mallmind:mall:mallreds')::uuid, 'FNB', null, null, null, '31', null, '087 575 0147 / 087 345 1290', null, null, null, 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'fnb'),
  (md5('mallmind:shop:mallreds-shop-31a')::uuid, md5('mallmind:mall:mallreds')::uuid, 'Cardies', null, null, null, '31A', null, '012 656 8951', null, null, null, 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'cardies'),
  (md5('mallmind:shop:mallreds-shop-31c')::uuid, md5('mallmind:mall:mallreds')::uuid, 'Aero Soft Shoes', null, null, null, '31C', null, '079 293 8038', null, null, null, 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'aero_soft_shoes'),
  (md5('mallmind:shop:mallreds-shop-31d')::uuid, md5('mallmind:mall:mallreds')::uuid, 'Soviet', null, null, null, '31D', null, '011 061 0615', null, null, null, 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'soviet'),
  (md5('mallmind:shop:mallreds-shop-32')::uuid, md5('mallmind:mall:mallreds')::uuid, 'Copy Express', null, null, null, '32', null, '012 656 3331', null, null, null, 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'copy_express'),
  (md5('mallmind:shop:mallreds-shop-33')::uuid, md5('mallmind:mall:mallreds')::uuid, 'SkinPHD', null, null, null, '33', null, '012 656 9118 / 012 656 9119', null, null, null, 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'skinphd'),
  (md5('mallmind:shop:mallreds-shop-35a')::uuid, md5('mallmind:mall:mallreds')::uuid, 'SA Home Loans', null, null, null, '35A', null, '081 774 4289', null, null, null, 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'sa_home_loans'),
  (md5('mallmind:shop:mallreds-shop-35b')::uuid, md5('mallmind:mall:mallreds')::uuid, 'Kitwe Laundry', null, null, null, '35B', null, '012 656 9008', null, null, null, 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'kitwe_laundry'),
  (md5('mallmind:shop:mallreds-shop-36')::uuid, md5('mallmind:mall:mallreds')::uuid, 'Tasko Sweets', null, null, null, '36', null, '083 253 4591', null, null, null, 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'tasko_sweets'),
  (md5('mallmind:shop:mallreds-shop-39')::uuid, md5('mallmind:mall:mallreds')::uuid, 'Pick n Pay Clothing', null, null, null, '39', null, '012 656 8176', null, null, null, 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'pick_n_pay_clothing'),
  (md5('mallmind:shop:mallreds-shop-3b')::uuid, md5('mallmind:mall:mallreds')::uuid, 'Barber SA', null, null, null, '3B', null, '073 193 8584', null, null, null, 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'barber_sa'),
  (md5('mallmind:shop:mallreds-shop-3c')::uuid, md5('mallmind:mall:mallreds')::uuid, 'Mobizone', null, null, null, '3C', null, '060 777 8777', null, null, null, 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'mobizone'),
  (md5('mallmind:shop:mallreds-shop-40')::uuid, md5('mallmind:mall:mallreds')::uuid, 'PEP Stores', null, null, null, '40', null, '012 656 0230', null, null, null, 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'pep_stores'),
  (md5('mallmind:shop:mallreds-shop-40a')::uuid, md5('mallmind:mall:mallreds')::uuid, 'Charisma', null, null, null, '40A', null, '061 309 3482', null, null, null, 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'charisma'),
  (md5('mallmind:shop:mallreds-shop-42')::uuid, md5('mallmind:mall:mallreds')::uuid, 'Ackermans', null, null, null, '42', null, '012 656 0035', null, null, null, 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'ackermans'),
  (md5('mallmind:shop:mallreds-shop-43')::uuid, md5('mallmind:mall:mallreds')::uuid, 'Edgars', null, null, null, '43', null, '010 593 8316', null, null, null, 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'edgars'),
  (md5('mallmind:shop:mallreds-shop-44')::uuid, md5('mallmind:mall:mallreds')::uuid, 'Truworths', null, null, null, '44', null, '087 757 0260', null, null, null, 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'truworths'),
  (md5('mallmind:shop:mallreds-shop-45')::uuid, md5('mallmind:mall:mallreds')::uuid, 'Clicks', null, null, null, '45', null, '012 656 8850', null, null, null, 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'clicks'),
  (md5('mallmind:shop:mallreds-shop-47')::uuid, md5('mallmind:mall:mallreds')::uuid, 'Cups & Cones', null, null, null, '47', null, '083 377 3013', null, null, null, 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'cups_cones'),
  (md5('mallmind:shop:mallreds-shop-48')::uuid, md5('mallmind:mall:mallreds')::uuid, 'King Pie', null, null, null, '48', null, '072 706 6666', null, null, null, 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'king_pie'),
  (md5('mallmind:shop:mallreds-shop-49')::uuid, md5('mallmind:mall:mallreds')::uuid, 'Pro-Tech', null, null, null, '49', null, '064 073 2889', null, null, null, 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'pro_tech'),
  (md5('mallmind:shop:mallreds-shop-50')::uuid, md5('mallmind:mall:mallreds')::uuid, 'Pick n Pay', null, null, null, '50', null, '012 656 9562', null, null, null, 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'pick_n_pay'),
  (md5('mallmind:shop:mallreds-shop-50b')::uuid, md5('mallmind:mall:mallreds')::uuid, 'Homemark', null, null, null, '50B', null, '076 202 7981', null, null, null, 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'homemark'),
  (md5('mallmind:shop:mallreds-shop-51')::uuid, md5('mallmind:mall:mallreds')::uuid, 'MTN', null, null, null, '51', null, '083 869 6739', null, null, null, 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'mtn'),
  (md5('mallmind:shop:mallreds-shop-52')::uuid, md5('mallmind:mall:mallreds')::uuid, 'Absolute Pets', null, null, null, '52', null, '012 004 3496', null, null, null, 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'absolute_pets'),
  (md5('mallmind:shop:mallreds-shop-53')::uuid, md5('mallmind:mall:mallreds')::uuid, 'Biltong Republic', null, null, null, '53', null, '065 633 5211', null, null, null, 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'biltong_republic'),
  (md5('mallmind:shop:mallreds-shop-55')::uuid, md5('mallmind:mall:mallreds')::uuid, 'Spec-Savers', null, null, null, '55', null, '012 656 8916', null, null, null, 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'spec_savers'),
  (md5('mallmind:shop:mallreds-shop-56')::uuid, md5('mallmind:mall:mallreds')::uuid, 'Crazy Store', null, null, null, '56', null, '087 135 8804', null, null, null, 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'crazy_store'),
  (md5('mallmind:shop:mallreds-shop-57')::uuid, md5('mallmind:mall:mallreds')::uuid, 'Footgear', null, null, null, '57', null, '087 286 6032', null, null, null, 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'footgear'),
  (md5('mallmind:shop:mallreds-shop-59')::uuid, md5('mallmind:mall:mallreds')::uuid, 'Mr Price Sport', null, null, null, '59', null, '087 750 8707', null, null, null, 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'mr_price_sport'),
  (md5('mallmind:shop:mallreds-shop-60')::uuid, md5('mallmind:mall:mallreds')::uuid, 'Senqu', null, null, null, '60', null, '087 283 3529', null, null, null, 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'senqu'),
  (md5('mallmind:shop:mallreds-shop-60a')::uuid, md5('mallmind:mall:mallreds')::uuid, 'Health Twin Vitamins & Supplements', null, null, null, '60A', null, '079 691 4579', null, null, null, 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'health_twin_vitamins_supplements'),
  (md5('mallmind:shop:mallreds-shop-62')::uuid, md5('mallmind:mall:mallreds')::uuid, 'Tekkie Town', null, null, null, '62', null, '087 802 9084', null, null, null, 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'tekkie_town'),
  (md5('mallmind:shop:mallreds-shop-63')::uuid, md5('mallmind:mall:mallreds')::uuid, 'Capitec Bank', null, null, null, '63', null, '087 756 0245', null, null, null, 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'capitec_bank'),
  (md5('mallmind:shop:mallreds-shop-68')::uuid, md5('mallmind:mall:mallreds')::uuid, 'Funtubbles', null, null, null, '68', null, '084 923 9381', null, null, null, 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'funtubbles'),
  (md5('mallmind:shop:mallreds-shop-70')::uuid, md5('mallmind:mall:mallreds')::uuid, 'Goldrush', null, null, null, '70', null, '012 656 1062 / 012 747 6250', null, null, null, 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'goldrush'),
  (md5('mallmind:shop:mallreds-shop-72')::uuid, md5('mallmind:mall:mallreds')::uuid, 'Pick n Pay Liquor', null, null, null, '72', null, '012 656 9679', null, null, null, 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'pick_n_pay_liquor'),
  (md5('mallmind:shop:mallreds-shop-73')::uuid, md5('mallmind:mall:mallreds')::uuid, 'Cash Converters', null, null, null, '73', null, '012 656 9143', null, null, null, 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'cash_converters'),
  (md5('mallmind:shop:mallreds-shop-75g')::uuid, md5('mallmind:mall:mallreds')::uuid, 'Bossa', null, null, null, '75G', null, '010 102 0300', null, null, null, 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'bossa'),
  (md5('mallmind:shop:mallreds-shop-76')::uuid, md5('mallmind:mall:mallreds')::uuid, 'Steers Drive Thru', null, null, null, '76', null, '012 656 8933', null, null, null, 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'steers_drive_thru'),
  (md5('mallmind:shop:mallreds-shop-77')::uuid, md5('mallmind:mall:mallreds')::uuid, 'Mattress & Couch', null, null, null, '77', null, '069 430 3937', null, null, null, 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'mattress_couch'),
  (md5('mallmind:shop:mallreds-shop-78')::uuid, md5('mallmind:mall:mallreds')::uuid, 'Value Co.', null, null, null, '78', null, '012 656 3071', null, null, null, 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'value_co'),
  (md5('mallmind:shop:mallreds-shop-80')::uuid, md5('mallmind:mall:mallreds')::uuid, 'Standard Bank', null, null, null, '80', null, '012 656 6917', null, null, null, 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'standard_bank'),
  (md5('mallmind:shop:mallreds-shop-80a')::uuid, md5('mallmind:mall:mallreds')::uuid, 'Clothing Junction', null, null, null, '80A', null, '087 087 8099', null, null, null, 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'clothing_junction'),
  (md5('mallmind:shop:mallreds-shop-80a_2')::uuid, md5('mallmind:mall:mallreds')::uuid, 'Homeware & Tech', null, null, null, '80A', null, '063 287 0102', null, null, null, 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', 'Shares a store_number with another official-directory listing; suffix appended to keep canonical_store_id unique. The store_number itself is preserved verbatim and NOT invented.', 'homeware_tech'),
  (md5('mallmind:shop:mallreds-shop-81')::uuid, md5('mallmind:mall:mallreds')::uuid, 'Exact', null, null, null, '81', null, '012 656 5528', null, null, null, 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'exact'),
  (md5('mallmind:shop:mallreds-shop-82')::uuid, md5('mallmind:mall:mallreds')::uuid, 'Markham', null, null, null, '82', null, '012 656 5526', null, null, null, 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'markham'),
  (md5('mallmind:shop:mallreds-shop-83')::uuid, md5('mallmind:mall:mallreds')::uuid, 'Sportscene', null, null, null, '83', null, '012 656 5523', null, null, null, 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'sportscene'),
  (md5('mallmind:shop:mallreds-shop-84')::uuid, md5('mallmind:mall:mallreds')::uuid, 'Contempo', null, null, null, '84', null, '012 884 0014', null, null, null, 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'contempo'),
  (md5('mallmind:shop:mallreds-shop-85')::uuid, md5('mallmind:mall:mallreds')::uuid, 'SA National Blood Services', null, null, null, '85', null, '082 419 1472', null, null, null, 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'sa_national_blood_services'),
  (md5('mallmind:shop:mallreds-shop-86')::uuid, md5('mallmind:mall:mallreds')::uuid, 'American Swiss', null, null, null, '86', null, '012 656 5518 / 012 656 5519', null, null, null, 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'american_swiss'),
  (md5('mallmind:shop:mallreds-shop-87')::uuid, md5('mallmind:mall:mallreds')::uuid, 'Foschini', null, null, null, '87', null, '012 656 5500', null, null, null, 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'foschini'),
  (md5('mallmind:shop:mallreds-shop-88')::uuid, md5('mallmind:mall:mallreds')::uuid, 'Dis-Chem', null, null, null, '88', null, '012 656 8974 / 012 656 8975', null, null, null, 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'dis_chem'),
  (md5('mallmind:shop:mallreds-shop-88_2')::uuid, md5('mallmind:mall:mallreds')::uuid, 'Sunrise Home', null, null, null, '88', null, '074 753 9276', null, null, null, 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', 'Shares a store_number with another official-directory listing; suffix appended to keep canonical_store_id unique. The store_number itself is preserved verbatim and NOT invented.', 'sunrise_home'),
  (md5('mallmind:shop:mallreds-shop-92')::uuid, md5('mallmind:mall:mallreds')::uuid, 'Tiger Wheel & Tyre', null, null, null, '92', null, '012 055 1104', null, null, null, 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'tiger_wheel_tyre'),
  (md5('mallmind:shop:mallreds-shop-95')::uuid, md5('mallmind:mall:mallreds')::uuid, 'Jet', null, null, null, '95', null, '012 656 6880', null, null, null, 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'jet'),
  (md5('mallmind:shop:mallreds-shop-96')::uuid, md5('mallmind:mall:mallreds')::uuid, 'Absa', null, null, null, '96', null, '012 656 6437', null, null, null, 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'absa'),
  (md5('mallmind:shop:mallreds-shop-98')::uuid, md5('mallmind:mall:mallreds')::uuid, 'Bag and Style', null, null, null, '98', null, '062 599 0991', null, null, null, 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'bag_and_style'),
  (md5('mallmind:shop:mallreds-shop-99')::uuid, md5('mallmind:mall:mallreds')::uuid, 'HiPhone', null, null, null, '99', null, '012 656 0011', null, null, null, 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'hiphone'),
  (md5('mallmind:shop:mallreds-shop-e402')::uuid, md5('mallmind:mall:mallreds')::uuid, 'Anaprop Property Management', null, null, null, 'E402', null, '012 656 8957', null, null, null, 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'anaprop_property_management'),
  (md5('mallmind:shop:mallreds-shop-e403')::uuid, md5('mallmind:mall:mallreds')::uuid, 'Beth-el Medical Group', null, null, null, 'E403', null, '012 656 8983 / 012 656 8984', null, null, null, 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'beth_el_medical_group'),
  (md5('mallmind:shop:mallreds-shop-e405')::uuid, md5('mallmind:mall:mallreds')::uuid, 'Flairskin Aesthetic Clinic', null, null, null, 'E405', null, '067 610 3736', null, null, null, 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'flairskin_aesthetic_clinic'),
  (md5('mallmind:shop:mallreds-shop-e408')::uuid, md5('mallmind:mall:mallreds')::uuid, 'Centurion Fight Club', null, null, null, 'E408', null, '083 383 4802', null, null, null, 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'centurion_fight_club'),
  (md5('mallmind:shop:mallreds-shop-kiosk')::uuid, md5('mallmind:mall:mallreds')::uuid, 'We Buy Cars', null, null, null, 'Kiosk', null, '082 927 1729', null, null, null, 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'we_buy_cars'),
  (md5('mallmind:shop:mallreds-shop-kiosk_2')::uuid, md5('mallmind:mall:mallreds')::uuid, 'Vuse', null, null, null, 'Kiosk 2', null, '063 164 4345', null, null, null, 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'vuse'),
  (md5('mallmind:shop:mallreds-shop-kiosk_4')::uuid, md5('mallmind:mall:mallreds')::uuid, 'Feel Good CBD', null, null, null, 'Kiosk 4', null, '071 171 2320', null, null, null, 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'feel_good_cbd'),
  (md5('mallmind:shop:mallreds-shop-kiosk_5')::uuid, md5('mallmind:mall:mallreds')::uuid, 'Dubai World Fragrances', null, null, null, 'Kiosk 5', null, '072 603 6469', null, null, null, 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'dubai_world_fragrances'),
  (md5('mallmind:shop:mallreds-shop-kiosk_6')::uuid, md5('mallmind:mall:mallreds')::uuid, 'African Craft', null, null, null, 'Kiosk 6', null, '073 835 6900', null, null, null, 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'african_craft'),
  (md5('mallmind:shop:mallreds-shop-m5')::uuid, md5('mallmind:mall:mallreds')::uuid, 'Mina Raptis Inc.', null, null, null, 'M5', null, '012 656 8957', null, null, null, 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'mina_raptis_inc'),
  (md5('mallmind:shop:mallreds-shop-pw2')::uuid, md5('mallmind:mall:mallreds')::uuid, 'Shield Car Wash', null, null, null, 'PW2', null, '071 297 7735', null, null, null, 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'shield_car_wash'),
  (md5('mallmind:shop:mallreds-shop-r65')::uuid, md5('mallmind:mall:mallreds')::uuid, 'African Bank', null, null, null, 'R65', null, '012 656 7456 / 012 656 7503', null, null, null, 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'african_bank');

-- ── Post-insert assertions (abort the whole transaction on any violation) ─────
do $$
declare
  v_mall_id uuid := md5('mallmind:mall:mallreds')::uuid;
  v_shops int;
begin
  select count(*) into v_shops from public.shops where mall_id = v_mall_id;
  if v_shops <> 113 then raise exception 'ABORT: expected 113 shops, got %.', v_shops; end if;
  if exists (select 1 from public.shops where mall_id = v_mall_id and floor        is not null) then raise exception 'ABORT: a floor is not NULL.'; end if;
  if exists (select 1 from public.shops where mall_id = v_mall_id and category     is not null) then raise exception 'ABORT: a category is not NULL.'; end if;
  if exists (select 1 from public.shops where mall_id = v_mall_id and zone         is not null) then raise exception 'ABORT: a zone is not NULL.'; end if;
  if exists (select 1 from public.shops where mall_id = v_mall_id and (opening_time is not null or closing_time is not null)) then raise exception 'ABORT: hours not NULL.'; end if;
  if exists (select 1 from public.shops where mall_id = v_mall_id and (store_number is null or primary_source_url is null or source_owner is null or observed_at is null)) then raise exception 'ABORT: missing provenance/store_number.'; end if;
  if exists (select 1 from public.shops where mall_id = v_mall_id and name ~* '(^|[^a-z])game([^a-z]|$)') then raise exception 'ABORT: an excluded tenant (Game) is present.'; end if;
  if exists (select 1 from public.shops where mall_id = v_mall_id and name ~* 'incredible connection') then raise exception 'ABORT: an excluded tenant (Incredible Connection) is present.'; end if;
end $$;

-- ── Return the created mall id + inserted shop count ──────────────────────────
select md5('mallmind:mall:mallreds')::uuid as mall_id,
       (select count(*) from public.shops where mall_id = md5('mallmind:mall:mallreds')::uuid) as shops_inserted;

commit;
