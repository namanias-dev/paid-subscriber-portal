-- Additive phone_key for legacy-lead matching (read-time joins).
-- Does NOT modify original phone / source / status columns.
-- Indexes: applied live with CREATE INDEX CONCURRENTLY (see apply notes below).

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS phone_key text
  GENERATED ALWAYS AS (right(regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g'), 10)) STORED;

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS phone_key text
  GENERATED ALWAYS AS (right(regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g'), 10)) STORED;

ALTER TABLE public.students
  ADD COLUMN IF NOT EXISTS phone_key text
  GENERATED ALWAYS AS (right(regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g'), 10)) STORED;

ALTER TABLE public.course_enrollments
  ADD COLUMN IF NOT EXISTS phone_key text
  GENERATED ALWAYS AS (right(regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g'), 10)) STORED;

ALTER TABLE public.webinar_registrations
  ADD COLUMN IF NOT EXISTS phone_key text
  GENERATED ALWAYS AS (right(regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g'), 10)) STORED;

-- CONCURRENTLY cannot run inside a migration transaction. Apply separately:
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_leads_legacy_phone_key
--   ON public.leads (phone_key)
--   WHERE is_legacy AND merged_into IS NULL AND length(phone_key) = 10;
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payments_phone_key
--   ON public.payments (phone_key) WHERE length(phone_key) = 10;
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_students_phone_key
--   ON public.students (phone_key) WHERE length(phone_key) = 10;
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_course_enrollments_phone_key
--   ON public.course_enrollments (phone_key) WHERE length(phone_key) = 10;
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_webinar_registrations_phone_key
--   ON public.webinar_registrations (phone_key) WHERE length(phone_key) = 10;
