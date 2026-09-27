-- Optional 4:5 artwork for the Notes Store landing notebook.
-- Null keeps the existing cover_image_key fallback. No backfill.

alter table public.store_products
  add column if not exists store_thumbnail_image_key text;

comment on column public.store_products.store_thumbnail_image_key is
  'Optional public R2 key for the 4:5 Notes Store landing thumbnail. Null falls back to cover_image_key.';
