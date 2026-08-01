-- General admin activity log (append-only). Separate from payment_action_log /
-- access_logs / webinar_audit_log which are domain-specific.
-- RLS enabled with no policies: only service-role (server) can read/write.
create table if not exists public.admin_activity (
  id text primary key,
  actor_user_id text,
  actor_name text,
  actor_role text,
  action text not null,
  entity_type text,
  entity_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists admin_activity_created_idx on public.admin_activity (created_at desc);
create index if not exists admin_activity_actor_idx on public.admin_activity (actor_user_id);
create index if not exists admin_activity_action_idx on public.admin_activity (action);
create index if not exists admin_activity_entity_idx on public.admin_activity (entity_type, entity_id);

alter table public.admin_activity enable row level security;
