-- ============================================================
-- Add an optional `faculty` field to content items (recordings/lectures).
--
-- ADDITIVE & SAFE: a single nullable column. Subject, topic (paper), lecture
-- date (date), session number (class_no), duration (duration/duration_seconds)
-- and thumbnail (thumbnail_key) already exist and are reused — no rename or
-- restructure. Existing rows are untouched (faculty = NULL).
-- ============================================================

alter table public.content_items add column if not exists faculty text;

notify pgrst, 'reload schema';
