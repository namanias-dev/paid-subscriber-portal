-- ============================================================
-- Courses Phase 1: central document library, batch timings,
-- after-registration / Class Hub config, brochure references.
-- Idempotent & backward-compatible.
-- ============================================================

-- ---- Central Brochure / Resources Library (upload once, attach many) ----
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

create index if not exists idx_library_docs_created on public.library_docs (created_at desc);

-- Public read (download cards on public course/webinar pages reference these).
alter table public.library_docs enable row level security;
do $$ begin
  create policy "Public read library_docs" on public.library_docs for select using (true);
exception when duplicate_object then null; end $$;

-- ---- Course references + batch timing + after-registration ----
alter table public.courses add column if not exists brochure_ids jsonb default '[]'::jsonb;
alter table public.courses add column if not exists batch_timings jsonb default '[]'::jsonb;
alter table public.courses add column if not exists after_registration jsonb default '{}'::jsonb;

-- ---- Webinar brochure references ----
alter table public.webinars add column if not exists brochure_ids jsonb default '[]'::jsonb;

notify pgrst, 'reload schema';
