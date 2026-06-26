-- ============================================================
-- Staff portal test-login bridge
-- ------------------------------------------------------------
-- Lets staff log in to the USER PORTAL (existing phone + login-code flow) to
-- test the real student view of courses/webinars comped to them — WITHOUT any
-- new auth system, and WITHOUT creating payment / enrolment / registration rows
-- (so revenue, seat counts and "real student" analytics stay clean).
--
--   * admin_users.phone — links a staff member to a portal account by phone.
--     Unique among non-null values so two staff can't share one test login.
--   * buyers.is_staff    — marks auto-provisioned staff TEST accounts so they
--     can be identified/filtered in admin and excluded from real-student stats.
-- Idempotent — safe to re-run.
-- ============================================================

alter table public.admin_users add column if not exists phone text;
create unique index if not exists admin_users_phone_unique
  on public.admin_users (phone) where phone is not null;

alter table public.buyers add column if not exists is_staff boolean not null default false;
create index if not exists buyers_is_staff_idx on public.buyers (is_staff) where is_staff = true;
