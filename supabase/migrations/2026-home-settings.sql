-- =====================================================================
-- Home Page upgrade: site_settings table + leads.email column
-- Idempotent & backward-compatible. Safe to run multiple times.
-- =====================================================================

-- 1) Single-row site/home settings record (id is always 'home').
create table if not exists public.site_settings (
  id text primary key default 'home',
  logo_url text,
  logo_alt text,
  hero jsonb not null default '{}'::jsonb,
  popup jsonb not null default '{}'::jsonb,
  content jsonb not null default '{}'::jsonb,
  updated_at timestamptz default now()
);

-- Seed the default row so the admin form always has something to load.
insert into public.site_settings (id) values ('home')
on conflict (id) do nothing;

-- 2) Optional email captured by the lead popup / forms.
alter table public.leads add column if not exists email text;

-- 3) Row Level Security: keep it locked down. All reads/writes go through the
--    service-role key (server-side getSupabaseAdmin), which bypasses RLS.
alter table public.site_settings enable row level security;
