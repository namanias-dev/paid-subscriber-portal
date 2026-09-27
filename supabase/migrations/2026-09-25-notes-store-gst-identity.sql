alter table public.store_invoice_settings
  add column if not exists trade_name text,
  add column if not exists constitution text,
  add column if not exists gst_registration_status text,
  add column if not exists registration_type text;

alter table public.store_invoices
  add column if not exists utgst_minor integer not null default 0;
