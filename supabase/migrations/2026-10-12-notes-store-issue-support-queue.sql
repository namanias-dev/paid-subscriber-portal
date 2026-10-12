-- Customer-service support fields for Notes order issues.
-- customer_note remains the staff personal reply (never overwritten by follow-ups or milestones).
-- milestone_note holds short verified courier updates.

alter table public.store_order_issues
  add column if not exists milestone_note text,
  add column if not exists last_customer_message_at timestamptz,
  add column if not exists last_staff_reply_at timestamptz,
  add column if not exists awaiting_staff_reply boolean not null default false;

create index if not exists store_order_issues_awaiting_idx
  on public.store_order_issues (awaiting_staff_reply, updated_at desc)
  where status in ('OPEN', 'IN_REVIEW', 'WAITING_ON_TEAM');
