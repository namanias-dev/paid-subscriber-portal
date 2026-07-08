-- ============================================================================
-- UPSC RESOURCES — SEO content hub (additive, non-destructive)
-- A "Resource" is an evergreen SEO article/guide, separate from Current Affairs
-- but linkable to it. Supports a chronological "Day 1 → Exam" journey.
-- Safe to re-run: everything is IF NOT EXISTS / idempotent.
-- ============================================================================

create table if not exists public.resources (
  id             text primary key,
  slug           text unique not null,
  title          text not null,
  summary        text not null default '',
  body_html      text,
  sections       jsonb not null default '[]',
  category       text,
  subject        text,
  exam_relevance text,
  target_year    text,
  difficulty     text,
  status         text not null default 'draft',
  publish_at     timestamptz,
  author         text,
  reading_time   int,
  featured_image text,
  tags           text[] not null default '{}',
  pdf_ids        text[] not null default '{}',
  faq            jsonb not null default '[]',
  cta_blocks     jsonb not null default '[]',
  related        jsonb not null default '{}',
  focus_keyword  text,
  seo            jsonb not null default '{}',
  journey_stage  text,
  order_index    int not null default 0,
  is_local       boolean not null default false,
  views          int not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists idx_resources_status       on public.resources (status);
create index if not exists idx_resources_publish_at    on public.resources (publish_at desc);
create index if not exists idx_resources_category      on public.resources (category);
create index if not exists idx_resources_order_index   on public.resources (order_index);
create index if not exists idx_resources_tags          on public.resources using gin (tags);

comment on table public.resources is 'UPSC Resources: evergreen SEO content hub (guides, strategy, booklists, local pages) with a chronological journey.';
comment on column public.resources.category is 'Cluster slug: beginner | strategy | books | syllabus | optional | prelims | mains | notes | local.';
comment on column public.resources.journey_stage is 'Chronological roadmap stage label; empty = not part of the Day-1→Exam journey.';
comment on column public.resources.order_index is 'Ordering within the overall roadmap (ascending).';
comment on column public.resources.is_local is 'Local-SEO page → enables LocalBusiness schema + local CTAs.';

-- ---------------------------------------------------------------------------
-- RLS: anon may read only PUBLISHED, live resources. All writes go through the
-- server (service role), matching the Current Affairs model.
-- ---------------------------------------------------------------------------
alter table public.resources enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'resources' and policyname = 'resources_anon_read_published') then
    create policy resources_anon_read_published on public.resources
      for select to anon
      using (status = 'published' and (publish_at is null or publish_at <= now()));
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Lightweight engagement events (self-contained; does NOT touch the Meta/UTM
-- attribution pipeline). Mirrors ca_events. Writes go through the server.
-- ---------------------------------------------------------------------------
create table if not exists public.resource_events (
  id         text primary key,
  type       text not null,   -- cta_click | quiz_click | pdf_download | share
  ref        text,            -- e.g. resource slug or target href
  created_at timestamptz not null default now()
);
create index if not exists idx_resource_events_type on public.resource_events (type);
create index if not exists idx_resource_events_ref  on public.resource_events (ref);

alter table public.resource_events enable row level security;
-- No anon policies: only the service role (server APIs) may read/write.
