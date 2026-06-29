-- ============================================================
-- Audit trail for Cloudflare R2 storage actions on lecture recordings:
-- delete-cascade (when a recording is deleted), upload-abort cleanup, and
-- orphan reclaims. Gives a permanent record of which binary objects were
-- removed/failed, by whom.
--
-- ADDITIVE & SAFE: new table only. Service-role-only (RLS enabled, no policies)
-- so only the guarded /api/admin routes write to it.
-- ============================================================

create table if not exists public.storage_audit_log (
  id uuid primary key default gen_random_uuid(),
  action text not null,            -- 'delete_cascade' | 'orphan_reclaim' | 'abort_cleanup'
  r2_key text,
  recording_id text,
  status text not null,            -- 'deleted' | 'failed'
  actor text,                      -- admin username / 'system'
  detail text,
  created_at timestamptz not null default now()
);

create index if not exists sal_created_idx on public.storage_audit_log (created_at desc);
create index if not exists sal_recording_idx on public.storage_audit_log (recording_id);

alter table public.storage_audit_log enable row level security;

notify pgrst, 'reload schema';
