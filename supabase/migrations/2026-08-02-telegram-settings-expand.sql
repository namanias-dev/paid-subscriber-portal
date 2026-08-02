-- Expand telegram_settings + webhook event log + first-inbound ack tracking.

alter table public.telegram_settings
  add column if not exists welcome_image_url text,
  add column if not exists unknown_command_reply text,
  add column if not exists first_inbound_ack_enabled boolean not null default true,
  add column if not exists first_inbound_ack_body text;

alter table public.telegram_subscribers
  add column if not exists first_inbound_ack_sent_at timestamptz;

create table if not exists public.telegram_webhook_events (
  id uuid primary key default gen_random_uuid(),
  update_id bigint,
  kind text,
  chat_id text,
  ok boolean not null default true,
  error text,
  created_at timestamptz not null default now()
);
create index if not exists telegram_webhook_events_created_idx
  on public.telegram_webhook_events (created_at desc);

alter table public.telegram_webhook_events enable row level security;

-- Seed default settings row so welcome is never empty on first load.
insert into public.telegram_settings (id, welcome_body, welcome_buttons, first_inbound_ack_enabled, first_inbound_ack_body, unknown_command_reply, updated_at)
values (
  'default',
  E'Welcome to Naman Sharma IAS Academy, {{first_name}}!\n\nBrowse courses, join upcoming webinars, or talk to us — we are here to help.',
  '[{"label":"Courses","url":"https://www.namanias.com/courses"},{"label":"Upcoming webinar","url":"https://www.namanias.com/webinars"},{"label":"Talk to us","url":"https://www.namanias.com/contact"}]'::jsonb,
  true,
  'Thanks for reaching out — our team will reply shortly.',
  'Sorry, I did not understand that. Tap /start to see options, or send a message and our team will reply.',
  now()
)
on conflict (id) do nothing;
