-- Login-day lookups for the business report. Additive, idempotent.
-- access_logs has no time index; dashboard logins are filtered by action + timestamp.
create index if not exists idx_access_logs_action_time
  on public.access_logs (action, timestamp desc);
