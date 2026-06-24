-- Content / LMS Manager: assign each content item to one OR many courses/batches,
-- add an optional class/session number for ordering, and a Telegram link
-- (external links only — nothing is ever hosted on the portal).
--
-- Backward compatible: existing items keep their single `course_id`; we backfill
-- `course_ids` from it so un-assigned legacy items stay valid and assigned ones
-- surface in their batch's Class Hub immediately.
alter table public.content_items
  add column if not exists course_ids jsonb not null default '[]'::jsonb,
  add column if not exists class_no integer,
  add column if not exists telegram_link text;

update public.content_items
  set course_ids = jsonb_build_array(course_id)
  where course_id is not null
    and (course_ids is null or jsonb_array_length(course_ids) = 0);

-- Per-student, per-Class-Hub-section "last seen" timestamps that power the
-- tasteful "NEW" badge. Lightweight: one row per (student, course, section),
-- upserted when the student opens that section. student_id is the canonical
-- students.id (every paying learner has one).
create table if not exists public.class_hub_views (
  id uuid primary key default gen_random_uuid(),
  student_id text not null,
  course_id text not null,
  section text not null,
  last_seen_at timestamptz not null default now(),
  unique (student_id, course_id, section)
);
create index if not exists class_hub_views_student_idx on public.class_hub_views (student_id);
