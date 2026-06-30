-- ============================================================
-- Payments → batch_id (Phase 3 follow-up). Additive & idempotent.
-- Records which course batch an attempt was for, so the short-window
-- enrollment dedup can be batch-aware (switching batch + re-clicking within
-- 120s becomes a new, correctly-priced attempt instead of reusing the prior
-- batch's amount). Null for single-batch / no-batch payments — behaviour
-- unchanged for every existing/single-batch checkout.
-- ============================================================

alter table public.payments add column if not exists batch_id text;

-- Helps the dedup lookup (phone + item + status + window already narrow it;
-- this keeps the added batch filter cheap).
create index if not exists payments_batch_idx on public.payments (batch_id);

notify pgrst, 'reload schema';
