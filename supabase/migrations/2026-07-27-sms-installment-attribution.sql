-- ============================================================================
-- SMS installment attribution key (ADDITIVE — breaks nothing).
--
-- WHAT
--   Three nullable columns on the EXISTING sms_logs, so a reminder can be tied
--   to the ONE installment it was about:
--     course_enrollment_id     which enrollment
--     installment_no           the ordinal within that enrollment's schedule
--     installment_fingerprint  an immutable snapshot of that line's identity
--
-- WHY NOT A NEW TABLE
--   The brief forbids "parallel bookkeeping". That prohibition is about not
--   inventing a SECOND source of truth for reminder state. Extending the send
--   log keeps sms_logs the single place a reminder is recorded — a separate
--   table would have to be kept in step with it, which is exactly the failure
--   mode being forbidden. Columns on the existing log satisfy the rule.
--
-- WHY A FINGERPRINT AND NOT JUST THE ORDINAL
--   Installments are not rows. There is no installments table; they are JSONB
--   elements in course_enrollments.schedule, identified only by their ordinal
--   `no` within one enrollment's array — and that array is MUTABLE. 9 of 310
--   enrollments already carry payment_plan_changed_at and 6 are superseded, so
--   restructuring is demonstrated, not hypothetical. If a plan change renumbers
--   the array, an attribution keyed on `no` alone silently re-points at a
--   DIFFERENT installment. The fingerprint (kind + due date + amount) is
--   captured at send time and never updated, so the same installment stays
--   recognisable across a renumber, and a line that no longer exists fails to
--   match instead of matching the wrong one.
--
--   Read-time matching is tiered in lib/sms/installmentAttribution.ts:
--     1. fingerprint match            -> confident (survives renumbering)
--     2. ordinal match, but ONLY when payment_plan_changed_at <= sent_at
--                                     -> confident (nothing restructured since)
--     3. otherwise                    -> honest "predates a plan change" state,
--                                        never a confident wrong attribution
--
-- NULLABLE / NO BACKFILL
--   Every historical row keeps NULL, including the one real manual reminder and
--   the two test_send rows that predate this column. They render as
--   "Reminded — installment not recorded": never dropped, never mis-attributed.
--   A backfill is impossible in principle — the schedule may have changed since
--   those sends, which is the very ambiguity these columns exist to remove.
--
-- SAFETY
--   add column if not exists on a nullable column takes no table rewrite and no
--   long lock. No FK: deleting an enrollment must not delete or rewrite its
--   audit trail, and the tracking code already treats an unmatchable key as the
--   honest degraded state, so a dangling id is handled by construction.
--
-- ROLLBACK (bottom of file)
-- ============================================================================

-- TEXT, not uuid, because course_enrollments.id is text. All 310 live ids happen
-- to be uuid-shaped, but the column does not constrain them and the demo/fixture
-- paths in this codebase mint ids like "demo-...". A uuid column would make the
-- log INSERT throw on such an id; insertQueuedLog swallows insert errors and
-- returns null, so the send would be skipped with a misleading "duplicate" and
-- no message would go out. Matching the referenced column removes that class of
-- silent failure entirely.
alter table public.sms_logs add column if not exists course_enrollment_id text;
alter table public.sms_logs add column if not exists installment_no integer;
alter table public.sms_logs add column if not exists installment_fingerprint text;

-- Serves the tracking read: "every reminder for these enrollments, newest
-- first". Partial, because only installment reminders ever set the key, which
-- keeps the index a small fraction of the 2820-row table. Column order matters:
-- course_enrollment_id is the join key, installment_no narrows to one line, and
-- sent_at desc lets "first reminder" / "last reminder" come off the index
-- without a sort. Not concurrent: creating it inside the same transaction as the
-- ALTERs is fine on a table this size, and the table is tiny.
create index if not exists sms_logs_installment_attr_idx
  on public.sms_logs (course_enrollment_id, installment_no, sent_at desc)
  where course_enrollment_id is not null;

comment on column public.sms_logs.course_enrollment_id is
  'Enrollment this reminder was about (course_enrollments.id). NULL for every non-installment send and for reminders predating this column.';
comment on column public.sms_logs.installment_no is
  'Ordinal of the targeted line within course_enrollments.schedule at SEND TIME. Not stable across a plan change — always validate against installment_fingerprint.';
comment on column public.sms_logs.installment_fingerprint is
  'Immutable identity of the targeted schedule line at send time: "kind|due-date|amount". Survives a renumbering so a payment is never attributed to the wrong installment.';

-- ============================================================================
-- ROLLBACK
--   drop index if exists public.sms_logs_installment_attr_idx;
--   alter table public.sms_logs drop column if exists installment_fingerprint;
--   alter table public.sms_logs drop column if exists installment_no;
--   alter table public.sms_logs drop column if exists course_enrollment_id;
-- ============================================================================
