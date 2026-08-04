-- Installment payment proofs — claims only. NEVER writes to payments.
-- One pending proof per student per instalment (partial unique index).

create table if not exists public.installment_payment_proofs (
  id uuid primary key default gen_random_uuid(),
  student_id text,
  phone text not null,
  course_id text not null,
  course_enrollment_id text not null,
  installment_no integer not null,
  claimed_amount numeric,
  claimed_paid_date date,
  reference_utr text,
  student_comment text,
  files jsonb not null default '[]'::jsonb,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'superseded')),
  submitted_at timestamptz not null default now(),
  reviewed_by text,
  reviewed_at timestamptz,
  review_reason text,
  provisional_grant_event_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint installment_payment_proofs_comment_len
    check (student_comment is null or char_length(student_comment) <= 500)
);

create unique index if not exists installment_payment_proofs_one_pending
  on public.installment_payment_proofs (course_enrollment_id, installment_no)
  where status = 'pending';

create index if not exists installment_payment_proofs_status_idx
  on public.installment_payment_proofs (status, submitted_at asc);

create index if not exists installment_payment_proofs_phone_idx
  on public.installment_payment_proofs (phone);

create index if not exists installment_payment_proofs_enrollment_idx
  on public.installment_payment_proofs (course_enrollment_id);

alter table public.installment_payment_proofs enable row level security;

-- Feature flag (student popup). Admin review surface ignores this.
create table if not exists public.app_feature_flags (
  key text primary key,
  enabled boolean not null default false,
  scope text not null default 'off',
  kill_switch boolean not null default false,
  meta jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

insert into public.app_feature_flags (key, enabled, scope, kill_switch, meta)
values (
  'installment_proof_popup',
  true,
  'cohort_73',
  false,
  '{"note":"Student popup for 63 grandfathered + 10 classic-grace only"}'::jsonb
)
on conflict (key) do update set
  enabled = excluded.enabled,
  scope = excluded.scope,
  kill_switch = excluded.kill_switch,
  updated_at = now();
