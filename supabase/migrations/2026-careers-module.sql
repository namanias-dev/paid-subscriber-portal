-- ============================================================================
--  CAREERS / JOB APPLICATIONS MODULE — fully ADDITIVE. Creates new tables only.
--  Nothing here alters or drops any existing table/column. Safe to run more than
--  once (IF NOT EXISTS + idempotent seeds). Access is always via the service-role
--  client (getSupabaseAdmin), which bypasses RLS; RLS is enabled with no public
--  policies so the anon/authenticated keys can never read applicant PII directly.
-- ============================================================================

-- ---------------------------------------------------------------------------
--  Open positions (jobs). Multiple can be OPEN at once.
-- ---------------------------------------------------------------------------
create table if not exists public.careers_positions (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  slug text not null,
  -- faculty | video_editor | other  (extensible free text; UI offers presets)
  role_type text not null default 'faculty',
  location_city text,
  location_state text,
  -- full_time | part_time | contract | freelance | internship
  job_type text not null default 'full_time',
  salary_min integer,
  salary_max integer,
  salary_currency text not null default 'INR',
  -- month | year  (how the salary range is expressed)
  salary_period text not null default 'month',
  subjects jsonb not null default '[]'::jsonb,       -- ["GS","Polity",...]
  summary text,                                       -- short card blurb
  description_html text,                              -- rich text (sanitized)
  requirements_html text,                             -- rich text (sanitized)
  -- draft | open | closed
  status text not null default 'draft',
  -- per-position kill switch (independent of the site-wide toggle)
  accepting_applications boolean not null default true,
  -- custom application form definition; [] means "use the global default template"
  form_fields jsonb not null default '[]'::jsonb,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists careers_positions_slug_uniq on public.careers_positions (slug);
create index if not exists careers_positions_status_idx on public.careers_positions (status);
create index if not exists careers_positions_role_idx on public.careers_positions (role_type);
alter table public.careers_positions enable row level security;

-- ---------------------------------------------------------------------------
--  Applications submitted by candidates.
-- ---------------------------------------------------------------------------
create table if not exists public.careers_applications (
  id uuid primary key default gen_random_uuid(),
  position_id uuid references public.careers_positions(id) on delete set null,
  position_title text,                                -- snapshot (survives position edits/deletes)
  position_slug text,
  full_name text not null,
  phone text not null,
  email text not null,
  city text,
  state text,
  subjects jsonb not null default '[]'::jsonb,
  upsc_attempts integer,
  interview_attempts integer,
  salary_expectation integer,
  upsc_roll_number text,
  -- all answers keyed by field id (includes the custom, non-core questions)
  answers jsonb not null default '{}'::jsonb,
  -- uploaded files: [{field,key,name,content_type,size,uploaded_at}]
  files jsonb not null default '[]'::jsonb,
  -- new | shortlisted | interviewing | rejected | hired
  status text not null default 'new',
  admin_notes text,
  status_history jsonb not null default '[]'::jsonb,  -- [{status,by,at,note}]
  source text,
  ip text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists careers_applications_position_idx on public.careers_applications (position_id);
create index if not exists careers_applications_status_idx on public.careers_applications (status);
create index if not exists careers_applications_created_idx on public.careers_applications (created_at desc);
create index if not exists careers_applications_phone_idx on public.careers_applications (phone);
alter table public.careers_applications enable row level security;

-- ---------------------------------------------------------------------------
--  Singleton global settings for the careers module.
-- ---------------------------------------------------------------------------
create table if not exists public.careers_settings (
  id text primary key default 'global',
  -- site-wide master switch for accepting applications
  accepting_applications boolean not null default true,
  -- admin-editable master subject list offered on positions & forms
  subjects jsonb not null default '[]'::jsonb,
  -- global default application-form template used when a position has none
  default_form_fields jsonb not null default '[]'::jsonb,
  -- where admin notification emails are sent (falls back to SUPPORT email)
  notify_email text,
  updated_at timestamptz not null default now()
);
alter table public.careers_settings enable row level security;

-- Seed the singleton settings row (subjects + default template are filled in by
-- the app layer on first read if left empty here).
insert into public.careers_settings (id, accepting_applications, subjects, default_form_fields)
values ('global', true, '[]'::jsonb, '[]'::jsonb)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
--  Seed: first OPEN position — UPSC Faculty.
--  NOTE(owner): salary_max is intentionally left blank (shows "From ₹60,000").
--  Set the exact upper bound in Admin → Careers → edit this position.
-- ---------------------------------------------------------------------------
insert into public.careers_positions (
  title, slug, role_type, location_city, location_state, job_type,
  salary_min, salary_max, salary_currency, salary_period, subjects, summary,
  description_html, requirements_html, status, accepting_applications, form_fields, display_order
) values (
  'UPSC Faculty', 'upsc-faculty', 'faculty', 'Chandigarh', 'Chandigarh', 'full_time',
  60000, null, 'INR', 'month',
  '["GS","Polity","History","Economy","Geography","Environment","Science and Technology","Ethics","CSAT","Current Affairs","Essay","International Relations"]'::jsonb,
  'Join one of Chandigarh''s top IAS academies as full-time UPSC Faculty and help make quality civil-services preparation affordable for every aspirant.',
  '<p>We are looking for passionate, confident and knowledgeable <strong>UPSC Faculty</strong> to join Naman Sharma IAS Academy in Chandigarh.</p>',
  '<ul><li>Strong command over one or more UPSC subjects.</li><li>Prior UPSC preparation and/or teaching experience preferred.</li></ul>',
  'open', true, '[]'::jsonb, 0
) on conflict (slug) do nothing;
