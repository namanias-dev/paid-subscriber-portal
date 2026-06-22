-- =====================================================================
-- Current Affairs module: articles, categories, tags, PDF library, leads,
-- bookmarks and lightweight analytics events.
-- Idempotent & backward-compatible — safe to run multiple times.
-- Writes go through the service role (server APIs). Anon may only read
-- published, public-safe rows (RLS safety net).
-- =====================================================================

-- ----------------------------- categories ----------------------------
create table if not exists public.ca_categories (
  id text primary key,
  slug text unique not null,
  name text not null,
  description text,
  seo jsonb not null default '{}'::jsonb,
  "order" int not null default 0,
  created_at timestamptz default now()
);

-- ------------------------------- tags --------------------------------
create table if not exists public.ca_tags (
  id text primary key,
  slug text unique not null,
  name text not null,
  seo jsonb not null default '{}'::jsonb,
  created_at timestamptz default now()
);

-- ------------------------------ articles -----------------------------
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

-- ----------------------------- PDF library ---------------------------
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

-- ------------------------------- leads -------------------------------
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

-- ----------------------------- bookmarks -----------------------------
create table if not exists public.ca_bookmarks (
  id text primary key,
  user_phone text not null,
  article_slug text not null,
  created_at timestamptz default now(),
  unique (user_phone, article_slug)
);

-- ------------------------- analytics events --------------------------
create table if not exists public.ca_events (
  id text primary key,
  type text not null,
  ref text,
  created_at timestamptz default now()
);
create index if not exists ca_events_type_idx on public.ca_events (type);

-- ============================== RLS ==================================
alter table public.ca_categories enable row level security;
alter table public.ca_tags enable row level security;
alter table public.ca_articles enable row level security;
alter table public.ca_pdfs enable row level security;
alter table public.ca_leads enable row level security;
alter table public.ca_bookmarks enable row level security;
alter table public.ca_events enable row level security;

-- Anon may read categories & tags (public taxonomy pages).
drop policy if exists "anon read ca_categories" on public.ca_categories;
create policy "anon read ca_categories" on public.ca_categories for select using (true);

drop policy if exists "anon read ca_tags" on public.ca_tags;
create policy "anon read ca_tags" on public.ca_tags for select using (true);

-- Anon may read ONLY published articles (drafts/scheduled/archived/disabled hidden).
drop policy if exists "anon read published ca_articles" on public.ca_articles;
create policy "anon read published ca_articles"
  on public.ca_articles for select
  using (status = 'published' and (publish_at is null or publish_at <= now()));

-- Anon may read PDF metadata (file access/gating enforced in app code).
drop policy if exists "anon read ca_pdfs" on public.ca_pdfs;
create policy "anon read ca_pdfs" on public.ca_pdfs for select using (true);

-- Anon may submit leads (public forms). No anon read of leads.
drop policy if exists "anon insert ca_leads" on public.ca_leads;
create policy "anon insert ca_leads" on public.ca_leads for insert with check (true);

-- bookmarks & events: fully locked to service role (no anon policies).

-- ============================= SEED ==================================
-- A starter category, tag, sample article and a monthly PDF record.
insert into public.ca_categories (id, slug, name, description, "order")
values ('cacat-polity', 'polity-governance', 'Polity & Governance', 'Constitution, governance, polity and institutions for UPSC.', 0)
on conflict (slug) do nothing;

insert into public.ca_tags (id, slug, name)
values ('catag-parliament', 'parliament', 'Parliament')
on conflict (slug) do nothing;

insert into public.ca_articles (
  id, slug, title, summary, article_type, status, publish_at, ca_date, author, reading_time,
  body_html, category_slug, tags, quick_revision, upsc, important, trending, show_on_home,
  seo
) values (
  'caart-sample-1',
  'sample-current-affairs-article',
  'Sample Current Affairs: Parliamentary Privileges Explained',
  'A concise UPSC-focused breakdown of parliamentary privileges — why in news, key facts and exam angle.',
  'daily', 'published', now(), current_date, 'Naman Sir', 4,
  '<h2>Why in the News</h2><p>This is sample seed content for the Current Affairs module. Replace it from the admin panel.</p><h2>Key Facts</h2><ul><li>Parliamentary privileges are defined under Article 105.</li><li>They protect free speech within the House.</li></ul>',
  'polity-governance', array['parliament'],
  '{"bullets":["Defined under Article 105","Protect free speech in the House","No codified law yet"],"why_in_news":"Recent debate on privilege motions.","upsc_relevance":"GS Paper 2 - Polity","exam_angle":"Prelims + Mains GS2"}'::jsonb,
  '{"gs_papers":["GS2","Prelims"],"exam_relevance":"both","difficulty":"medium","topic":"Parliament"}'::jsonb,
  true, true, true,
  '{"structured_data_enabled":true}'::jsonb
)
on conflict (slug) do nothing;

insert into public.ca_pdfs (id, title, kind, date_ref, category_slug, description, is_free)
values ('capdf-sample-monthly', 'Monthly Current Affairs Compilation (Sample)', 'monthly', to_char(current_date, 'YYYY-MM'), null, 'Sample monthly compilation record. Upload the real PDF from admin.', true)
on conflict (id) do nothing;

-- Refresh PostgREST schema cache.
notify pgrst, 'reload schema';
