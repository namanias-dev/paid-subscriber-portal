-- =====================================================================
-- Webinar: per-webinar "show registration count on public page" toggle
-- (Problem 1). Additive & idempotent. NULL = show (current behaviour, the
-- count is threshold-gated and computed from REAL data on-read); FALSE =
-- hide the count entirely. Existing webinars are unaffected.
--
-- NOTE: the legacy public.webinars.registrations integer is a seeded/marketing
-- counter and is intentionally NOT used for the public display anymore — the
-- honest count is computed on-read (paid-distinct for paid webinars, real
-- registration rows for free ones). This migration does not touch it.
-- =====================================================================

alter table public.webinars add column if not exists show_registration_count boolean;

-- Refresh PostgREST schema cache so the new column is recognised.
notify pgrst, 'reload schema';
