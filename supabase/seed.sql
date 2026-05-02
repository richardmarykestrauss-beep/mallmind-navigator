-- ============================================================
-- MallMind Seed Data
-- Run once in Supabase SQL Editor to populate shops & products
-- Safe to re-run — uses ON CONFLICT DO NOTHING throughout
-- ============================================================

-- ============================================================
-- SHOPS — 8 malls × ~8 shops each
-- ============================================================

INSERT INTO shops (mall_id, name, floor, unit_number, category, opening_hours) VALUES

  -- MALL OF AFRICA (Midrand, Gauteng)
  ((SELECT id FROM malls WHERE name ILIKE '%Mall of Africa%' LIMIT 1), 'Game',                    'L2', 'L201', 'Electronics',    '09:00–21:00'),
  ((SELECT id FROM malls WHERE name ILIKE '%Mall of Africa%' LIMIT 1), 'Hi-Fi Corporation',       'L2', 'L205', 'Electronics',    '09:00–21:00'),
  ((SELECT id FROM malls WHERE name ILIKE '%Mall of Africa%' LIMIT 1), 'iStore',                  'L2', 'L210', 'Electronics',    '09:00–21:00'),
  ((SELECT id FROM malls WHERE name ILIKE '%Mall of Africa%' LIMIT 1), 'H&M',                     'L1', 'L105', 'Clothing',       '09:00–21:00'),
  ((SELECT id FROM malls WHERE name ILIKE '%Mall of Africa%' LIMIT 1), 'Woolworths',              'G',  'G001', 'Food & Clothing', '08:00–21:00'),
  ((SELECT id FROM malls WHERE name ILIKE '%Mall of Africa%' LIMIT 1), 'Checkers',                'G',  'G005', 'Grocery',        '08:00–21:00'),
  ((SELECT id FROM malls WHERE name ILIKE '%Mall of Africa%' LIMIT 1), 'Dis-Chem',                'G',  'G010', 'Pharmacy',       '08:00–21:00'),
  ((SELECT id FROM malls WHERE name ILIKE '%Mall of Africa%' LIMIT 1), 'Sportsmans Warehouse',    'L1', 'L115', 'Sport',          '09:00–21:00'),
  ((SELECT id FROM malls WHERE name ILIKE '%Mall of Africa%' LIMIT 1), 'Mr Price',                'L1', 'L120', 'Clothing',       '09:00–21:00'),
  ((SELECT id FROM malls WHERE name ILIKE '%Mall of Africa%' LIMIT 1), 'Cotton On',               'L1', 'L125', 'Clothing',       '09:00–21:00'),

  -- SANDTON CITY (Sandton, Gauteng)
  ((SELECT id FROM malls WHERE name ILIKE '%Sandton%' LIMIT 1), 'Incredible Connection',          'L2', 'L201', 'Electronics',    '09:00–21:00'),
  ((SELECT id FROM malls WHERE name ILIKE '%Sandton%' LIMIT 1), 'iStore',                         'L2', 'L205', 'Electronics',    '09:00–21:00'),
  ((SELECT id FROM malls WHERE name ILIKE '%Sandton%' LIMIT 1), 'Samsung Experience Store',       'L2', 'L210', 'Electronics',    '09:00–21:00'),
  ((SELECT id FROM malls WHERE name ILIKE '%Sandton%' LIMIT 1), 'Woolworths',                     'G',  'G001', 'Food & Clothing', '08:00–21:00'),
  ((SELECT id FROM malls WHERE name ILIKE '%Sandton%' LIMIT 1), 'H&M',                            'L1', 'L101', 'Clothing',       '09:00–21:00'),
  ((SELECT id FROM malls WHERE name ILIKE '%Sandton%' LIMIT 1), 'Zara',                           'L1', 'L105', 'Clothing',       '09:00–21:00'),
  ((SELECT id FROM malls WHERE name ILIKE '%Sandton%' LIMIT 1), 'Clicks',                         'G',  'G015', 'Pharmacy',       '08:00–21:00'),
  ((SELECT id FROM malls WHERE name ILIKE '%Sandton%' LIMIT 1), 'Total Sport',                    'L1', 'L110', 'Sport',          '09:00–21:00'),
  ((SELECT id FROM malls WHERE name ILIKE '%Sandton%' LIMIT 1), 'Cotton On',                      'L1', 'L115', 'Clothing',       '09:00–21:00'),

  -- GATEWAY (Umhlanga, KwaZulu-Natal)
  ((SELECT id FROM malls WHERE name ILIKE '%Gateway%' LIMIT 1), 'Game',                           'L1', 'L101', 'Electronics',    '09:00–21:00'),
  ((SELECT id FROM malls WHERE name ILIKE '%Gateway%' LIMIT 1), 'Hi-Fi Corporation',              'L1', 'L105', 'Electronics',    '09:00–21:00'),
  ((SELECT id FROM malls WHERE name ILIKE '%Gateway%' LIMIT 1), 'Mr Price',                       'G',  'G001', 'Clothing',       '09:00–21:00'),
  ((SELECT id FROM malls WHERE name ILIKE '%Gateway%' LIMIT 1), 'Woolworths',                     'G',  'G005', 'Food & Clothing', '08:00–21:00'),
  ((SELECT id FROM malls WHERE name ILIKE '%Gateway%' LIMIT 1), 'Dis-Chem',                       'G',  'G010', 'Pharmacy',       '08:00–21:00'),
  ((SELECT id FROM malls WHERE name ILIKE '%Gateway%' LIMIT 1), 'Sportsmans Warehouse',           'L1', 'L110', 'Sport',          '09:00–21:00'),
  ((SELECT id FROM malls WHERE name ILIKE '%Gateway%' LIMIT 1), 'Cotton On',                      'G',  'G015', 'Clothing',       '09:00–21:00'),
  ((SELECT id FROM malls WHERE name ILIKE '%Gateway%' LIMIT 1), 'Clicks',                         'G',  'G020', 'Pharmacy',       '08:00–21:00'),

  -- CANAL WALK (Century City, Western Cape)
  ((SELECT id FROM malls WHERE name ILIKE '%Canal Walk%' LIMIT 1), 'Game',                        'L2', 'L201', 'Electronics',    '09:00–21:00'),
  ((SELECT id FROM malls WHERE name ILIKE '%Canal Walk%' LIMIT 1), 'Incredible Connection',       'L2', 'L205', 'Electronics',    '09:00–21:00'),
  ((SELECT id FROM malls WHERE name ILIKE '%Canal Walk%' LIMIT 1), 'Woolworths',                  'G',  'G001', 'Food & Clothing', '08:00–21:00'),
  ((SELECT id FROM malls WHERE name ILIKE '%Canal Walk%' LIMIT 1), 'H&M',                         'L1', 'L101', 'Clothing',       '09:00–21:00'),
  ((SELECT id FROM malls WHERE name ILIKE '%Canal Walk%' LIMIT 1), 'Mr Price',                    'L1', 'L105', 'Clothing',       '09:00–21:00'),
  ((SELECT id FROM malls WHERE name ILIKE '%Canal Walk%' LIMIT 1), 'Dis-Chem',                    'G',  'G010', 'Pharmacy',       '08:00–21:00'),
  ((SELECT id FROM malls WHERE name ILIKE '%Canal Walk%' LIMIT 1), 'Sportsmans Warehouse',        'L1', 'L110', 'Sport',          '09:00–21:00'),
  ((SELECT id FROM malls WHERE name ILIKE '%Canal Walk%' LIMIT 1), 'Checkers',                    'G',  'G015', 'Grocery',        '08:00–21:00'),

  -- V&A WATERFRONT (Cape Town)
  ((SELECT id FROM malls WHERE name ILIKE '%Waterfront%' OR name ILIKE '%V&A%' LIMIT 1), 'iStore',                     'G',  'G101', 'Electronics',    '09:00–21:00'),
  ((SELECT id FROM malls WHERE name ILIKE '%Waterfront%' OR name ILIKE '%V&A%' LIMIT 1), 'Samsung Experience Store',   'G',  'G105', 'Electronics',    '09:00–21:00'),
  ((SELECT id FROM malls WHERE name ILIKE '%Waterfront%' OR name ILIKE '%V&A%' LIMIT 1), 'Woolworths',                 'G',  'G001', 'Food & Clothing', '08:00–21:00'),
  ((SELECT id FROM malls WHERE name ILIKE '%Waterfront%' OR name ILIKE '%V&A%' LIMIT 1), 'H&M',                        'L1', 'L101', 'Clothing',       '09:00–21:00'),
  ((SELECT id FROM malls WHERE name ILIKE '%Waterfront%' OR name ILIKE '%V&A%' LIMIT 1), 'Clicks',                     'G',  'G010', 'Pharmacy',       '08:00–21:00'),
  ((SELECT id FROM malls WHERE name ILIKE '%Waterfront%' OR name ILIKE '%V&A%' LIMIT 1), 'Cotton On',                  'L1', 'L105', 'Clothing',       '09:00–21:00'),
  ((SELECT id FROM malls WHERE name ILIKE '%Waterfront%' OR name ILIKE '%V&A%' LIMIT 1), 'Cape Union Mart',            'L1', 'L110', 'Sport',          '09:00–21:00'),
  ((SELECT id FROM malls WHERE name ILIKE '%Waterfront%' OR name ILIKE '%V&A%' LIMIT 1), 'Exclusive Books',            'G',  'G020', 'Books',          '09:00–21:00'),

  -- EASTGATE (Bedfordview, Gauteng)
  ((SELECT id FROM malls WHERE name ILIKE '%Eastgate%' LIMIT 1), 'Game',                          'G',  'G201', 'Electronics',    '09:00–20:00'),
  ((SELECT id FROM malls WHERE name ILIKE '%Eastgate%' LIMIT 1), 'Hi-Fi Corporation',             'G',  'G205', 'Electronics',    '09:00–20:00'),
  ((SELECT id FROM malls WHERE name ILIKE '%Eastgate%' LIMIT 1), 'Mr Price',                      'G',  'G101', 'Clothing',       '09:00–20:00'),
  ((SELECT id FROM malls WHERE name ILIKE '%Eastgate%' LIMIT 1), 'Woolworths',                    'G',  'G001', 'Food & Clothing', '08:00–20:00'),
  ((SELECT id FROM malls WHERE name ILIKE '%Eastgate%' LIMIT 1), 'Clicks',                        'G',  'G015', 'Pharmacy',       '08:00–20:00'),
  ((SELECT id FROM malls WHERE name ILIKE '%Eastgate%' LIMIT 1), 'Cotton On',                     'G',  'G105', 'Clothing',       '09:00–20:00'),
  ((SELECT id FROM malls WHERE name ILIKE '%Eastgate%' LIMIT 1), 'Sportsmans Warehouse',          'G',  'G110', 'Sport',          '09:00–20:00'),
  ((SELECT id FROM malls WHERE name ILIKE '%Eastgate%' LIMIT 1), 'Dis-Chem',                      'G',  'G020', 'Pharmacy',       '08:00–20:00'),

  -- CRESTA (Northcliff, Gauteng)
  ((SELECT id FROM malls WHERE name ILIKE '%Cresta%' LIMIT 1), 'Game',                            'G',  'G201', 'Electronics',    '09:00–20:00'),
  ((SELECT id FROM malls WHERE name ILIKE '%Cresta%' LIMIT 1), 'Mr Price',                        'G',  'G101', 'Clothing',       '09:00–20:00'),
  ((SELECT id FROM malls WHERE name ILIKE '%Cresta%' LIMIT 1), 'Woolworths',                      'G',  'G001', 'Food & Clothing', '08:00–20:00'),
  ((SELECT id FROM malls WHERE name ILIKE '%Cresta%' LIMIT 1), 'Checkers',                        'G',  'G010', 'Grocery',        '08:00–20:00'),
  ((SELECT id FROM malls WHERE name ILIKE '%Cresta%' LIMIT 1), 'Clicks',                          'G',  'G015', 'Pharmacy',       '08:00–20:00'),
  ((SELECT id FROM malls WHERE name ILIKE '%Cresta%' LIMIT 1), 'Cotton On',                       'G',  'G105', 'Clothing',       '09:00–20:00'),
  ((SELECT id FROM malls WHERE name ILIKE '%Cresta%' LIMIT 1), 'Dis-Chem',                        'G',  'G020', 'Pharmacy',       '08:00–20:00'),
  ((SELECT id FROM malls WHERE name ILIKE '%Cresta%' LIMIT 1), 'Total Sport',                     'G',  'G110', 'Sport',          '09:00–20:00'),

  -- MENLYN PARK (Pretoria, Gauteng)
  ((SELECT id FROM malls WHERE name ILIKE '%Menlyn%' LIMIT 1), 'Game',                            'L2', 'L201', 'Electronics',    '09:00–21:00'),
  ((SELECT id FROM malls WHERE name ILIKE '%Menlyn%' LIMIT 1), 'Hi-Fi Corporation',               'L2', 'L205', 'Electronics',    '09:00–21:00'),
  ((SELECT id FROM malls WHERE name ILIKE '%Menlyn%' LIMIT 1), 'iStore',                          'L2', 'L210', 'Electronics',    '09:00–21:00'),
  ((SELECT id FROM malls WHERE name ILIKE '%Menlyn%' LIMIT 1), 'H&M',                             'L1', 'L101', 'Clothing',       '09:00–21:00'),
  ((SELECT id FROM malls WHERE name ILIKE '%Menlyn%' LIMIT 1), 'Mr Price',                        'G',  'G101', 'Clothing',       '09:00–21:00'),
  ((SELECT id FROM malls WHERE name ILIKE '%Menlyn%' LIMIT 1), 'Woolworths',                      'G',  'G001', 'Food & Clothing', '08:00–21:00'),
  ((SELECT id FROM malls WHERE name ILIKE '%Menlyn%' LIMIT 1), 'Dis-Chem',                        'G',  'G010', 'Pharmacy',       '08:00–21:00'),
  ((SELECT id FROM malls WHERE name ILIKE '%Menlyn%' LIMIT 1), 'Sportsmans Warehouse',            'L1', 'L110', 'Sport',          '09:00–21:00')

ON CONFLICT DO NOTHING;


-- ============================================================
-- HELPER: shop lookup by name + mall name
-- ============================================================
CREATE OR REPLACE FUNCTION shop_id(p_shop_name TEXT, p_mall_pattern TEXT)
RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT s.id FROM shops s
  JOIN malls m ON m.id = s.mall_id
  WHERE s.name ILIKE p_shop_name
    AND m.name ILIKE p_mall_pattern
  LIMIT 1;
$$;


-- ============================================================
-- PRODUCTS — Electronics
-- ============================================================

INSERT INTO products (shop_id, name, category, price, special_price, is_on_special) VALUES

  -- Game (Mall of Africa)
  (shop_id('Game', '%Mall of Africa%'), 'Samsung 65" QLED 4K Smart TV',      'Electronics', 12999, 10999, true),
  (shop_id('Game', '%Mall of Africa%'), 'Hisense 55" 4K UHD Smart TV',        'Electronics',  6999,  5499, true),
  (shop_id('Game', '%Mall of Africa%'), 'LG 43" Full HD Smart TV',             'Electronics',  4999,  3999, false),
  (shop_id('Game', '%Mall of Africa%'), 'Samsung Galaxy S24 128GB',            'Electronics', 18999, 16999, true),
  (shop_id('Game', '%Mall of Africa%'), 'Sony PlayStation 5',                  'Electronics', 11999, 10999, false),
  (shop_id('Game', '%Mall of Africa%'), 'JBL Charge 5 Bluetooth Speaker',      'Electronics',  2499,  1999, true),
  (shop_id('Game', '%Mall of Africa%'), 'Samsung Galaxy Buds2 Pro',            'Electronics',  3499,  2799, true),
  (shop_id('Game', '%Mall of Africa%'), 'Logitech MX Master 3S Mouse',         'Electronics',  1799,  null, false),

  -- Hi-Fi Corporation (Mall of Africa)
  (shop_id('Hi-Fi Corporation', '%Mall of Africa%'), 'Samsung 65" QLED 4K Smart TV',  'Electronics', 13499, 11499, true),
  (shop_id('Hi-Fi Corporation', '%Mall of Africa%'), 'Hisense 55" 4K UHD Smart TV',   'Electronics',  7299,  5999, true),
  (shop_id('Hi-Fi Corporation', '%Mall of Africa%'), 'Sony 55" OLED 4K TV',           'Electronics', 22999,  null, false),
  (shop_id('Hi-Fi Corporation', '%Mall of Africa%'), 'Samsung Galaxy S24 128GB',       'Electronics', 19499,  null, false),
  (shop_id('Hi-Fi Corporation', '%Mall of Africa%'), 'Bose SoundLink Max Speaker',     'Electronics',  6999,  5999, true),
  (shop_id('Hi-Fi Corporation', '%Mall of Africa%'), 'Sony WH-1000XM5 Headphones',     'Electronics',  7999,  6499, true),

  -- iStore (Mall of Africa)
  (shop_id('iStore', '%Mall of Africa%'), 'iPhone 16 128GB',               'Electronics', 22999,  null, false),
  (shop_id('iStore', '%Mall of Africa%'), 'iPhone 16 Pro 256GB',           'Electronics', 32999,  null, false),
  (shop_id('iStore', '%Mall of Africa%'), 'iPad (10th generation) 64GB',   'Electronics',  9999,  null, false),
  (shop_id('iStore', '%Mall of Africa%'), 'AirPods Pro (2nd generation)',  'Electronics',  5999,  4999, true),
  (shop_id('iStore', '%Mall of Africa%'), 'MacBook Air M2 256GB',          'Electronics', 24999,  null, false),
  (shop_id('iStore', '%Mall of Africa%'), 'Apple Watch Series 9 41mm',     'Electronics',  9999,  8499, true),

  -- Incredible Connection (Sandton City)
  (shop_id('Incredible Connection', '%Sandton%'), 'Samsung 65" QLED 4K Smart TV',    'Electronics', 12799, 10799, true),
  (shop_id('Incredible Connection', '%Sandton%'), 'Hisense 55" 4K UHD Smart TV',     'Electronics',  6799,  5299, true),
  (shop_id('Incredible Connection', '%Sandton%'), 'Samsung Galaxy S24 128GB',         'Electronics', 18499, 16499, true),
  (shop_id('Incredible Connection', '%Sandton%'), 'JBL Flip 6 Bluetooth Speaker',     'Electronics',  1899,  1499, true),
  (shop_id('Incredible Connection', '%Sandton%'), 'Sony WH-1000XM5 Headphones',       'Electronics',  7799,  6299, true),
  (shop_id('Incredible Connection', '%Sandton%'), 'Lenovo IdeaPad 3 Laptop',          'Electronics', 12999,  null, false),
  (shop_id('Incredible Connection', '%Sandton%'), 'Canon EOS R50 Camera Kit',         'Electronics', 19999, 17999, true),

  -- iStore (Sandton City)
  (shop_id('iStore', '%Sandton%'), 'iPhone 16 128GB',               'Electronics', 22999,  null, false),
  (shop_id('iStore', '%Sandton%'), 'iPhone 16 Pro 256GB',           'Electronics', 32999,  null, false),
  (shop_id('iStore', '%Sandton%'), 'AirPods Pro (2nd generation)',  'Electronics',  5999,  4999, true),
  (shop_id('iStore', '%Sandton%'), 'MacBook Air M2 256GB',          'Electronics', 24999,  null, false),
  (shop_id('iStore', '%Sandton%'), 'iPad mini 6 64GB',              'Electronics', 12999,  null, false),

  -- Samsung Experience Store (Sandton City)
  (shop_id('Samsung Experience Store', '%Sandton%'), 'Samsung Galaxy S24 128GB',         'Electronics', 18999,  null, false),
  (shop_id('Samsung Experience Store', '%Sandton%'), 'Samsung Galaxy S24 Ultra 256GB',   'Electronics', 34999, 31999, true),
  (shop_id('Samsung Experience Store', '%Sandton%'), 'Samsung Galaxy Tab S9 128GB',      'Electronics', 16999, 14999, true),
  (shop_id('Samsung Experience Store', '%Sandton%'), 'Samsung Galaxy Watch 6 Classic',   'Electronics',  8999,  7499, true),
  (shop_id('Samsung Experience Store', '%Sandton%'), 'Samsung Galaxy Buds2 Pro',         'Electronics',  3799,  2999, true),

  -- Game (Gateway)
  (shop_id('Game', '%Gateway%'), 'Samsung 65" QLED 4K Smart TV',      'Electronics', 12999, 10999, true),
  (shop_id('Game', '%Gateway%'), 'Hisense 43" 4K UHD Smart TV',        'Electronics',  4999,  3999, true),
  (shop_id('Game', '%Gateway%'), 'Samsung Galaxy S24 128GB',            'Electronics', 18999, 16999, true),
  (shop_id('Game', '%Gateway%'), 'Sony PlayStation 5',                  'Electronics', 11999,  null, false),
  (shop_id('Game', '%Gateway%'), 'JBL Charge 5 Bluetooth Speaker',      'Electronics',  2499,  1999, true),

  -- Hi-Fi Corporation (Gateway)
  (shop_id('Hi-Fi Corporation', '%Gateway%'), 'Samsung 65" QLED 4K Smart TV',   'Electronics', 13499, 11999, true),
  (shop_id('Hi-Fi Corporation', '%Gateway%'), 'Sony WH-1000XM5 Headphones',      'Electronics',  7999,  6499, true),
  (shop_id('Hi-Fi Corporation', '%Gateway%'), 'Bose QuietComfort 45',            'Electronics',  6499,  5499, true),
  (shop_id('Hi-Fi Corporation', '%Gateway%'), 'Samsung Galaxy S24 128GB',        'Electronics', 19499,  null, false),
  (shop_id('Hi-Fi Corporation', '%Gateway%'), 'LG 55" OLED 4K Smart TV',         'Electronics', 21999, 19999, true),

  -- Game (Canal Walk)
  (shop_id('Game', '%Canal Walk%'), 'Samsung 65" QLED 4K Smart TV',    'Electronics', 12999, 10999, true),
  (shop_id('Game', '%Canal Walk%'), 'Hisense 55" 4K UHD Smart TV',     'Electronics',  6999,  5499, true),
  (shop_id('Game', '%Canal Walk%'), 'Sony PlayStation 5',               'Electronics', 11999, 10499, true),
  (shop_id('Game', '%Canal Walk%'), 'Samsung Galaxy S24 128GB',         'Electronics', 18999, 16999, true),
  (shop_id('Game', '%Canal Walk%'), 'JBL Flip 6 Bluetooth Speaker',     'Electronics',  1899,  1599, true),

  -- iStore (V&A Waterfront)
  (shop_id('iStore', '%Waterfront%'), 'iPhone 16 128GB',               'Electronics', 22999,  null, false),
  (shop_id('iStore', '%Waterfront%'), 'iPhone 16 Pro 256GB',           'Electronics', 32999,  null, false),
  (shop_id('iStore', '%Waterfront%'), 'AirPods Pro (2nd generation)',  'Electronics',  5999,  null, false),
  (shop_id('iStore', '%Waterfront%'), 'MacBook Air M2 256GB',          'Electronics', 24999,  null, false),
  (shop_id('iStore', '%Waterfront%'), 'Apple Watch Series 9 41mm',     'Electronics',  9999,  null, false),

  -- Game (Eastgate)
  (shop_id('Game', '%Eastgate%'), 'Samsung 65" QLED 4K Smart TV',     'Electronics', 12999, 10999, true),
  (shop_id('Game', '%Eastgate%'), 'Hisense 55" 4K UHD Smart TV',      'Electronics',  6999,  5499, true),
  (shop_id('Game', '%Eastgate%'), 'Samsung Galaxy S24 128GB',          'Electronics', 18999, 16499, true),
  (shop_id('Game', '%Eastgate%'), 'Sony PlayStation 5',                'Electronics', 11999,  null, false),
  (shop_id('Game', '%Eastgate%'), 'Microsoft Xbox Series X',           'Electronics', 11499, 10499, true),

  -- Game (Cresta)
  (shop_id('Game', '%Cresta%'), 'Samsung 65" QLED 4K Smart TV',       'Electronics', 12999, 11499, true),
  (shop_id('Game', '%Cresta%'), 'Hisense 43" 4K UHD Smart TV',        'Electronics',  4999,  3999, true),
  (shop_id('Game', '%Cresta%'), 'Samsung Galaxy S24 128GB',            'Electronics', 18999,  null, false),
  (shop_id('Game', '%Cresta%'), 'JBL Charge 5 Bluetooth Speaker',      'Electronics',  2499,  1999, true),

  -- Game (Menlyn Park)
  (shop_id('Game', '%Menlyn%'), 'Samsung 65" QLED 4K Smart TV',       'Electronics', 12999, 10999, true),
  (shop_id('Game', '%Menlyn%'), 'Hisense 55" 4K UHD Smart TV',        'Electronics',  6999,  5499, true),
  (shop_id('Game', '%Menlyn%'), 'Samsung Galaxy S24 128GB',            'Electronics', 18999, 16999, true),
  (shop_id('Game', '%Menlyn%'), 'Sony PlayStation 5',                  'Electronics', 11999, 10999, false),
  (shop_id('Game', '%Menlyn%'), 'JBL Charge 5 Bluetooth Speaker',      'Electronics',  2499,  1999, true),

  -- Hi-Fi Corporation (Menlyn Park)
  (shop_id('Hi-Fi Corporation', '%Menlyn%'), 'Samsung 65" QLED 4K Smart TV',   'Electronics', 13499, 11999, true),
  (shop_id('Hi-Fi Corporation', '%Menlyn%'), 'Sony WH-1000XM5 Headphones',      'Electronics',  7999,  6499, true),
  (shop_id('Hi-Fi Corporation', '%Menlyn%'), 'Samsung Galaxy S24 128GB',        'Electronics', 19499,  null, false),
  (shop_id('Hi-Fi Corporation', '%Menlyn%'), 'Bose SoundLink Max Speaker',      'Electronics',  6999,  5999, true),


-- ============================================================
-- PRODUCTS — Clothing
-- ============================================================

  -- H&M (Mall of Africa)
  (shop_id('H&M', '%Mall of Africa%'), 'H&M Slim Fit Chinos',            'Clothing', 599,  399, true),
  (shop_id('H&M', '%Mall of Africa%'), 'H&M Cotton Crew Neck Tee',       'Clothing', 249,  149, true),
  (shop_id('H&M', '%Mall of Africa%'), 'H&M Zip-Up Hoodie',              'Clothing', 799,  599, true),
  (shop_id('H&M', '%Mall of Africa%'), 'H&M Floral Midi Dress',          'Clothing', 699,  null, false),
  (shop_id('H&M', '%Mall of Africa%'), 'H&M Denim Jacket',               'Clothing', 899,  699, true),

  -- Cotton On (Mall of Africa)
  (shop_id('Cotton On', '%Mall of Africa%'), 'Cotton On V-Neck Tee',     'Clothing', 149,   99, true),
  (shop_id('Cotton On', '%Mall of Africa%'), 'Cotton On Super Skinny Jean','Clothing', 499,  399, true),
  (shop_id('Cotton On', '%Mall of Africa%'), 'Cotton On Hoodie',          'Clothing', 599,  449, true),
  (shop_id('Cotton On', '%Mall of Africa%'), 'Cotton On Bomber Jacket',   'Clothing', 799,  null, false),

  -- Mr Price (Mall of Africa)
  (shop_id('Mr Price', '%Mall of Africa%'), 'Mr Price Chino Pants',       'Clothing', 299,  199, true),
  (shop_id('Mr Price', '%Mall of Africa%'), 'Mr Price Polo Shirt',        'Clothing', 249,  null, false),
  (shop_id('Mr Price', '%Mall of Africa%'), 'Mr Price Denim Shorts',      'Clothing', 199,  149, true),
  (shop_id('Mr Price', '%Mall of Africa%'), 'Mr Price Puffer Jacket',     'Clothing', 699,  499, true),

  -- Zara (Sandton City)
  (shop_id('Zara', '%Sandton%'), 'Zara Floral Midi Dress',              'Clothing',  999,  699, true),
  (shop_id('Zara', '%Sandton%'), 'Zara Slim Fit Blazer',                'Clothing', 1499,  null, false),
  (shop_id('Zara', '%Sandton%'), 'Zara High-Waist Jeans',               'Clothing',  899,  699, true),
  (shop_id('Zara', '%Sandton%'), 'Zara Linen Shirt',                    'Clothing',  699,  499, true),
  (shop_id('Zara', '%Sandton%'), 'Zara Knit Cardigan',                  'Clothing',  799,  null, false),

  -- H&M (Sandton City)
  (shop_id('H&M', '%Sandton%'), 'H&M Cotton Crew Neck Tee',             'Clothing', 249,  149, true),
  (shop_id('H&M', '%Sandton%'), 'H&M Slim Fit Chinos',                  'Clothing', 599,  399, true),
  (shop_id('H&M', '%Sandton%'), 'H&M Winter Coat',                      'Clothing',1299,  999, true),

  -- H&M (Canal Walk)
  (shop_id('H&M', '%Canal Walk%'), 'H&M Cotton Crew Neck Tee',          'Clothing', 249,  149, true),
  (shop_id('H&M', '%Canal Walk%'), 'H&M Slim Fit Chinos',               'Clothing', 599,  399, true),
  (shop_id('H&M', '%Canal Walk%'), 'H&M Linen Blend Blazer',            'Clothing', 999,  null, false),

  -- Mr Price (Gateway)
  (shop_id('Mr Price', '%Gateway%'), 'Mr Price Chino Pants',            'Clothing', 299,  199, true),
  (shop_id('Mr Price', '%Gateway%'), 'Mr Price Graphic Tee',            'Clothing', 149,   99, true),
  (shop_id('Mr Price', '%Gateway%'), 'Mr Price Puffer Jacket',          'Clothing', 699,  499, true),

  -- Mr Price (Menlyn Park)
  (shop_id('Mr Price', '%Menlyn%'), 'Mr Price Chino Pants',             'Clothing', 299,  199, true),
  (shop_id('Mr Price', '%Menlyn%'), 'Mr Price Polo Shirt',              'Clothing', 249,  null, false),
  (shop_id('Mr Price', '%Menlyn%'), 'Mr Price Denim Shorts',            'Clothing', 199,  149, true),


-- ============================================================
-- PRODUCTS — Sport
-- ============================================================

  -- Sportsmans Warehouse (Mall of Africa)
  (shop_id('Sportsmans Warehouse', '%Mall of Africa%'), 'Nike Air Max 270',             'Sport', 2299, 1899, true),
  (shop_id('Sportsmans Warehouse', '%Mall of Africa%'), 'Adidas Ultraboost 22',         'Sport', 2799, 2199, true),
  (shop_id('Sportsmans Warehouse', '%Mall of Africa%'), 'Puma Running Shorts',          'Sport',  449,  299, true),
  (shop_id('Sportsmans Warehouse', '%Mall of Africa%'), 'Wilson Clash 100 Tennis',      'Sport', 3299,  null, false),
  (shop_id('Sportsmans Warehouse', '%Mall of Africa%'), 'Nike Training T-Shirt',        'Sport',  599,  449, true),
  (shop_id('Sportsmans Warehouse', '%Mall of Africa%'), 'Speedo Fastskin Goggles',      'Sport',  449,  349, true),

  -- Total Sport (Sandton City)
  (shop_id('Total Sport', '%Sandton%'), 'Nike Air Force 1',              'Sport', 1499, 1199, true),
  (shop_id('Total Sport', '%Sandton%'), 'Adidas Stan Smith',             'Sport', 1299,  999, true),
  (shop_id('Total Sport', '%Sandton%'), 'Nike Air Max 270',              'Sport', 2299, 1999, true),
  (shop_id('Total Sport', '%Sandton%'), 'Under Armour Running Shoes',    'Sport', 1799, 1499, true),
  (shop_id('Total Sport', '%Sandton%'), 'Puma Suede Classic',            'Sport', 1299,  999, true),

  -- Sportsmans Warehouse (Gateway)
  (shop_id('Sportsmans Warehouse', '%Gateway%'), 'Nike Air Max 270',     'Sport', 2299, 1899, true),
  (shop_id('Sportsmans Warehouse', '%Gateway%'), 'Adidas Ultraboost 22', 'Sport', 2799, 2299, true),
  (shop_id('Sportsmans Warehouse', '%Gateway%'), 'Nike Running Shorts',  'Sport',  499,  349, true),
  (shop_id('Sportsmans Warehouse', '%Gateway%'), 'Speedo Fastskin Elite','Sport',  799,  599, true),

  -- Cape Union Mart (V&A Waterfront)
  (shop_id('Cape Union Mart', '%Waterfront%'), 'Merrell Moab 3 Hiking Boots', 'Sport', 2799, 2299, true),
  (shop_id('Cape Union Mart', '%Waterfront%'), 'Columbia Rain Jacket',         'Sport', 1999, 1599, true),
  (shop_id('Cape Union Mart', '%Waterfront%'), 'The North Face Backpack 40L',  'Sport', 2499,  null, false),
  (shop_id('Cape Union Mart', '%Waterfront%'), 'Patagonia Fleece Jacket',      'Sport', 2999, 2499, true),

  -- Sportsmans Warehouse (Canal Walk)
  (shop_id('Sportsmans Warehouse', '%Canal Walk%'), 'Nike Air Max 270',    'Sport', 2299, 1899, true),
  (shop_id('Sportsmans Warehouse', '%Canal Walk%'), 'Adidas Stan Smith',   'Sport', 1299,  999, true),
  (shop_id('Sportsmans Warehouse', '%Canal Walk%'), 'Puma Running Shorts', 'Sport',  449,  299, true),

  -- Sportsmans Warehouse (Menlyn Park)
  (shop_id('Sportsmans Warehouse', '%Menlyn%'), 'Nike Air Max 270',        'Sport', 2299, 1899, true),
  (shop_id('Sportsmans Warehouse', '%Menlyn%'), 'Adidas Ultraboost 22',    'Sport', 2799, 2199, true),
  (shop_id('Sportsmans Warehouse', '%Menlyn%'), 'Nike Training T-Shirt',   'Sport',  599,  449, true),


-- ============================================================
-- PRODUCTS — Pharmacy & Beauty
-- ============================================================

  -- Dis-Chem (Mall of Africa)
  (shop_id('Dis-Chem', '%Mall of Africa%'), 'Neutrogena Hydro Boost Gel Cream 50ml', 'Beauty', 279, 199, true),
  (shop_id('Dis-Chem', '%Mall of Africa%'), 'L''Oréal Elvive Shampoo 400ml',          'Beauty',  89,  69, true),
  (shop_id('Dis-Chem', '%Mall of Africa%'), 'Dove Body Wash 750ml',                   'Beauty',  89,  65, true),
  (shop_id('Dis-Chem', '%Mall of Africa%'), 'Maybelline Fit Me Foundation',           'Beauty', 199, 149, true),
  (shop_id('Dis-Chem', '%Mall of Africa%'), 'Garnier Micellar Water 400ml',           'Beauty',  99,  79, true),

  -- Clicks (Sandton City)
  (shop_id('Clicks', '%Sandton%'), 'Neutrogena Hydro Boost Gel Cream 50ml', 'Beauty', 269, 209, true),
  (shop_id('Clicks', '%Sandton%'), 'L''Oréal Elvive Shampoo 400ml',          'Beauty',  85,  65, true),
  (shop_id('Clicks', '%Sandton%'), 'Dove Body Wash 750ml',                   'Beauty',  85,  65, true),
  (shop_id('Clicks', '%Sandton%'), 'Revlon ColorStay Foundation',            'Beauty', 299, 239, true),

  -- Dis-Chem (Gateway)
  (shop_id('Dis-Chem', '%Gateway%'), 'Neutrogena Hydro Boost Gel Cream 50ml', 'Beauty', 279, 199, true),
  (shop_id('Dis-Chem', '%Gateway%'), 'L''Oréal Elvive Shampoo 400ml',          'Beauty',  89,  69, true),
  (shop_id('Dis-Chem', '%Gateway%'), 'Maybelline Fit Me Foundation',           'Beauty', 199, 149, true),

  -- Dis-Chem (Canal Walk)
  (shop_id('Dis-Chem', '%Canal Walk%'), 'Neutrogena Hydro Boost Gel Cream 50ml', 'Beauty', 279, 199, true),
  (shop_id('Dis-Chem', '%Canal Walk%'), 'Dove Body Wash 750ml',                   'Beauty',  89,  65, true),
  (shop_id('Dis-Chem', '%Canal Walk%'), 'Garnier Micellar Water 400ml',           'Beauty',  99,  79, true)

ON CONFLICT DO NOTHING;


-- ============================================================
-- CLEANUP helper function (not needed after seed runs)
-- ============================================================
-- DROP FUNCTION IF EXISTS shop_id(TEXT, TEXT);
