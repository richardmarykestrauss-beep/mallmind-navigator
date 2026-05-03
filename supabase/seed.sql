-- ================================================================
-- MallMind Seed Data v2
-- Verified against live Supabase schema on 2026-05-02
--
-- Real column names confirmed:
--   shops:    mall_id, name, category, floor, unit_number,
--             opening_time, closing_time, is_active
--   products: shop_id, mall_id, name, category, brand, model,
--             price, original_price, is_on_special, in_stock
--
-- Real mall IDs (hardcoded — no subquery guessing):
--   Canal Walk              b37170b0-2520-4e80-9aed-150eead2f5f1
--   Cresta Shopping Centre  380b7ce7-b307-4601-8d91-53b6a1839748
--   Eastgate Shopping Centre d64d90f5-f0fa-4eb9-adc8-368586adf652
--   Gateway Theatre         66fb8867-e5b6-4912-bdbc-de3349ebdddb
--   Mall of Africa          d5ac0565-2b06-47b4-85b1-6968b60d229d
--   Menlyn Park             c8029cc9-1ff4-4fe4-8f0d-eed5f3227d2b
--   Sandton City            059ee9b0-c4f9-46c3-835e-0a4b30b9de0a
--   V&A Waterfront          c71e86c3-cf24-4fba-8de4-3f61bc1c151c
--
-- SAFE TO RE-RUN — uses ON CONFLICT DO NOTHING throughout
-- ================================================================


-- ================================================================
-- HELPER FUNCTION — get shop id by name + mall id
-- ================================================================
CREATE OR REPLACE FUNCTION _shop(p_name TEXT, p_mall_id UUID)
RETURNS UUID LANGUAGE sql STABLE AS $$
  SELECT id FROM shops WHERE name = p_name AND mall_id = p_mall_id LIMIT 1;
$$;


-- ================================================================
-- SHOPS
-- Mall of Africa already has 14 shops — skip it.
-- Add shops for the other 7 malls.
-- ================================================================

INSERT INTO shops (mall_id, name, category, floor, unit_number, opening_time, closing_time, is_active)
VALUES

  -- ── SANDTON CITY ────────────────────────────────────────────
  ('059ee9b0-c4f9-46c3-835e-0a4b30b9de0a','Incredible Connection','Electronics',  'L2','Shop L201','09:00','21:00',true),
  ('059ee9b0-c4f9-46c3-835e-0a4b30b9de0a','iStore',               'Electronics',  'L2','Shop L205','09:00','21:00',true),
  ('059ee9b0-c4f9-46c3-835e-0a4b30b9de0a','Samsung Experience',   'Electronics',  'L2','Shop L210','09:00','21:00',true),
  ('059ee9b0-c4f9-46c3-835e-0a4b30b9de0a','Woolworths',           'Food & Clothing','G','Shop G01','08:00','21:00',true),
  ('059ee9b0-c4f9-46c3-835e-0a4b30b9de0a','H&M',                  'Clothing',     'L1','Shop L101','09:00','21:00',true),
  ('059ee9b0-c4f9-46c3-835e-0a4b30b9de0a','Zara',                 'Clothing',     'L1','Shop L105','09:00','21:00',true),
  ('059ee9b0-c4f9-46c3-835e-0a4b30b9de0a','Clicks',               'Beauty & Health','G','Shop G15','08:00','21:00',true),
  ('059ee9b0-c4f9-46c3-835e-0a4b30b9de0a','Total Sport',          'Sport',        'L1','Shop L110','09:00','21:00',true),
  ('059ee9b0-c4f9-46c3-835e-0a4b30b9de0a','Cotton On',            'Clothing',     'L1','Shop L115','09:00','21:00',true),
  ('059ee9b0-c4f9-46c3-835e-0a4b30b9de0a','Nando''s',             'Food & Restaurants','L3','Shop L301','10:00','22:00',true),

  -- ── MENLYN PARK ─────────────────────────────────────────────
  ('c8029cc9-1ff4-4fe4-8f0d-eed5f3227d2b','Game',                 'Electronics',  'L2','Shop L201','09:00','21:00',true),
  ('c8029cc9-1ff4-4fe4-8f0d-eed5f3227d2b','Hi-Fi Corporation',    'Electronics',  'L2','Shop L205','09:00','21:00',true),
  ('c8029cc9-1ff4-4fe4-8f0d-eed5f3227d2b','iStore',               'Electronics',  'L2','Shop L210','09:00','21:00',true),
  ('c8029cc9-1ff4-4fe4-8f0d-eed5f3227d2b','H&M',                  'Clothing',     'L1','Shop L101','09:00','21:00',true),
  ('c8029cc9-1ff4-4fe4-8f0d-eed5f3227d2b','Mr Price',             'Clothing',     'G', 'Shop G101','09:00','21:00',true),
  ('c8029cc9-1ff4-4fe4-8f0d-eed5f3227d2b','Woolworths',           'Food & Clothing','G','Shop G01','08:00','21:00',true),
  ('c8029cc9-1ff4-4fe4-8f0d-eed5f3227d2b','Dis-Chem',             'Beauty & Health','G','Shop G10','08:00','21:00',true),
  ('c8029cc9-1ff4-4fe4-8f0d-eed5f3227d2b','Sportsmans Warehouse', 'Sport',        'L1','Shop L110','09:00','21:00',true),

  -- ── GATEWAY THEATRE OF SHOPPING ─────────────────────────────
  ('66fb8867-e5b6-4912-bdbc-de3349ebdddb','Game',                 'Electronics',  'L1','Shop L101','09:00','21:00',true),
  ('66fb8867-e5b6-4912-bdbc-de3349ebdddb','Hi-Fi Corporation',    'Electronics',  'L1','Shop L105','09:00','21:00',true),
  ('66fb8867-e5b6-4912-bdbc-de3349ebdddb','Mr Price',             'Clothing',     'G', 'Shop G01', '09:00','21:00',true),
  ('66fb8867-e5b6-4912-bdbc-de3349ebdddb','Woolworths',           'Food & Clothing','G','Shop G05','08:00','21:00',true),
  ('66fb8867-e5b6-4912-bdbc-de3349ebdddb','Dis-Chem',             'Beauty & Health','G','Shop G10','08:00','21:00',true),
  ('66fb8867-e5b6-4912-bdbc-de3349ebdddb','Sportsmans Warehouse', 'Sport',        'L1','Shop L110','09:00','21:00',true),
  ('66fb8867-e5b6-4912-bdbc-de3349ebdddb','Cotton On',            'Clothing',     'G', 'Shop G15', '09:00','21:00',true),
  ('66fb8867-e5b6-4912-bdbc-de3349ebdddb','Clicks',               'Beauty & Health','G','Shop G20','08:00','21:00',true),

  -- ── CANAL WALK ──────────────────────────────────────────────
  ('b37170b0-2520-4e80-9aed-150eead2f5f1','Game',                 'Electronics',  'L2','Shop L201','09:00','21:00',true),
  ('b37170b0-2520-4e80-9aed-150eead2f5f1','Incredible Connection','Electronics',  'L2','Shop L205','09:00','21:00',true),
  ('b37170b0-2520-4e80-9aed-150eead2f5f1','Woolworths',           'Food & Clothing','G','Shop G01','08:00','21:00',true),
  ('b37170b0-2520-4e80-9aed-150eead2f5f1','H&M',                  'Clothing',     'L1','Shop L101','09:00','21:00',true),
  ('b37170b0-2520-4e80-9aed-150eead2f5f1','Mr Price',             'Clothing',     'L1','Shop L105','09:00','21:00',true),
  ('b37170b0-2520-4e80-9aed-150eead2f5f1','Dis-Chem',             'Beauty & Health','G','Shop G10','08:00','21:00',true),
  ('b37170b0-2520-4e80-9aed-150eead2f5f1','Sportsmans Warehouse', 'Sport',        'L1','Shop L110','09:00','21:00',true),
  ('b37170b0-2520-4e80-9aed-150eead2f5f1','Checkers',             'Grocery',      'G', 'Shop G15', '08:00','21:00',true),

  -- ── V&A WATERFRONT ──────────────────────────────────────────
  ('c71e86c3-cf24-4fba-8de4-3f61bc1c151c','iStore',               'Electronics',  'G', 'Shop G101','09:00','21:00',true),
  ('c71e86c3-cf24-4fba-8de4-3f61bc1c151c','Samsung Experience',   'Electronics',  'G', 'Shop G105','09:00','21:00',true),
  ('c71e86c3-cf24-4fba-8de4-3f61bc1c151c','Woolworths',           'Food & Clothing','G','Shop G01','08:00','21:00',true),
  ('c71e86c3-cf24-4fba-8de4-3f61bc1c151c','H&M',                  'Clothing',     'L1','Shop L101','09:00','21:00',true),
  ('c71e86c3-cf24-4fba-8de4-3f61bc1c151c','Clicks',               'Beauty & Health','G','Shop G10','08:00','21:00',true),
  ('c71e86c3-cf24-4fba-8de4-3f61bc1c151c','Cotton On',            'Clothing',     'L1','Shop L105','09:00','21:00',true),
  ('c71e86c3-cf24-4fba-8de4-3f61bc1c151c','Cape Union Mart',      'Sport',        'L1','Shop L110','09:00','21:00',true),
  ('c71e86c3-cf24-4fba-8de4-3f61bc1c151c','Exclusive Books',      'Books',        'G', 'Shop G20', '09:00','21:00',true),

  -- ── EASTGATE SHOPPING CENTRE ────────────────────────────────
  ('d64d90f5-f0fa-4eb9-adc8-368586adf652','Game',                 'Electronics',  'G', 'Shop G201','09:00','20:00',true),
  ('d64d90f5-f0fa-4eb9-adc8-368586adf652','Hi-Fi Corporation',    'Electronics',  'G', 'Shop G205','09:00','20:00',true),
  ('d64d90f5-f0fa-4eb9-adc8-368586adf652','Mr Price',             'Clothing',     'G', 'Shop G101','09:00','20:00',true),
  ('d64d90f5-f0fa-4eb9-adc8-368586adf652','Woolworths',           'Food & Clothing','G','Shop G01','08:00','20:00',true),
  ('d64d90f5-f0fa-4eb9-adc8-368586adf652','Clicks',               'Beauty & Health','G','Shop G15','08:00','20:00',true),
  ('d64d90f5-f0fa-4eb9-adc8-368586adf652','Cotton On',            'Clothing',     'G', 'Shop G105','09:00','20:00',true),
  ('d64d90f5-f0fa-4eb9-adc8-368586adf652','Sportsmans Warehouse', 'Sport',        'G', 'Shop G110','09:00','20:00',true),
  ('d64d90f5-f0fa-4eb9-adc8-368586adf652','Dis-Chem',             'Beauty & Health','G','Shop G20','08:00','20:00',true),

  -- ── CRESTA SHOPPING CENTRE ──────────────────────────────────
  ('380b7ce7-b307-4601-8d91-53b6a1839748','Game',                 'Electronics',  'G', 'Shop G201','09:00','20:00',true),
  ('380b7ce7-b307-4601-8d91-53b6a1839748','Mr Price',             'Clothing',     'G', 'Shop G101','09:00','20:00',true),
  ('380b7ce7-b307-4601-8d91-53b6a1839748','Woolworths',           'Food & Clothing','G','Shop G01','08:00','20:00',true),
  ('380b7ce7-b307-4601-8d91-53b6a1839748','Checkers',             'Grocery',      'G', 'Shop G10', '08:00','20:00',true),
  ('380b7ce7-b307-4601-8d91-53b6a1839748','Clicks',               'Beauty & Health','G','Shop G15','08:00','20:00',true),
  ('380b7ce7-b307-4601-8d91-53b6a1839748','Cotton On',            'Clothing',     'G', 'Shop G105','09:00','20:00',true),
  ('380b7ce7-b307-4601-8d91-53b6a1839748','Dis-Chem',             'Beauty & Health','G','Shop G20','08:00','20:00',true),
  ('380b7ce7-b307-4601-8d91-53b6a1839748','Total Sport',          'Sport',        'G', 'Shop G110','09:00','20:00',true)

ON CONFLICT DO NOTHING;


-- ================================================================
-- PRODUCTS
-- Using _shop() helper: _shop('Store Name', 'mall-uuid')
-- Columns: shop_id, mall_id, name, category, brand, model,
--          price, original_price, is_on_special, in_stock
-- ================================================================

INSERT INTO products (shop_id, mall_id, name, category, brand, model, price, original_price, is_on_special, in_stock)
VALUES

  -- ──────────────────────────────────────────────────────────
  -- MALL OF AFRICA — add more products to existing shops
  -- ──────────────────────────────────────────────────────────

  -- Game (Mall of Africa) — already has Samsung 55" TV, add more
  (_shop('Game','d5ac0565-2b06-47b4-85b1-6968b60d229d'),'d5ac0565-2b06-47b4-85b1-6968b60d229d',
   'Samsung 65" QLED 4K Smart TV','Electronics','Samsung','QA65Q70C',12999,15999,true,true),
  (_shop('Game','d5ac0565-2b06-47b4-85b1-6968b60d229d'),'d5ac0565-2b06-47b4-85b1-6968b60d229d',
   'Hisense 55" 4K UHD Smart TV','Electronics','Hisense','55A7H',5999,7499,true,true),
  (_shop('Game','d5ac0565-2b06-47b4-85b1-6968b60d229d'),'d5ac0565-2b06-47b4-85b1-6968b60d229d',
   'Sony PlayStation 5 Console','Electronics','Sony','CFI-1200A',10999,null,false,true),
  (_shop('Game','d5ac0565-2b06-47b4-85b1-6968b60d229d'),'d5ac0565-2b06-47b4-85b1-6968b60d229d',
   'JBL Charge 5 Bluetooth Speaker','Electronics','JBL','Charge5',2499,2999,true,true),
  (_shop('Game','d5ac0565-2b06-47b4-85b1-6968b60d229d'),'d5ac0565-2b06-47b4-85b1-6968b60d229d',
   'Samsung Galaxy S24 128GB','Electronics','Samsung','SM-S921B',18999,21999,true,true),
  (_shop('Game','d5ac0565-2b06-47b4-85b1-6968b60d229d'),'d5ac0565-2b06-47b4-85b1-6968b60d229d',
   'Microsoft Xbox Series X','Electronics','Microsoft','RRT-00010',10999,null,false,true),

  -- Hi-Fi Corporation (Mall of Africa)
  (_shop('Hi-Fi Corporation','d5ac0565-2b06-47b4-85b1-6968b60d229d'),'d5ac0565-2b06-47b4-85b1-6968b60d229d',
   'Samsung 65" QLED 4K Smart TV','Electronics','Samsung','QA65Q70C',13499,15999,true,true),
  (_shop('Hi-Fi Corporation','d5ac0565-2b06-47b4-85b1-6968b60d229d'),'d5ac0565-2b06-47b4-85b1-6968b60d229d',
   'Hisense 55" 4K UHD Smart TV','Electronics','Hisense','55A7H',6299,7499,true,true),
  (_shop('Hi-Fi Corporation','d5ac0565-2b06-47b4-85b1-6968b60d229d'),'d5ac0565-2b06-47b4-85b1-6968b60d229d',
   'Sony WH-1000XM5 Headphones','Electronics','Sony','WH-1000XM5',7999,9499,true,true),
  (_shop('Hi-Fi Corporation','d5ac0565-2b06-47b4-85b1-6968b60d229d'),'d5ac0565-2b06-47b4-85b1-6968b60d229d',
   'Bose SoundLink Max Speaker','Electronics','Bose','SoundLinkMax',6999,7999,true,true),
  (_shop('Hi-Fi Corporation','d5ac0565-2b06-47b4-85b1-6968b60d229d'),'d5ac0565-2b06-47b4-85b1-6968b60d229d',
   'Samsung Galaxy S24 128GB','Electronics','Samsung','SM-S921B',19499,21999,false,true),

  -- Incredible Connection (Mall of Africa)
  (_shop('Incredible Connection','d5ac0565-2b06-47b4-85b1-6968b60d229d'),'d5ac0565-2b06-47b4-85b1-6968b60d229d',
   'Samsung 65" QLED 4K Smart TV','Electronics','Samsung','QA65Q70C',12799,15999,true,true),
  (_shop('Incredible Connection','d5ac0565-2b06-47b4-85b1-6968b60d229d'),'d5ac0565-2b06-47b4-85b1-6968b60d229d',
   'Hisense 55" 4K UHD Smart TV','Electronics','Hisense','55A7H',5799,7499,true,true),
  (_shop('Incredible Connection','d5ac0565-2b06-47b4-85b1-6968b60d229d'),'d5ac0565-2b06-47b4-85b1-6968b60d229d',
   'Sony WH-1000XM5 Headphones','Electronics','Sony','WH-1000XM5',7799,9499,true,true),
  (_shop('Incredible Connection','d5ac0565-2b06-47b4-85b1-6968b60d229d'),'d5ac0565-2b06-47b4-85b1-6968b60d229d',
   'Samsung Galaxy S24 128GB','Electronics','Samsung','SM-S921B',18499,21999,true,true),
  (_shop('Incredible Connection','d5ac0565-2b06-47b4-85b1-6968b60d229d'),'d5ac0565-2b06-47b4-85b1-6968b60d229d',
   'Lenovo IdeaPad 3 Laptop 15"','Electronics','Lenovo','82H8',10999,12999,true,true),

  -- Zara (Mall of Africa)
  (_shop('Zara','d5ac0565-2b06-47b4-85b1-6968b60d229d'),'d5ac0565-2b06-47b4-85b1-6968b60d229d',
   'Zara Floral Midi Dress','Clothing','Zara',null,999,1299,true,true),
  (_shop('Zara','d5ac0565-2b06-47b4-85b1-6968b60d229d'),'d5ac0565-2b06-47b4-85b1-6968b60d229d',
   'Zara Slim Fit Blazer','Clothing','Zara',null,1499,null,false,true),
  (_shop('Zara','d5ac0565-2b06-47b4-85b1-6968b60d229d'),'d5ac0565-2b06-47b4-85b1-6968b60d229d',
   'Zara High-Waist Jeans','Clothing','Zara',null,899,1199,true,true),
  (_shop('Zara','d5ac0565-2b06-47b4-85b1-6968b60d229d'),'d5ac0565-2b06-47b4-85b1-6968b60d229d',
   'Zara Linen Shirt','Clothing','Zara',null,699,null,false,true),

  -- H&M (Mall of Africa)
  (_shop('H&M','d5ac0565-2b06-47b4-85b1-6968b60d229d'),'d5ac0565-2b06-47b4-85b1-6968b60d229d',
   'H&M Cotton Crew Neck Tee','Clothing','H&M',null,249,null,false,true),
  (_shop('H&M','d5ac0565-2b06-47b4-85b1-6968b60d229d'),'d5ac0565-2b06-47b4-85b1-6968b60d229d',
   'H&M Slim Fit Chinos','Clothing','H&M',null,599,799,true,true),
  (_shop('H&M','d5ac0565-2b06-47b4-85b1-6968b60d229d'),'d5ac0565-2b06-47b4-85b1-6968b60d229d',
   'H&M Zip-Up Hoodie','Clothing','H&M',null,799,999,true,true),
  (_shop('H&M','d5ac0565-2b06-47b4-85b1-6968b60d229d'),'d5ac0565-2b06-47b4-85b1-6968b60d229d',
   'H&M Floral Midi Dress','Clothing','H&M',null,699,null,false,true),

  -- Sportscene (Mall of Africa)
  (_shop('Sportscene','d5ac0565-2b06-47b4-85b1-6968b60d229d'),'d5ac0565-2b06-47b4-85b1-6968b60d229d',
   'Nike Air Max 270','Sport','Nike','AH8050',2299,2799,true,true),
  (_shop('Sportscene','d5ac0565-2b06-47b4-85b1-6968b60d229d'),'d5ac0565-2b06-47b4-85b1-6968b60d229d',
   'Adidas Stan Smith Sneakers','Sport','Adidas','FX5502',1299,1599,true,true),
  (_shop('Sportscene','d5ac0565-2b06-47b4-85b1-6968b60d229d'),'d5ac0565-2b06-47b4-85b1-6968b60d229d',
   'Nike Air Force 1 Low','Sport','Nike','CW2288',1499,null,false,true),
  (_shop('Sportscene','d5ac0565-2b06-47b4-85b1-6968b60d229d'),'d5ac0565-2b06-47b4-85b1-6968b60d229d',
   'Puma Suede Classic Sneakers','Sport','Puma','374915',1199,1499,true,true),

  -- Dis-Chem (Mall of Africa)
  (_shop('Dis-Chem','d5ac0565-2b06-47b4-85b1-6968b60d229d'),'d5ac0565-2b06-47b4-85b1-6968b60d229d',
   'Neutrogena Hydro Boost Gel Cream 50ml','Beauty & Health','Neutrogena',null,279,349,true,true),
  (_shop('Dis-Chem','d5ac0565-2b06-47b4-85b1-6968b60d229d'),'d5ac0565-2b06-47b4-85b1-6968b60d229d',
   'L''Oréal Elvive Shampoo 400ml','Beauty & Health','L''Oréal',null,89,null,false,true),
  (_shop('Dis-Chem','d5ac0565-2b06-47b4-85b1-6968b60d229d'),'d5ac0565-2b06-47b4-85b1-6968b60d229d',
   'Dove Body Wash 750ml','Beauty & Health','Dove',null,89,109,true,true),
  (_shop('Dis-Chem','d5ac0565-2b06-47b4-85b1-6968b60d229d'),'d5ac0565-2b06-47b4-85b1-6968b60d229d',
   'Maybelline Fit Me Foundation','Beauty & Health','Maybelline',null,199,249,true,true),

  -- Clicks (Mall of Africa)
  (_shop('Clicks','d5ac0565-2b06-47b4-85b1-6968b60d229d'),'d5ac0565-2b06-47b4-85b1-6968b60d229d',
   'Neutrogena Hydro Boost Gel Cream 50ml','Beauty & Health','Neutrogena',null,269,349,true,true),
  (_shop('Clicks','d5ac0565-2b06-47b4-85b1-6968b60d229d'),'d5ac0565-2b06-47b4-85b1-6968b60d229d',
   'L''Oréal Elvive Shampoo 400ml','Beauty & Health','L''Oréal',null,85,null,false,true),
  (_shop('Clicks','d5ac0565-2b06-47b4-85b1-6968b60d229d'),'d5ac0565-2b06-47b4-85b1-6968b60d229d',
   'Dove Body Wash 750ml','Beauty & Health','Dove',null,85,109,true,true),
  (_shop('Clicks','d5ac0565-2b06-47b4-85b1-6968b60d229d'),'d5ac0565-2b06-47b4-85b1-6968b60d229d',
   'Revlon ColorStay Foundation','Beauty & Health','Revlon',null,299,379,true,true),


  -- ──────────────────────────────────────────────────────────
  -- SANDTON CITY
  -- ──────────────────────────────────────────────────────────
  (_shop('Incredible Connection','059ee9b0-c4f9-46c3-835e-0a4b30b9de0a'),'059ee9b0-c4f9-46c3-835e-0a4b30b9de0a',
   'Samsung 65" QLED 4K Smart TV','Electronics','Samsung','QA65Q70C',12799,15999,true,true),
  (_shop('Incredible Connection','059ee9b0-c4f9-46c3-835e-0a4b30b9de0a'),'059ee9b0-c4f9-46c3-835e-0a4b30b9de0a',
   'Hisense 55" 4K UHD Smart TV','Electronics','Hisense','55A7H',5999,7499,true,true),
  (_shop('Incredible Connection','059ee9b0-c4f9-46c3-835e-0a4b30b9de0a'),'059ee9b0-c4f9-46c3-835e-0a4b30b9de0a',
   'Sony WH-1000XM5 Headphones','Electronics','Sony','WH-1000XM5',7799,9499,true,true),
  (_shop('Incredible Connection','059ee9b0-c4f9-46c3-835e-0a4b30b9de0a'),'059ee9b0-c4f9-46c3-835e-0a4b30b9de0a',
   'Samsung Galaxy S24 128GB','Electronics','Samsung','SM-S921B',18499,21999,true,true),
  (_shop('iStore','059ee9b0-c4f9-46c3-835e-0a4b30b9de0a'),'059ee9b0-c4f9-46c3-835e-0a4b30b9de0a',
   'iPhone 16 128GB','Electronics','Apple','MXVY3ZA',22999,null,false,true),
  (_shop('iStore','059ee9b0-c4f9-46c3-835e-0a4b30b9de0a'),'059ee9b0-c4f9-46c3-835e-0a4b30b9de0a',
   'AirPods Pro (2nd gen)','Electronics','Apple','MTJV3ZA',5999,6999,true,true),
  (_shop('iStore','059ee9b0-c4f9-46c3-835e-0a4b30b9de0a'),'059ee9b0-c4f9-46c3-835e-0a4b30b9de0a',
   'MacBook Air M2 256GB','Electronics','Apple','MLY33ZA',24999,null,false,true),
  (_shop('Samsung Experience','059ee9b0-c4f9-46c3-835e-0a4b30b9de0a'),'059ee9b0-c4f9-46c3-835e-0a4b30b9de0a',
   'Samsung Galaxy S24 128GB','Electronics','Samsung','SM-S921B',18999,21999,false,true),
  (_shop('Samsung Experience','059ee9b0-c4f9-46c3-835e-0a4b30b9de0a'),'059ee9b0-c4f9-46c3-835e-0a4b30b9de0a',
   'Samsung Galaxy S24 Ultra 256GB','Electronics','Samsung','SM-S928B',34999,38999,true,true),
  (_shop('Samsung Experience','059ee9b0-c4f9-46c3-835e-0a4b30b9de0a'),'059ee9b0-c4f9-46c3-835e-0a4b30b9de0a',
   'Samsung Galaxy Buds2 Pro','Electronics','Samsung','SM-R510N',3499,3999,true,true),
  (_shop('Zara','059ee9b0-c4f9-46c3-835e-0a4b30b9de0a'),'059ee9b0-c4f9-46c3-835e-0a4b30b9de0a',
   'Zara Floral Midi Dress','Clothing','Zara',null,999,1299,true,true),
  (_shop('Zara','059ee9b0-c4f9-46c3-835e-0a4b30b9de0a'),'059ee9b0-c4f9-46c3-835e-0a4b30b9de0a',
   'Zara High-Waist Jeans','Clothing','Zara',null,899,1199,true,true),
  (_shop('H&M','059ee9b0-c4f9-46c3-835e-0a4b30b9de0a'),'059ee9b0-c4f9-46c3-835e-0a4b30b9de0a',
   'H&M Cotton Crew Neck Tee','Clothing','H&M',null,249,null,false,true),
  (_shop('H&M','059ee9b0-c4f9-46c3-835e-0a4b30b9de0a'),'059ee9b0-c4f9-46c3-835e-0a4b30b9de0a',
   'H&M Slim Fit Chinos','Clothing','H&M',null,599,799,true,true),
  (_shop('Total Sport','059ee9b0-c4f9-46c3-835e-0a4b30b9de0a'),'059ee9b0-c4f9-46c3-835e-0a4b30b9de0a',
   'Nike Air Max 270','Sport','Nike','AH8050',2299,2799,true,true),
  (_shop('Total Sport','059ee9b0-c4f9-46c3-835e-0a4b30b9de0a'),'059ee9b0-c4f9-46c3-835e-0a4b30b9de0a',
   'Adidas Stan Smith Sneakers','Sport','Adidas','FX5502',1299,1599,true,true),
  (_shop('Clicks','059ee9b0-c4f9-46c3-835e-0a4b30b9de0a'),'059ee9b0-c4f9-46c3-835e-0a4b30b9de0a',
   'Neutrogena Hydro Boost Gel Cream 50ml','Beauty & Health','Neutrogena',null,269,349,true,true),
  (_shop('Clicks','059ee9b0-c4f9-46c3-835e-0a4b30b9de0a'),'059ee9b0-c4f9-46c3-835e-0a4b30b9de0a',
   'Dove Body Wash 750ml','Beauty & Health','Dove',null,85,109,true,true),


  -- ──────────────────────────────────────────────────────────
  -- GATEWAY THEATRE OF SHOPPING
  -- ──────────────────────────────────────────────────────────
  (_shop('Game','66fb8867-e5b6-4912-bdbc-de3349ebdddb'),'66fb8867-e5b6-4912-bdbc-de3349ebdddb',
   'Samsung 55" 4K Smart TV','Electronics','Samsung','UA55AU7000',8999,11999,true,true),
  (_shop('Game','66fb8867-e5b6-4912-bdbc-de3349ebdddb'),'66fb8867-e5b6-4912-bdbc-de3349ebdddb',
   'Hisense 55" 4K UHD Smart TV','Electronics','Hisense','55A7H',5999,7499,true,true),
  (_shop('Game','66fb8867-e5b6-4912-bdbc-de3349ebdddb'),'66fb8867-e5b6-4912-bdbc-de3349ebdddb',
   'Sony PlayStation 5 Console','Electronics','Sony','CFI-1200A',10999,null,false,true),
  (_shop('Game','66fb8867-e5b6-4912-bdbc-de3349ebdddb'),'66fb8867-e5b6-4912-bdbc-de3349ebdddb',
   'Samsung Galaxy S24 128GB','Electronics','Samsung','SM-S921B',18999,21999,true,true),
  (_shop('Hi-Fi Corporation','66fb8867-e5b6-4912-bdbc-de3349ebdddb'),'66fb8867-e5b6-4912-bdbc-de3349ebdddb',
   'Samsung 55" 4K Smart TV','Electronics','Samsung','UA55AU7000',9499,11999,true,true),
  (_shop('Hi-Fi Corporation','66fb8867-e5b6-4912-bdbc-de3349ebdddb'),'66fb8867-e5b6-4912-bdbc-de3349ebdddb',
   'Sony WH-1000XM5 Headphones','Electronics','Sony','WH-1000XM5',7999,9499,true,true),
  (_shop('Hi-Fi Corporation','66fb8867-e5b6-4912-bdbc-de3349ebdddb'),'66fb8867-e5b6-4912-bdbc-de3349ebdddb',
   'Hisense 55" 4K UHD Smart TV','Electronics','Hisense','55A7H',6299,7499,true,true),
  (_shop('Sportsmans Warehouse','66fb8867-e5b6-4912-bdbc-de3349ebdddb'),'66fb8867-e5b6-4912-bdbc-de3349ebdddb',
   'Nike Air Max 270','Sport','Nike','AH8050',2299,2799,true,true),
  (_shop('Sportsmans Warehouse','66fb8867-e5b6-4912-bdbc-de3349ebdddb'),'66fb8867-e5b6-4912-bdbc-de3349ebdddb',
   'Adidas Ultraboost 22','Sport','Adidas','GX5457',2799,3299,true,true),
  (_shop('Dis-Chem','66fb8867-e5b6-4912-bdbc-de3349ebdddb'),'66fb8867-e5b6-4912-bdbc-de3349ebdddb',
   'Neutrogena Hydro Boost Gel Cream 50ml','Beauty & Health','Neutrogena',null,279,349,true,true),
  (_shop('Dis-Chem','66fb8867-e5b6-4912-bdbc-de3349ebdddb'),'66fb8867-e5b6-4912-bdbc-de3349ebdddb',
   'Maybelline Fit Me Foundation','Beauty & Health','Maybelline',null,199,249,true,true),


  -- ──────────────────────────────────────────────────────────
  -- CANAL WALK
  -- ──────────────────────────────────────────────────────────
  (_shop('Game','b37170b0-2520-4e80-9aed-150eead2f5f1'),'b37170b0-2520-4e80-9aed-150eead2f5f1',
   'Samsung 55" 4K Smart TV','Electronics','Samsung','UA55AU7000',8999,11999,true,true),
  (_shop('Game','b37170b0-2520-4e80-9aed-150eead2f5f1'),'b37170b0-2520-4e80-9aed-150eead2f5f1',
   'Sony PlayStation 5 Console','Electronics','Sony','CFI-1200A',10999,null,false,true),
  (_shop('Game','b37170b0-2520-4e80-9aed-150eead2f5f1'),'b37170b0-2520-4e80-9aed-150eead2f5f1',
   'Samsung Galaxy S24 128GB','Electronics','Samsung','SM-S921B',18999,21999,true,true),
  (_shop('Incredible Connection','b37170b0-2520-4e80-9aed-150eead2f5f1'),'b37170b0-2520-4e80-9aed-150eead2f5f1',
   'Samsung 55" 4K Smart TV','Electronics','Samsung','UA55AU7000',9499,11999,true,true),
  (_shop('Incredible Connection','b37170b0-2520-4e80-9aed-150eead2f5f1'),'b37170b0-2520-4e80-9aed-150eead2f5f1',
   'Sony WH-1000XM5 Headphones','Electronics','Sony','WH-1000XM5',7799,9499,true,true),
  (_shop('Sportsmans Warehouse','b37170b0-2520-4e80-9aed-150eead2f5f1'),'b37170b0-2520-4e80-9aed-150eead2f5f1',
   'Nike Air Max 270','Sport','Nike','AH8050',2299,2799,true,true),
  (_shop('Sportsmans Warehouse','b37170b0-2520-4e80-9aed-150eead2f5f1'),'b37170b0-2520-4e80-9aed-150eead2f5f1',
   'Adidas Stan Smith Sneakers','Sport','Adidas','FX5502',1299,1599,true,true),
  (_shop('H&M','b37170b0-2520-4e80-9aed-150eead2f5f1'),'b37170b0-2520-4e80-9aed-150eead2f5f1',
   'H&M Cotton Crew Neck Tee','Clothing','H&M',null,249,null,false,true),
  (_shop('Dis-Chem','b37170b0-2520-4e80-9aed-150eead2f5f1'),'b37170b0-2520-4e80-9aed-150eead2f5f1',
   'Neutrogena Hydro Boost Gel Cream 50ml','Beauty & Health','Neutrogena',null,279,349,true,true),


  -- ──────────────────────────────────────────────────────────
  -- V&A WATERFRONT
  -- ──────────────────────────────────────────────────────────
  (_shop('iStore','c71e86c3-cf24-4fba-8de4-3f61bc1c151c'),'c71e86c3-cf24-4fba-8de4-3f61bc1c151c',
   'iPhone 16 128GB','Electronics','Apple','MXVY3ZA',22999,null,false,true),
  (_shop('iStore','c71e86c3-cf24-4fba-8de4-3f61bc1c151c'),'c71e86c3-cf24-4fba-8de4-3f61bc1c151c',
   'AirPods Pro (2nd gen)','Electronics','Apple','MTJV3ZA',5999,6999,true,true),
  (_shop('iStore','c71e86c3-cf24-4fba-8de4-3f61bc1c151c'),'c71e86c3-cf24-4fba-8de4-3f61bc1c151c',
   'MacBook Air M2 256GB','Electronics','Apple','MLY33ZA',24999,null,false,true),
  (_shop('Samsung Experience','c71e86c3-cf24-4fba-8de4-3f61bc1c151c'),'c71e86c3-cf24-4fba-8de4-3f61bc1c151c',
   'Samsung Galaxy S24 128GB','Electronics','Samsung','SM-S921B',18999,21999,false,true),
  (_shop('Samsung Experience','c71e86c3-cf24-4fba-8de4-3f61bc1c151c'),'c71e86c3-cf24-4fba-8de4-3f61bc1c151c',
   'Samsung Galaxy Buds2 Pro','Electronics','Samsung','SM-R510N',3499,3999,true,true),
  (_shop('Cape Union Mart','c71e86c3-cf24-4fba-8de4-3f61bc1c151c'),'c71e86c3-cf24-4fba-8de4-3f61bc1c151c',
   'Merrell Moab 3 Hiking Boots','Sport','Merrell','J035881',2799,3299,true,true),
  (_shop('Cape Union Mart','c71e86c3-cf24-4fba-8de4-3f61bc1c151c'),'c71e86c3-cf24-4fba-8de4-3f61bc1c151c',
   'Columbia Watertight Rain Jacket','Sport','Columbia','RM2433',1999,2499,true,true),
  (_shop('H&M','c71e86c3-cf24-4fba-8de4-3f61bc1c151c'),'c71e86c3-cf24-4fba-8de4-3f61bc1c151c',
   'H&M Cotton Crew Neck Tee','Clothing','H&M',null,249,null,false,true),
  (_shop('Clicks','c71e86c3-cf24-4fba-8de4-3f61bc1c151c'),'c71e86c3-cf24-4fba-8de4-3f61bc1c151c',
   'Neutrogena Hydro Boost Gel Cream 50ml','Beauty & Health','Neutrogena',null,269,349,true,true),


  -- ──────────────────────────────────────────────────────────
  -- EASTGATE SHOPPING CENTRE
  -- ──────────────────────────────────────────────────────────
  (_shop('Game','d64d90f5-f0fa-4eb9-adc8-368586adf652'),'d64d90f5-f0fa-4eb9-adc8-368586adf652',
   'Samsung 55" 4K Smart TV','Electronics','Samsung','UA55AU7000',8999,11999,true,true),
  (_shop('Game','d64d90f5-f0fa-4eb9-adc8-368586adf652'),'d64d90f5-f0fa-4eb9-adc8-368586adf652',
   'Sony PlayStation 5 Console','Electronics','Sony','CFI-1200A',10999,null,false,true),
  (_shop('Game','d64d90f5-f0fa-4eb9-adc8-368586adf652'),'d64d90f5-f0fa-4eb9-adc8-368586adf652',
   'Samsung Galaxy S24 128GB','Electronics','Samsung','SM-S921B',18999,21999,true,true),
  (_shop('Hi-Fi Corporation','d64d90f5-f0fa-4eb9-adc8-368586adf652'),'d64d90f5-f0fa-4eb9-adc8-368586adf652',
   'Samsung 55" 4K Smart TV','Electronics','Samsung','UA55AU7000',9499,11999,true,true),
  (_shop('Hi-Fi Corporation','d64d90f5-f0fa-4eb9-adc8-368586adf652'),'d64d90f5-f0fa-4eb9-adc8-368586adf652',
   'Sony WH-1000XM5 Headphones','Electronics','Sony','WH-1000XM5',7999,9499,true,true),
  (_shop('Sportsmans Warehouse','d64d90f5-f0fa-4eb9-adc8-368586adf652'),'d64d90f5-f0fa-4eb9-adc8-368586adf652',
   'Nike Air Max 270','Sport','Nike','AH8050',2299,2799,true,true),
  (_shop('Cotton On','d64d90f5-f0fa-4eb9-adc8-368586adf652'),'d64d90f5-f0fa-4eb9-adc8-368586adf652',
   'Cotton On V-Neck Tee','Clothing','Cotton On',null,149,199,true,true),
  (_shop('Clicks','d64d90f5-f0fa-4eb9-adc8-368586adf652'),'d64d90f5-f0fa-4eb9-adc8-368586adf652',
   'Dove Body Wash 750ml','Beauty & Health','Dove',null,85,109,true,true),
  (_shop('Dis-Chem','d64d90f5-f0fa-4eb9-adc8-368586adf652'),'d64d90f5-f0fa-4eb9-adc8-368586adf652',
   'Neutrogena Hydro Boost Gel Cream 50ml','Beauty & Health','Neutrogena',null,279,349,true,true),


  -- ──────────────────────────────────────────────────────────
  -- CRESTA SHOPPING CENTRE
  -- ──────────────────────────────────────────────────────────
  (_shop('Game','380b7ce7-b307-4601-8d91-53b6a1839748'),'380b7ce7-b307-4601-8d91-53b6a1839748',
   'Samsung 55" 4K Smart TV','Electronics','Samsung','UA55AU7000',8999,11999,true,true),
  (_shop('Game','380b7ce7-b307-4601-8d91-53b6a1839748'),'380b7ce7-b307-4601-8d91-53b6a1839748',
   'Sony PlayStation 5 Console','Electronics','Sony','CFI-1200A',10999,null,false,true),
  (_shop('Game','380b7ce7-b307-4601-8d91-53b6a1839748'),'380b7ce7-b307-4601-8d91-53b6a1839748',
   'JBL Charge 5 Bluetooth Speaker','Electronics','JBL','Charge5',2499,2999,true,true),
  (_shop('Cotton On','380b7ce7-b307-4601-8d91-53b6a1839748'),'380b7ce7-b307-4601-8d91-53b6a1839748',
   'Cotton On V-Neck Tee','Clothing','Cotton On',null,149,199,true,true),
  (_shop('Mr Price','380b7ce7-b307-4601-8d91-53b6a1839748'),'380b7ce7-b307-4601-8d91-53b6a1839748',
   'Mr Price Chino Pants','Clothing','Mr Price',null,299,399,true,true),
  (_shop('Total Sport','380b7ce7-b307-4601-8d91-53b6a1839748'),'380b7ce7-b307-4601-8d91-53b6a1839748',
   'Nike Air Force 1 Low','Sport','Nike','CW2288',1499,null,false,true),
  (_shop('Dis-Chem','380b7ce7-b307-4601-8d91-53b6a1839748'),'380b7ce7-b307-4601-8d91-53b6a1839748',
   'Dove Body Wash 750ml','Beauty & Health','Dove',null,89,109,true,true),
  (_shop('Clicks','380b7ce7-b307-4601-8d91-53b6a1839748'),'380b7ce7-b307-4601-8d91-53b6a1839748',
   'Neutrogena Hydro Boost Gel Cream 50ml','Beauty & Health','Neutrogena',null,269,349,true,true),


  -- ──────────────────────────────────────────────────────────
  -- MENLYN PARK
  -- ──────────────────────────────────────────────────────────
  (_shop('Game','c8029cc9-1ff4-4fe4-8f0d-eed5f3227d2b'),'c8029cc9-1ff4-4fe4-8f0d-eed5f3227d2b',
   'Samsung 55" 4K Smart TV','Electronics','Samsung','UA55AU7000',8999,11999,true,true),
  (_shop('Game','c8029cc9-1ff4-4fe4-8f0d-eed5f3227d2b'),'c8029cc9-1ff4-4fe4-8f0d-eed5f3227d2b',
   'Samsung Galaxy S24 128GB','Electronics','Samsung','SM-S921B',18999,21999,true,true),
  (_shop('Game','c8029cc9-1ff4-4fe4-8f0d-eed5f3227d2b'),'c8029cc9-1ff4-4fe4-8f0d-eed5f3227d2b',
   'Sony PlayStation 5 Console','Electronics','Sony','CFI-1200A',10999,null,false,true),
  (_shop('Hi-Fi Corporation','c8029cc9-1ff4-4fe4-8f0d-eed5f3227d2b'),'c8029cc9-1ff4-4fe4-8f0d-eed5f3227d2b',
   'Samsung 55" 4K Smart TV','Electronics','Samsung','UA55AU7000',9499,11999,true,true),
  (_shop('Hi-Fi Corporation','c8029cc9-1ff4-4fe4-8f0d-eed5f3227d2b'),'c8029cc9-1ff4-4fe4-8f0d-eed5f3227d2b',
   'Sony WH-1000XM5 Headphones','Electronics','Sony','WH-1000XM5',7999,9499,true,true),
  (_shop('iStore','c8029cc9-1ff4-4fe4-8f0d-eed5f3227d2b'),'c8029cc9-1ff4-4fe4-8f0d-eed5f3227d2b',
   'iPhone 16 128GB','Electronics','Apple','MXVY3ZA',22999,null,false,true),
  (_shop('iStore','c8029cc9-1ff4-4fe4-8f0d-eed5f3227d2b'),'c8029cc9-1ff4-4fe4-8f0d-eed5f3227d2b',
   'AirPods Pro (2nd gen)','Electronics','Apple','MTJV3ZA',5999,6999,true,true),
  (_shop('Sportsmans Warehouse','c8029cc9-1ff4-4fe4-8f0d-eed5f3227d2b'),'c8029cc9-1ff4-4fe4-8f0d-eed5f3227d2b',
   'Nike Air Max 270','Sport','Nike','AH8050',2299,2799,true,true),
  (_shop('H&M','c8029cc9-1ff4-4fe4-8f0d-eed5f3227d2b'),'c8029cc9-1ff4-4fe4-8f0d-eed5f3227d2b',
   'H&M Cotton Crew Neck Tee','Clothing','H&M',null,249,null,false,true),
  (_shop('Dis-Chem','c8029cc9-1ff4-4fe4-8f0d-eed5f3227d2b'),'c8029cc9-1ff4-4fe4-8f0d-eed5f3227d2b',
   'Neutrogena Hydro Boost Gel Cream 50ml','Beauty & Health','Neutrogena',null,279,349,true,true)

ON CONFLICT DO NOTHING;


-- ================================================================
-- CLEANUP helper
-- ================================================================
DROP FUNCTION IF EXISTS _shop(TEXT, UUID);
