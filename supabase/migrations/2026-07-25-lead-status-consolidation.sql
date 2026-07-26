-- ===========================================================================
-- LEAD STATUS CONSOLIDATION — 16 observed values -> 13 canonical
-- 2026-07-25
-- ===========================================================================
--
-- Collapses the five status vocabularies that accumulated across Phases 0-4
-- into the single 13-value set defined by `lib/leadStatus.ts`. The application
-- side of this change is meaningless without the data side and vice versa, so
-- both ship in one PR.
--
-- WHAT THIS TOUCHES:  `public.leads.status`, and nothing else on that table.
--
-- WHAT IT MUST NOT TOUCH — and does not:
--
--   * `legacy_call_status_raw` — the verbatim source-sheet wording. The only
--     record of what the calling team actually typed. Never written here.
--   * `legacy_call_status`     — the frozen Phase 0c normalisation. This is the
--     pre-consolidation mapped value and it stays exactly as it is, which is
--     what keeps the old vocabulary readable forever. Never written here.
--
-- Those two columns plus the snapshot table below give three independent
-- layers of history, so this migration is reversible from any of them.
--
-- THE MAPPING (approved 2026-07-25 after a full read-only audit):
--
--   New          -> Not Called      RENAME  63,663 rows
--   Admitted     -> Admission Done  RENAME       3 rows
--   Lost         -> Not Interested  MERGE      112 rows
--   Contacted    -> Interested      MERGE        1 row  (a seed fixture)
--   Paid Rs. 50  -> High Potential Lead  MERGE   1 row
--   Negotiation  -> Interested      RETIRED      0 rows
--
--   Everything else already carries a canonical value and is not written.
--   Rows rewritten: 63,780. Table total is unchanged at 179,210 active.
--
-- WHY `New` IS NOT `Not Replied` (the decision this whole change turns on):
--   The 62,641 legacy rows carrying `New` are EXACTLY the rows where
--   `legacy_call_status_raw IS NULL` — a 1:1 partition verified in both
--   directions with zero rows unaccounted for. `New` therefore means "the
--   calling team never dispositioned this lead", while `Not Replied` means "a
--   human dialled and nobody picked up". Merging them would have asserted a
--   contact attempt for 62,641 people who were never called, across a bucket
--   that would then be 70% of the table, with no way to reconstruct the split.
--
-- SAFETY PROPERTIES:
--   * Idempotent      — re-running is a no-op (fixed batch id, guarded inserts,
--                       and the UPDATE only matches retired values).
--   * Reversible      — `lead_status_migration_snapshot` holds the prior value
--                       per lead; the rollback one-liner is at the bottom.
--   * Set-based       — chunked bulk UPDATEs, never row-by-row. An earlier
--                       phase in this program went from 8.9 hours to 3-6
--                       minutes on exactly that change; do not reintroduce a
--                       per-row loop here.
--   * Non-blocking    — the CHECK constraint is added NOT VALID and validated
--                       in a second step, so 179k rows are never scanned under
--                       an ACCESS EXCLUSIVE lock.
--   * No deletes      — nothing is removed. No business data is destroyed.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- STEP 1 — the snapshot table (additive, permanent)
-- ---------------------------------------------------------------------------
-- Not a temp table and not dropped at the end. It is the audit record of the
-- consolidation and the source for the rollback, and it is cheap (63,780 rows,
-- two short text columns).

create table if not exists public.lead_status_migration_snapshot (
  batch_id     text        not null,
  lead_id      text        not null,
  prior_status text,
  new_status   text        not null,
  is_legacy    boolean     not null,
  taken_at     timestamptz not null default now(),
  primary key (batch_id, lead_id)
);

comment on table public.lead_status_migration_snapshot is
  'Prior value of leads.status before the 2026-07-25 13-value consolidation. Batch-tagged and restorable; see the rollback block in migrations/2026-07-25-lead-status-consolidation.sql.';

create index if not exists idx_lead_status_snapshot_batch
  on public.lead_status_migration_snapshot (batch_id);


-- ---------------------------------------------------------------------------
-- STEP 2a — snapshot every row this migration will touch, before touching it
-- ---------------------------------------------------------------------------
-- `on conflict do nothing` makes a re-run a no-op rather than an error, and
-- preserves the ORIGINAL prior value if this is somehow run twice — a second
-- run must not record the already-migrated value as the thing to roll back to.
--
-- This snapshots the WHOLE TABLE, not just active rows. Merged rows
-- (`merged_into is not null`) carry retired statuses too — 323 of them, all
-- `New` — and the CHECK constraint in step 3 applies to every row, so leaving
-- them behind would make VALIDATE fail.

insert into public.lead_status_migration_snapshot (batch_id, lead_id, prior_status, new_status, is_legacy)
select 'status-consolidation-2026-07-25', l.id, l.status, m.to_status, l.is_legacy
from public.leads l
join (values
  ('New',         'Not Called'),
  ('Admitted',    'Admission Done'),
  ('Lost',        'Not Interested'),
  ('Contacted',   'Interested'),
  ('Paid Rs. 50', 'High Potential Lead'),
  ('Negotiation', 'Interested')
) as m(from_status, to_status) on m.from_status = l.status
on conflict (batch_id, lead_id) do nothing;

-- Executed 2026-07-25: 64,104 rows snapshotted (63,781 active + 323 merged).


-- ---------------------------------------------------------------------------
-- STEP 2b — the rewrite
-- ---------------------------------------------------------------------------
-- The five low-volume values go in one set-based statement (117 rows).

update public.leads l
   set status = m.to_status
  from (values
    ('Admitted',    'Admission Done'),
    ('Lost',        'Not Interested'),
    ('Contacted',   'Interested'),
    ('Paid Rs. 50', 'High Potential Lead'),
    ('Negotiation', 'Interested')
  ) as m(from_status, to_status)
 where l.status = m.from_status;

-- `New` is 63,987 rows and must be chunked.
--
-- WHY ctid AND NOT A `DO` LOOP — this was tried and failed in production.
-- The obvious form is a PL/pgSQL loop that keeps updating until row_count is
-- 0. Do not use it here: the whole DO block is ONE statement as far as the
-- server is concerned, so it inherits a single statement_timeout for all
-- 64k rows and is cancelled part-way (it rolled back cleanly, but it never
-- completes). Each chunk must be its own top-level statement.
--
-- Chunk by `ctid`, not by `id`: `... where id in (select id ... order by id
-- limit N)` re-sorts the whole matching set on every pass, and the sort is
-- most of the cost. `ctid` is the physical row address, so the subselect is a
-- cheap scan that stops at the limit.
--
-- 12,000 completes comfortably inside the timeout; 20,000 does not. Repeat
-- until it reports 0 rows:
--
--   update public.leads set status = 'Not Called'
--    where ctid in (select ctid from public.leads where status = 'New' limit 12000);
--
-- Then sweep the remainder in one statement:

update public.leads set status = 'Not Called' where status = 'New';

-- Executed 2026-07-25: 64,104 rows rewritten across 6 chunks + a final sweep.


-- ---------------------------------------------------------------------------
-- STEP 3 — the CHECK constraint
-- ---------------------------------------------------------------------------
-- `public.leads.status` has never had one. That is how five vocabularies and a
-- one-row 'Paid Rs. 50' got in. Added NOT VALID first: that takes only a brief
-- lock and immediately starts rejecting bad writes, without the full-table
-- scan a plain ADD CONSTRAINT would perform while holding ACCESS EXCLUSIVE on
-- 179k rows.
--
-- NULL is permitted because the column is nullable and 0 rows are NULL today;
-- constraining nullability is a separate change with a separate blast radius.

alter table public.leads
  drop constraint if exists leads_status_vocab;

alter table public.leads
  add constraint leads_status_vocab check (
    status is null or status = any (array[
      'Not Called'::text,
      'Not Replied'::text,
      'Call Back'::text,
      'Interested'::text,
      'High Potential Lead'::text,
      'Wants Free Seminar'::text,
      'Walk In'::text,
      'Demo Booked'::text,
      'Demo Attended'::text,
      'Admission Done'::text,
      'Repeat'::text,
      'Not Interested'::text,
      'Wrong No.'::text
    ])
  ) not valid;

-- Step 3b, run separately: validates existing rows under a SHARE UPDATE
-- EXCLUSIVE lock, which does not block reads or writes.
alter table public.leads validate constraint leads_status_vocab;


-- ---------------------------------------------------------------------------
-- STEP 4 — the column default
-- ---------------------------------------------------------------------------
-- Mirrors `DEFAULT_LEAD_STATUS`. Left until after the constraint so the two can
-- never be momentarily inconsistent.

alter table public.leads alter column status set default 'Not Called';


-- ---------------------------------------------------------------------------
-- STEP 5 — index maintenance (run OUTSIDE a transaction)
-- ---------------------------------------------------------------------------
-- No index PREDICATE references a status value — the three status-bearing
-- indexes have `status` as a leading KEY column with predicates on
-- `merged_into` / `is_legacy` only, so none of them needs to be redefined.
--
-- They do need rebuilding: rewriting 63,780 rows leaves dead tuples in every
-- index whose key changed, and `idx_leads_legacy_status_created_v2` is the one
-- the re-engagement worklist depends on for its 285 ms page. REINDEX
-- CONCURRENTLY rebuilds without blocking reads or writes.
--
-- Each REINDEX must be its own top-level statement — batching two of them, or
-- one plus the ANALYZE, puts them in an implicit transaction block and
-- Postgres raises 25001.
--
--   reindex index concurrently public.idx_leads_status;
--   reindex index concurrently public.idx_leads_legacy_status_created_v2;
--   reindex index concurrently public.idx_leads_legacy_count_cover;
--   analyze public.leads;
--
-- Executed 2026-07-25. Post-rebuild plan for the worklist's hottest query
-- (legacy + status + keyset) confirmed still an Index Scan on
-- idx_leads_legacy_status_created_v2, 61 ms.


-- ===========================================================================
-- ROLLBACK
-- ===========================================================================
-- Restores every row this migration touched to its exact prior value. Safe to
-- run more than once. Drop the constraint FIRST — the prior values are not in
-- the new vocabulary and the CHECK will reject them.
--
--   alter table public.leads drop constraint if exists leads_status_vocab;
--   alter table public.leads alter column status set default 'New';
--   update public.leads l
--      set status = s.prior_status
--     from public.lead_status_migration_snapshot s
--    where s.batch_id = 'status-consolidation-2026-07-25'
--      and s.lead_id = l.id
--      and l.status  = s.new_status;
--
-- Verify with:
--   select status, count(*) from public.leads where merged_into is null
--   group by 1 order by 2 desc;
-- ===========================================================================
