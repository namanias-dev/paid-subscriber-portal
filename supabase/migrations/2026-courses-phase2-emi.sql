-- ============================================================
-- Courses Phase 2: Book-Your-Seat + EMI/installment payments.
-- Course enrollments (phone-keyed), payment ledger links, immutable receipts.
-- Idempotent & backward-compatible. Existing one-time payments untouched.
-- ============================================================

-- ---- Per-course EMI config ----
alter table public.courses add column if not exists emi_config jsonb default '{}'::jsonb;

-- ---- Payment ledger links (nullable; one-time payments leave these null) ----
alter table public.payments add column if not exists enrollment_id text;
alter table public.payments add column if not exists payment_kind text;
alter table public.payments add column if not exists installment_no int;
alter table public.payments add column if not exists receipt_no text;
create index if not exists payments_enrollment_idx on public.payments (enrollment_id);

-- ---- Course enrollments (Book-Your-Seat + EMI), keyed by buyer phone ----
create table if not exists public.course_enrollments (
  id text primary key,
  phone text not null,
  student_name text,
  email text,
  course_id text references public.courses(id) on delete set null,
  course_slug text,
  course_title text,
  batch_label text,
  plan_type text not null default 'full',
  total_fee int not null default 0,
  amount_paid int not null default 0,
  installment_count int not null default 0,
  status text not null default 'pending',
  schedule jsonb not null default '[]'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists course_enrollments_phone_idx on public.course_enrollments (phone);
create index if not exists course_enrollments_course_idx on public.course_enrollments (course_id);

-- ---- Immutable payment receipts ----
create table if not exists public.payment_receipts (
  id text primary key,
  receipt_no text unique not null,
  enrollment_id text,
  payment_id text,
  reference_no text,
  phone text not null,
  student_name text,
  email text,
  course_title text,
  batch_label text,
  payment_kind text,
  payment_label text,
  amount int not null default 0,
  gateway_ref text,
  total_fee int not null default 0,
  paid_to_date int not null default 0,
  remaining int not null default 0,
  installments_summary text,
  status text,
  issued_at timestamptz default now()
);
create index if not exists payment_receipts_phone_idx on public.payment_receipts (phone);
create index if not exists payment_receipts_reference_idx on public.payment_receipts (reference_no);

-- ---- Sequential, traceable receipt numbers via a Postgres sequence ----
create sequence if not exists public.receipt_no_seq start 1001;

create or replace function public.next_receipt_no() returns text
language plpgsql as $$
declare
  n bigint;
  fy text;
begin
  n := nextval('public.receipt_no_seq');
  -- Indian financial year (Apr–Mar) for traceable grouping. URL-safe (no slashes).
  if extract(month from now() at time zone 'Asia/Kolkata') >= 4 then
    fy := to_char(now() at time zone 'Asia/Kolkata', 'YY') ||
          to_char((now() at time zone 'Asia/Kolkata') + interval '1 year', 'YY');
  else
    fy := to_char((now() at time zone 'Asia/Kolkata') - interval '1 year', 'YY') ||
          to_char(now() at time zone 'Asia/Kolkata', 'YY');
  end if;
  return 'NSA-' || fy || '-' || lpad(n::text, 6, '0');
end;
$$;

-- Public read for receipts/enrollments (app-level gating still enforced by phone).
alter table public.course_enrollments enable row level security;
alter table public.payment_receipts enable row level security;
do $$ begin
  create policy "Public read course_enrollments" on public.course_enrollments for select using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Public read payment_receipts" on public.payment_receipts for select using (true);
exception when duplicate_object then null; end $$;

notify pgrst, 'reload schema';
