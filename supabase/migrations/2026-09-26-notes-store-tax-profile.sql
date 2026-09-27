alter table public.store_products
  add column if not exists tax_configuration_status text,
  add column if not exists tax_configuration_source text;

alter table public.store_invoice_settings
  add column if not exists show_bank_details boolean not null default false;
