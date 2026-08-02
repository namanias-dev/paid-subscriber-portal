-- ============================================================
-- Per-batch Zoom links (extend courses.batches JSONB).
-- Copies each course's after_registration.zoom_link / zoom_note onto every
-- batch that does not already have a zoom_link, so enrolled students keep
-- access at deploy. Course-level fields remain as fallback for one release.
-- Reversible: SET batches = batches #- '{i,zoom_link}' etc. or restore from
-- after_registration; this migration never drops course-level Zoom fields.
-- ============================================================

-- Backfill batch Zoom from course-level after_registration (idempotent).
UPDATE public.courses c
SET batches = sub.new_batches
FROM (
  SELECT
    c2.id,
    coalesce(
      (
        SELECT jsonb_agg(
          CASE
            WHEN nullif(b->>'zoom_link', '') IS NULL
                 AND nullif(c2.after_registration->>'zoom_link', '') IS NOT NULL
            THEN b || jsonb_strip_nulls(jsonb_build_object(
              'zoom_link', c2.after_registration->'zoom_link',
              'zoom_note', c2.after_registration->'zoom_note'
            ))
            ELSE b
          END
        )
        FROM jsonb_array_elements(coalesce(c2.batches, '[]'::jsonb)) AS b
      ),
      '[]'::jsonb
    ) AS new_batches
  FROM public.courses c2
  WHERE nullif(c2.after_registration->>'zoom_link', '') IS NOT NULL
    AND jsonb_array_length(coalesce(c2.batches, '[]'::jsonb)) > 0
) sub
WHERE c.id = sub.id
  AND c.batches IS DISTINCT FROM sub.new_batches;

-- Backfill enrollment.batch_id from the latest payment that recorded one.
UPDATE public.course_enrollments e
SET
  batch_id = p.batch_id,
  batch_id_source = coalesce(e.batch_id_source, 'payment_backfill')
FROM (
  SELECT DISTINCT ON (enrollment_id)
    enrollment_id,
    batch_id
  FROM public.payments
  WHERE batch_id IS NOT NULL
    AND enrollment_id IS NOT NULL
  ORDER BY enrollment_id, created_at DESC NULLS LAST
) p
WHERE e.id = p.enrollment_id
  AND e.batch_id IS NULL;

-- Single-batch courses: assign default_batch_id where enrollment still lacks one.
UPDATE public.course_enrollments e
SET
  batch_id = c.default_batch_id,
  batch_id_source = coalesce(e.batch_id_source, 'default_batch_backfill')
FROM public.courses c
WHERE e.course_id = c.id
  AND e.batch_id IS NULL
  AND c.default_batch_id IS NOT NULL
  AND jsonb_array_length(coalesce(c.batches, '[]'::jsonb)) = 1;

notify pgrst, 'reload schema';
