-- Additive, non-destructive: per-section show/hide toggles for the public course
-- page's "What's included" and "What's not included" lists.
--
-- The item arrays themselves (courses.included / courses.not_included, both jsonb)
-- already exist; this only adds the two visibility flags. Defaults are TRUE so
-- every existing course renders EXACTLY as before (a section shows iff it has
-- items) until an admin explicitly hides it. No data is modified or removed.

alter table public.courses
  add column if not exists show_included boolean not null default true,
  add column if not exists show_not_included boolean not null default true;

comment on column public.courses.show_included is 'Show the "What''s included" list on the public course page (default true).';
comment on column public.courses.show_not_included is 'Show the "What''s not included" list on the public course page (default true).';
