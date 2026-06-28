-- ============================================================
-- Duplicate-enrollment merge tool + recoverable payment trash + safe payment edits.
--
-- ADDITIVE & BACKWARD-COMPATIBLE:
--   * payments gains soft-delete columns (deleted_at/by/reason). NOTHING is ever
--     hard-deleted by the app; "delete" = set deleted_at. All payment reads that
--     drive money/access filter deleted_at IS NULL; a Trash view reads the rest.
--   * course_enrollments gains superseded_by (points a cancelled duplicate at the
--     canonical enrollment it was merged into). Status 'cancelled' already exists.
--   * enrollment_merge_log records every merge (who, what was cancelled, payments
--     re-pointed/abandoned, old->new balance, reason) — immutable audit trail.
--   * payment edits/deletes/restores are logged in the existing payment_action_log
--     (action text is free-form: 'edit' | 'soft_delete' | 'restore' |
--     'permanent_delete'), so no schema change is needed there.
-- ============================================================

-- ---- payments: recoverable soft-delete (Trash) ----
alter table public.payments add column if not exists deleted_at timestamptz;
alter table public.payments add column if not exists deleted_by text;
alter table public.payments add column if not exists deleted_reason text;
create index if not exists payments_deleted_at_idx on public.payments (deleted_at);

-- ---- course_enrollments: link a cancelled duplicate to its canonical row ----
alter table public.course_enrollments add column if not exists superseded_by text;
create index if not exists ce_superseded_by_idx on public.course_enrollments (superseded_by);
-- Speeds up the on-demand duplicate detection (group by phone+course_id).
create index if not exists ce_phone_course_idx on public.course_enrollments (phone, course_id);

-- ---- Audit log: one row per duplicate-enrollment merge ----
create table if not exists public.enrollment_merge_log (
  id text primary key,
  phone text,
  course_id text,
  course_title text,
  kept_enrollment_id text not null,
  cancelled_enrollment_ids jsonb not null default '[]'::jsonb,
  repointed_payment_ids jsonb not null default '[]'::jsonb,
  abandoned_payment_ids jsonb not null default '[]'::jsonb,
  old_outstanding int not null default 0,
  new_outstanding int not null default 0,
  old_enrollment_count int not null default 0,
  reason text,
  actor_id text,
  actor_name text,
  actor_role text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists eml_phone_idx on public.enrollment_merge_log (phone);
create index if not exists eml_kept_idx on public.enrollment_merge_log (kept_enrollment_id);
create index if not exists eml_created_idx on public.enrollment_merge_log (created_at);

-- Service-role-only: RLS enabled, NO policies → anon/auth get nothing; the app's
-- service-role client (getSupabaseAdmin) bypasses RLS for all reads/writes.
alter table public.enrollment_merge_log enable row level security;

notify pgrst, 'reload schema';
