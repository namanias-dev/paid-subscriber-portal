-- Additive only: SMS-only short titles. Website title/slug/URL unchanged.
ALTER TABLE public.webinars
  ADD COLUMN IF NOT EXISTS sms_short_title text NULL;

ALTER TABLE public.courses
  ADD COLUMN IF NOT EXISTS sms_short_title text NULL;

COMMENT ON COLUMN public.webinars.sms_short_title IS
  'Optional SMS-only title for DLT {#var#} slots. Public title/slug/URL are untouched.';
COMMENT ON COLUMN public.courses.sms_short_title IS
  'Optional SMS-only title for DLT {#var#} slots. Public title/slug/URL are untouched.';
