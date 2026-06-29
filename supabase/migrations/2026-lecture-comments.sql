-- ============================================================
-- Per-lecture comments / Q&A for the student Class Hub.
--
-- Enrolled students post comments/questions on a specific lecture (a hosted
-- content_items recording); staff/teachers/admins reply with an official badge.
-- Visibility is PUBLIC within the enrolled cohort — read/write access is enforced
-- in the API using the SAME resolveLectureAccess() gate as the player, so a
-- non-enrolled user can neither read nor post.
--
-- ADDITIVE & SAFE:
--   * New table only. Nothing else is altered.
--   * Soft-delete only (deleted_at) — history is never hard-deleted.
--   * One level of replies (parent_comment_id -> a top-level comment).
--   * Service-role-only: RLS enabled, NO policies → anon/auth clients get nothing;
--     all reads/writes go through the guarded /api routes (getSupabaseAdmin).
-- ============================================================

create table if not exists public.lecture_comments (
  id uuid primary key default gen_random_uuid(),
  recording_id uuid not null references public.content_items(id) on delete cascade,
  course_id text,                                    -- first course id of the recording (for the moderation queue filter)
  author_kind text not null,                         -- 'student' | 'staff'
  author_id text not null,                           -- students.id / 'phone:<p>' / staff actor id
  author_name text not null,
  author_phone text,                                 -- student phone (reply notify); null for staff
  author_role text,                                  -- staff role label (admin/super/faculty); null for students
  body text not null,
  parent_comment_id uuid references public.lecture_comments(id) on delete cascade,
  is_pinned boolean not null default false,
  is_hidden boolean not null default false,          -- moderated out of the student view
  is_answered boolean not null default false,        -- on a top-level comment: thread resolved
  notified_at timestamptz,                           -- idempotency for reply notifications
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz
);

create index if not exists lc_recording_idx on public.lecture_comments (recording_id);
create index if not exists lc_parent_idx on public.lecture_comments (parent_comment_id);
-- Drives the "unanswered student questions" moderation queue.
create index if not exists lc_queue_idx on public.lecture_comments (author_kind, is_answered, is_hidden, created_at);

alter table public.lecture_comments enable row level security;

notify pgrst, 'reload schema';
