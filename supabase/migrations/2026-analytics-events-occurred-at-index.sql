-- ============================================================================
-- Perf: analytics_events time-range index (additive, idempotent)
--
-- Every admin analytics/overview page pulls events for a date window via
--   WHERE occurred_at BETWEEN ? AND ? AND is_bot = false ORDER BY occurred_at DESC
-- With ~74k rows and no occurred_at index this planned a Parallel Seq Scan +
-- an external merge sort spilling ~37 MB to disk (~5 s per fetch — the dominant
-- cost of the Overview/Analytics pages, EXPLAIN-verified).
--
-- A partial index ordered by occurred_at DESC (matching the is_bot=false filter)
-- lets Postgres serve the range + ORDER BY straight from the index — no seq scan,
-- no disk sort. Read-only optimization; changes no data or query results.
-- ============================================================================

create index if not exists idx_ae_occurred_at_active
  on public.analytics_events (occurred_at desc)
  where is_bot = false;
