-- ============================================================================
--  HOSTED LECTURE RECORDINGS — direct-to-R2 hosted video as a NEW SOURCE TYPE
--  on the EXISTING recordings (content_items). Additive only: every existing
--  recording keeps source_type='link' and behaves exactly as before.
--
--  No video processing, no worker, no raw storage, no queues. We persist only
--  metadata, the final R2 object key, and resumable multipart-upload state.
-- ============================================================================
alter table public.content_items
  add column if not exists source_type text not null default 'link',        -- 'link' | 'hosted'
  add column if not exists visibility text not null default 'enrolled',      -- 'enrolled' | 'public'
  add column if not exists upload_status text not null default 'idle',       -- idle|uploading|paused|completed|failed
  add column if not exists processed_key text,
  add column if not exists thumbnail_key text,
  add column if not exists notes_pdf_key text,
  add column if not exists duration_seconds integer,
  add column if not exists file_size bigint,
  add column if not exists resolution text,
  add column if not exists public_cdn boolean not null default false,        -- optional per-lecture CDN opt-in
  add column if not exists multipart_upload_id text,
  add column if not exists multipart_key text,
  add column if not exists multipart_parts jsonb not null default '[]'::jsonb,
  add column if not exists multipart_total_parts integer,
  add column if not exists multipart_chunk_size integer;

-- Resume-watching + completion tracking, keyed by the canonical students.id.
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

-- Admin manual access override per learner (phone) per course — ALWAYS wins over
-- the installment/full-payment computation. mode='grant' (optional expiry, null =
-- lifetime) or mode='revoke'.
create table if not exists public.course_access_overrides (
  id uuid primary key default gen_random_uuid(),
  phone text not null,
  course_id text not null,
  mode text not null,
  expires_at timestamptz,
  note text,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (phone, course_id)
);
create index if not exists cao_phone_idx on public.course_access_overrides (phone);
