-- =====================================================================
-- Webinar portal experience: session type, post-registration materials,
-- and a course cross-sell block. Idempotent & backward-compatible — existing
-- webinars keep working (sensible defaults; empty = nothing shown).
--
-- Notes:
--  * Recording embed / Zoom link reuse existing columns (recording_link, link).
--  * "materials" are entitlement-gated deliverables shown only in the portal,
--    distinct from public "pdf_resources" on the marketing page.
--  * Uploaded PDFs reuse the existing public "media" storage bucket
--    (folder "materials/"). Access is enforced server-side in the portal.
--  * Persistent login reuses the existing JWT-cookie auth (buyers table) — no
--    separate sessions table is required.
-- Safe to run multiple times.
-- =====================================================================

alter table public.webinars add column if not exists session_type text default 'live';
alter table public.webinars add column if not exists materials jsonb not null default '[]'::jsonb;
alter table public.webinars add column if not exists cross_sell jsonb not null default '{}'::jsonb;

-- Refresh PostgREST schema cache so the new columns are recognised immediately.
notify pgrst, 'reload schema';
