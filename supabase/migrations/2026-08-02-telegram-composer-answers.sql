-- Telegram composer / polls / answers (ADDITIVE)

alter table public.telegram_broadcasts
  add column if not exists parse_mode text not null default 'HTML',
  add column if not exists fallbacks jsonb not null default '{}'::jsonb,
  add column if not exists template_id text,
  add column if not exists kind text not null default 'message', -- message | poll | question
  add column if not exists poll jsonb,
  add column if not exists question_key text,
  add column if not exists lead_field text;

alter table public.telegram_send_queue
  add column if not exists parse_mode text not null default 'HTML',
  add column if not exists kind text not null default 'message',
  add column if not exists poll jsonb,
  add column if not exists rendered_body text;

alter table public.telegram_templates
  add column if not exists fallbacks jsonb not null default '{}'::jsonb;

create table if not exists public.telegram_answers (
  id uuid primary key default gen_random_uuid(),
  subscriber_id uuid,
  chat_id text not null,
  broadcast_id uuid,
  kind text not null, -- poll | button
  question_key text not null,
  option_key text not null,
  option_label text,
  poll_id text,
  lead_id text,
  lead_field text,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists telegram_answers_q_opt_idx
  on public.telegram_answers (question_key, option_key, created_at desc);
create index if not exists telegram_answers_chat_idx
  on public.telegram_answers (chat_id, created_at desc);
create index if not exists telegram_answers_broadcast_idx
  on public.telegram_answers (broadcast_id) where broadcast_id is not null;
create unique index if not exists telegram_answers_uniq_poll
  on public.telegram_answers (chat_id, poll_id) where kind = 'poll' and poll_id is not null;

create table if not exists public.telegram_button_clicks (
  id uuid primary key default gen_random_uuid(),
  broadcast_id uuid,
  queue_id uuid,
  chat_id text,
  button_label text,
  button_url text,
  created_at timestamptz not null default now()
);
create index if not exists telegram_button_clicks_broadcast_idx
  on public.telegram_button_clicks (broadcast_id, created_at desc);

alter table public.telegram_answers enable row level security;
alter table public.telegram_button_clicks enable row level security;
