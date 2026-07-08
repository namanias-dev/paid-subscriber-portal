-- ============================================================================
-- Media delete-cascade + notes migration (ADDITIVE, IDEMPOTENT, REVERSIBLE)
--   WS1  original_source_url — preserves the ORIGINAL external link when a note
--        is migrated into R2, so the migration is fully reversible/auditable.
--   WS2  media_deletion_log  — audit log + grace-period purge QUEUE for the
--        global delete-cascade. Every R2 object scheduled/skipped/deleted is
--        recorded here (who, what content, which key, result, when).
-- Nothing here alters or drops existing data. Every statement is IF NOT EXISTS /
-- nullable and safe to run multiple times.
-- ============================================================================

-- ---- WS1: preserve the original external link on migration -----------------
-- When a Google-Drive (or other external) note is migrated into our R2 bucket,
-- drive_link is rewritten to the stable /api/media url. We keep the ORIGINAL
-- url here so the change is reversible and auditable. NULL for never-migrated
-- items. Purely additive; no reader depends on it.
alter table public.content_items
  add column if not exists original_source_url text;

-- ---- WS2: global media deletion audit log + purge queue ---------------------
-- Serves two purposes at once:
--   (1) AUDIT LOG   — an immutable trail of every cascade decision.
--   (2) PURGE QUEUE — rows with status='pending' + purge_after in the future are
--                     the GRACE WINDOW: the R2 object still exists and can be
--                     recovered until the media-purge cron deletes it after the
--                     grace period. This prevents accidental one-click loss.
create table if not exists public.media_deletion_log (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  -- who triggered it (admin user id/name; 'system' for cron/orphan sweeps)
  actor         text,
  -- source record the key belonged to: content_item | webinar | ca_pdf | orphan
  content_type  text,
  content_id    text,
  content_title text,
  -- the exact resolved R2 object key (never a prefix / wildcard)
  r2_key        text not null,
  size_bytes    bigint,
  -- enqueue | purge | orphan_reclaim | immediate
  action        text not null,
  -- pending | purged | deleted | skipped_referenced | missing | failed | out_of_scope
  status        text not null,
  -- human-readable detail (e.g. which live record still references the key)
  reason        text,
  -- grace deadline: the cron only purges pending rows once now() >= purge_after
  purge_after   timestamptz,
  -- when the object was actually removed (or the row otherwise resolved)
  resolved_at   timestamptz
);

-- Cron scan: find due, still-pending purges fast.
create index if not exists media_deletion_log_pending_idx
  on public.media_deletion_log (status, purge_after);

-- Reference / history lookups by key.
create index if not exists media_deletion_log_key_idx
  on public.media_deletion_log (r2_key);
