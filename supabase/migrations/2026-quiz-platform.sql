-- =====================================================================
-- Quiz / Test platform (UPSC Prelims-style MCQ practice)
-- Phase 1: tables only. Idempotent & fully additive — nothing existing is
-- touched. Safe to run multiple times.
-- =====================================================================

-- ----------------------------- questions -----------------------------
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

-- ------------------------------- quizzes -----------------------------
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

-- --------------------------- quiz_questions --------------------------
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

-- ---------------------------- quiz_attempts --------------------------
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

-- ----------------------------- quiz_answers --------------------------
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

-- ------------------------------ import_jobs --------------------------
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

-- RLS: all access is server-side via the service-role key (bypasses RLS).
alter table public.questions enable row level security;
alter table public.quizzes enable row level security;
alter table public.quiz_questions enable row level security;
alter table public.quiz_attempts enable row level security;
alter table public.quiz_answers enable row level security;
alter table public.import_jobs enable row level security;

notify pgrst, 'reload schema';
