-- Proof approval may record a real offline payment (additive columns only).
-- Does NOT alter PAID immutability trigger or installment amounts/dues.

-- Tag offline payments that originated from installment proof approval.
alter table public.payments
  add column if not exists proof_id uuid,
  add column if not exists payment_source text,
  add column if not exists finance_verified boolean not null default false,
  add column if not exists recorded_by text,
  add column if not exists reversed_at timestamptz,
  add column if not exists reversed_by text,
  add column if not exists reversal_reason text,
  add column if not exists reversal_of_payment_id uuid;

comment on column public.payments.proof_id is
  'installment_payment_proofs.id when payment_source=student_proof. Unique for idempotency.';
comment on column public.payments.payment_source is
  'Origin tag: student_proof | student_proof_reversal | null (gateway/offline cash).';
comment on column public.payments.finance_verified is
  'Finance has verified bank money for a student_proof payment.';
comment on column public.payments.reversed_at is
  'When a compensating reversal was applied. Original PAID status is never downgraded.';

-- One payment per proof (double-click / concurrent approve → one row).
create unique index if not exists payments_proof_id_uniq
  on public.payments (proof_id)
  where proof_id is not null;

create index if not exists payments_finance_verify_queue_idx
  on public.payments (created_at asc)
  where payment_source = 'student_proof'
    and finance_verified = false
    and reversed_at is null
    and deleted_at is null;

-- Proof row: expected snapshot + link to recorded payment + new status.
alter table public.installment_payment_proofs
  add column if not exists expected_amount numeric,
  add column if not exists expected_installment_no integer,
  add column if not exists recorded_payment_id text,
  add column if not exists recorded_amount numeric;

-- Expand status check to include approved_recorded.
alter table public.installment_payment_proofs
  drop constraint if exists installment_payment_proofs_status_check;

alter table public.installment_payment_proofs
  add constraint installment_payment_proofs_status_check
  check (status in ('pending', 'approved', 'approved_recorded', 'rejected', 'superseded'));

-- Feature flag: admin Approve & record (grant-only always available).
insert into public.app_feature_flags (key, enabled, scope, kill_switch, meta)
values (
  'proof_records_payment',
  true,
  'admin',
  false,
  '{"note":"Admin Approve & record payment via recordOfflineCoursePayment"}'::jsonb
)
on conflict (key) do update set
  enabled = excluded.enabled,
  scope = excluded.scope,
  kill_switch = excluded.kill_switch,
  updated_at = now();
