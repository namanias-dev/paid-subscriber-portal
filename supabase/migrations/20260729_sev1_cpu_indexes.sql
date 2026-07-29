-- SEV1 CPU cut: concurrent indexes for hot public/admin paths.
-- Applied live via CREATE INDEX CONCURRENTLY (not blocking). Kept here for repo history.

-- CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payments_webinar_item_status
--   ON public.payments (item_type, item_slug, status)
--   WHERE item_type = 'webinar';

-- CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_webinars_active_datetime
--   ON public.webinars (active, datetime);

-- CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_webinar_regs_webinar_id
--   ON public.webinar_registrations (webinar_id);

-- CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_course_enrollments_status_created
--   ON public.course_enrollments (status, created_at DESC);
