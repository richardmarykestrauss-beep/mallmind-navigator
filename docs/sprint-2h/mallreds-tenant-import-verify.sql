-- ═══════════════════════════════════════════════════════════════════════════
-- GATE 9 VERIFICATION — Mall@Reds tenant import (mallmind-dev ONLY). READ-ONLY.
-- Deterministic preview↔database parity, returned as ONE consolidated result row.
-- Embeds all 113 expected rows (derived from docs/sprint-2g/mallreds-tenant-import-preview.json)
-- and folds the per-row parity check and the reverse "unexpected shop" check into scalar
-- counts. Mutates nothing. Regenerate: node scripts/retail/generate-mallreds-import-sql.mjs --emit
--
-- Expected single row:
--   malls=1  malls_by_name=1  shops=113  products_total=0  floor_null=113  category_null=113
--   zone_null=113  opening_null=113  closing_null=113  provenance_complete=113
--   distinct_store_numbers=111  game_count=0  incredible_count=0  shops_rls_enabled=t
--   preview_db_mismatch_count=0  unexpected_shops_on_mall=0
-- ═══════════════════════════════════════════════════════════════════════════
with
mall as (select md5('mallmind:mall:mallreds')::uuid as mall_id),

-- The exact 113 expected rows, derived deterministically from the import preview.
expected(id, name, store_number, phone, branch_status, verification_status,
         confidence_score, observed_at, last_verified_at, primary_source_url,
         source_owner, contradiction_notes, normalized_retailer_name) as (
  values
    (md5('mallmind:shop:mallreds-shop-01a')::uuid, 'Ola Milky Lane', '01A', '012 656 0362', 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'ola_milky_lane'),
    (md5('mallmind:shop:mallreds-shop-02')::uuid, 'Kung-Fu Kitchen', '02', '012 656 7234', 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'kung_fu_kitchen'),
    (md5('mallmind:shop:mallreds-shop-04')::uuid, 'Legends Barber', '04', '069 676 4487', 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'legends_barber'),
    (md5('mallmind:shop:mallreds-shop-05')::uuid, 'Del Forno', '05', '012 004 0962', 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'del_forno'),
    (md5('mallmind:shop:mallreds-shop-06')::uuid, 'Mugg & Bean', '06', '012 656 8987', 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'mugg_bean'),
    (md5('mallmind:shop:mallreds-shop-08')::uuid, 'Wimpy', '08', '012 656 8865', 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'wimpy'),
    (md5('mallmind:shop:mallreds-shop-09b')::uuid, 'The Good Masala', '09B', '084 777 0880', 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'the_good_masala'),
    (md5('mallmind:shop:mallreds-shop-10')::uuid, 'Cell World/SmartFix', '10', '012 656 3066', 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'cell_world_smartfix'),
    (md5('mallmind:shop:mallreds-shop-101')::uuid, 'WAXIT', '101', '010 140 2926', 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'waxit'),
    (md5('mallmind:shop:mallreds-shop-102')::uuid, 'Nedbank', '102', '012 656 6700', 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'nedbank'),
    (md5('mallmind:shop:mallreds-shop-103')::uuid, 'PEP Home', '103', '012 656 1614', 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'pep_home'),
    (md5('mallmind:shop:mallreds-shop-105')::uuid, 'Farrah Quartz', '105', '012 656 7540', 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'farrah_quartz'),
    (md5('mallmind:shop:mallreds-shop-106')::uuid, 'Exclusive Hair', '106', '071 092 8529 / 076 848 4179', 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'exclusive_hair'),
    (md5('mallmind:shop:mallreds-shop-108')::uuid, 'Mr Price', '108', '087 049 3669', 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'mr_price'),
    (md5('mallmind:shop:mallreds-shop-109')::uuid, 'Mr Price Home', '109', '012 656 9607', 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'mr_price_home'),
    (md5('mallmind:shop:mallreds-shop-111')::uuid, 'Woolworths', '111', '012 656 6800', 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'woolworths'),
    (md5('mallmind:shop:mallreds-shop-114')::uuid, 'Nando''s', '114', '012 656 1426', 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'nando_s'),
    (md5('mallmind:shop:mallreds-shop-115')::uuid, 'McDonald''s', '115', '012 656 1386', 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'mcdonald_s'),
    (md5('mallmind:shop:mallreds-shop-116')::uuid, 'Virgin Active', '116', '012 656 0920', 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'virgin_active'),
    (md5('mallmind:shop:mallreds-shop-13')::uuid, 'Pizza Hut', '13', '072 742 7854', 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'pizza_hut'),
    (md5('mallmind:shop:mallreds-shop-14_16')::uuid, 'Vodashop', '14-16', '012 653 2883 / 012 653 9569', 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'vodashop'),
    (md5('mallmind:shop:mallreds-shop-142')::uuid, 'Ocean Basket', '142', '012 656 0526', 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'ocean_basket'),
    (md5('mallmind:shop:mallreds-shop-143b')::uuid, 'Rasam Tandoori Indian Restaurant', '143B', '083 328 3491', 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'rasam_tandoori_indian_restaurant'),
    (md5('mallmind:shop:mallreds-shop-144')::uuid, 'Barcelos', '144', '012 884 6030', 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'barcelos'),
    (md5('mallmind:shop:mallreds-shop-145')::uuid, 'Hogshead', '145', '087 160 0283', 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'hogshead'),
    (md5('mallmind:shop:mallreds-shop-17')::uuid, 'Telkom', '17', '012 664 1179', 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'telkom'),
    (md5('mallmind:shop:mallreds-shop-18a')::uuid, 'Delhi Delicious', '18a', '083 786 1760', 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'delhi_delicious'),
    (md5('mallmind:shop:mallreds-shop-19')::uuid, 'Sheet Street', '19', '087 750 1977', 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'sheet_street'),
    (md5('mallmind:shop:mallreds-shop-19a')::uuid, 'Lovisa', '19A', '010 143 0772', 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'lovisa'),
    (md5('mallmind:shop:mallreds-shop-1b')::uuid, 'Fish & Chips', '1B', '061 411 9302', 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'fish_chips'),
    (md5('mallmind:shop:mallreds-shop-1c')::uuid, 'Mochachos', '1C', '076 616 7866', 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'mochachos'),
    (md5('mallmind:shop:mallreds-shop-2')::uuid, 'One and Only Flower Shop', '2', '076 066 1549', 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'one_and_only_flower_shop'),
    (md5('mallmind:shop:mallreds-shop-20a')::uuid, 'Party City', '20A', '012 656 8982', 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'party_city'),
    (md5('mallmind:shop:mallreds-shop-21')::uuid, 'Amazing Tobacco', '21', '078 699 0450', 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'amazing_tobacco'),
    (md5('mallmind:shop:mallreds-shop-22')::uuid, 'Ru''s African Art', '22', '073 835 6900', 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'ru_s_african_art'),
    (md5('mallmind:shop:mallreds-shop-23')::uuid, 'Boutique Istanbul', '23', '082 221 7769', 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'boutique_istanbul'),
    (md5('mallmind:shop:mallreds-shop-24')::uuid, 'The Little Cake Shop', '24', '012 656 1246', 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'the_little_cake_shop'),
    (md5('mallmind:shop:mallreds-shop-25')::uuid, 'Sorbet', '25', '012 656 0567', 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'sorbet'),
    (md5('mallmind:shop:mallreds-shop-26')::uuid, 'Torga Optical', '26', '012 656 8952 / 012 656 8953', 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'torga_optical'),
    (md5('mallmind:shop:mallreds-shop-28')::uuid, 'De Rovers', '28', '074 395 1843', 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'de_rovers'),
    (md5('mallmind:shop:mallreds-shop-29')::uuid, 'Miladys', '29', '087 750 8827', 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'miladys'),
    (md5('mallmind:shop:mallreds-shop-30b')::uuid, 'fbo', '30B', '012 944 1061', 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'fbo'),
    (md5('mallmind:shop:mallreds-shop-31')::uuid, 'FNB', '31', '087 575 0147 / 087 345 1290', 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'fnb'),
    (md5('mallmind:shop:mallreds-shop-31a')::uuid, 'Cardies', '31A', '012 656 8951', 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'cardies'),
    (md5('mallmind:shop:mallreds-shop-31c')::uuid, 'Aero Soft Shoes', '31C', '079 293 8038', 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'aero_soft_shoes'),
    (md5('mallmind:shop:mallreds-shop-31d')::uuid, 'Soviet', '31D', '011 061 0615', 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'soviet'),
    (md5('mallmind:shop:mallreds-shop-32')::uuid, 'Copy Express', '32', '012 656 3331', 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'copy_express'),
    (md5('mallmind:shop:mallreds-shop-33')::uuid, 'SkinPHD', '33', '012 656 9118 / 012 656 9119', 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'skinphd'),
    (md5('mallmind:shop:mallreds-shop-35a')::uuid, 'SA Home Loans', '35A', '081 774 4289', 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'sa_home_loans'),
    (md5('mallmind:shop:mallreds-shop-35b')::uuid, 'Kitwe Laundry', '35B', '012 656 9008', 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'kitwe_laundry'),
    (md5('mallmind:shop:mallreds-shop-36')::uuid, 'Tasko Sweets', '36', '083 253 4591', 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'tasko_sweets'),
    (md5('mallmind:shop:mallreds-shop-39')::uuid, 'Pick n Pay Clothing', '39', '012 656 8176', 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'pick_n_pay_clothing'),
    (md5('mallmind:shop:mallreds-shop-3b')::uuid, 'Barber SA', '3B', '073 193 8584', 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'barber_sa'),
    (md5('mallmind:shop:mallreds-shop-3c')::uuid, 'Mobizone', '3C', '060 777 8777', 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'mobizone'),
    (md5('mallmind:shop:mallreds-shop-40')::uuid, 'PEP Stores', '40', '012 656 0230', 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'pep_stores'),
    (md5('mallmind:shop:mallreds-shop-40a')::uuid, 'Charisma', '40A', '061 309 3482', 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'charisma'),
    (md5('mallmind:shop:mallreds-shop-42')::uuid, 'Ackermans', '42', '012 656 0035', 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'ackermans'),
    (md5('mallmind:shop:mallreds-shop-43')::uuid, 'Edgars', '43', '010 593 8316', 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'edgars'),
    (md5('mallmind:shop:mallreds-shop-44')::uuid, 'Truworths', '44', '087 757 0260', 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'truworths'),
    (md5('mallmind:shop:mallreds-shop-45')::uuid, 'Clicks', '45', '012 656 8850', 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'clicks'),
    (md5('mallmind:shop:mallreds-shop-47')::uuid, 'Cups & Cones', '47', '083 377 3013', 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'cups_cones'),
    (md5('mallmind:shop:mallreds-shop-48')::uuid, 'King Pie', '48', '072 706 6666', 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'king_pie'),
    (md5('mallmind:shop:mallreds-shop-49')::uuid, 'Pro-Tech', '49', '064 073 2889', 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'pro_tech'),
    (md5('mallmind:shop:mallreds-shop-50')::uuid, 'Pick n Pay', '50', '012 656 9562', 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'pick_n_pay'),
    (md5('mallmind:shop:mallreds-shop-50b')::uuid, 'Homemark', '50B', '076 202 7981', 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'homemark'),
    (md5('mallmind:shop:mallreds-shop-51')::uuid, 'MTN', '51', '083 869 6739', 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'mtn'),
    (md5('mallmind:shop:mallreds-shop-52')::uuid, 'Absolute Pets', '52', '012 004 3496', 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'absolute_pets'),
    (md5('mallmind:shop:mallreds-shop-53')::uuid, 'Biltong Republic', '53', '065 633 5211', 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'biltong_republic'),
    (md5('mallmind:shop:mallreds-shop-55')::uuid, 'Spec-Savers', '55', '012 656 8916', 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'spec_savers'),
    (md5('mallmind:shop:mallreds-shop-56')::uuid, 'Crazy Store', '56', '087 135 8804', 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'crazy_store'),
    (md5('mallmind:shop:mallreds-shop-57')::uuid, 'Footgear', '57', '087 286 6032', 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'footgear'),
    (md5('mallmind:shop:mallreds-shop-59')::uuid, 'Mr Price Sport', '59', '087 750 8707', 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'mr_price_sport'),
    (md5('mallmind:shop:mallreds-shop-60')::uuid, 'Senqu', '60', '087 283 3529', 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'senqu'),
    (md5('mallmind:shop:mallreds-shop-60a')::uuid, 'Health Twin Vitamins & Supplements', '60A', '079 691 4579', 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'health_twin_vitamins_supplements'),
    (md5('mallmind:shop:mallreds-shop-62')::uuid, 'Tekkie Town', '62', '087 802 9084', 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'tekkie_town'),
    (md5('mallmind:shop:mallreds-shop-63')::uuid, 'Capitec Bank', '63', '087 756 0245', 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'capitec_bank'),
    (md5('mallmind:shop:mallreds-shop-68')::uuid, 'Funtubbles', '68', '084 923 9381', 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'funtubbles'),
    (md5('mallmind:shop:mallreds-shop-70')::uuid, 'Goldrush', '70', '012 656 1062 / 012 747 6250', 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'goldrush'),
    (md5('mallmind:shop:mallreds-shop-72')::uuid, 'Pick n Pay Liquor', '72', '012 656 9679', 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'pick_n_pay_liquor'),
    (md5('mallmind:shop:mallreds-shop-73')::uuid, 'Cash Converters', '73', '012 656 9143', 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'cash_converters'),
    (md5('mallmind:shop:mallreds-shop-75g')::uuid, 'Bossa', '75G', '010 102 0300', 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'bossa'),
    (md5('mallmind:shop:mallreds-shop-76')::uuid, 'Steers Drive Thru', '76', '012 656 8933', 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'steers_drive_thru'),
    (md5('mallmind:shop:mallreds-shop-77')::uuid, 'Mattress & Couch', '77', '069 430 3937', 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'mattress_couch'),
    (md5('mallmind:shop:mallreds-shop-78')::uuid, 'Value Co.', '78', '012 656 3071', 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'value_co'),
    (md5('mallmind:shop:mallreds-shop-80')::uuid, 'Standard Bank', '80', '012 656 6917', 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'standard_bank'),
    (md5('mallmind:shop:mallreds-shop-80a')::uuid, 'Clothing Junction', '80A', '087 087 8099', 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'clothing_junction'),
    (md5('mallmind:shop:mallreds-shop-80a_2')::uuid, 'Homeware & Tech', '80A', '063 287 0102', 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', 'Shares a store_number with another official-directory listing; suffix appended to keep canonical_store_id unique. The store_number itself is preserved verbatim and NOT invented.', 'homeware_tech'),
    (md5('mallmind:shop:mallreds-shop-81')::uuid, 'Exact', '81', '012 656 5528', 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'exact'),
    (md5('mallmind:shop:mallreds-shop-82')::uuid, 'Markham', '82', '012 656 5526', 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'markham'),
    (md5('mallmind:shop:mallreds-shop-83')::uuid, 'Sportscene', '83', '012 656 5523', 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'sportscene'),
    (md5('mallmind:shop:mallreds-shop-84')::uuid, 'Contempo', '84', '012 884 0014', 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'contempo'),
    (md5('mallmind:shop:mallreds-shop-85')::uuid, 'SA National Blood Services', '85', '082 419 1472', 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'sa_national_blood_services'),
    (md5('mallmind:shop:mallreds-shop-86')::uuid, 'American Swiss', '86', '012 656 5518 / 012 656 5519', 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'american_swiss'),
    (md5('mallmind:shop:mallreds-shop-87')::uuid, 'Foschini', '87', '012 656 5500', 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'foschini'),
    (md5('mallmind:shop:mallreds-shop-88')::uuid, 'Dis-Chem', '88', '012 656 8974 / 012 656 8975', 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'dis_chem'),
    (md5('mallmind:shop:mallreds-shop-88_2')::uuid, 'Sunrise Home', '88', '074 753 9276', 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', 'Shares a store_number with another official-directory listing; suffix appended to keep canonical_store_id unique. The store_number itself is preserved verbatim and NOT invented.', 'sunrise_home'),
    (md5('mallmind:shop:mallreds-shop-92')::uuid, 'Tiger Wheel & Tyre', '92', '012 055 1104', 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'tiger_wheel_tyre'),
    (md5('mallmind:shop:mallreds-shop-95')::uuid, 'Jet', '95', '012 656 6880', 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'jet'),
    (md5('mallmind:shop:mallreds-shop-96')::uuid, 'Absa', '96', '012 656 6437', 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'absa'),
    (md5('mallmind:shop:mallreds-shop-98')::uuid, 'Bag and Style', '98', '062 599 0991', 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'bag_and_style'),
    (md5('mallmind:shop:mallreds-shop-99')::uuid, 'HiPhone', '99', '012 656 0011', 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'hiphone'),
    (md5('mallmind:shop:mallreds-shop-e402')::uuid, 'Anaprop Property Management', 'E402', '012 656 8957', 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'anaprop_property_management'),
    (md5('mallmind:shop:mallreds-shop-e403')::uuid, 'Beth-el Medical Group', 'E403', '012 656 8983 / 012 656 8984', 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'beth_el_medical_group'),
    (md5('mallmind:shop:mallreds-shop-e405')::uuid, 'Flairskin Aesthetic Clinic', 'E405', '067 610 3736', 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'flairskin_aesthetic_clinic'),
    (md5('mallmind:shop:mallreds-shop-e408')::uuid, 'Centurion Fight Club', 'E408', '083 383 4802', 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'centurion_fight_club'),
    (md5('mallmind:shop:mallreds-shop-kiosk')::uuid, 'We Buy Cars', 'Kiosk', '082 927 1729', 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'we_buy_cars'),
    (md5('mallmind:shop:mallreds-shop-kiosk_2')::uuid, 'Vuse', 'Kiosk 2', '063 164 4345', 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'vuse'),
    (md5('mallmind:shop:mallreds-shop-kiosk_4')::uuid, 'Feel Good CBD', 'Kiosk 4', '071 171 2320', 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'feel_good_cbd'),
    (md5('mallmind:shop:mallreds-shop-kiosk_5')::uuid, 'Dubai World Fragrances', 'Kiosk 5', '072 603 6469', 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'dubai_world_fragrances'),
    (md5('mallmind:shop:mallreds-shop-kiosk_6')::uuid, 'African Craft', 'Kiosk 6', '073 835 6900', 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'african_craft'),
    (md5('mallmind:shop:mallreds-shop-m5')::uuid, 'Mina Raptis Inc.', 'M5', '012 656 8957', 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'mina_raptis_inc'),
    (md5('mallmind:shop:mallreds-shop-pw2')::uuid, 'Shield Car Wash', 'PW2', '071 297 7735', 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'shield_car_wash'),
    (md5('mallmind:shop:mallreds-shop-r65')::uuid, 'African Bank', 'R65', '012 656 7456 / 012 656 7503', 'listed_current', 'official_directory', 0.9, '2026-07-24', '2026-07-24', 'https://www.mallatreds.co.za/shops/', 'Mall@Reds / Anaprop Property Management (official)', null, 'african_bank')
),

-- The exact 113 expected deterministic shop ids (for the reverse check).
expected_ids as (
  select md5('mallmind:shop:' || cid)::uuid as id
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
