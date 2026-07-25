-- =====================================================================
-- PHASE 2 — Legacy leads become first-class in the Lead CRM.
--
-- Everything here is ADDITIVE and NULLABLE. No business data is deleted,
-- rewritten, or re-imported. Every index is CREATE INDEX CONCURRENTLY
-- IF NOT EXISTS. Rollback one-liners are at the bottom of the file.
--
-- WHAT THIS ENABLES
-- -----------------
-- The 178,183 legacy leads stop being hidden and start being SCOPED: the
-- CRM gets an explicit scope control, and counsellors get real per-lead
-- write actions (working status, notes, assignment, follow-up, wrong
-- number / unreachable, opted out) that replace the Google Sheet.
--
-- =====================================================================
-- THE NON-NEGOTIABLE INVARIANT OF THIS MIGRATION
-- =====================================================================
-- `work_status` IS A SEPARATE FIELD. It must NEVER overwrite either:
--
--   * `legacy_call_status_raw` — the team's own verbatim wording from the
--     source sheet, preserved on all 178,183 rows. The team TRUSTS this
--     text; it is surfaced verbatim in the UI and is never parsed,
--     normalised, or written to by the application. It is history.
--
--   * `status` — the frozen Phase 0c mapped `LeadStatus`. Rewriting it
--     would retroactively move leads between historical reporting
--     buckets, which is exactly what freezing it prevented.
--
-- Both remain visible in the lead drawer as history, forever. A counsellor
-- working a lead moves `work_status`, and only `work_status`. This is
-- enforced in the API layer (`lib/legacy-crm/writes.ts` never emits
-- `status` or `legacy_call_status_raw` in an UPDATE) and asserted by
-- `tests/legacy-crm-phase2/write-actions.test.ts`.
--
-- =====================================================================
-- PHASE 3 / PHASE 4 EXTENSIBILITY (deliberate, not speculative)
-- =====================================================================
-- `lead_worklist_audit` is built as the ONE audit spine for all later
-- phases rather than a Phase-2-only convenience:
--
--   * `batch_id`     — Phase 3 bulk assignment tags every row of a batch
--                      with one id so the whole batch is reversible as a
--                      unit. Phase 2 single writes get a batch of one.
--   * `reverses_id`  — a reversal is itself an audited row pointing at the
--                      row it undoes, so history is append-only and an
--                      undo can never erase evidence.
--   * `action`       — an open text vocabulary; Phase 4 adds 'promote' /
--                      'demote' without a schema change.
--   * `before_value` / `after_value` — every write records both sides, so
--                      a Phase 4 demote can be proven byte-identical.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. THE SEPARATE WORKING STATUS
-- ---------------------------------------------------------------------
-- Nullable with no default: NULL means "no counsellor has worked this
-- lead yet", which is true for 100% of the legacy set today. A default of
-- 'new' would have been a 178,183-row write that fabricates work history.
alter table public.leads
  add column if not exists work_status    text,
  add column if not exists work_status_at timestamptz,
  add column if not exists work_status_by text;

comment on column public.leads.work_status is
  'Counsellor working state. SEPARATE from `status` (frozen Phase 0c mapping) '
  'and from `legacy_call_status_raw` (verbatim source-sheet wording). Writing '
  'this NEVER touches either of those. NULL = never worked.';
comment on column public.leads.work_status_at is
  'When work_status last changed. Distinct from updated_at, which any write moves.';
comment on column public.leads.work_status_by is
  'Actor who last changed work_status. Full history lives in lead_worklist_audit.';

-- Constrain the vocabulary so a typo cannot create a phantom bucket that
-- silently drops rows out of every filtered view. NOT VALID + VALIDATE is
-- the additive-safe pair; every existing row is NULL so VALIDATE is a
-- no-op scan that cannot fail.
alter table public.leads drop constraint if exists leads_work_status_vocab;
alter table public.leads add constraint leads_work_status_vocab check (
  work_status is null or work_status in (
    'new',
    'in_progress',
    'contacted',
    'callback_scheduled',
    'interested',
    'not_interested',
    'not_reachable',
    'wrong_number',
    'opted_out',
    'closed'
  )
) not valid;
alter table public.leads validate constraint leads_work_status_vocab;


-- ---------------------------------------------------------------------
-- 2. THE AUDIT SPINE — who / what / when / before / after
-- ---------------------------------------------------------------------
create table if not exists public.lead_worklist_audit (
  id           text        primary key,
  lead_id      text        not null,
  actor        text        not null,
  action       text        not null,
  field        text,
  before_value text,
  after_value  text,
  -- Phase 3 tags every row of a bulk operation with one batch_id so the
  -- batch is reversible as a unit. Phase 2 single writes get a batch of one.
  batch_id     text,
  -- A reversal is an append-only row pointing at what it undid. Undo never
  -- deletes evidence.
  reverses_id  text,
  reverted_at  timestamptz,
  reverted_by  text,
  metadata     jsonb       not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);

comment on table public.lead_worklist_audit is
  'Append-only audit spine for every CRM write against a lead. Phase 2 records '
  'single-lead writes; Phase 3 bulk assignment reuses batch_id; Phase 4 '
  'promotion/demotion reuses action + before/after. Rows are NEVER deleted.';

create index if not exists idx_lead_worklist_audit_lead_created
  on public.lead_worklist_audit (lead_id, created_at desc);
create index if not exists idx_lead_worklist_audit_batch
  on public.lead_worklist_audit (batch_id, created_at desc)
  where batch_id is not null;
create index if not exists idx_lead_worklist_audit_actor_created
  on public.lead_worklist_audit (actor, created_at desc);

-- Admin-only surface reached with the service role. Nothing anonymous may
-- read an audit trail of 178k phone-number owners.
alter table public.lead_worklist_audit enable row level security;
revoke all on table public.lead_worklist_audit from public, anon, authenticated;
grant select, insert, update on table public.lead_worklist_audit to service_role;

-- `lead_notes` already exists (id, lead_id, author, body, created_at) and
-- already carries idx_lead_notes_lead_created (lead_id, created_at desc).
-- Phase 2 reuses it as-is: it is exactly the "child table: author +
-- timestamp" the notes requirement asks for. No change needed.


-- ---------------------------------------------------------------------
-- 3. INDEXES FOR THE NEW LEGACY-SCOPE QUERY PATHS
-- ---------------------------------------------------------------------
-- EVERY index below carries the legacy predicate. Omitting it is a known,
-- measured failure in this program: without `and is_legacy` the planner
-- BitmapAnds the index against the whole 178k set instead of walking it.
--
-- The two sort indexes wrap their nullable key in coalesce(...,'-infinity').
-- That is load-bearing, not cosmetic. The keyset cursor is a row-value
-- comparison `(sort_key, id) < (:v, :id)`, and in SQL a row-value
-- comparison whose left side contains NULL evaluates to NULL — not false —
-- so every row with a NULL sort key would be silently dropped from the
-- walk. `follow_up_at` and `last_contacted_at` are NULL on 100% of legacy
-- rows today, so the un-coalesced form would return an empty page and look
-- like "no results" rather than a bug. coalesce makes the expression
-- NOT NULL, which makes the comparison total.

create index concurrently if not exists idx_leads_legacy_work_status_created
  on public.leads (work_status, created_at desc, id desc)
  where merged_into is null and is_legacy;

create index concurrently if not exists idx_leads_legacy_assigned_created
  on public.leads (assigned_to, created_at desc, id desc)
  where merged_into is null and is_legacy and assigned_to is not null;

-- 100% of legacy rows are unassigned today, so this index currently covers
-- the whole partition and the planner may prefer the plain created_at one.
-- It exists for AFTER Phase 3 bulk assignment, when "unassigned" becomes
-- the selective residue rather than the entire set.
create index concurrently if not exists idx_leads_legacy_unassigned_created
  on public.leads (created_at desc, id desc)
  where merged_into is null and is_legacy and assigned_to is null;

create index concurrently if not exists idx_leads_legacy_followup_sort
  on public.leads ((coalesce(follow_up_at, '-infinity'::timestamptz)) desc, id desc)
  where merged_into is null and is_legacy;

create index concurrently if not exists idx_leads_legacy_lastcontact_sort
  on public.leads ((coalesce(last_contacted_at, '-infinity'::timestamptz)) desc, id desc)
  where merged_into is null and is_legacy;

-- UNIFORM DIRECTION IS LOAD-BEARING. The keyset predicate is a row-value
-- comparison `(name, id) > (:name, :id)`, which is only equivalent to an
-- ordered walk when BOTH index columns sort the same way. A mixed
-- `(name ASC, id DESC)` index cannot serve it and the planner falls back to
-- a sort over the whole 178k partition. Built as (name, id) so ASC is a
-- forward scan and DESC is a backward scan of the same index.
create index concurrently if not exists idx_leads_legacy_name_sort
  on public.leads (name, id)
  where merged_into is null and is_legacy;

-- CONSENT — two indexes, deliberately, because the page read and the exact
-- count are different shapes and one index cannot serve both well.
--
-- FOUND IN QA: `leads_paged_count(consent_status => 'unknown')` was a
-- SEQ SCAN at 17,542 ms. Every legacy lead has consent_status='unknown'
-- (178,183 of 178,183), so this is not an exotic filter — it is the
-- consent blocker the UI shows by default, i.e. the single most common
-- count in the whole feature.
--
-- (a) WIDE — serves the ordered PAGE READ. Carries the sort key so the
--     limit-50 walk is an ordered index scan with no sort node.
--     Measured: 49 ms, 53 buffers.
create index concurrently if not exists idx_leads_legacy_consent_created
  on public.leads (consent_status, created_at desc, id desc)
  where merged_into is null and is_legacy;

-- (b) NARROW — serves the exact COUNT, and nothing else.
--     A count reads every matching index entry, so the only thing that
--     matters is how many BYTES it must walk. Dropping created_at and id
--     from the key shrinks the index from 13 MB to 1,216 kB and the scan
--     from 46,636 buffers to 214.
--
--     MEASURED, cold, count of the 178,183-row consent bucket:
--       seq scan (no index)                 17,542 ms
--       wide index, index-only scan          1,249 ms
--       narrow index, index-only scan          238 ms   <- 73x
--     and the unfiltered legacy count: 765 ms -> 30 ms.
create index concurrently if not exists idx_leads_legacy_countonly
  on public.leads (consent_status)
  where merged_into is null and is_legacy;


-- ---------------------------------------------------------------------
-- 4. ANALYZE — RUN THIS, AND RUN IT LAST
-- ---------------------------------------------------------------------
-- A freshly built index has NO planner statistics. Skipping this exact
-- step once in this program produced a 594x regression: 23,693 ms where
-- the analyzed plan takes 39.9 ms. A bare ANALYZE, after the indexes,
-- every time.
analyze public.leads;
analyze public.lead_worklist_audit;
analyze public.lead_notes;


-- =====================================================================
-- ROLLBACK (safe, additive-only reversal — no business data is touched)
-- =====================================================================
--   drop index concurrently if exists public.idx_leads_legacy_work_status_created;
--   drop index concurrently if exists public.idx_leads_legacy_assigned_created;
--   drop index concurrently if exists public.idx_leads_legacy_unassigned_created;
--   drop index concurrently if exists public.idx_leads_legacy_followup_sort;
--   drop index concurrently if exists public.idx_leads_legacy_lastcontact_sort;
--   drop index concurrently if exists public.idx_leads_legacy_name_sort;
--   drop index concurrently if exists public.idx_leads_legacy_consent_created;
--   drop index concurrently if exists public.idx_leads_legacy_countonly;
--   alter table public.leads drop constraint if exists leads_work_status_vocab;
--   alter table public.leads
--     drop column if exists work_status,
--     drop column if exists work_status_at,
--     drop column if exists work_status_by;
--   -- lead_worklist_audit is append-only evidence. Prefer to KEEP it on
--   -- rollback; drop only if the phase is being abandoned entirely:
--   -- drop table if exists public.lead_worklist_audit;
--   analyze public.leads;
-- =====================================================================
