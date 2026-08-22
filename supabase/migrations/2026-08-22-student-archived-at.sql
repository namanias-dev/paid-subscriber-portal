-- Archive flag for students/buyers excluded from counts while keeping the ledger.
alter table public.students add column if not exists archived_at timestamptz;
alter table public.buyers add column if not exists archived_at timestamptz;
create index if not exists students_archived_at_idx on public.students (archived_at) where archived_at is not null;
