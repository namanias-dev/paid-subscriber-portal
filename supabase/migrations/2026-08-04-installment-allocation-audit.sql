-- ============================================================================
-- INSTALMENT ALLOCATION AUDIT (oldest-outstanding-first backfill)
-- Additive + nullable + reversible. No schedule/amount columns altered here —
-- course_enrollments.schedule JSONB is updated by the app backfill script.
-- Rollback at bottom.
-- ============================================================================

create table if not exists public.installment_allocation_audit (
  id                    uuid primary key default gen_random_uuid(),
  enrollment_id         text not null,
  student_name          text,
  phone                 text,
  amount_paid_before    numeric,
  amount_paid_after     numeric,
  paid_sum_before       numeric,
  paid_sum_after        numeric,
  schedule_before       jsonb,
  schedule_after        jsonb,
  lock_before           boolean,
  lock_after            boolean,
  applied_at            timestamptz not null default now(),
  applied_by            text,
  note                  text
);

create index if not exists installment_allocation_audit_enrollment_idx
  on public.installment_allocation_audit (enrollment_id);

create index if not exists installment_allocation_audit_applied_idx
  on public.installment_allocation_audit (applied_at desc);

comment on table public.installment_allocation_audit is
  'Audit of oldest-outstanding-first schedule re-labelling. Totals must not move.';

-- Rollback:
-- drop table if exists public.installment_allocation_audit;
