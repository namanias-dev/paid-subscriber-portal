-- =====================================================================
-- `auth_attempts` 24-hour TTL.
--
-- WHY THIS EXISTS
-- ---------------
-- `public.auth_attempts` is the durable counter behind `rateLimited()`
-- (lib/dataProvider.ts). Every login, forgot-code, careers upload/apply,
-- public lead capture, PDF download and /api/track hit inserts one row and
-- nothing ever removed them. On 2026-07-24 the table held 217,799 rows /
-- 45 MB on a database of 1,177 MB — roughly 4% of the volume spent on
-- throttle counters, 98.5% of which no caller could still read.
--
-- WHY 24 HOURS IS SAFE
-- --------------------
-- `rateLimited(key, max, windowSec)` counts rows with
-- `created_at >= now() - windowSec`. A row older than the widest window in
-- use is unreachable by every caller. Windows in the codebase, measured
-- 2026-07-24:
--
--   app/api/track/route.ts:27                        track-ip           60 s
--   app/api/public/downloads/lead/route.ts:56        dl-lead           600 s
--   app/api/public/current-affairs/pdf-download:39   ca-pdf            600 s
--   app/api/public/current-affairs/lead/route.ts:14  ca-lead           600 s
--   app/api/public/careers/upload/route.ts:21        careers-upload    600 s
--   app/api/public/careers/apply/route.ts:25         careers-apply   3,600 s  <-- widest
--   app/api/portal/login/route.ts:29                 login / login-ip  600 s
--   app/api/portal/forgot/route.ts:34                forgot / forgot-ip 600 s
--   app/api/auth/login/route.ts:46                   login / login-ip  600 s
--
-- Widest = 3,600 s. The 86,400 s TTL is a 24x margin over it, so pruning
-- cannot shorten anybody's throttle. The floor below refuses any retention
-- under 2 hours so a future caller with a wider window cannot be silently
-- undermined by a stray argument.
--
-- WHY NOT TRUNCATE
-- ----------------
-- TRUNCATE would drop the in-window rows too, resetting every counter to
-- zero and instantly unlocking every currently-throttled phone and IP —
-- i.e. handing a free retry burst to whoever is mid-attack. Aged DELETE
-- only.
--
-- MECHANISM
-- ---------
-- Vercel cron -> `GET /api/cron/auth-attempts-ttl` -> this function via
-- RPC, matching the nine existing routes in app/api/cron/ and the
-- `db_size_bytes` SECURITY DEFINER + service_role-only RPC convention.
-- pg_cron is available on this project but NOT installed; enabling it would
-- add a second, invisible scheduler alongside the one the repo already
-- operates and monitors.
--
-- The delete is chunked and set-based. A prior phase in this program spent
-- 8.9 hours on a row-by-row loop that took 3-6 minutes once rewritten as
-- chunked set operations; the same shape is used here so the job stays
-- bounded even if the cron is down for a week.
--
-- Idempotent: running it twice in a row simply deletes nothing the second
-- time.
--
-- ROLLBACK: drop function if exists public.prune_auth_attempts(integer,integer,integer);
-- =====================================================================

CREATE OR REPLACE FUNCTION public.prune_auth_attempts(
  p_retain_hours integer DEFAULT 24,
  p_chunk_size   integer DEFAULT 20000,
  p_max_chunks   integer DEFAULT 50
)
RETURNS bigint
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  -- Hard floor of 2 h: comfortably above the widest live window (3,600 s).
  v_retain  interval := make_interval(hours => greatest(coalesce(p_retain_hours, 24), 2));
  v_chunk   integer  := least(greatest(coalesce(p_chunk_size, 20000), 1000), 50000);
  v_cap     integer  := least(greatest(coalesce(p_max_chunks, 50), 1), 500);
  v_deleted bigint   := 0;
  v_n       bigint;
BEGIN
  FOR i IN 1..v_cap LOOP
    WITH doomed AS (
      SELECT id
        FROM public.auth_attempts
       -- A NULL created_at can never satisfy the `>= since` filter in
       -- rateLimited(), so such a row is unreadable by design, not recent.
       WHERE created_at IS NULL
          OR created_at < now() - v_retain
       LIMIT v_chunk
    )
    DELETE FROM public.auth_attempts a
     USING doomed d
     WHERE a.id = d.id;

    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_deleted := v_deleted + v_n;
    EXIT WHEN v_n < v_chunk;
  END LOOP;

  RETURN v_deleted;
END;
$fn$;

COMMENT ON FUNCTION public.prune_auth_attempts(integer,integer,integer) IS
  'Chunked aged DELETE of public.auth_attempts. Retention floor 2 h (widest rateLimited() window is 3,600 s). Idempotent.';

-- Only the server reaches this. Nothing anonymous should be able to clear
-- throttle counters — that is the attack the rate limiter exists to stop.
REVOKE ALL ON FUNCTION public.prune_auth_attempts(integer,integer,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prune_auth_attempts(integer,integer,integer) TO service_role;
