-- Telegram business reporting: settings + metric snapshots for real deltas
create table if not exists public.telegram_report_settings (
  id text primary key default 'default',
  channel_id text,
  digest_enabled boolean not null default true,
  digest_frequency text not null default '3h',
  quiet_hours_start integer,
  quiet_hours_end integer,
  alerts jsonb not null default '{}'::jsonb,
  last_digest_at timestamptz,
  last_digest_error text,
  last_alert_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.telegram_report_snapshots (
  id uuid primary key default gen_random_uuid(),
  slot_key text not null unique,
  kind text not null default 'digest',
  metrics jsonb not null default '{}'::jsonb,
  message_html text,
  created_at timestamptz not null default now()
);

create index if not exists telegram_report_snapshots_created_idx
  on public.telegram_report_snapshots (created_at desc);

alter table public.telegram_report_settings enable row level security;
alter table public.telegram_report_snapshots enable row level security;

insert into public.telegram_report_settings (id) values ('default')
on conflict (id) do nothing;
