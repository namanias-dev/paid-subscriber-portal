-- =====================================================================
-- Lead accounts: convert anonymous quiz-takers into re-loggable users.
--
-- A "lead" is a non-paying user who filled the quiz lead form. We reuse the
-- existing `buyers` login-code primitive so they can log back in (phone + code)
-- to retake quizzes and see their results. Leads carry ZERO entitlements — the
-- central access gate (resolveLearner/gateQuiz/...) already default-denies all
-- paid content for a buyer with no payments/enrolments.
--
-- This migration only ADDS an `is_lead` marker column for identification /
-- analytics. Seats, finance and revenue are derived from `payments` /
-- `course_enrollments`, so lead accounts never affect them. Idempotent.
-- =====================================================================

alter table public.buyers
  add column if not exists is_lead boolean not null default false;

-- Refresh PostgREST schema cache so the new column is recognised immediately.
notify pgrst, 'reload schema';
