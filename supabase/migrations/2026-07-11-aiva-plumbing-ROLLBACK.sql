-- ============================================================================
-- SINGLE ROLLBACK for AIVA data-plumbing Phases B + C (2026-07-11)
-- ============================================================================
-- Every change below was ADDITIVE (new columns only). Original source columns
-- (phone, name, batch_label, registrations, status, amount_paid, schedule, ...)
-- were NEVER mutated, so dropping the added columns fully reverts the DB. Full
-- pre-write snapshots are also retained in schema `aiva_backup`.
--
-- Finance anchor before AND after every write: collected = 5,691,033 ;
-- enrollments = 197 (177 active). Unchanged by design.
-- ============================================================================

begin;

-- Phase B: webinar registrant link tiers + aggregate/vanity marker
alter table public.webinar_registrations drop column if exists matched_enrollment_id;
alter table public.webinar_registrations drop column if exists match_method;
alter table public.webinars              drop column if exists registrations_source;

-- Phase C: batch mapping on enrollments
alter table public.course_enrollments    drop column if exists batch_id;
alter table public.course_enrollments    drop column if exists batch_id_source;

commit;

-- ----------------------------------------------------------------------------
-- Retained pre-write snapshots (safe to keep; drop only when fully satisfied):
--   aiva_backup.webinar_registrations_20260711  (551 rows)
--   aiva_backup.course_enrollments_20260711      (197 rows)
--   aiva_backup.webinars_20260711                (5 rows)
-- To hard-restore a table from its snapshot instead of just dropping columns:
--   truncate public.<table>;
--   insert into public.<table> select * from aiva_backup.<table>_20260711;
-- (Not required — the drops above already revert, since originals were untouched.)
--
-- Optionally remove snapshots when done:
--   drop schema aiva_backup cascade;
--
-- Portal CODE rollback (attendance endpoint + audit-type + AIVA insight rewire):
--   git revert 181c1a5     # then push the branch
-- ----------------------------------------------------------------------------
