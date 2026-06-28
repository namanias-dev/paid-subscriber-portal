-- ============================================================
-- Admin payment-plan management: convert an existing enrollment between
-- FULL / EMI / CUSTOM_INSTALLMENTS after enrollment, with a full audit trail.
--
-- ADDITIVE & BACKWARD-COMPATIBLE:
--   * The installment "schedule" already lives in course_enrollments.schedule
--     (JSONB array of InstallmentItem). We DO NOT create a parallel installment
--     table. New per-line fields (title/grace/status/paid_amount/is_custom/
--     created_by/cancelled_reason/notes/created_at/updated_at) are stored INSIDE
--     those JSONB items, so the existing 15-day-grace access rule
--     (lib/entitlements.ts → earliestUnpaidDue) keeps driving access from the
--     same source of truth. graceDate maps to the SAME 15-day window — it is an
--     optional explicit grace-end, not a second grace mechanism.
--   * Existing payments / receipts / statuses are never touched here.
-- ============================================================

-- ---- Enrollment: payment-plan + student-notice columns ----
alter table public.course_enrollments add column if not exists payment_plan text;             -- FULL | EMI | CUSTOM_INSTALLMENTS
alter table public.course_enrollments add column if not exists previous_payment_plan text;
alter table public.course_enrollments add column if not exists payment_plan_changed_at timestamptz;
alter table public.course_enrollments add column if not exists payment_plan_changed_by text;
alter table public.course_enrollments add column if not exists payment_plan_change_reason text;
alter table public.course_enrollments add column if not exists plan_change_notice_pending boolean not null default false;
alter table public.course_enrollments add column if not exists plan_change_notice_seen_at timestamptz;

-- Backfill payment_plan from the legacy 2-value plan_type so existing rows are
-- consistent (idempotent: only fills NULLs).
update public.course_enrollments
   set payment_plan = case when plan_type = 'emi' then 'EMI' else 'FULL' end
 where payment_plan is null;

-- ---- Audit log: one row per plan change ----
create table if not exists public.enrollment_plan_change_log (
  id text primary key,
  enrollment_id text not null,
  student_id text,
  phone text,
  course_id text,
  old_plan text,
  new_plan text,
  old_outstanding int not null default 0,
  new_outstanding int not null default 0,
  reason text,
  changed_by text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz default now()
);
create index if not exists epcl_enrollment_idx on public.enrollment_plan_change_log (enrollment_id);
create index if not exists epcl_created_idx on public.enrollment_plan_change_log (created_at);

-- Service-role-only: RLS enabled, NO policies → anon/auth get nothing; the app's
-- service-role client (getSupabaseAdmin) bypasses RLS for all reads/writes.
alter table public.enrollment_plan_change_log enable row level security;

notify pgrst, 'reload schema';
