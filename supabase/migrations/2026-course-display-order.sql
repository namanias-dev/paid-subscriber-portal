-- ============================================================
-- Course display order — admin-controlled sort for the public Courses page.
-- Idempotent & backward-compatible.
-- ============================================================

alter table public.courses add column if not exists display_order int;

-- Backfill a sensible initial order for existing rows (newest first → appended last),
-- only where it has not been set yet.
with ordered as (
  select id, row_number() over (order by created_at asc) as rn
  from public.courses
  where display_order is null
)
update public.courses c
set display_order = ordered.rn
from ordered
where c.id = ordered.id;

create index if not exists idx_courses_display_order on public.courses (display_order);
