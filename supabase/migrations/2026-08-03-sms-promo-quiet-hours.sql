-- Additive: promo category + deferred promo queue (quiet-hours).
-- No drops, no NOT NULL on existing columns.

ALTER TABLE public.sms_templates
  ADD COLUMN IF NOT EXISTS category text;

COMMENT ON COLUMN public.sms_templates.category IS
  'promo | transactional. Null treated as promo (fail-safe quiet hours).';

-- Backfill from existing message_type.
UPDATE public.sms_templates
SET category = CASE
  WHEN message_type = 'promotional' THEN 'promo'
  WHEN message_type = 'service' THEN 'transactional'
  ELSE 'promo'
END
WHERE category IS NULL;

ALTER TABLE public.sms_templates
  DROP CONSTRAINT IF EXISTS sms_templates_category_check;
ALTER TABLE public.sms_templates
  ADD CONSTRAINT sms_templates_category_check
  CHECK (category IS NULL OR category IN ('promo', 'transactional'));

CREATE TABLE IF NOT EXISTS public.sms_promo_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id text NOT NULL,
  mobile text NOT NULL,
  normalized_mobile text NOT NULL,
  variables jsonb NOT NULL DEFAULT '{}'::jsonb,
  related_entity jsonb,
  trigger_event text,
  audience_type text,
  dedupe_key text,
  scheduled_for timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','claimed','sent','cancelled','skipped','failed')),
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 3,
  last_error text,
  cancel_reason text,
  skip_reason text,
  sent_by_type text NOT NULL DEFAULT 'SYSTEM',
  sent_by_user_id text,
  source_failed_log_id uuid,
  sent_log_id uuid,
  claimed_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS sms_promo_queue_dedupe_uq
  ON public.sms_promo_queue (dedupe_key)
  WHERE dedupe_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS sms_promo_queue_due_idx
  ON public.sms_promo_queue (scheduled_for)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS sms_promo_queue_status_idx
  ON public.sms_promo_queue (status, created_at DESC);

-- Atomic claim for drain (same pattern as sms_scheduled_claim).
CREATE OR REPLACE FUNCTION public.sms_promo_queue_claim(p_limit integer DEFAULT 20)
RETURNS SETOF public.sms_promo_queue
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  WITH due AS (
    SELECT id
    FROM public.sms_promo_queue
    WHERE status = 'pending'
      AND scheduled_for <= now()
    ORDER BY scheduled_for ASC
    LIMIT GREATEST(1, LEAST(coalesce(p_limit, 20), 100))
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.sms_promo_queue q
  SET status = 'claimed',
      claimed_at = now(),
      attempts = q.attempts + 1,
      updated_at = now()
  FROM due
  WHERE q.id = due.id
  RETURNING q.*;
END;
$$;
