-- ============================================================================
-- Notes Store — additive subject-interest (demand signal) table.
--
-- This is NOT an order and does not touch payments, inventory, reservations,
-- quotes, or shipment semantics. Students can mark "I want these notes" for
-- Coming Soon / planned titles so the Academy can see potential demand.
--
-- Privacy: only a SHA-256 voter hash is stored (from a device cookie UUID).
-- No phone, name, email, or address is collected for a vote.
--
-- Idempotent: safe to re-run.
-- ============================================================================

create table if not exists public.store_subject_interest (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.store_products (id) on delete cascade,
  voter_hash text not null,
  source text not null default 'unknown'
    check (source in ('landing', 'subject', 'pdp', 'unknown')),
  created_at timestamptz not null default now(),
  constraint store_subject_interest_voter_hash_chk
    check (char_length(voter_hash) = 64)
);

-- One vote per device-hash per product.
create unique index if not exists store_subject_interest_product_voter_uidx
  on public.store_subject_interest (product_id, voter_hash);

create index if not exists store_subject_interest_product_created_idx
  on public.store_subject_interest (product_id, created_at desc);

create index if not exists store_subject_interest_created_idx
  on public.store_subject_interest (created_at desc);

alter table public.store_subject_interest enable row level security;

revoke all on table public.store_subject_interest from public;
revoke all on table public.store_subject_interest from anon;
revoke all on table public.store_subject_interest from authenticated;
grant all on table public.store_subject_interest to service_role;
