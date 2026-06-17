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
    'live_link','pyq','test_series','answer_writing'
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

-- Anon may read ONLY published content. Everything else is closed to anon.
drop policy if exists "anon read published content" on public.content_items;
create policy "anon read published content"
  on public.content_items for select
  using (is_published = true);

-- No anon policies on students/bookmarks/progress/admin/logs => fully locked.
-- The service role (server-side) bypasses RLS and handles all writes/reads.
