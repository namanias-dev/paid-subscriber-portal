-- Allow timeline rows for manual access-reminder SMS (admin actor).
-- Live column is event_type (not kind).
alter table public.access_override_events
  drop constraint if exists access_override_events_event_type_check;

alter table public.access_override_events
  add constraint access_override_events_event_type_check
  check (event_type in ('granted','revoked','shortened','expired','reminder_sent'));

-- ROLLBACK
-- alter table public.access_override_events drop constraint if exists access_override_events_event_type_check;
-- alter table public.access_override_events add constraint access_override_events_event_type_check
--   check (event_type in ('granted','revoked','shortened','expired'));
