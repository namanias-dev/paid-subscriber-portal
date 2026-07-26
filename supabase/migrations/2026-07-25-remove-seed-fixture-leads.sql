-- ============================================================
-- 2026-07-25 · Remove the five seed-fixture leads from production
--
-- Batch: seed-fixture-removal-2026-07-25
--
-- WHAT
-- ----
-- Deletes `lead-0001`..`lead-0005` ("Aspirant One".."Five", phones
-- 9000010001-0005) from `public.leads`. These are demo rows from
-- `supabase/seed.sql`; they reached production because DEPLOY.md step 2
-- instructed operators to run that file against the live database.
--
-- This is the only sanctioned deletion of production lead rows in the entire
-- CRM migration programme. It is sanctioned because the rows are fixtures with
-- no payments and no real references, and because the user approved these five
-- ids explicitly. It does not generalise. Do not reuse this file as a template
-- for deleting leads that merely look inactive.
--
-- WHY IT MATTERED
-- ---------------
-- `leads` is the live sales pipeline, so the fixtures were reported as real
-- prospects. Immediately before the delete, the live (non-legacy) cohort read:
--
--   Interested       1  →  0 real, 1 fixture
--   Demo Booked      1  →  0 real, 1 fixture
--   Demo Attended    2  →  1 real, 1 fixture
--   Admission Done   1  →  0 real, 1 fixture
--
-- Four of the five live leads with any funnel progress were fake, and the
-- pipeline's only admission was Aspirant Five. One real lead had progress: a
-- genuine Demo Attended from a webinar on 2026-07-25.
--
-- PRE-DELETE AUDIT (all verified zero before deleting)
-- ----------------------------------------------------
-- Dependents by lead_id, across every table carrying one — lead_activities,
-- lead_notes, lead_legacy_touches, lead_worklist_audit, ai_conversations,
-- ai_followups, ai_lead_events, automation_enrollments, automation_events,
-- business_events, sms_logs, leads_jsonb_slim_snapshot,
-- legacy_status_backfill_snapshot, leads_backfill_snapshot: 0 rows.
--
-- The only dependent rows anywhere were 3 in `lead_status_migration_snapshot`
-- (this programme's own status-rename audit). That table has no FK to `leads`,
-- so the delete did not cascade into it and all 3 rows survive by design —
-- the audit trail of the rename outlives the row it described.
--
-- Five FKs reference `leads`, ALL `ON DELETE CASCADE`: lead_activities,
-- lead_legacy_touches, lead_notes, leads_jsonb_slim_snapshot,
-- legacy_status_backfill_snapshot. Two of those are prior-phase rollback
-- snapshots, so a delete of a lead with earlier-phase history would have
-- silently destroyed its restore record. It was zero for these five ids, but
-- that is a property of these rows, not a general safety margin.
--
-- Phone-based references for 9000010001-0005 across payments, payment_proofs,
-- payment_receipts, payment_action_log, students, buyers, enrollments,
-- course_enrollments, course_access_overrides, analytics_events, sms_logs,
-- sms_opt_outs, webinar_registrations, referrals, ca_leads, ai_leads,
-- automation_enrollments, automation_suppressions, automation_events,
-- careers_applications, quiz_attempts, ca_bookmarks, lecture_comments: 0 rows
-- in every one. No other lead shares these phones.
--
-- Corroborating evidence that all five were untouched fixtures: `created_at`
-- equals `updated_at` to the microsecond on all five (2026-06-20
-- 22:40:50.862313+00), none was ever assigned, contacted or promoted, and
-- Aspirant Five's "Admission Done" carries a null total_fee and null
-- amount_collected — a real admission has money attached.
-- ============================================================


-- ------------------------------------------------------------
-- 1. Snapshot. Full row image, all 71 columns, as jsonb.
--    Verified before deleting: to_jsonb(live row) = row_data for all five, and
--    jsonb_populate_record reconstructs each row field-for-field.
-- ------------------------------------------------------------
create table if not exists public.lead_seed_fixture_removal_snapshot (
  batch_id  text not null,
  lead_id   text not null,
  row_data  jsonb not null,
  taken_at  timestamptz not null default now(),
  primary key (batch_id, lead_id)
);

comment on table public.lead_seed_fixture_removal_snapshot is
  'Complete pre-delete row image (all columns, as jsonb) of the five supabase/seed.sql demo leads removed from production 2026-07-25. Restore with jsonb_populate_record; see the rollback block in migrations/2026-07-25-remove-seed-fixture-leads.sql.';

create index if not exists idx_lead_seed_fixture_snapshot_batch
  on public.lead_seed_fixture_removal_snapshot (batch_id);

insert into public.lead_seed_fixture_removal_snapshot (batch_id, lead_id, row_data)
select 'seed-fixture-removal-2026-07-25', l.id, to_jsonb(l)
from public.leads l
where l.id in ('lead-0001','lead-0002','lead-0003','lead-0004','lead-0005')
on conflict (batch_id, lead_id) do nothing;


-- ------------------------------------------------------------
-- 2. Delete, guarded on both sides.
--    Refuses to proceed unless the snapshot holds exactly 5 rows, and aborts
--    the transaction unless exactly 5 rows are deleted. A stray id, a partial
--    snapshot or a WHERE clause that matched too much rolls the whole thing
--    back rather than half-deleting.
-- ------------------------------------------------------------
do $$
declare
  v_snap int;
  v_del  int;
begin
  select count(*) into v_snap
  from public.lead_seed_fixture_removal_snapshot
  where batch_id = 'seed-fixture-removal-2026-07-25';

  if v_snap <> 5 then
    raise exception 'refusing to delete: snapshot holds % rows, expected 5', v_snap;
  end if;

  delete from public.leads
  where id in ('lead-0001','lead-0002','lead-0003','lead-0004','lead-0005');

  get diagnostics v_del = row_count;

  if v_del <> 5 then
    raise exception 'refusing to commit: deleted % rows, expected exactly 5', v_del;
  end if;

  raise notice 'deleted % seed fixture leads', v_del;
end $$;


-- ------------------------------------------------------------
-- 3. Verification (run after; every row must read PASS)
-- ------------------------------------------------------------
-- select 'active legacy unchanged at 178183' as check_name,
--        count(*)::text as value,
--        case when count(*) = 178183 then 'PASS' else 'FAIL' end as verdict
--   from public.leads where merged_into is null and is_legacy
-- union all
-- select 'fixtures gone', count(*)::text,
--        case when count(*) = 0 then 'PASS' else 'FAIL' end
--   from public.leads
--  where id in ('lead-0001','lead-0002','lead-0003','lead-0004','lead-0005')
-- union all
-- select 'snapshot complete', count(*)::text,
--        case when count(*) = 5 then 'PASS' else 'FAIL' end
--   from public.lead_seed_fixture_removal_snapshot
--  where batch_id = 'seed-fixture-removal-2026-07-25';


-- ============================================================
-- ROLLBACK — restores all five rows exactly as they were.
--
-- Every column is reconstructed from the snapshot, including the original
-- created_at and updated_at, so the restored rows are byte-identical to the
-- pre-delete state rather than approximations. Safe to run more than once:
-- `on conflict (id) do nothing` here is genuine idempotence, because the
-- snapshot is the authority for what the row contained.
--
-- Ordering note: if the 2026-07-25 status consolidation is ever also rolled
-- back, restore these rows FIRST. That rollback UPDATEs by lead_id and would
-- no-op against rows that do not exist yet. Restoring first also means the
-- 3 surviving `lead_status_migration_snapshot` rows line up with real rows
-- again. The snapshot here holds post-consolidation status values ('Not
-- Called', 'Interested', 'Demo Booked', 'Demo Attended', 'Admission Done'),
-- so restoring alone puts the rows back in their current-vocabulary form.
-- ============================================================
--
-- insert into public.leads
-- select (jsonb_populate_record(null::public.leads, row_data)).*
--   from public.lead_seed_fixture_removal_snapshot
--  where batch_id = 'seed-fixture-removal-2026-07-25'
-- on conflict (id) do nothing;
--
-- Confirm the restore:
-- select count(*) from public.leads
--  where id in ('lead-0001','lead-0002','lead-0003','lead-0004','lead-0005');  -- expect 5
--
-- NOTE: restoring these rows re-creates the phantom pipeline entries. It is
-- here for completeness of the audit trail, not as something anyone should
-- want. `supabase/seed.sql` no longer defines them, so nothing will recreate
-- them accidentally.
