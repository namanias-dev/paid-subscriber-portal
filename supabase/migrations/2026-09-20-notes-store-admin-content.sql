-- Notes Store — richer admin-editable product content + lifecycle (additive, safe).
--
-- Backs the rebuilt Notes product editor so staff manage real customer-facing
-- content (not raw JSON/columns). All nullable; existing rows unaffected.

alter table public.store_products add column if not exists topics_json jsonb;              -- Topics covered
alter table public.store_products add column if not exists how_to_use_md text;             -- "How to use these notes"
alter table public.store_products add column if not exists prelims_relevance_md text;      -- Prelims relevance
alter table public.store_products add column if not exists mains_relevance_md text;        -- Mains relevance
alter table public.store_products add column if not exists revision_value_md text;         -- Revision value
alter table public.store_products add column if not exists physical_format text;           -- e.g. "Printed booklet set"

-- Archive lifecycle: archived products are hidden from the store and the default
-- admin list but retained for order-history integrity (never hard-deleted when
-- orders reference them).
alter table public.store_products add column if not exists archived_at timestamptz;
create index if not exists store_products_archived_idx on public.store_products (archived_at);
