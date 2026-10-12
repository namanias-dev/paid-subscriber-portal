-- Minimal schema for isolated finalize_course_payment RPC tests.
-- Not a full production dump — only tables/columns the RPC + repair need.

create extension if not exists pgcrypto;

create table if not exists public.payments (
  id text primary key,
  student_name text,
  phone text,
  item text,
  item_type text,
  amount int,
  status text,
  razorpay_payment_id text,
  mode text,
  created_at timestamptz default now(),
  reference_no text unique,
  gateway text,
  gateway_ref text,
  payment_mode text,
  transaction_date text,
  enrollment_id text,
  payment_kind text,
  installment_no int,
  receipt_no text,
  payment_source text,
  deleted_at timestamptz,
  is_superseded boolean default false
);

create table if not exists public.course_enrollments (
  id text primary key,
  phone text not null,
  student_name text,
  email text,
  course_id text,
  course_slug text,
  course_title text,
  batch_label text,
  plan_type text not null default 'emi',
  total_fee int not null default 0,
  amount_paid int not null default 0,
  installment_count int not null default 0,
  status text not null default 'pending',
  schedule jsonb not null default '[]'::jsonb,
  discount_amount int not null default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  superseded_by text
);

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
  method text,
  issued_at timestamptz default now()
);

create table if not exists public.enrollment_transfers (
  id text primary key default gen_random_uuid()::text,
  from_enrollment_id text not null,
  to_enrollment_id text not null,
  amount_paid int,
  reason text,
  old_schedule jsonb,
  new_schedule jsonb,
  created_at timestamptz default now()
);

create sequence if not exists public.receipt_no_seq start 1001;
create or replace function public.next_receipt_no() returns text
language plpgsql as $$
declare n bigint; fy text;
begin
  n := nextval('public.receipt_no_seq');
  fy := to_char(now() at time zone 'Asia/Kolkata', 'YY') || to_char((now() at time zone 'Asia/Kolkata') + interval '1 year', 'YY');
  return 'NSA-' || fy || '-' || lpad(n::text, 6, '0');
end;
$$;
