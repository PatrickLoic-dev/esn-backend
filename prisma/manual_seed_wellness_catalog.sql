-- Re-seeds the wellness catalog after manual_empty_catalog.sql.
-- 8 categories (icon keys match the frontend's ICON_REGISTRY / keyword
-- matcher in src/lib/categoryIcon.ts) and 20 products: 16 STOCK / 4
-- MADE_TO_ORDER (80/20 split). MADE_TO_ORDER items carry stock = 0 but the
-- storefront never surfaces that — it shows a "Request a quote" CTA instead.
--
-- Run this in the Supabase SQL editor, after manual_empty_catalog.sql.

BEGIN;

-- ---------------------------------------------------------------------------
-- Categories
-- ---------------------------------------------------------------------------
INSERT INTO "Category" (id, name, slug, description, color, icon, featured, "isActive", "createdAt", "updatedAt")
VALUES
  (gen_random_uuid(), 'Aromatherapy',    'aromatherapy',    'Essential oils, diffusers, and scented rituals', 'Green',  'Leaf',    true,  true, now(), now()),
  (gen_random_uuid(), 'Supplements',     'supplements',     'Vitamins, minerals, and natural boosters',       'Purple', 'Pill',    true,  true, now(), now()),
  (gen_random_uuid(), 'Skincare',        'skincare',        'Face and body care for a natural glow',          'Pink',   'Droplet', true,  true, now(), now()),
  (gen_random_uuid(), 'Spa & Massage',   'spa-massage',     'Massage and self-care rituals at home',          'Blue',   'Waves',   true,  true, now(), now()),
  (gen_random_uuid(), 'Meditation & Yoga', 'meditation-yoga', 'Mindfulness, yoga, and relaxation essentials', 'Orange', 'Flower2', false, true, now(), now()),
  (gen_random_uuid(), 'Fitness',         'fitness',         'Home workout and recovery gear',                 'Red',    'Dumbbell',false, true, now(), now()),
  (gen_random_uuid(), 'Beauty',          'beauty',          'Natural cosmetics and personal care',            'Pink',   'Sparkles',false, true, now(), now()),
  (gen_random_uuid(), 'Sleep',           'sleep',           'Rituals and aids for a better night''s sleep',   'Purple', 'Moon',    false, true, now(), now());

-- ---------------------------------------------------------------------------
-- Products — STOCK (16)
-- ---------------------------------------------------------------------------
INSERT INTO "Product" (id, name, description, price, "comparePrice", sku, stock, "stockMin", "stockMax", "imageUrl", "isActive", fulfilment, "categoryId", "createdAt", "updatedAt")
VALUES
  (gen_random_uuid(), 'Organic Lavender Essential Oil', 'Steam-distilled French lavender oil, calming and multi-purpose.', 12.99, 16.99, 'AROM-001', 60, 10, 150, '/images/product-1.png', true, 'STOCK', (SELECT id FROM "Category" WHERE slug = 'aromatherapy'), now(), now()),
  (gen_random_uuid(), 'Ceramic Aroma Diffuser', 'Whisper-quiet ultrasonic diffuser with a hand-finished ceramic shell.', 29.99, 39.99, 'AROM-002', 25, 5, 60, '/images/product-2.png', true, 'STOCK', (SELECT id FROM "Category" WHERE slug = 'aromatherapy'), now(), now()),
  (gen_random_uuid(), 'Sandalwood Scented Candle', 'Soy-wax candle, 45-hour burn, warm sandalwood and amber notes.', 18.50, NULL, 'AROM-003', 40, 8, 100, '/images/product-3.png', true, 'STOCK', (SELECT id FROM "Category" WHERE slug = 'aromatherapy'), now(), now()),

  (gen_random_uuid(), 'Natural Vitamin Complex', 'Daily multivitamin blend with D3, B-complex, and zinc.', 19.99, NULL, 'SUPP-001', 80, 15, 200, '/images/product-4.png', true, 'STOCK', (SELECT id FROM "Category" WHERE slug = 'supplements'), now(), now()),
  (gen_random_uuid(), 'Magnesium & Melatonin Complex', 'Evening formula to support relaxation and restful sleep.', 22.50, NULL, 'SUPP-002', 55, 10, 150, '/images/product-1.png', true, 'STOCK', (SELECT id FROM "Category" WHERE slug = 'supplements'), now(), now()),
  (gen_random_uuid(), 'Plant-Based Protein Powder', 'Pea and rice protein blend, unflavored, 900g.', 34.90, 39.90, 'SUPP-003', 30, 5, 80, '/images/product-2.png', true, 'STOCK', (SELECT id FROM "Category" WHERE slug = 'supplements'), now(), now()),

  (gen_random_uuid(), 'Hydrating Face Cream', 'Lightweight daily moisturizer with hyaluronic acid.', 24.90, NULL, 'SKIN-001', 45, 8, 120, '/images/product-3.png', true, 'STOCK', (SELECT id FROM "Category" WHERE slug = 'skincare'), now(), now()),
  (gen_random_uuid(), 'Vitamin C Glow Serum', 'Brightening serum, 20% vitamin C, for a radiant complexion.', 27.90, 32.90, 'SKIN-002', 38, 8, 100, '/images/product-4.png', true, 'STOCK', (SELECT id FROM "Category" WHERE slug = 'skincare'), now(), now()),
  (gen_random_uuid(), 'Shea Butter Body Balm', 'Rich, unrefined shea butter balm for dry skin.', 14.50, NULL, 'SKIN-003', 70, 15, 180, '/images/product-1.png', true, 'STOCK', (SELECT id FROM "Category" WHERE slug = 'skincare'), now(), now()),

  (gen_random_uuid(), 'Massage Ritual Gift Set', 'Massage oil, stone roller, and balm in a gift-ready box.', 39.90, NULL, 'SPA-001', 20, 5, 50, '/images/product-2.png', true, 'STOCK', (SELECT id FROM "Category" WHERE slug = 'spa-massage'), now(), now()),
  (gen_random_uuid(), 'Cane Sugar Body Scrub', 'Exfoliating scrub with cane sugar and sweet almond oil.', 16.90, NULL, 'SPA-002', 50, 10, 120, '/images/product-3.png', true, 'STOCK', (SELECT id FROM "Category" WHERE slug = 'spa-massage'), now(), now()),

  (gen_random_uuid(), 'Eco-Friendly Yoga Mat', 'Non-slip natural rubber mat, 5mm, biodegradable.', 32.90, NULL, 'MEDI-001', 33, 6, 80, '/images/product-4.png', true, 'STOCK', (SELECT id FROM "Category" WHERE slug = 'meditation-yoga'), now(), now()),
  (gen_random_uuid(), 'Palo Santo Incense Bundle', 'Sustainably sourced palo santo sticks for meditation rituals.', 9.50, NULL, 'MEDI-002', 90, 20, 200, '/images/product-1.png', true, 'STOCK', (SELECT id FROM "Category" WHERE slug = 'meditation-yoga'), now(), now()),

  (gen_random_uuid(), 'Resistance Bands Set', 'Five-band set with varying resistance for home workouts.', 19.90, NULL, 'FIT-001', 65, 12, 150, '/images/product-2.png', true, 'STOCK', (SELECT id FROM "Category" WHERE slug = 'fitness'), now(), now()),
  (gen_random_uuid(), 'Foam Roller Pro', 'High-density foam roller for muscle recovery and mobility.', 27.90, NULL, 'FIT-002', 28, 5, 70, '/images/product-3.png', true, 'STOCK', (SELECT id FROM "Category" WHERE slug = 'fitness'), now(), now()),

  (gen_random_uuid(), 'Natural Honey Soap', 'Cold-pressed soap bar with raw honey and oatmeal.', 6.90, NULL, 'BEAU-001', 100, 20, 250, '/images/product-4.png', true, 'STOCK', (SELECT id FROM "Category" WHERE slug = 'beauty'), now(), now());

-- ---------------------------------------------------------------------------
-- Products — MADE_TO_ORDER (4)
-- Stock is 0 by design (no inventory held); the storefront shows "Request a
-- quote" instead of "Add to cart" and never reveals the lack of stock.
-- ---------------------------------------------------------------------------
INSERT INTO "Product" (id, name, description, price, "comparePrice", sku, stock, "stockMin", "stockMax", "imageUrl", "isActive", fulfilment, "categoryId", "createdAt", "updatedAt")
VALUES
  (gen_random_uuid(), 'Custom Aromatherapy Blend', 'A personal essential-oil blend, formulated to order from your preferences.', 45.00, NULL, 'AROM-004', 0, NULL, NULL, '/images/product-1.png', true, 'MADE_TO_ORDER', (SELECT id FROM "Category" WHERE slug = 'aromatherapy'), now(), now()),
  (gen_random_uuid(), 'Bespoke Skincare Regimen Box', 'A full skincare routine curated for your skin type, made to order.', 89.00, NULL, 'SKIN-004', 0, NULL, NULL, '/images/product-2.png', true, 'MADE_TO_ORDER', (SELECT id FROM "Category" WHERE slug = 'skincare'), now(), now()),
  (gen_random_uuid(), 'Personalized Supplement Pack', 'A daily supplement pack tailored to your goals, made to order.', 59.00, NULL, 'SUPP-004', 0, NULL, NULL, '/images/product-3.png', true, 'MADE_TO_ORDER', (SELECT id FROM "Category" WHERE slug = 'supplements'), now(), now()),
  (gen_random_uuid(), 'Private Yoga & Meditation Retreat Kit', 'A curated retreat-in-a-box, built to order around your practice.', 149.00, NULL, 'MEDI-003', 0, NULL, NULL, '/images/product-4.png', true, 'MADE_TO_ORDER', (SELECT id FROM "Category" WHERE slug = 'meditation-yoga'), now(), now());

COMMIT;
