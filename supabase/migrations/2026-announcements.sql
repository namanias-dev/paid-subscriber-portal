-- ============================================================================
-- ANNOUNCEMENTS — optional admin-pinned items for the "What's New" system.
-- Auto "What's New" is computed on-read from live content (resources, PDFs,
-- open webinars, open batches); this table only stores MANUAL overrides an
-- admin pins alongside them. Additive, non-destructive, safe to re-run.
-- ============================================================================

create table if not exists public.announcements (
  id          text primary key,
  title       text not null,
  href        text,
  badge       text,               -- short label e.g. "New", "Result"
  active       boolean not null default true,
  pinned       boolean not null default true,  -- show in the top rotating bar
  starts_at    timestamptz,       -- null = live immediately
  ends_at      timestamptz,       -- null = never expires
  sort_order   int not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists idx_announcements_active on public.announcements (active, sort_order);
create index if not exists idx_announcements_window on public.announcements (starts_at, ends_at);

comment on table public.announcements is 'Admin-pinned manual announcements shown alongside the auto-computed "What''s New" items. Writes via service role only.';

-- ---------------------------------------------------------------------------
-- RLS: anon may read only ACTIVE announcements inside their date window.
-- All writes go through the server (service role), matching the Resources model.
-- ---------------------------------------------------------------------------
alter table public.announcements enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'announcements' and policyname = 'announcements_anon_read_active'
  ) then
    create policy announcements_anon_read_active on public.announcements
      for select to anon
      using (
        active = true
        and (starts_at is null or starts_at <= now())
        and (ends_at is null or ends_at >= now())
      );
  end if;
end $$;

-- Refresh PostgREST schema cache so the new table is recognised.
notify pgrst, 'reload schema';
