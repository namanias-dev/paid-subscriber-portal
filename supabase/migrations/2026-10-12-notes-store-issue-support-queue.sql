-- Customer-service support fields for Notes order issues.
-- Additive only: safe with older app code (unused columns) and required by the CS queue.
-- customer_note remains the staff personal reply (never overwritten by follow-ups or milestones).
-- milestone_note holds short verified courier updates.
-- awaiting_staff_reply defaults false so existing rows stay valid before backfill.

alter table public.store_order_issues
  add column if not exists milestone_note text,
  add column if not exists last_customer_message_at timestamptz,
  add column if not exists last_staff_reply_at timestamptz,
  add column if not exists awaiting_staff_reply boolean not null default false;

create index if not exists store_order_issues_awaiting_idx
  on public.store_order_issues (awaiting_staff_reply, updated_at desc)
  where status in ('OPEN', 'IN_REVIEW', 'WAITING_ON_TEAM');
