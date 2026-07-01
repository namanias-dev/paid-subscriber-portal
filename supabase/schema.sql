-- ============================================================
-- Naman Sharma IAS Academy — Subscriber Portal
-- Supabase schema. Run this FIRST in the Supabase SQL editor,
-- then run seed.sql.
-- ============================================================

create extension if not exists "pgcrypto";

-- ----------------------------- students -----------------------------
create table if not exists public.students (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text unique not null,
  email text,
  plan text check (plan in ('1m','3m','6m','12m','lifetime')),
  months int,
  access_code text unique not null,
  start_date timestamptz default now(),
  expiry_date timestamptz,
  amount_paid int,
  razorpay_payment_id text,
  razorpay_order_id text,
  target_year int,
  optional_subject text,
  streak_count int default 0,
  last_active_date date,
  is_active boolean default true,
  notes text,
  created_at timestamptz default now()
);

-- --------------------------- content_items --------------------------
create table if not exists public.content_items (
  id uuid primary key default gen_random_uuid(),
  type text check (type in (
    'current_affairs','mcq','booklet','recording',
    'live_link','pyq','test_series','answer_writing','notes','maps'
  )),
  subject text,
  paper text,
  title text not null,
  description text,
  drive_link text,
  youtube_link text,
  date date,
  duration text,
  is_published boolean default false,
  course_id text,
  course_ids jsonb not null default '[]'::jsonb,
  class_no integer,
  telegram_link text,
  drip_date date,
  -- Hosted lecture recordings (direct-to-R2) as a source type on the same table.
  source_type text not null default 'link',      -- 'link' | 'hosted'
  visibility text not null default 'enrolled',    -- 'enrolled' | 'public'
  upload_status text not null default 'idle',     -- idle|uploading|paused|completed|failed
  processed_key text,
  thumbnail_key text,
  notes_pdf_key text,
  duration_seconds integer,
  file_size bigint,
  resolution text,
  public_cdn boolean not null default false,
  multipart_upload_id text,
  multipart_key text,
  multipart_parts jsonb not null default '[]'::jsonb,
  multipart_total_parts integer,
  multipart_chunk_size integer,
  created_at timestamptz default now()
);

-- Per-student, per-section "last seen" timestamps powering the Class Hub NEW badge.
create table if not exists public.class_hub_views (
  id uuid primary key default gen_random_uuid(),
  student_id text not null,
  course_id text not null,
  section text not null,
  last_seen_at timestamptz not null default now(),
  unique (student_id, course_id, section)
);
create index if not exists class_hub_views_student_idx on public.class_hub_views (student_id);

-- Resume-watching + completion tracking for hosted lectures (canonical students.id).
create table if not exists public.lecture_watch_progress (
  id uuid primary key default gen_random_uuid(),
  learner_id text not null,
  recording_id text not null,
  last_position_seconds integer not null default 0,
  completed boolean not null default false,
  completed_at timestamptz,
  watch_count integer not null default 0,
  last_watched_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (learner_id, recording_id)
);
create index if not exists lwp_learner_idx on public.lecture_watch_progress (learner_id);

-- Admin manual access override per learner (phone) per course — always wins.
create table if not exists public.course_access_overrides (
  id uuid primary key default gen_random_uuid(),
  phone text not null,
  course_id text not null,
  mode text not null,            -- 'grant' | 'revoke'
  expires_at timestamptz,        -- null = lifetime grant
  note text,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (phone, course_id)
);
create index if not exists cao_phone_idx on public.course_access_overrides (phone);

-- ----------------------------- bookmarks ----------------------------
create table if not exists public.bookmarks (
  id uuid primary key default gen_random_uuid(),
  student_id uuid references public.students(id) on delete cascade,
  content_id uuid references public.content_items(id) on delete cascade,
  created_at timestamptz default now(),
  unique (student_id, content_id)
);

-- -------------------------- content_progress ------------------------
create table if not exists public.content_progress (
  id uuid primary key default gen_random_uuid(),
  student_id uuid references public.students(id) on delete cascade,
  content_id uuid references public.content_items(id) on delete cascade,
  completed boolean default false,
  completed_at timestamptz,
  unique (student_id, content_id)
);

-- ------------------------------- roles ------------------------------
-- RBAC roles for admin/staff accounts. Permissions is a JSON map of boolean flags.
create table if not exists public.roles (
  id text primary key,
  name text not null,
  description text,
  permissions jsonb not null default '{}'::jsonb,
  is_system boolean not null default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ---------------------------- admin_users ---------------------------
-- Admin/staff LOGIN accounts. Enriched with RBAC role + status + credential mgmt.
create table if not exists public.admin_users (
  id uuid primary key default gen_random_uuid(),
  username text unique,
  password_hash text,
  role text default 'Super Admin',
  name text,
  email text,
  -- Optional 10-digit mobile linking a staff member to a USER-PORTAL test login.
  phone text,
  role_id text references public.roles(id),
  status text not null default 'active',
  must_change_password boolean not null default false,
  permissions_override jsonb,
  created_by text,
  last_login_at timestamptz,
  created_at timestamptz default now()
);

-- ============================================================
-- LMS + CRM expansion tables
-- ============================================================

-- ------------------------------ courses -----------------------------
create table if not exists public.courses (
  id text primary key,
  slug text unique not null,
  title text not null,
  category text,
  description text,
  long_description text,
  image text,
  modes jsonb default '[]'::jsonb,
  language text,
  target_years text,
  batch_start text,
  duration text,
  price int default 0,
  original_price int,
  pay_in_full_price numeric,
  gst boolean default false,
  emi_amount int, -- deprecated: EMI auto-calculated from emi_config
  emi_months int, -- deprecated: EMI auto-calculated from emi_config
  faculty text,
  capacity int,
  seats_left int,
  status text default 'draft',
  brochure_link text,
  demo_video text,
  razorpay_link text,
  included jsonb default '[]'::jsonb,
  not_included jsonb default '[]'::jsonb,
  curriculum jsonb default '[]'::jsonb,
  schedule text,
  featured boolean default false,
  display_order int,
  cover_image_url text,
  mobile_image_url text,
  faqs jsonb default '[]'::jsonb,
  contact_links jsonb default '[]'::jsonb,
  pdf_resources jsonb default '[]'::jsonb,
  coupons jsonb default '[]'::jsonb,
  active boolean default true,
  about_html text,
  badge_label text,
  seat_config jsonb default '{}'::jsonb,
  whatsapp_config jsonb default '{}'::jsonb,
  video_config jsonb default '{}'::jsonb,
  mentor jsonb default '{}'::jsonb,
  seo jsonb default '{}'::jsonb,
  what_you_learn jsonb default '[]'::jsonb,
  who_should_attend jsonb default '[]'::jsonb,
  what_you_get jsonb default '[]'::jsonb,
  reviews jsonb default '[]'::jsonb,
  sections jsonb default '[]'::jsonb,
  brochure_ids jsonb default '[]'::jsonb,
  batch_timings jsonb default '[]'::jsonb,
  after_registration jsonb default '{}'::jsonb,
  emi_config jsonb default '{}'::jsonb,
  entitlements jsonb not null default '{}'::jsonb,
  created_at timestamptz default now()
);

-- ------------------- library_docs (central brochure/resources) -------------------
create table if not exists public.library_docs (
  id text primary key,
  title text not null,
  category text,
  file_url text not null,
  file_size bigint,
  description text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ---------------------------- enrollments ---------------------------
create table if not exists public.enrollments (
  id text primary key,
  student_id uuid references public.students(id) on delete cascade,
  course_id text references public.courses(id) on delete cascade,
  status text default 'active',
  fee_total int default 0,
  fee_collected int default 0,
  pending int default 0,
  installments jsonb default '[]'::jsonb,
  progress int default 0,
  enrolled_at timestamptz default now()
);

-- ------------------------------- leads ------------------------------
create table if not exists public.leads (
  id text primary key,
  name text not null,
  phone text not null,
  email text,
  city text,
  state text,
  source text,
  campaign text,
  course_interest text,
  target_year int,
  mode_pref text,
  called boolean default false,
  status text default 'New',
  temperature text default 'Interested',
  demo_booked boolean default false,
  demo_attended boolean default false,
  webinar_registered boolean default false,
  webinar_attended boolean default false,
  admitted boolean default false,
  course text,
  total_fee int,
  amount_collected int,
  pending_balance int,
  follow_up_date date,
  counsellor text,
  created_at timestamptz default now()
);

create table if not exists public.lead_activities (
  id text primary key,
  lead_id text references public.leads(id) on delete cascade,
  type text,
  note text,
  counsellor text,
  timestamp timestamptz default now()
);

create table if not exists public.site_settings (
  id text primary key default 'home',
  logo_url text,
  logo_alt text,
  hero jsonb not null default '{}'::jsonb,
  popup jsonb not null default '{}'::jsonb,
  content jsonb not null default '{}'::jsonb,
  brand jsonb not null default '{}'::jsonb,
  toppers jsonb not null default '[]'::jsonb,
  nav jsonb not null default '{}'::jsonb,
  about jsonb not null default '{}'::jsonb,
  updated_at timestamptz default now()
);
insert into public.site_settings (id) values ('home') on conflict (id) do nothing;

create table if not exists public.lead_forms (
  id text primary key,
  name text not null,
  slug text unique,
  campaign text,
  fields jsonb default '[]'::jsonb,
  submissions int default 0,
  created_at timestamptz default now()
);

create table if not exists public.form_submissions (
  id text primary key,
  form_id text references public.lead_forms(id) on delete cascade,
  data jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

-- ------------------------------ webinars ----------------------------
create table if not exists public.webinars (
  id text primary key,
  slug text unique not null,
  title text not null,
  description text,
  datetime timestamptz,
  link text,
  price int default 0,
  capacity int,
  registrations int default 0,
  recording_link text,
  -- Hosted recording (uploaded video FILE) — reuses the R2 multipart pipeline.
  recording_upload_status text,          -- null|uploading|completed|failed
  recording_upload_id text,              -- active multipart upload id (resume)
  recording_multipart_key text,          -- R2 key being/was uploaded
  recording_key text,                    -- final playable R2 object key
  recording_is_reference boolean default false, -- true => recording_key is a SHARED object owned by another row (never delete on remove)
  recording_duration_seconds integer,
  recording_file_size bigint,
  status text default 'upcoming',
  end_datetime timestamptz,
  long_description text,
  cover_image_url text,
  mobile_image_url text,
  faqs jsonb default '[]'::jsonb,
  contact_links jsonb default '[]'::jsonb,
  pdf_resources jsonb default '[]'::jsonb,
  coupons jsonb default '[]'::jsonb,
  active boolean default true,
  about_html text,
  badge_label text,
  seat_config jsonb default '{}'::jsonb,
  whatsapp_config jsonb default '{}'::jsonb,
  video_config jsonb default '{}'::jsonb,
  mentor jsonb default '{}'::jsonb,
  seo jsonb default '{}'::jsonb,
  what_you_learn jsonb default '[]'::jsonb,
  who_should_attend jsonb default '[]'::jsonb,
  what_you_get jsonb default '[]'::jsonb,
  reviews jsonb default '[]'::jsonb,
  sections jsonb default '[]'::jsonb,
  session_type text default 'live',
  join_note text,
  materials jsonb default '[]'::jsonb,
  cross_sell jsonb default '{}'::jsonb,
  brochure_ids jsonb default '[]'::jsonb,
  created_at timestamptz default now()
);

create table if not exists public.webinar_registrations (
  id text primary key default gen_random_uuid()::text,
  webinar_id text references public.webinars(id) on delete cascade,
  name text,
  phone text,
  attended boolean default false,
  created_at timestamptz default now()
);

-- ------------------------------- plans ------------------------------
create table if not exists public.plans (
  id text primary key,
  name text,
  months int,
  price int,
  features jsonb default '[]'::jsonb,
  razorpay_link text,
  created_at timestamptz default now()
);

-- ------------------------------ payments ----------------------------
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
  -- ICICI Eazypay fields (nullable; existing/Razorpay records remain valid)
  reference_no text,
  gateway text,
  sub_merchant_id text,
  item_slug text,
  email text,
  gateway_ref text,
  payment_mode text,
  total_amount int,
  transaction_amount int,
  response_code text,
  transaction_date text,
  verified_signature boolean,
  -- ICICI Verify URL settlement state for a PAID row: 'settled' (money in our
  -- account, status Success) | 'in_progress' (money confirmed, still settling —
  -- status RIP/SIP; access granted, settlement pending). See migrations.
  settlement_status text,
  -- Phase 2: Book-Your-Seat + EMI ledger links (nullable; one-time payments leave these null)
  enrollment_id text,
  payment_kind text,
  installment_no int,
  receipt_no text
);

create unique index if not exists payments_reference_no_idx on public.payments (reference_no);
create index if not exists payments_phone_idx on public.payments (phone);
create index if not exists payments_enrollment_idx on public.payments (enrollment_id);

-- ----------------- payment_proofs (self-service recovery) -----------------
-- Student-submitted proof for PENDING/VERIFYING/FAILED payments. SEPARATE from
-- the payment status enum: uploading proof never grants access. Access is still
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
  files jsonb not null default '[]'::jsonb,
  student_note text,
  admin_reason text,
  audit jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists payment_proofs_payment_id_uniq on public.payment_proofs (payment_id);
create index if not exists payment_proofs_phone_idx on public.payment_proofs (phone);
create index if not exists payment_proofs_status_idx on public.payment_proofs (status);

-- ----------------- course_enrollments (Book-Your-Seat + EMI) -----------------
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

-- ----------------------- payment_receipts (immutable) -----------------------
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
create index if not exists payment_receipts_phone_idx on public.payment_receipts (phone);
create index if not exists payment_receipts_reference_idx on public.payment_receipts (reference_no);

-- Sequential, traceable receipt numbers (NSA/<FY>/<seq>).
create sequence if not exists public.receipt_no_seq start 1001;
create or replace function public.next_receipt_no() returns text
language plpgsql as $$
declare
  n bigint;
  fy text;
begin
  n := nextval('public.receipt_no_seq');
  if extract(month from now() at time zone 'Asia/Kolkata') >= 4 then
    fy := to_char(now() at time zone 'Asia/Kolkata', 'YY') || to_char((now() at time zone 'Asia/Kolkata') + interval '1 year', 'YY');
  else
    fy := to_char((now() at time zone 'Asia/Kolkata') - interval '1 year', 'YY') || to_char(now() at time zone 'Asia/Kolkata', 'YY');
  end if;
  return 'NSA-' || fy || '-' || lpad(n::text, 6, '0');
end;
$$;

-- ------------------------------ buyers ------------------------------
-- Post-payment portal accounts: one phone -> one login code -> access to all
-- that phone's PAID payments (entitlements). See migrations/2026-buyer-access.sql.
create table if not exists public.buyers (
  id uuid primary key default gen_random_uuid(),
  phone text unique not null,
  name text,
  login_code text unique not null,
  -- True for auto-provisioned STAFF test accounts (excluded from real-student analytics).
  is_staff boolean not null default false,
  -- True for non-paying LEAD accounts auto-created from the quiz lead form (zero
  -- entitlements; cleared if the lead ever pays). See migrations/2026-lead-accounts.sql.
  is_lead boolean not null default false,
  -- Per-user session/access version for targeted cross-device invalidation: embedded
  -- in the buyer JWT and bumped on real access changes. See migrations/2026-session-version.sql.
  session_version integer not null default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists buyers_phone_idx on public.buyers (phone);
create unique index if not exists admin_users_phone_unique on public.admin_users (phone) where phone is not null;

-- Durable lightweight rate-limiting for login / forgot-code.
create table if not exists public.auth_attempts (
  id uuid primary key default gen_random_uuid(),
  key text not null,
  created_at timestamptz default now()
);
create index if not exists auth_attempts_key_idx on public.auth_attempts (key, created_at);

-- ----------------------------- referrals ----------------------------
create table if not exists public.referrals (
  id text primary key,
  referrer_name text,
  referrer_phone text,
  referee_name text,
  tier int,
  admitted boolean default false,
  payout_status text default 'pending',
  created_at timestamptz default now()
);

-- ------------------------------- staff ------------------------------
create table if not exists public.staff (
  id text primary key,
  name text,
  username text,
  role text,
  email text,
  active boolean default true,
  created_at timestamptz default now()
);

-- ---------------------------- access_logs ---------------------------
create table if not exists public.access_logs (
  id uuid primary key default gen_random_uuid(),
  student_id uuid references public.students(id) on delete set null,
  action text,
  timestamp timestamptz default now()
);

-- ----------------------------- indexes ------------------------------
create index if not exists idx_content_published on public.content_items (is_published, date desc);
create index if not exists idx_students_phone on public.students (phone);
create index if not exists idx_bookmarks_student on public.bookmarks (student_id);
create index if not exists idx_progress_student on public.content_progress (student_id);
create index if not exists idx_courses_status on public.courses (status);
create index if not exists idx_courses_display_order on public.courses (display_order);
create index if not exists idx_leads_status on public.leads (status);
create index if not exists idx_enrollments_student on public.enrollments (student_id);
create index if not exists idx_webinars_status on public.webinars (status);

-- ============================================================
-- Quiz / Test platform (UPSC Prelims-style MCQ practice)
-- ============================================================
create table if not exists public.questions (
  id text primary key,
  question_html text not null default '',
  question_image text,
  passage_id text,
  options jsonb not null default '{}'::jsonb,
  correct_option text not null default 'A',
  explanation_html text,
  short_explanation text,
  subject text,
  topic text,
  subtopic text,
  difficulty text not null default 'Moderate',
  tags jsonb not null default '[]'::jsonb,
  source text,
  source_url text,
  is_pyq boolean not null default false,
  pyq_year int,
  current_affairs_date date,
  language text not null default 'English',
  status text not null default 'draft',
  quality_status text not null default 'unreviewed',
  allow_in_public_quiz boolean not null default true,
  allow_in_paid_quiz boolean not null default true,
  marks_override numeric,
  negative_marks_override numeric,
  duplicate_check_hash text,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists questions_subject_idx on public.questions (subject);
create index if not exists questions_status_idx on public.questions (status);
create index if not exists questions_hash_idx on public.questions (duplicate_check_hash);

create table if not exists public.quizzes (
  id text primary key,
  title text not null default 'Untitled Quiz',
  slug text unique,
  description text,
  instructions_html text,
  type text not null default 'FreePublic',
  exam_type text not null default 'PrelimsGS',
  subject text,
  topic text,
  quiz_date date,
  quiz_month text,
  quiz_year int,
  difficulty text not null default 'Moderate',
  language text not null default 'English',
  thumbnail text,
  status text not null default 'draft',
  is_public boolean not null default true,
  requires_login boolean not null default false,
  requires_payment boolean not null default false,
  time_limit_minutes int,
  marks_per_question numeric not null default 2,
  negative_marking_enabled boolean not null default true,
  negative_fraction numeric not null default 0.3333,
  max_attempts int,
  scoring_settings jsonb not null default '{}'::jsonb,
  timing_settings jsonb not null default '{}'::jsonb,
  attempt_settings jsonb not null default '{}'::jsonb,
  result_settings jsonb not null default '{}'::jsonb,
  access_rules jsonb not null default '{}'::jsonb,
  seo jsonb not null default '{}'::jsonb,
  published_at timestamptz,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists quizzes_status_idx on public.quizzes (status);
create index if not exists quizzes_slug_idx on public.quizzes (slug);

create table if not exists public.quiz_questions (
  id text primary key,
  quiz_id text references public.quizzes(id) on delete cascade,
  question_id text references public.questions(id) on delete set null,
  order_index int not null default 0,
  section text,
  marks numeric,
  negative_marks numeric,
  snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists quiz_questions_quiz_idx on public.quiz_questions (quiz_id);

create table if not exists public.quiz_attempts (
  id text primary key,
  quiz_id text references public.quizzes(id) on delete cascade,
  user_id text,
  guest_session_id text,
  guest_name text,
  guest_email text,
  guest_mobile text,
  status text not null default 'IN_PROGRESS',
  started_at timestamptz not null default now(),
  submitted_at timestamptz,
  expires_at timestamptz,
  time_taken_seconds int,
  score numeric not null default 0,
  max_score numeric not null default 0,
  correct_count int not null default 0,
  incorrect_count int not null default 0,
  unattempted_count int not null default 0,
  accuracy numeric not null default 0,
  negative_marks numeric not null default 0,
  percentile numeric,
  rank int,
  result_summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists quiz_attempts_quiz_idx on public.quiz_attempts (quiz_id);
create index if not exists quiz_attempts_user_idx on public.quiz_attempts (user_id);
create index if not exists quiz_attempts_guest_idx on public.quiz_attempts (guest_session_id);

create table if not exists public.quiz_answers (
  id text primary key,
  attempt_id text references public.quiz_attempts(id) on delete cascade,
  quiz_id text,
  question_id text,
  selected_option text,
  is_correct boolean not null default false,
  is_unattempted boolean not null default true,
  marks_awarded numeric not null default 0,
  negative_marks_deducted numeric not null default 0,
  time_spent_seconds int,
  marked_for_review boolean not null default false,
  answer_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists quiz_answers_attempt_idx on public.quiz_answers (attempt_id);

create table if not exists public.import_jobs (
  id text primary key,
  type text not null default 'BULK_TEXT',
  source_config jsonb not null default '{}'::jsonb,
  status text not null default 'pending',
  total_rows int not null default 0,
  success_count int not null default 0,
  error_count int not null default 0,
  errors jsonb not null default '[]'::jsonb,
  created_by text,
  created_at timestamptz not null default now()
);

-- ============================================================
-- Row Level Security
-- The app uses the SERVICE ROLE key inside /api routes (bypasses RLS)
-- to enforce auth/expiry in application code. RLS below is a safety net
-- so the public ANON key can only ever read published content.
-- ============================================================

alter table public.students enable row level security;
alter table public.content_items enable row level security;
alter table public.bookmarks enable row level security;
alter table public.content_progress enable row level security;
alter table public.admin_users enable row level security;
alter table public.roles enable row level security;
alter table public.access_logs enable row level security;
alter table public.courses enable row level security;
alter table public.enrollments enable row level security;
alter table public.leads enable row level security;
alter table public.lead_activities enable row level security;
alter table public.lead_forms enable row level security;
alter table public.form_submissions enable row level security;
alter table public.webinars enable row level security;
alter table public.webinar_registrations enable row level security;
alter table public.plans enable row level security;
alter table public.payments enable row level security;
alter table public.buyers enable row level security;
alter table public.auth_attempts enable row level security;
alter table public.referrals enable row level security;
alter table public.staff enable row level security;
alter table public.questions enable row level security;
alter table public.quizzes enable row level security;
alter table public.quiz_questions enable row level security;
alter table public.quiz_attempts enable row level security;
alter table public.quiz_answers enable row level security;
alter table public.import_jobs enable row level security;

-- Anon may read ONLY published content. Everything else is closed to anon.
drop policy if exists "anon read published content" on public.content_items;
create policy "anon read published content"
  on public.content_items for select
  using (is_published = true);

-- Anon may read published courses & webinars (public marketing pages).
drop policy if exists "anon read published courses" on public.courses;
create policy "anon read published courses"
  on public.courses for select
  using (status = 'published');

drop policy if exists "anon read webinars" on public.webinars;
create policy "anon read webinars"
  on public.webinars for select
  using (true);

drop policy if exists "anon read plans" on public.plans;
create policy "anon read plans"
  on public.plans for select
  using (true);

-- Anon may submit leads & webinar registrations (public forms).
drop policy if exists "anon insert leads" on public.leads;
create policy "anon insert leads"
  on public.leads for insert
  with check (true);

drop policy if exists "anon insert webinar regs" on public.webinar_registrations;
create policy "anon insert webinar regs"
  on public.webinar_registrations for insert
  with check (true);

-- No anon policies on students/bookmarks/progress/admin/logs => fully locked.
-- The service role (server-side) bypasses RLS and handles all writes/reads.

-- ============================================================
-- Current Affairs module (see migrations/2026-current-affairs.sql)
-- ============================================================
create table if not exists public.ca_categories (
  id text primary key,
  slug text unique not null,
  name text not null,
  description text,
  seo jsonb not null default '{}'::jsonb,
  "order" int not null default 0,
  created_at timestamptz default now()
);
create table if not exists public.ca_tags (
  id text primary key,
  slug text unique not null,
  name text not null,
  seo jsonb not null default '{}'::jsonb,
  created_at timestamptz default now()
);
create table if not exists public.ca_articles (
  id text primary key,
  slug text unique not null,
  title text not null,
  summary text not null default '',
  article_type text not null default 'daily',
  status text not null default 'draft',
  publish_at timestamptz,
  ca_date date,
  author text,
  reading_time int,
  featured_image text,
  thumbnail_image text,
  mobile_image text,
  body_html text,
  sections jsonb not null default '[]'::jsonb,
  category_slug text,
  tags text[] not null default '{}',
  quick_revision jsonb not null default '{}'::jsonb,
  upsc jsonb not null default '{}'::jsonb,
  important boolean not null default false,
  trending boolean not null default false,
  show_on_home boolean not null default false,
  in_daily boolean not null default true,
  in_monthly boolean not null default true,
  related_quiz_slug text,
  pdf_ids text[] not null default '{}',
  cross_sell jsonb not null default '{}'::jsonb,
  seo jsonb not null default '{}'::jsonb,
  views int not null default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists ca_articles_status_idx on public.ca_articles (status);
create index if not exists ca_articles_publish_at_idx on public.ca_articles (publish_at desc);
create index if not exists ca_articles_ca_date_idx on public.ca_articles (ca_date desc);
create index if not exists ca_articles_category_idx on public.ca_articles (category_slug);
create index if not exists ca_articles_tags_idx on public.ca_articles using gin (tags);
create table if not exists public.ca_pdfs (
  id text primary key,
  title text not null,
  kind text not null default 'general',
  date_ref text,
  category_slug text,
  file_url text,
  cover_image text,
  description text,
  is_free boolean not null default true,
  requires_login boolean not null default false,
  requires_lead boolean not null default false,
  generated boolean not null default false,
  download_count int not null default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create table if not exists public.ca_leads (
  id text primary key,
  phone text not null,
  name text,
  source text,
  city text,
  target_year text,
  interested_course text,
  created_at timestamptz default now()
);
create table if not exists public.ca_bookmarks (
  id text primary key,
  user_phone text not null,
  article_slug text not null,
  created_at timestamptz default now(),
  unique (user_phone, article_slug)
);
create table if not exists public.ca_events (
  id text primary key,
  type text not null,
  ref text,
  created_at timestamptz default now()
);
create index if not exists ca_events_type_idx on public.ca_events (type);

alter table public.ca_categories enable row level security;
alter table public.ca_tags enable row level security;
alter table public.ca_articles enable row level security;
alter table public.ca_pdfs enable row level security;
alter table public.ca_leads enable row level security;
alter table public.ca_bookmarks enable row level security;
alter table public.ca_events enable row level security;

drop policy if exists "anon read ca_categories" on public.ca_categories;
create policy "anon read ca_categories" on public.ca_categories for select using (true);
drop policy if exists "anon read ca_tags" on public.ca_tags;
create policy "anon read ca_tags" on public.ca_tags for select using (true);
drop policy if exists "anon read published ca_articles" on public.ca_articles;
create policy "anon read published ca_articles"
  on public.ca_articles for select
  using (status = 'published' and (publish_at is null or publish_at <= now()));
drop policy if exists "anon read ca_pdfs" on public.ca_pdfs;
create policy "anon read ca_pdfs" on public.ca_pdfs for select using (true);
drop policy if exists "anon insert ca_leads" on public.ca_leads;
create policy "anon insert ca_leads" on public.ca_leads for insert with check (true);
