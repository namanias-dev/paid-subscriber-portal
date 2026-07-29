-- Read-only RPC for Payments "Legacy campaign → conversion" card.
-- Matching uses the same phone_key + is_legacy pipeline as LegacyLeadPill.

CREATE OR REPLACE FUNCTION public.legacy_campaign_conversion_funnel()
RETURNS TABLE (
  campaign text,
  matched bigint,
  webinar_reg bigint,
  seat_cum bigint,
  paid_cum bigint,
  excl_no_seat bigint,
  excl_seat_only bigint,
  excl_paid bigint
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $$
WITH matched AS (
  SELECT s.phone_key,
    COALESCE(NULLIF(btrim(leg.camp), ''), '') AS camp
  FROM students s
  INNER JOIN LATERAL (
    SELECT COALESCE(
      NULLIF(btrim(l.campaign_clean), ''),
      NULLIF(btrim(l.campaign), ''),
      NULLIF(btrim(l.legacy_source_tab), ''),
      ''
    ) AS camp
    FROM leads l
    WHERE l.is_legacy
      AND l.merged_into IS NULL
      AND l.phone_key = s.phone_key
      AND length(l.phone_key) = 10
    ORDER BY COALESCE(l.first_seen_at, l.created_at) DESC NULLS LAST
    LIMIT 1
  ) leg ON true
  WHERE length(s.phone_key) = 10
    AND s.phone_key ~ '^[6-9]'
),
reg AS (
  SELECT phone_key FROM webinar_registrations WHERE length(phone_key) = 10
  UNION
  SELECT phone_key FROM payments
  WHERE deleted_at IS NULL
    AND item_type = 'webinar'
    AND status IN ('PAID', 'captured')
    AND length(phone_key) = 10
),
seat AS (
  SELECT DISTINCT phone_key
  FROM course_enrollments ce
  WHERE length(phone_key) = 10
    AND (
      status IN ('seat_booked', 'partially_paid', 'fully_paid')
      OR EXISTS (
        SELECT 1
        FROM jsonb_array_elements(COALESCE(ce.schedule, '[]'::jsonb)) e
        WHERE (e->>'paid')::boolean IS TRUE
          AND e->>'kind' IN ('seat', 'installment', 'full')
      )
    )
),
inst AS (
  SELECT DISTINCT phone_key
  FROM course_enrollments ce
  WHERE length(phone_key) = 10
    AND EXISTS (
      SELECT 1
      FROM jsonb_array_elements(COALESCE(ce.schedule, '[]'::jsonb)) e
      WHERE e->>'kind' = 'installment'
        AND (e->>'paid')::boolean IS TRUE
    )
)
SELECT
  COALESCE(NULLIF(m.camp, ''), '') AS campaign,
  COUNT(*)::bigint AS matched,
  COUNT(*) FILTER (WHERE r.phone_key IS NOT NULL)::bigint AS webinar_reg,
  COUNT(*) FILTER (WHERE se.phone_key IS NOT NULL)::bigint AS seat_cum,
  COUNT(*) FILTER (WHERE i.phone_key IS NOT NULL)::bigint AS paid_cum,
  COUNT(*) FILTER (WHERE se.phone_key IS NULL)::bigint AS excl_no_seat,
  COUNT(*) FILTER (WHERE se.phone_key IS NOT NULL AND i.phone_key IS NULL)::bigint AS excl_seat_only,
  COUNT(*) FILTER (WHERE i.phone_key IS NOT NULL)::bigint AS excl_paid
FROM matched m
LEFT JOIN reg r USING (phone_key)
LEFT JOIN seat se USING (phone_key)
LEFT JOIN inst i USING (phone_key)
GROUP BY 1
ORDER BY paid_cum DESC, matched DESC;
$$;

COMMENT ON FUNCTION public.legacy_campaign_conversion_funnel() IS
  'Read-only per-legacy-campaign conversion funnel for matched students.';

GRANT EXECUTE ON FUNCTION public.legacy_campaign_conversion_funnel() TO service_role;
