-- Additive only: nullable entry_point for webinar funnel attribution
-- (listing | detail | direct). No backfill, no NOT NULL, no constraint changes.
alter table public.webinar_registrations
  add column if not exists entry_point text;

comment on column public.webinar_registrations.entry_point is
  'Where the student started checkout: listing | detail | direct. Nullable; historical rows stay null.';
