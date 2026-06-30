-- ============================================================
-- Courses → Batches (Phase 1): DATA LAYER ONLY. Zero behaviour change.
-- Introduces first-class, sellable course variants ("batches") while the
-- existing course-level price/date/mode fields REMAIN the canonical source.
-- Every existing course is backfilled with exactly ONE "default batch" that
-- mirrors its current values, so checkout output is byte-for-byte identical
-- until a batch is explicitly selected in a later phase.
-- Additive & idempotent: no existing column is changed or dropped.
-- ============================================================

-- ---- New, additive, nullable columns -------------------------------------
alter table public.courses add column if not exists batches jsonb default '[]'::jsonb;
alter table public.courses add column if not exists default_batch_id text;

-- ---- Backfill one default batch per course (idempotent) ------------------
-- Only touches rows that have not been backfilled yet (default_batch_id null),
-- so re-running is a no-op. The batch id is deterministic (<course id>-b1).
update public.courses c
set
  batches = jsonb_build_array(
    jsonb_build_object(
      'id', c.id || '-b1',
      'label', nullif(
        concat_ws(' · ',
          nullif((select string_agg(v, '/')   from jsonb_array_elements_text(coalesce(c.modes, '[]'::jsonb)) v), ''),
          nullif((select string_agg(v, ' · ') from jsonb_array_elements_text(coalesce(c.batch_timings, '[]'::jsonb)) v), '')
        ), ''),
      'mode', coalesce(c.modes, '[]'::jsonb),
      'timing', coalesce(c.batch_timings, '[]'::jsonb),
      'start_date', to_jsonb(c.batch_start),
      'end_date', to_jsonb(null::text),
      'price', to_jsonb(coalesce(c.price, 0)),
      'original_price', to_jsonb(c.original_price),
      'pay_in_full_price', to_jsonb(c.pay_in_full_price),
      'emi_config', coalesce(c.emi_config, '{}'::jsonb),
      'capacity', to_jsonb(c.capacity),
      'seats_left', to_jsonb(c.seats_left)
    )
  ),
  default_batch_id = c.id || '-b1'
where c.default_batch_id is null;

notify pgrst, 'reload schema';
