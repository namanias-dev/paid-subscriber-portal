-- ============================================================
-- TEST DATA: Aug-2026 multi-batch course copied from "safalta".
-- Creates a NEW, clearly-marked course (id co-safalta-aug2026) that reuses all
-- of safalta's (co-safalta) content but offers FOUR single-valued batches —
-- Online·Morning (default), Online·Evening, Offline·Morning, Offline·Evening —
-- all starting 5 Aug 2026 (IST). Purely additive — it copies the source row via
-- jsonb_populate_record and overrides only id/slug/title/dates/flags/batches, so
-- the original safalta course and every other course/enrollment/payment are
-- untouched. Idempotent (guarded by NOT EXISTS). Safe to delete after review:
--   delete from public.courses where id = 'co-safalta-aug2026';
--
-- Batch start: 5 Aug 2026 00:00 IST == 2026-08-04T18:30:00.000Z (UTC).
-- One batch = one mode + one timing + one price (the unified model). Online
-- 45k/47k, Offline 55k/57k so the public selector visibly shows per-batch pricing.
-- ============================================================

insert into public.courses
select (jsonb_populate_record(
  null::public.courses,
  to_jsonb(c.*)
  || jsonb_build_object(
    'id', 'co-safalta-aug2026',
    'slug', 'safalta-online-foundation-aug-2026',
    'title', 'Safalta Online Foundation 2027/28/29 (Aug 2026)',
    'featured', false,
    'display_order', 999,
    'created_at', now(),
    'batch_start', '2026-08-04T18:30:00.000Z',
    'batch_timings', jsonb_build_array('Morning'),
    'default_batch_id', 'co-safalta-aug2026-b1',
    'after_registration', coalesce(c.after_registration, '{}'::jsonb)
      || jsonb_build_object('next_class_at', '2026-08-05T03:30:00.000Z'),
    'batches', jsonb_build_array(
      -- Single-valued batches (one mode + one timing each). Four real offerings.
      jsonb_build_object(
        'id', 'co-safalta-aug2026-b1', 'label', 'Online · Morning',
        'mode', 'Online', 'timing', 'Morning',
        'start_date', '2026-08-04T18:30:00.000Z', 'end_date', null,
        'price', 45000, 'original_price', 50000, 'pay_in_full_price', 40000,
        'emi_config', jsonb_build_object('enabled', true, 'seat_amount', 2000, 'best_value_note', 'Save More', 'interval_months', 2, 'installment_counts', jsonb_build_array(3)),
        'capacity', null, 'seats_left', null
      ),
      jsonb_build_object(
        'id', 'co-safalta-aug2026-b2', 'label', 'Online · Evening',
        'mode', 'Online', 'timing', 'Evening',
        'start_date', '2026-08-04T18:30:00.000Z', 'end_date', null,
        'price', 47000, 'original_price', 52000, 'pay_in_full_price', 42000,
        'emi_config', jsonb_build_object('enabled', true, 'seat_amount', 2000, 'best_value_note', 'Save More', 'interval_months', 2, 'installment_counts', jsonb_build_array(3)),
        'capacity', null, 'seats_left', null
      ),
      jsonb_build_object(
        'id', 'co-safalta-aug2026-b3', 'label', 'Offline · Morning',
        'mode', 'Offline', 'timing', 'Morning',
        'start_date', '2026-08-04T18:30:00.000Z', 'end_date', null,
        'price', 55000, 'original_price', 60000, 'pay_in_full_price', 50000,
        'emi_config', jsonb_build_object('enabled', true, 'seat_amount', 2000, 'best_value_note', 'Save More', 'interval_months', 2, 'installment_counts', jsonb_build_array(3)),
        'capacity', null, 'seats_left', null
      ),
      jsonb_build_object(
        'id', 'co-safalta-aug2026-b4', 'label', 'Offline · Evening',
        'mode', 'Offline', 'timing', 'Evening',
        'start_date', '2026-08-04T18:30:00.000Z', 'end_date', null,
        'price', 57000, 'original_price', 62000, 'pay_in_full_price', 52000,
        'emi_config', jsonb_build_object('enabled', true, 'seat_amount', 2000, 'best_value_note', 'Save More', 'interval_months', 2, 'installment_counts', jsonb_build_array(3)),
        'capacity', null, 'seats_left', null
      )
    )
  )
)).*
from public.courses c
where c.id = 'co-safalta'
  and not exists (select 1 from public.courses x where x.id = 'co-safalta-aug2026');
