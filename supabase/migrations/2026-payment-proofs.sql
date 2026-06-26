-- Self-service payment-proof recovery for PENDING / VERIFYING / FAILED payments.
-- Kept SEPARATE from the payment status enum: proof.status and payment.status are
-- independent lifecycles. Uploading proof NEVER grants access; access is still
-- granted only on PAID (ICICI) or an explicit admin Accept (reuses the PAID path).
create table if not exists public.payment_proofs (
  id uuid primary key default gen_random_uuid(),
  payment_id text not null references public.payments(id) on delete cascade,
  reference_no text,
  phone text not null,
  item_type text,
  item_slug text,
  item text,
  -- submitted -> reupload_requested -> submitted (re-upload) -> accepted / rejected
  status text not null default 'submitted',
  files jsonb not null default '[]'::jsonb,        -- [{key,name,content_type,size,uploaded_at}]
  student_note text,
  admin_reason text,                                -- reason surfaced to the student
  audit jsonb not null default '[]'::jsonb,         -- [{action, by, at, note}]
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists payment_proofs_payment_id_uniq on public.payment_proofs (payment_id);
create index if not exists payment_proofs_phone_idx on public.payment_proofs (phone);
create index if not exists payment_proofs_status_idx on public.payment_proofs (status);
alter table public.payment_proofs enable row level security;
