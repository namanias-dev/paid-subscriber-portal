-- Notes Store — availability model + richer product content (additive, safe).
--
-- Adds an explicit availability mode so staff never have to fake an inventory
-- number for print-on-demand titles (spec §5). Backward compatible: every
-- existing row defaults to 'ready_stock', preserving current behaviour, and all
-- new columns are nullable content fields.
--
--   ready_stock  — physical copies on hand; sell down to zero, no oversell.
--   on_demand    — orderable with no stock counter; paid orders accrue as
--                  "copies to prepare" in the admin Preparation Queue.
--   coming_soon  — visible, not purchasable.
--   unavailable  — not purchasable (temporarily off).
--
-- `is_active` (draft vs live) stays orthogonal to availability_mode (how a live
-- product is sold).

alter table public.store_products
  add column if not exists availability_mode text not null default 'ready_stock'
    check (availability_mode in ('ready_stock', 'on_demand', 'coming_soon', 'unavailable'));

-- Structured, admin-editable product content used by the PDP conversion sections.
alter table public.store_products
  add column if not exists subtitle text;

alter table public.store_products
  add column if not exists author text;

alter table public.store_products
  add column if not exists booklets integer check (booklets is null or booklets >= 0);

-- "What's included" bullet points and "Who these notes are for" — JSON arrays of
-- short strings. Null/empty means the PDP simply omits that section.
alter table public.store_products
  add column if not exists highlights_json jsonb;

alter table public.store_products
  add column if not exists ideal_for_json jsonb;

-- Index to make the Preparation Queue's paid-unfulfilled scan efficient as order
-- volume grows (status filter is the hot path).
create index if not exists store_orders_status_idx on public.store_orders (status);
