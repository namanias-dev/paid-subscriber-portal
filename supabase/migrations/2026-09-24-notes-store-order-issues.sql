-- Customer-raised notes-order issues. Separate from the delivered-only
-- RETURN_REQUESTED support flow: creating an issue never changes order status,
-- payment, or shipment.

create table if not exists public.store_order_issues (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique,
  order_id uuid not null references public.store_orders (id) on delete cascade,
  order_no text not null,
  category text not null check (category in (
    'ADDRESS_ISSUE',
    'DELIVERY_DELAY',
    'PICKUP_ISSUE',
    'TRACKING_ISSUE',
    'STATUS_MISMATCH',
    'DAMAGE_ISSUE',
    'UPDATE_REQUEST',
    'OTHER'
  )),
  description text not null,
  status text not null default 'OPEN' check (status in (
    'OPEN',
    'IN_REVIEW',
    'WAITING_ON_TEAM',
    'RESOLVED',
    'CLOSED'
  )),
  priority text not null default 'normal' check (priority in ('normal', 'high')),
  source text not null default 'customer_tracking_page',
  callback_requested boolean not null default false,
  customer_note text,
  admin_note text,
  resolved_at timestamptz,
  closed_at timestamptz,
  metadata jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists store_order_issues_order_idx
  on public.store_order_issues (order_id, created_at desc);
create index if not exists store_order_issues_open_idx
  on public.store_order_issues (status, created_at desc)
  where status in ('OPEN', 'IN_REVIEW', 'WAITING_ON_TEAM');

create table if not exists public.store_order_issue_events (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid not null references public.store_order_issues (id) on delete cascade,
  order_id uuid not null references public.store_orders (id) on delete cascade,
  event text not null,
  from_status text,
  to_status text,
  actor_type text not null default 'system' check (actor_type in ('system', 'admin', 'customer')),
  actor_name text,
  body text,
  visibility text not null default 'internal' check (visibility in ('internal', 'customer')),
  created_at timestamptz not null default now()
);

create index if not exists store_order_issue_events_issue_idx
  on public.store_order_issue_events (issue_id, created_at desc);

alter table public.store_order_issues enable row level security;
alter table public.store_order_issue_events enable row level security;
