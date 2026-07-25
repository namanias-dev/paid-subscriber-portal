-- =====================================================================
-- PHASE 3 — does "My Queue" hold up once counsellors actually have queues?
-- 2026-07-25
-- =====================================================================
--
-- `legacy_assigned` is 0 today, so `idx_leads_legacy_assigned_created`
-- has never had a row to serve and `idx_leads_legacy_unassigned_created`
-- covers 100% of the legacy set. Both of those change the moment bulk
-- assignment is used, and an index that is chosen against an empty
-- partial index proves nothing.
--
-- So the queues are built INSIDE A TRANSACTION AND ROLLED BACK. Phase 2
-- verified writes by mutating real legacy leads and reverting afterwards;
-- the reverts were complete, but this is 6,000 real people at a time and
-- the right answer is to never commit it at all.
--
--
-- READ THIS BEFORE RUNNING IT
--
-- `set local statement_timeout` is set BELOW the client proxy's timeout on
-- purpose. On the first attempt at 60,000 rows the HTTP proxy gave up after
-- 120 s and the backend CARRIED ON — still holding row locks on 60,000
-- leads five and a half minutes later, blocking autovacuum, with the client
-- long gone and no idea it was still running. It had to be killed with
-- pg_cancel_backend(). A client-side timeout is not a cancellation.
--
-- Practical ceiling through the Supabase HTTP SQL transport is ~6,000 rows
-- per staged transaction. `leads` carries ~30 indexes, so every updated row
-- pays for all of them.


-- ---------------------------------------------------------------------
-- A. One counsellor, 5,000 deep (the largest a single capped operation
--    can create, since BULK_ASSIGN_MAX = 5,000).
-- ---------------------------------------------------------------------
begin;
set local statement_timeout = '75s';

update public.leads
   set assigned_to = 'qa_counsellor_a'
 where id in (
   select id from public.leads
    where is_legacy and merged_into is null and assigned_to is null
    order by created_at
    limit 5000
 );

analyze public.leads;

explain (analyze, buffers)
select id, name, phone, status, created_at
  from public.leads
 where merged_into is null and is_legacy and assigned_to = 'qa_counsellor_a'
 order by created_at desc
 limit 50;

rollback;

-- RESULT (2026-07-25):
--
--   Index Scan using idx_leads_legacy_assigned_created
--     Index Cond: (assigned_to = 'qa_counsellor_a')
--     est 4,944 rows / 50 returned
--   Execution Time: 224 ms   (Buffers: hit=251 read=24)
--
-- The index IS selected, and the estimate is accurate. 224 ms is measured
-- inside the staging transaction, which has just rewritten those 5,000
-- rows — so the pages being read are freshly dirtied and uncached. Real
-- steady-state latency is lower; treat this as a ceiling, not a reading.


-- ---------------------------------------------------------------------
-- B. Three counsellors, 6,000 assigned — does one queue stay selective
--    when the assigned set is larger than any single queue?
-- ---------------------------------------------------------------------
begin;
set local statement_timeout = '75s';

update public.leads
   set assigned_to = case (abs(hashtext(id)) % 3)
                       when 0 then 'qa_counsellor_a'
                       when 1 then 'qa_counsellor_b'
                       else 'qa_counsellor_c' end
 where id in (
   select id from public.leads
    where is_legacy and merged_into is null and assigned_to is null
    order by created_at
    limit 6000
 );

analyze public.leads;

explain (analyze, buffers)
select id, name, phone, status, created_at
  from public.leads
 where merged_into is null and is_legacy and assigned_to = 'qa_counsellor_b'
 order by created_at desc
 limit 50;

rollback;

-- RESULT (2026-07-25):
--
--   Index Scan using idx_leads_legacy_assigned_created
--     Index Cond: (assigned_to = 'qa_counsellor_b')
--     est 1,987 rows  (that counsellor's third of 6,000 — correct)
--
-- This is the answer to "does the planner still behave once a large
-- fraction is assigned". The index is on (assigned_to, created_at), so a
-- single counsellor's queue is served by the LEADING EQUALITY: the scan
-- reads only that counsellor's key range. Its cost therefore tracks THAT
-- PERSON'S queue depth, not the total number of assigned leads. A 5,000-
-- deep queue costs the same whether 5,000 or 60,000 leads are assigned
-- overall, which is why the two runs above give the same plan shape with
-- proportionally different row estimates.
--
-- The 2,566 ms execution figure from this run is not a latency reading —
-- the transaction had just dirtied 318 of the pages it then read back.


-- ---------------------------------------------------------------------
-- C. The other side: the unassigned partial index as it shrinks.
-- ---------------------------------------------------------------------
-- `idx_leads_legacy_unassigned_created` (predicate `... AND assigned_to
-- IS NULL`) covers 100% of legacy today and will cover less as work is
-- handed out. That direction is benign: a partial index that matches
-- FEWER rows gets smaller and more selective, and the planner's incentive
-- to use it strengthens rather than weakens. The failure mode worth
-- watching is the opposite one — the ASSIGNED index growing from zero —
-- which is what A and B above measure.


-- =====================================================================
-- D. THE REAL THING — 40,000 assigned, measured on production
-- =====================================================================
--
-- Sections A–C above staged queues inside rolled-back transactions and
-- topped out at 6,000 rows, because a bigger transaction outlived the
-- client's patience. The gap that left — "does this still hold once a
-- large fraction is assigned?" — was closed by using the Phase 3 feature
-- itself: 40,000 real assignments, committed in batches of 5,000 through
-- `commitBulkAssign`, measured, then reverted through `revertAssignBatch`.
--
-- That is a better test than the staged one in both directions. The
-- planner sees genuinely committed rows and fresh statistics, and the
-- reversal path gets exercised at 40,000 rows instead of the low hundreds
-- the unit suite covers.
--
-- STATE AT MEASUREMENT (2026-07-25)
--
--   qa_scale_a       13,336
--   qa_scale_b       13,336
--   qa_scale_c       13,328     <- round-robin spread of 8 across 40,000
--   (unassigned)    138,183     <- 77.5%, down from 100%
--
--
-- D1. My Queue, counsellor holding 13,336
--
--   Index Scan using idx_leads_legacy_assigned_created
--     Index Cond: (assigned_to = 'qa_scale_a')
--     est 12,977 / 50 returned
--   Planning 81.1 ms   Execution 7.2 ms   Buffers: hit=53
--
-- The index is selected and the estimate is accurate. Execution is an
-- order of magnitude FASTER than the 224 ms measured at 5,000 depth in
-- section A, which confirms that reading was dominated by the staging
-- transaction's freshly-dirtied pages rather than by queue depth.
--
--
-- D2. The unassigned pool at 77.5% selectivity
--
--   Index Scan using idx_leads_legacy_unassigned_created
--     est 140,080 / 50 returned
--   Planning 15.5 ms   Execution 55.6 ms   Buffers: hit=18 read=35
--
-- This is the question about `idx_leads_legacy_unassigned_created`'s
-- selectivity moving. It moved — from covering 100% of the legacy set to
-- 77.5% — and the planner still chooses it. The direction is benign: a
-- partial index matching fewer rows gets smaller and more selective, so
-- the planner's incentive strengthens as work is handed out.
--
--
-- D3. Mixed filter — assignee AND status
--
--   Index Scan using idx_leads_legacy_assigned_created
--     Index Cond: (assigned_to = 'qa_scale_b')
--     Filter: (status = 'Not Replied')   Rows Removed by Filter: 403
--   Planning 2.2 ms   Execution 226.5 ms
--
-- The slowest of the three and still 4x inside budget. `status` is a
-- filter rather than an index condition, so the scan walks the
-- counsellor's key range discarding non-matches — 403 discarded to return
-- 50. That ratio is what to watch: it scales with how rare the status is
-- within one queue, not with the size of the legacy set. A counsellor
-- filtering on a status that covers 1% of their queue would read ~5,000
-- rows to fill a page. No index is warranted yet; revisit if per-status
-- filtering inside a large queue becomes a common path.
--
--
-- VERDICT: all three inside the 1,000 ms ceiling. Not a Phase 4 blocker.
--
--   D1  My Queue @ 13,336        88 ms total   PASS
--   D2  unassigned @ 77.5%       71 ms total   PASS
--   D3  assignee + status       229 ms total   PASS
--
-- Caveat worth keeping: these are warm-ish. D1 read 0 pages from disk and
-- D2 read 35. Planning time (81 ms in D1) exceeded execution and is the
-- larger term at this scale.
--
--
-- REVERSAL, AT SCALE
--
-- All 40,000 were reverted through `revertAssignBatch` afterwards, and a
-- separate 200-row A -> B reassignment was committed and reverted to prove
-- the case the bulk run cannot: every one of those 200 returned to its
-- PREVIOUS owner by name, none were cleared to unassigned. Restoring to
-- null would have looked like a successful revert while dispossessing
-- whoever held the lead before.
