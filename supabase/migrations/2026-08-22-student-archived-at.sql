-- Archive flag for students/buyers excluded from counts while keeping the ledger.
alter table public.students add column if not exists archived_at timestamptz;
alter table public.buyers add column if not exists archived_at timestamptz;
create index if not exists students_archived_at_idx on public.students (archived_at) where archived_at is not null;

update public.students
set archived_at = coalesce(archived_at, now()),
    is_active = false
where archived_at is null
  and notes like '⟦ARCHIVED⟧%';

update public.buyers b
set archived_at = coalesce(b.archived_at, s.archived_at)
from public.students s
where b.phone = s.phone
  and s.archived_at is not null
  and b.archived_at is null;

update public.students
set notes = nullif(trim(regexp_replace(notes, '^⟦ARCHIVED⟧[^\n]*\n?', '', '')), '')
where notes like '⟦ARCHIVED⟧%';
