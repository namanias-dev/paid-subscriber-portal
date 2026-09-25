create table if not exists public.store_invoice_settings (
  id integer primary key default 1 check (id = 1),
  display_name text not null default 'Naman IAS Academy',
  legal_name text,
  address_line text,
  city text,
  state text,
  state_code text,
  pincode text,
  gstin text,
  pan text,
  support_phone text,
  support_email text,
  invoice_prefix text not null default 'NIA',
  price_tax_mode text not null default 'inclusive' check (price_tax_mode in ('inclusive', 'exclusive')),
  document_mode text not null default 'auto',
  legal_footer text,
  signatory_name text,
  updated_at timestamptz not null default now()
);

insert into public.store_invoice_settings (id) values (1) on conflict (id) do nothing;

create table if not exists public.store_invoice_counters (
  namespace text not null,
  financial_year text not null,
  last_value integer not null default 0,
  primary key (namespace, financial_year)
);

create or replace function public.next_store_invoice_seq(p_namespace text, p_fy text)
returns integer
language plpgsql
as $$
declare
  n integer;
begin
  insert into public.store_invoice_counters (namespace, financial_year, last_value)
  values (p_namespace, p_fy, 1)
  on conflict (namespace, financial_year)
  do update set last_value = public.store_invoice_counters.last_value + 1
  returning last_value into n;
  return n;
end;
$$;

create table if not exists public.store_invoices (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.store_orders (id) on delete restrict,
  invoice_number text not null unique,
  financial_year text not null,
  sequence_number integer not null,
  namespace text not null default 'production',
  document_type text not null,
  status text not null default 'PENDING' check (status in ('PENDING', 'GENERATING', 'READY', 'FAILED')),
  attention text,
  issued_at timestamptz not null default now(),
  seller_snapshot jsonb not null default '{}'::jsonb,
  buyer_snapshot jsonb not null default '{}'::jsonb,
  shipping_snapshot jsonb not null default '{}'::jsonb,
  line_items_snapshot jsonb not null default '[]'::jsonb,
  tax_summary jsonb not null default '{}'::jsonb,
  subtotal_minor integer not null default 0,
  discount_minor integer not null default 0,
  shipping_minor integer not null default 0,
  taxable_minor integer not null default 0,
  cgst_minor integer not null default 0,
  sgst_minor integer not null default 0,
  igst_minor integer not null default 0,
  cess_minor integer not null default 0,
  rounding_minor integer not null default 0,
  grand_total_minor integer not null default 0,
  currency text not null default 'INR',
  place_of_supply_state text,
  place_of_supply_state_code text,
  payment_gateway text,
  gateway_transaction_id text,
  gateway_reference text,
  paid_at timestamptz,
  r2_object_key text,
  pdf_sha256 text,
  pdf_size integer,
  pdf_version integer not null default 1,
  pdf_generated_at timestamptz,
  irn text,
  irn_ack_number text,
  irn_ack_date timestamptz,
  irn_signed_qr text,
  credit_note_status text,
  credit_note_number text,
  credit_note_issued_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.store_invoices enable row level security;
alter table public.store_invoice_settings enable row level security;
alter table public.store_invoice_counters enable row level security;
