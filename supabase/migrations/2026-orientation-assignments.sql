-- ============================================================
-- Reusable orientation / starter video assignments (many-to-many).
--
-- GOAL: a video is uploaded ONCE into the content library (content_items) and
-- can be assigned as an orientation/starter video to the "After Registration"
-- section of MANY courses AND webinars — no re-uploading per course.
--
-- ADDITIVE & SAFE:
--   * New join table only. content_items / courses / webinars are NOT altered.
--   * References the single library video (content_id) — never duplicates media.
--   * Unassigning from one course just deletes that join row; the library video
--     and every other course/webinar using it are untouched.
--   * ON DELETE CASCADE from content_items so deleting a library video cleans up
--     its links (the admin UI warns first when it's still assigned).
--   * Service-role-only: RLS enabled, NO policies → anon/auth clients get nothing;
--     the app's service-role client (getSupabaseAdmin) does all reads/writes,
--     exactly like payment_proofs / enrollment_merge_log.
--
-- Existing inline course orientation videos (courses.after_registration.videos)
-- are migrated into this model by scripts/backfill-orientation.mjs (dry-run first).
-- ============================================================

create table if not exists public.content_orientation_assignments (
  id uuid primary key default gen_random_uuid(),
  content_id uuid not null references public.content_items(id) on delete cascade,
  target_type text not null,                 -- 'course' | 'webinar'
  target_id text not null,                   -- courses.id / webinars.id
  role text not null default 'orientation',  -- 'orientation' | 'starter'
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  -- one assignment per video per target (role/sort_order are editable in place)
  unique (content_id, target_type, target_id)
);

create index if not exists coa_target_idx on public.content_orientation_assignments (target_type, target_id);
create index if not exists coa_content_idx on public.content_orientation_assignments (content_id);

alter table public.content_orientation_assignments enable row level security;

notify pgrst, 'reload schema';
