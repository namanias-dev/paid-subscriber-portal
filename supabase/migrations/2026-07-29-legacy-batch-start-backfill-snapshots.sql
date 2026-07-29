-- Snapshot + revert support for legacy batch-start backfill + amnesty grants.
create table if not exists public.legacy_batch_start_backfill_snapshots (
  id uuid primary key default gen_random_uuid(),
  tag text not null,
  courses_before jsonb not null,
  grants_issued jsonb not null default '[]'::jsonb,
  settings_before jsonb,
  actor text not null,
  notes text,
  reverted_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists legacy_batch_start_backfill_snapshots_tag_idx
  on public.legacy_batch_start_backfill_snapshots (tag, created_at desc);
