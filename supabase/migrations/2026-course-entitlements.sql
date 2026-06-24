-- Course "Mission Control" entitlements.
-- A JSONB blob (like emi_config / after_registration) describing exactly what a
-- student unlocks when they enrol: quizzes (free + specific paid test-series),
-- recorded lectures, current-affairs compilations, study material, Class Hub,
-- and the access type (lifetime vs limited validity).
-- Backward compatible: existing rows default to '{}' = "Class Hub only" (legacy).
alter table public.courses
  add column if not exists entitlements jsonb not null default '{}'::jsonb;
