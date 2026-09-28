-- ============================================================================
-- Notes Store launch catalog: three real subject products, archive TEST rows,
-- clean names/slugs/copy. Additive. Does not drop tables or order history.
-- ============================================================================

-- Category merchandising copy for the three launch subjects.
update public.store_categories
set
  nav_label = 'Polity',
  name = 'Polity',
  short_description = 'Constitution, Parliament, Governance & key institutions.',
  updated_at = now()
where slug = 'polity';

update public.store_categories
set
  nav_label = 'Modern History',
  name = 'Modern History',
  short_description = 'British expansion, reform movements & India’s freedom struggle.',
  updated_at = now()
where slug = 'modern-history';

update public.store_categories
set
  nav_label = 'Economy',
  name = 'Economy',
  short_description = 'Core concepts, Indian economy, Budget & current developments.',
  updated_at = now()
where slug = 'economy';

-- Indian Polity — upgrade the merchandised ready-stock row.
update public.store_products
set
  sku = 'NOTES-POLITY',
  slug = 'polity',
  name = 'Indian Polity Notes',
  short_name = 'Polity',
  subject = 'Polity',
  stage = 'both',
  short_description = 'Constitution, Parliament, Governance & key institutions.',
  subtitle = 'Build a strong command over the Constitution, governance and institutions — with static concepts connected to current affairs.',
  description_md = 'Polity is one of the most consistent areas of UPSC preparation because the Constitution and institutions form the static base, while judgments, legislation, governance issues and institutional developments keep the subject current.',
  how_to_use_md = E'1. Read the core topic.\n2. Link it with the relevant current development.\n3. Mark PYQ-relevant concepts.\n4. Revise the condensed notes repeatedly.\n5. Add only essential updates instead of rebuilding notes from scratch.',
  seo_title = 'Indian Polity Notes for UPSC | Naman Sir',
  seo_description = 'Handwritten Indian Polity notes for UPSC Prelims and Mains — Constitution, governance and institutions, connected to current affairs. Printed hard copies delivered pan-India.',
  selling_price_paise = 299900,
  mrp_paise = 299900,
  availability_mode = 'on_demand',
  is_active = true,
  is_featured = true,
  archived_at = null,
  position = 10,
  updated_at = now()
where id = '815423bb-8b6e-4e2c-8507-33becb92b8ec';

-- Indian Economy — upgrade the merchandised row.
update public.store_products
set
  sku = 'NOTES-ECONOMY',
  slug = 'economy',
  name = 'Indian Economy Notes',
  short_name = 'Economy',
  subject = 'Economy',
  stage = 'both',
  short_description = 'Core concepts, Indian economy, Budget & current developments.',
  subtitle = 'Master the concepts behind growth, inflation, banking, Budget and the issues shaping India’s economy.',
  description_md = 'Economy is easier when concepts are connected to real developments. UPSC can test the same idea as a definition in Prelims, a policy development in current affairs, and an analytical question in Mains.',
  how_to_use_md = E'1. Read the core topic.\n2. Link it with the relevant current development.\n3. Mark PYQ-relevant concepts.\n4. Revise the condensed notes repeatedly.\n5. Add only essential updates instead of rebuilding notes from scratch.',
  seo_title = 'Indian Economy Notes for UPSC | Naman Sir',
  seo_description = 'Handwritten Indian Economy notes for UPSC — growth, inflation, banking, Budget and development, linked to current policy. Printed hard copies delivered pan-India.',
  selling_price_paise = 299900,
  mrp_paise = 299900,
  availability_mode = 'on_demand',
  is_active = true,
  is_featured = true,
  archived_at = null,
  position = 30,
  updated_at = now()
where id = '37ceb5c7-76d3-40fb-874a-1d92d5fdfe68';

-- Modern History — create if missing.
insert into public.store_products (
  id, sku, slug, kind, name, short_name, category_id, subject, stage, language,
  short_description, subtitle, description_md, how_to_use_md,
  seo_title, seo_description,
  mrp_paise, selling_price_paise, availability_mode,
  is_active, is_featured, position, max_quantity_per_order, tax_treatment
)
select
  'c3a1e7d4-2b90-4f11-9c6a-0d8f2a1b7e55',
  'NOTES-MODERN-HISTORY',
  'modern-history',
  'single',
  'Modern History Notes',
  'Modern History',
  c.id,
  'Modern History',
  'both',
  'english',
  'British expansion, reform movements & India’s freedom struggle.',
  'Understand the forces that shaped modern India — from British expansion to the freedom struggle and Independence.',
  'Modern History becomes much easier when studied as a connected story rather than isolated dates. The notes help you hold chronology, causes, personalities, movements and consequences together.',
  E'1. Read the core topic.\n2. Link it with the relevant current development.\n3. Mark PYQ-relevant concepts.\n4. Revise the condensed notes repeatedly.\n5. Add only essential updates instead of rebuilding notes from scratch.',
  'Modern History Notes for UPSC | Naman Sir',
  'Handwritten Modern History notes for UPSC — British expansion, reform movements and the freedom struggle, written as a connected story. Printed hard copies delivered pan-India.',
  299900,
  299900,
  'on_demand',
  true,
  true,
  20,
  5,
  'exempt'
from public.store_categories c
where c.slug = 'modern-history'
  and not exists (select 1 from public.store_products p where p.slug = 'modern-history' or p.sku = 'NOTES-MODERN-HISTORY');

-- Archive every other product so the public catalogue cannot resurrect TEST rows.
update public.store_products
set
  is_active = false,
  archived_at = coalesce(archived_at, now()),
  updated_at = now()
where sku not in ('NOTES-POLITY', 'NOTES-ECONOMY', 'NOTES-MODERN-HISTORY');
