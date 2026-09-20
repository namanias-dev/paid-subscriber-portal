-- ============================================================================
-- Notes Store — additive subject-preference submissions (Student Voices).
--
-- Distinct from store_subject_interest (per-product Coming Soon votes).
-- One voter keeps ONE current preference SET so refresh-spam cannot inflate
-- unique demand. Subject rows are relational for co-selection analytics.
--
-- This is interest / demand data, not marketing consent and not an order.
-- No phone, email, or Academy identity is stored.
--
-- Idempotent: safe to re-run.
-- ============================================================================

create table if not exists public.store_interest_submissions (
  id uuid primary key default gen_random_uuid(),
  voter_hash text not null,
  source text not null default 'voices'
    check (source in ('voices', 'landing', 'unknown')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint store_interest_submissions_voter_hash_chk
    check (char_length(voter_hash) = 64)
);

create unique index if not exists store_interest_submissions_voter_uidx
  on public.store_interest_submissions (voter_hash);

create index if not exists store_interest_submissions_created_idx
  on public.store_interest_submissions (created_at desc);

create index if not exists store_interest_submissions_updated_idx
  on public.store_interest_submissions (updated_at desc);

create table if not exists public.store_interest_submission_subjects (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null
    references public.store_interest_submissions (id) on delete cascade,
  category_id uuid not null
    references public.store_categories (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint store_interest_submission_subjects_uidx
    unique (submission_id, category_id)
);

create index if not exists store_interest_submission_subjects_category_idx
  on public.store_interest_submission_subjects (category_id);

alter table public.store_interest_submissions enable row level security;
alter table public.store_interest_submission_subjects enable row level security;

revoke all on table public.store_interest_submissions from public;
revoke all on table public.store_interest_submissions from anon;
revoke all on table public.store_interest_submissions from authenticated;
grant all on table public.store_interest_submissions to service_role;

revoke all on table public.store_interest_submission_subjects from public;
revoke all on table public.store_interest_submission_subjects from anon;
revoke all on table public.store_interest_submission_subjects from authenticated;
grant all on table public.store_interest_submission_subjects to service_role;
