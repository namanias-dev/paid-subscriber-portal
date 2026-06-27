-- =====================================================================
-- Per-user session/access version for TARGETED cross-device invalidation.
--
-- `session_version` is embedded into the buyer JWT at sign time and compared to
-- this column on each authenticated request. Bumping it (on a REAL access/role
-- change — lead->paid, admin payment accept, staff access change, login-code
-- regen) invalidates that user's existing sessions on ALL devices, forcing a
-- fresh re-auth + re-fetch. It is NOT a blunt logout: only the affected user's
-- version moves, so everyone else is undisturbed. Idempotent.
-- =====================================================================

alter table public.buyers
  add column if not exists session_version integer not null default 0;

notify pgrst, 'reload schema';
