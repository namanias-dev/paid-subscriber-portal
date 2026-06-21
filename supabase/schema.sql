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
  drip_date date,
  created_at timestamptz default now()
);

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

-- ---------------------------- admin_users ---------------------------
create table if not exists public.admin_users (
  id uuid primary key default gen_random_uuid(),
  username text unique,
  password_hash text,
  role text default 'Super Admin',
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
  gst boolean default false,
  emi_amount int,
  emi_months int,
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
  created_at timestamptz default now()
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
  verified_signature boolean
);

create unique index if not exists payments_reference_no_idx on public.payments (reference_no);

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
create index if not exists idx_leads_status on public.leads (status);
create index if not exists idx_enrollments_student on public.enrollments (student_id);
create index if not exists idx_webinars_status on public.webinars (status);

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
alter table public.referrals enable row level security;
alter table public.staff enable row level security;

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
