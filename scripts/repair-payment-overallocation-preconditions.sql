-- READ-ONLY precondition checks for the four over-allocation repairs.
-- Run before any write. Abort the repair transaction if any count mismatches.
-- Generated from dry-run revalidation 2026-10-12. DO NOT EXECUTE WRITES HERE.

-- Udaydeep evening: expect amount_paid=18500, Inst2 paid with MSMV2WHW
select 'udaydeep' as case_id, amount_paid, status,
  (schedule->2->>'paid')::boolean as inst2_paid,
  schedule->2->>'reference_no' as inst2_ref
from course_enrollments
where id = '72c363d0-6bbc-4818-b3d3-7a6fcfbe43ec';

-- Akash: expect fully_paid 35000, Inst2+3 paid with MUF6V8MJ
select 'akash' as case_id, amount_paid, status,
  (schedule->2->>'paid')::boolean as inst2_paid,
  (schedule->3->>'paid')::boolean as inst3_paid,
  (schedule->3->>'amount')::int as inst3_amount
from course_enrollments
where id = 'dfc3dfde-c122-4bee-b3cc-e001ac7d965e';

-- Sarah: expect fully_paid 75000, Inst3 paid with MUMLT4E9, amount 24334
select 'sarah' as case_id, amount_paid, status,
  (schedule->3->>'paid')::boolean as inst3_paid,
  (schedule->3->>'amount')::int as inst3_amount,
  schedule->3->>'reference_no' as inst3_ref
from course_enrollments
where id = 'b1ee55ac-a2f2-458e-a1ae-96e94ac9fa89';

-- Payal: expect 62000, Inst5+6 paid with MUYZZS1A
select 'payal' as case_id, amount_paid, status,
  (schedule->5->>'paid')::boolean as inst5_paid,
  (schedule->6->>'paid')::boolean as inst6_paid
from course_enrollments
where id = '9e515d9f-091c-4123-8ee5-c641b5c51424';

-- Duplicate receipt counts (expect 3 each for race refs)
select reference_no, count(*) as receipt_count
from payment_receipts
where reference_no in (
  'NAMAN-COURSE-MSMV2WHW-3IX7',
  'NAMAN-COURSE-MTK1SFRS-7CRQ',
  'NAMAN-COURSE-MUF6V8MJ-K9Q9',
  'NAMAN-COURSE-MUMLT4E9-JF5O',
  'NAMAN-COURSE-MUYZZS1A-IFSX'
)
group by reference_no
order by 1;

-- Reminder automation must be paused before writes
select id, enabled, kill_switch, dry_run from access_reminder_settings where id = 1;
