-- Telegram Mission Control (ADDITIVE). Service-role only (RLS on, no policies).

alter table public.leads add column if not exists telegram_chat_id text;
alter table public.students add column if not exists telegram_chat_id text;
create index if not exists leads_telegram_chat_id_idx on public.leads (telegram_chat_id) where telegram_chat_id is not null;
create index if not exists students_telegram_chat_id_idx on public.students (telegram_chat_id) where telegram_chat_id is not null;

create table if not exists public.telegram_subscribers (
  id uuid primary key default gen_random_uuid(),
  chat_id text not null unique,
  telegram_user_id text,
  username text,
  first_name text,
  linked_lead_id text,
  linked_student_id text,
  source text,
  subscribed_at timestamptz not null default now(),
  is_active boolean not null default true,
  unsubscribed_at timestamptz,
  last_interaction_at timestamptz not null default now(),
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists telegram_subscribers_active_idx on public.telegram_subscribers (is_active, last_interaction_at desc);
create index if not exists telegram_subscribers_lead_idx on public.telegram_subscribers (linked_lead_id) where linked_lead_id is not null;
create index if not exists telegram_subscribers_phone_idx on public.telegram_subscribers (phone) where phone is not null;

create table if not exists public.telegram_templates (
  id text primary key,
  name text not null,
  body text not null,
  image_url text,
  buttons jsonb not null default '[]'::jsonb,
  variables text[] not null default '{}',
  is_active boolean not null default true,
  created_by text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.telegram_automations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  enabled boolean not null default false,
  trigger text not null,
  audience_id text,
  schedule_mode text not null default 'on_trigger', -- on_trigger | send_now | datetime | recurring | manual
  schedule_at timestamptz,
  recurring_cron text,
  message_body text not null default '',
  image_url text,
  buttons jsonb not null default '[]'::jsonb,
  template_id text,
  follow_ups jsonb not null default '[]'::jsonb,
  stop_on_reply boolean not null default true,
  stop_on_converted boolean not null default false,
  created_by text,
  updated_by text,
  last_run_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists telegram_automations_trigger_idx on public.telegram_automations (trigger, enabled);

create table if not exists public.telegram_broadcasts (
  id uuid primary key default gen_random_uuid(),
  name text,
  audience_id text not null,
  message_body text not null,
  image_url text,
  buttons jsonb not null default '[]'::jsonb,
  status text not null default 'draft', -- draft|queued|sending|done|cancelled
  scheduled_at timestamptz,
  audience_size int not null default 0,
  reachable_count int not null default 0,
  sent_count int not null default 0,
  failed_count int not null default 0,
  blocked_count int not null default 0,
  skipped_count int not null default 0,
  created_by text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.telegram_send_queue (
  id uuid primary key default gen_random_uuid(),
  chat_id text not null,
  subscriber_id uuid,
  status text not null default 'queued', -- queued|sent|failed|blocked|skipped|paused
  skip_reason text,
  body text not null,
  image_url text,
  buttons jsonb not null default '[]'::jsonb,
  automation_id uuid,
  broadcast_id uuid,
  follow_up_index int,
  attempt int not null default 0,
  max_attempts int not null default 3,
  scheduled_at timestamptz not null default now(),
  pause_until timestamptz,
  last_error text,
  telegram_message_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index if not exists telegram_send_queue_due_idx
  on public.telegram_send_queue (status, scheduled_at)
  where status in ('queued', 'paused');
create index if not exists telegram_send_queue_chat_idx on public.telegram_send_queue (chat_id, created_at desc);
create index if not exists telegram_send_queue_broadcast_idx on public.telegram_send_queue (broadcast_id) where broadcast_id is not null;
create index if not exists telegram_send_queue_automation_idx on public.telegram_send_queue (automation_id) where automation_id is not null;

create table if not exists public.telegram_messages (
  id uuid primary key default gen_random_uuid(),
  chat_id text not null,
  subscriber_id uuid,
  direction text not null, -- inbound|outbound
  body text,
  telegram_message_id text,
  callback_data text,
  is_read boolean not null default false,
  sent_by_user_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists telegram_messages_chat_idx on public.telegram_messages (chat_id, created_at desc);
create index if not exists telegram_messages_unread_idx on public.telegram_messages (chat_id) where is_read = false and direction = 'inbound';

create table if not exists public.telegram_settings (
  id text primary key default 'default',
  bot_username text,
  welcome_body text,
  welcome_buttons jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by text
);

alter table public.telegram_subscribers enable row level security;
alter table public.telegram_templates enable row level security;
alter table public.telegram_automations enable row level security;
alter table public.telegram_broadcasts enable row level security;
alter table public.telegram_send_queue enable row level security;
alter table public.telegram_messages enable row level security;
alter table public.telegram_settings enable row level security;
