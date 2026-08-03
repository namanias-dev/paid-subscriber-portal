-- Additive only: label queue source for Mission Control (manual vs quiet-hours vs recovery).
-- Does NOT alter existing rows' scheduled_for / status.

ALTER TABLE public.sms_promo_queue
  ADD COLUMN IF NOT EXISTS queue_source text;

COMMENT ON COLUMN public.sms_promo_queue.queue_source IS
  'manual | quiet_hours | recovery. Null on legacy rows — UI treats SYSTEM as Automation.';

ALTER TABLE public.sms_promo_queue
  DROP CONSTRAINT IF EXISTS sms_promo_queue_source_check;
ALTER TABLE public.sms_promo_queue
  ADD CONSTRAINT sms_promo_queue_source_check
  CHECK (queue_source IS NULL OR queue_source IN ('manual', 'quiet_hours', 'recovery'));

-- Backfill recovery rows only (source_failed_log_id set); leave others null.
UPDATE public.sms_promo_queue
SET queue_source = 'recovery'
WHERE source_failed_log_id IS NOT NULL AND queue_source IS NULL;

UPDATE public.sms_promo_queue
SET queue_source = 'quiet_hours'
WHERE source_failed_log_id IS NULL
  AND sent_by_type = 'SYSTEM'
  AND queue_source IS NULL
  AND status IN ('pending', 'claimed', 'sent', 'cancelled', 'skipped', 'failed');
