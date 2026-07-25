-- =====================================================================
-- Phase 1d — JSONB slimming on `public.leads`.
--
-- Applied to production 2026-07-24 via Supabase MCP. `CREATE INDEX
-- CONCURRENTLY`, `REINDEX CONCURRENTLY` and `VACUUM` cannot run inside a
-- transaction block and migration runners wrap a file in one, so the
-- CONCURRENTLY statements below were applied as standalone statements,
-- one per call. The rest ran as ordinary migrations.
--
-- GOAL
-- ----
-- `attribution` averaged 891 bytes across 179,493 rows and every scan of
-- `leads` paid for it. Four keys carried the bulk of that weight and none
-- of them were read by any product code path.
--
--   MEASURED payload before -> after:
--     attribution total        152 MB  ->  65 MB   (-87 MB, -57%)
--     average per row          891 B   ->  384 B
--     live tuple length                   165 MB   (pgstattuple)
--
-- FOUR ITEMS, IN THE ORDER THEY WERE APPLIED
-- ------------------------------------------
--   1. `legacy_touches[]`  -> `public.lead_legacy_touches` side table.
--      66 MB / 178,312 rows / ~49% of the whole blob. Read by NO product
--      code — importer / dedupe / transform write paths and tests only.
--      Preserved IN FULL (221,264 touchpoints; 39,553 leads with >1).
--   2. `legacy`            -> `is_legacy boolean NOT NULL DEFAULT false`.
--   3. `legacy_source_tab` -> `legacy_source_tab text`
--      `first_touch.campaign_clean` -> `campaign_clean text`
--   4. Dropped outright: `campaign_confidence`, `platform_hint`,
--      `legacy_status_backfill_batch`.
--
-- WHY ITEM 2 MATTERS MORE THAN ITS 2 MB
-- -------------------------------------
-- `(attribution ->> 'legacy') = 'true'` evaluates to NULL — not false —
-- for any row where `attribution` is NULL or lacks the key. NULL is not
-- true, so such rows are dropped by BOTH `= 'true'` and `<> 'true'`:
-- the two buckets silently lose rows and do not sum to the table total.
-- That trap produced two confidently-wrong answers in this program and
-- forced two incompatible spellings to coexist:
--
--   * analytical SQL   -> `IS DISTINCT FROM 'true'`
--   * index predicates -> a literal three-arm OR, because the planner
--                         cannot prove `IS DISTINCT FROM` implies the
--                         partial index predicate. Getting that wrong
--                         once cost 65,171 ms on a 285 ms query.
--
-- `is_legacy` is `boolean NOT NULL`, so `is_legacy` / `not is_legacy` is
-- a TOTAL, EXACT, two-valued partition. One spelling, both sides
-- planner-provable, entire bug class gone.
--
-- WHY `legacy_status_backfill_batch` WAS SAFE TO DROP
-- --------------------------------------------------
-- It is the rollback marker for the Phase 0c status remap of 115,542
-- rows. VERIFIED before dropping: `legacy_status_backfill_snapshot`
-- carries its own `id`, `batch`, `pre_status`, `pre_call_status`,
-- `pre_call_status_raw` AND a full `pre_attribution` JSONB pre-image —
-- 115,542 snapshot rows against 115,542 marker rows, 0 markers without a
-- snapshot row. The Phase 0c rollback joins on `id` and filters on the
-- snapshot's own `batch` column; it never reads the marker. The rollback
-- path is therefore fully intact without it.
--
-- WHAT WAS DELIBERATELY *NOT* DROPPED
-- -----------------------------------
-- `legacy`, `legacy_source_tab` and `first_touch.campaign_clean` stay in
-- the blob (~15 MB). They are the WRITE-side source of truth; the new
-- columns are the READ side, derived by trigger. That keeps the promoted
-- columns rebuildable from the blob indefinitely, keeps the currently
-- deployed application working unchanged, and means this migration has
-- no dependency on deploy ordering. Dropping them is a separate, later,
-- optional step once the columns have soaked.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. SIDE TABLE for the legacy touch audit trail.
-- ---------------------------------------------------------------------
create table if not exists public.lead_legacy_touches (
  lead_id     text        primary key references public.leads(id) on delete cascade,
  touches     jsonb       not null,
  touch_count integer     not null,
  moved_at    timestamptz not null default now()
);

comment on table public.lead_legacy_touches is
  'Audit trail of legacy sheet touchpoints per lead. Moved out of leads.attribution->legacy_touches on 2026-07-24 to remove the dominant deTOAST cost from every scan of public.leads. Written by the legacy importer / sheets-sync only; no product read path.';

create index if not exists idx_lead_legacy_touches_count
  on public.lead_legacy_touches (touch_count)
  where touch_count > 1;

alter table public.lead_legacy_touches enable row level security;
revoke all on table public.lead_legacy_touches from public, anon, authenticated;
grant all on table public.lead_legacy_touches to service_role;

-- Populated with a resumable, chunked, set-based loop (20,000 rows per
-- COMMIT). NEVER row-by-row: an earlier phase of this program went from
-- 8.9 hours to 3-6 minutes by making exactly this switch. The loop keys
-- off `id` and restarts from `max(lead_id)` already moved, so a statement
-- timeout mid-run costs only the current chunk.
--
--   do $$
--   declare v_chunk int := 20000; v_last text; v_n int;
--   begin
--     select coalesce(max(lead_id), '') into v_last from public.lead_legacy_touches;
--     loop
--       with src as (
--         select l.id, l.attribution -> 'legacy_touches' as touches
--         from public.leads l
--         where l.id > v_last and l.attribution ? 'legacy_touches'
--         order by l.id limit v_chunk
--       ), ins as (
--         insert into public.lead_legacy_touches (lead_id, touches, touch_count)
--         select s.id, s.touches,
--                case when jsonb_typeof(s.touches) = 'array'
--                     then jsonb_array_length(s.touches) else 1 end
--         from src s on conflict (lead_id) do nothing returning 1
--       )
--       select count(*), max(id) into v_n, v_last from src;
--       exit when v_n = 0;
--       commit;
--     end loop;
--   end $$;
--
-- VERIFIED BEFORE ANY KEY WAS DROPPED (all four had to hold):
--   source rows with the key      178,312
--   side-table rows               178,312
--   missing from side table             0
--   orphan/extra side-table rows        0
--   byte-level content mismatch         0   (jsonb IS DISTINCT FROM, all rows)

-- ---------------------------------------------------------------------
-- 2 + 3. PROMOTED COLUMNS.
--
-- Added NULLABLE with no default first: that is a metadata-only DDL in
-- PG11+, so no table rewrite and no meaningful lock. The backfill, the
-- reconciliation gate and the NOT NULL promotion are separate steps on
-- purpose. Do not fold them together.
-- ---------------------------------------------------------------------
alter table public.leads add column if not exists is_legacy boolean;
alter table public.leads add column if not exists legacy_source_tab text;
alter table public.leads add column if not exists campaign_clean text;

comment on column public.leads.is_legacy is
  'True iff the row was created by the legacy backfill / sheets-sync. Promoted from attribution->>legacy on 2026-07-24. Maintained by trg_leads_sync_legacy_columns while attribution.legacy remains the write-side flag.';
comment on column public.leads.legacy_source_tab is
  'Promoted from attribution->>legacy_source_tab. Worklist source-tag filter reads this column, not the blob.';
comment on column public.leads.campaign_clean is
  'Promoted from attribution->first_touch->>campaign_clean. The only key the worklist reads out of first_touch.';

-- Backfilled with the same resumable chunked loop (10,000 rows per COMMIT):
--
--   update public.leads t
--      set is_legacy         = (((t.attribution ->> 'legacy') = 'true') is true),
--          legacy_source_tab = t.attribution ->> 'legacy_source_tab',
--          campaign_clean    = t.attribution -> 'first_touch' ->> 'campaign_clean'
--     from src where t.id = src.id;
--
-- `(... = 'true') IS TRUE` is the NULL-collapsing form and mirrors
-- `hasLegacyFlag()` exactly: `->>` renders JSON boolean true and JSON
-- string "true" identically, and IS TRUE folds the NULL arm to false.

-- ---------------------------------------------------------------------
-- THE HALT GATE. Readers were NOT switched until every line below
-- reconciled exactly. MEASURED 2026-07-24, all assertions passed:
--
--   table total                              179,493
--   is_legacy non-null                       179,493
--   is_legacy null                                 0
--   is_legacy = true                         178,183
--   is_legacy = false                          1,310    (sums to 179,493)
--   active total (merged_into is null)       179,170
--   active + is_legacy                       178,183
--   active + not is_legacy                       987    (sums to 179,170)
--
--   is_legacy <> ((attribution->>'legacy') = 'true') IS TRUE          0
--   (not is_legacy) <> (attribution->>'legacy' IS DISTINCT FROM 'true') 0
--   is_legacy true  but jsonb not 'true'                              0
--   is_legacy false but jsonb  =  'true'                              0
--   legacy_source_tab <> attribution->>'legacy_source_tab'            0
--   campaign_clean <> first_touch->>'campaign_clean'                  0
--
-- Re-verified AFTER the key drop: identical, still 0 disagreements.
-- ---------------------------------------------------------------------

-- NOT NULL without an ACCESS EXCLUSIVE full-table scan: a NOT VALID check
-- is a catalog-only change, VALIDATE takes only SHARE UPDATE EXCLUSIVE
-- (readers and writers keep running), and SET NOT NULL then skips its own
-- scan because the validated constraint already proves the invariant.
alter table public.leads add constraint leads_is_legacy_not_null check (is_legacy is not null) not valid;
alter table public.leads validate constraint leads_is_legacy_not_null;
alter table public.leads alter column is_legacy set not null,
                         alter column is_legacy set default false;

-- ---------------------------------------------------------------------
-- THE BRIDGE TRIGGER.
--
-- ~15 code paths write `leads.attribution`. Requiring every one to also
-- maintain three scalar columns is precisely the sort of distributed
-- invariant that drifts, and a drifted `is_legacy` IS the "178,183 legacy
-- leads leak into the CRM and SMS audiences" failure. Deriving in one
-- place makes drift structurally impossible and lets the already-deployed
-- application keep writing exactly as it does today.
--
-- The scalar projections use a key-presence guard rather than a plain
-- assignment: a writer that rewrites `attribution` wholesale without
-- `legacy_source_tab` must not silently blank the worklist's source-tag
-- filter. `legacy` needs no guard — it is never removed, and absence
-- genuinely means non-legacy.
-- ---------------------------------------------------------------------
create or replace function public.leads_sync_legacy_columns()
returns trigger
language plpgsql
set search_path = public
as $fn$
begin
  new.is_legacy := (((new.attribution ->> 'legacy') = 'true') is true);

  if new.attribution ? 'legacy_source_tab' then
    new.legacy_source_tab := new.attribution ->> 'legacy_source_tab';
  end if;

  if (new.attribution -> 'first_touch') ? 'campaign_clean' then
    new.campaign_clean := new.attribution -> 'first_touch' ->> 'campaign_clean';
  end if;

  return new;
end
$fn$;

drop trigger if exists trg_leads_sync_legacy_columns on public.leads;

-- `UPDATE OF attribution` keeps this off the hot path of ordinary CRM
-- edits (status, assignment, follow-up dates) — it fires only when the
-- blob itself is in the SET list. The column list is ignored for INSERT.
create trigger trg_leads_sync_legacy_columns
  before insert or update of attribution on public.leads
  for each row execute function public.leads_sync_legacy_columns();

-- Superseded by the column's own NOT NULL.
alter table public.leads drop constraint if exists leads_is_legacy_not_null;

-- Trigger behaviour VERIFIED in an aborted transaction (nothing committed):
--   {"legacy": true, ...}          -> is_legacy=t, tab and campaign_clean set
--   {"first_touch": {...}}         -> is_legacy=f          (NULL arm folded)
--   attribution IS NULL            -> is_legacy=f
--   {"legacy": "true"}             -> is_legacy=t          (string spelling)
--   wholesale rewrite w/o scalars  -> tab / campaign_clean PRESERVED
--   legacy key removed             -> is_legacy=f

-- ---------------------------------------------------------------------
-- 4. SNAPSHOT, then drop the dead keys.
--
-- Only the three genuinely DELETED keys are captured. `legacy_touches`
-- is not, because `lead_legacy_touches` already holds it in full and
-- verified byte-for-byte — that table IS its snapshot.
-- ---------------------------------------------------------------------
create table if not exists public.leads_jsonb_slim_snapshot (
  id           text        primary key references public.leads(id) on delete cascade,
  dropped_keys jsonb       not null,
  snapshot_at  timestamptz not null default now()
);

comment on table public.leads_jsonb_slim_snapshot is
  'Pre-image of the attribution keys deleted on 2026-07-24 (campaign_confidence, platform_hint, legacy_status_backfill_batch). Restore: update leads l set attribution = l.attribution || s.dropped_keys from leads_jsonb_slim_snapshot s where s.id = l.id;';

alter table public.leads_jsonb_slim_snapshot enable row level security;
revoke all on table public.leads_jsonb_slim_snapshot from public, anon, authenticated;
grant all on table public.leads_jsonb_slim_snapshot to service_role;

-- Snapshot VERIFIED complete before the drop:
--   rows carrying at least one dropped key   178,183
--   snapshot rows                            178,183
--   with campaign_confidence                 178,183
--   with platform_hint                       178,183
--   with legacy_status_backfill_batch        115,542  (= the Phase 0c count)
--
-- Then, chunked and set-based as above:
--   update public.leads t
--      set attribution = t.attribution
--            - 'legacy_touches' - 'campaign_confidence'
--            - 'platform_hint'  - 'legacy_status_backfill_batch'
--    from src where t.id = src.id and t.attribution is not null;
--
-- VERIFIED after: 0 rows retain any of the four; 178,183 rows still carry
-- each of `legacy`, `legacy_source_tab` and `first_touch.campaign_clean`.

-- ---------------------------------------------------------------------
-- INDEXES. Run as standalone statements — CONCURRENTLY cannot be in a
-- transaction.
--
-- Six partial indexes encoded the JSONB legacy predicate and were rebuilt
-- against `is_legacy`. The `_v2` suffix exists only because a
-- CONCURRENTLY build needs a free name while the old index is still
-- serving traffic; new builds were verified by EXPLAIN before the old
-- ones were dropped.
--
-- `idx_leads_legacy_tab_created_v2` is now a plain column index rather
-- than an index on `(attribution ->> 'legacy_source_tab')`. That is the
-- real prize of item 3: expression indexes have no planner statistics
-- until the table is analyzed AFTER they exist, which is what made the
-- source-tag filter pick a stale index and sort 83,070 rows for
-- 23,693 ms until a bare ANALYZE moved it to 39.9 ms. A plain column
-- carries ordinary column statistics and cannot reproduce that failure.
--
-- The trigram pairs still carry the legacy predicate. Without it the
-- planner BitmapAnds trigram hits against the entire 178k legacy set;
-- that one arm cost 418 ms of an 807 ms query.
-- ---------------------------------------------------------------------
create index concurrently if not exists idx_leads_legacy_active_created_v2
  on public.leads (created_at desc, id desc)
  where merged_into is null and is_legacy;

create index concurrently if not exists idx_leads_legacy_status_created_v2
  on public.leads (status, created_at desc, id desc)
  where merged_into is null and is_legacy;

create index concurrently if not exists idx_leads_legacy_tab_created_v2
  on public.leads (legacy_source_tab, created_at desc, id desc)
  where merged_into is null and is_legacy;

create index concurrently if not exists idx_leads_legacy_phone_trgm_v2
  on public.leads using gin (phone extensions.gin_trgm_ops)
  where merged_into is null and is_legacy;

create index concurrently if not exists idx_leads_legacy_name_trgm_v2
  on public.leads using gin (name extensions.gin_trgm_ops)
  where merged_into is null and is_legacy;

-- New: the RPC's `exclude` mode now emits `not is_legacy`, which the
-- three-arm-OR index cannot serve. Tiny (987 rows).
create index concurrently if not exists idx_leads_nonlegacy_active_created_v2
  on public.leads (created_at desc, id desc)
  where merged_into is null and not is_legacy;

-- =====================================================================
-- ANALYZE AFTER CREATING INDEXES — NOT BEFORE. STILL NOT OPTIONAL.
-- =====================================================================
-- Carried forward verbatim from 2026-07-24-legacy-worklist-indexes.sql,
-- because it cost 594x once: an index has no planner statistics until the
-- table is analyzed AFTER the index exists.
analyze public.leads;

-- Superseded by the `_v2` set. Dropped only after EXPLAIN confirmed every
-- worklist filter had moved onto the replacements. Dropping them also
-- removed six index writes per row from the remaining key-drop pass.
drop index concurrently if exists public.idx_leads_legacy_active_created;
drop index concurrently if exists public.idx_leads_legacy_status_created;
drop index concurrently if exists public.idx_leads_legacy_tab_created;
drop index concurrently if exists public.idx_leads_legacy_phone_trgm;
drop index concurrently if exists public.idx_leads_legacy_name_trgm;
-- Pre-Phase-1, unreferenced by code, and the index whose stale statistics
-- caused the 23,693 ms source-tag plan. Superseded by _tab_created_v2.
drop index concurrently if exists public.idx_leads_legacy_source_tab_partial;

-- RETAINED ON PURPOSE:
--   idx_leads_active_nonlegacy_created  — the LIVE CRM read (`getLeads`)
--     still fires the three-arm PostgREST OR against it. That plan is a
--     Phase 1 invariant; re-measured after this migration as an
--     unchanged `Index Scan using idx_leads_active_nonlegacy_created`,
--     987 rows, 2.97 ms warm, 946 buffers (baseline 928).
--   idx_leads_legacy_flag — still serves `getLeadsForPillMap`'s
--     `.filter("attribution->>legacy", "eq", "true")`.

-- Two full-table rewrites bloated the broad trigram indexes
-- (14 -> 21 MB and 10 -> 17 MB). Non-blocking rebuild; reclaimed 16 MB.
reindex index concurrently public.idx_leads_name_trgm;
reindex index concurrently public.idx_leads_phone_trgm;

-- ---------------------------------------------------------------------
-- RECLAIM.
--
-- Plain VACUUM ON PURPOSE. It marks freed space reusable but does not
-- return it to the OS, so `pg_relation_size` still reports 404 MB.
-- Returning it needs VACUUM FULL, which takes an ACCESS EXCLUSIVE lock
-- and blocks ALL reads and writes on `leads` — a production outage. At
-- 16% of an 8 GB disk there is no reason to buy that, and the actual
-- performance win (smaller rows, less deTOAST) has already landed.
--
--   pgstattuple('public.leads') AFTER, measured:
--     table_len            404 MB
--     live tuple length    165 MB  (40.84%)
--     dead tuples                0
--     reusable free space  236 MB  (58.38%)
--
-- So `leads` now holds 165 MB of live data in a 404 MB file. A VACUUM
-- FULL or `pg_repack` (available, not installed) would compact it to
-- roughly 170-180 MB — comfortably past the 270 MB projection — but that
-- is a separate, explicitly-accepted maintenance window, not part of
-- this migration.
-- ---------------------------------------------------------------------
vacuum (analyze) public.leads;

-- ROLLBACK: see 2026-07-24-leads-jsonb-slimming-rollback.sql
