-- ============================================================================
-- SMS campaign id (ADDITIVE — breaks nothing).
--
-- Backs Mission Control "live send visibility": a single bulk/segment send is a
-- campaign. Every sms_logs row created by that send is stamped with the same
-- campaign_id so the UI can (a) show per-recipient status (Queued -> Sent ->
-- Delivered / Failed) as DLR settles, and (b) resend-to-failed for just that set.
--
-- Nullable: auto-SMS and all historical rows keep campaign_id = NULL (no
-- backfill, no behavioral change). The column + index are all that's needed.
-- ============================================================================
alter table public.sms_logs add column if not exists campaign_id text;
create index if not exists sms_logs_campaign_id_idx on public.sms_logs (campaign_id);
