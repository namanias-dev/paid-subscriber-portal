-- ============================================================================
-- SMS opt-out / DND suppression list (ADDITIVE — compliance-critical).
--
-- A normalized 10-digit mobile on this list is suppressed on EVERY send path —
-- manual, bulk, filtered, auto-SMS, cron and resend-to-failed — enforced in the
-- SMS service (sendSms / sendBatch) so nothing can bypass it, and also applied in
-- audience resolution so previews/counts reflect the suppression.
--
-- `source` records HOW the number opted out (inbound STOP keyword, manual admin
-- entry, complaint, bounce, …) — an inbound STOP webhook simply upserts a row
-- here with source='sms_stop'. If this table is absent the suppression check
-- degrades to a no-op (fail-open on infra error, never fail-closed on sends).
-- ============================================================================
create table if not exists public.sms_opt_outs (
  normalized_mobile text primary key,   -- 10-digit
  reason            text,
  source            text not null default 'manual',
  created_by        text,
  created_at        timestamptz not null default now()
);

create index if not exists sms_opt_outs_created_at_idx on public.sms_opt_outs (created_at desc);

alter table public.sms_opt_outs enable row level security;
-- No policies => only the service role (used by guarded admin APIs) can read/write.
