-- Total-fee discount on course enrollments (staff-applied concession).
-- Additive & backward-compatible: existing rows keep discount_amount = 0.
alter table public.course_enrollments
  add column if not exists discount_amount int not null default 0,
  add column if not exists original_total_fee int,
  add column if not exists discount_reason text,
  add column if not exists discount_applied_by text,
  add column if not exists discount_applied_at timestamptz;
