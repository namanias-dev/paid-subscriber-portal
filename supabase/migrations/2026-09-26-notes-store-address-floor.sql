alter table public.store_invoice_settings
  add column if not exists address_floor_display text,
  add column if not exists address_floor_raw text,
  add column if not exists address_sector text;
