-- =====================================================================
-- Buyer access system: post-payment login codes + entitlements.
--
-- Adds:
--   * buyers          — one row per phone, with a unique human-friendly login code
--   * auth_attempts   — durable, lightweight rate-limiting for login / forgot-code
--   * gen_login_code()— SQL helper for backfill (ambiguous chars excluded)
--   * backfill        — assigns login codes to every existing PAID phone
--
-- Purchases/entitlements are the existing `payments` rows (status PAID/captured):
-- one phone can have many payments => access to all of them. No payment data is
-- modified. Idempotent & backward-compatible — safe to run multiple times.
-- =====================================================================

-- ---------------------------- buyers --------------------------------
create table if not exists public.buyers (
  id uuid primary key default gen_random_uuid(),
  phone text unique not null,
  name text,
  login_code text unique not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists buyers_phone_idx on public.buyers (phone);

-- ------------------------- auth_attempts ----------------------------
create table if not exists public.auth_attempts (
  id uuid primary key default gen_random_uuid(),
  key text not null,
  created_at timestamptz default now()
);
create index if not exists auth_attempts_key_idx on public.auth_attempts (key, created_at);

-- Helpful index for entitlement lookups by phone.
create index if not exists payments_phone_idx on public.payments (phone);

-- --------------------- login code generator -------------------------
-- 7 chars from an unambiguous alphabet (no O/0, I/1/L).
create or replace function public.gen_login_code(len int default 7)
returns text
language plpgsql
as $$
declare
  alphabet text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  result text := '';
  i int;
begin
  for i in 1..len loop
    result := result || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
  end loop;
  return result;
end;
$$;

-- ----------------------------- RLS ----------------------------------
-- Enable RLS (no public policies): only the service-role key (used by the app's
-- server routes) can read/write. The anon key is denied, matching `payments`.
alter table public.buyers enable row level security;
alter table public.auth_attempts enable row level security;

-- --------------------------- backfill -------------------------------
-- Give every existing already-paid phone a unique login code.
do $$
declare
  r record;
  code text;
begin
  for r in (
    select phone, max(student_name) as name
    from public.payments
    where status in ('PAID', 'captured')
      and phone is not null
      and btrim(phone) <> ''
      and phone not in (select phone from public.buyers)
    group by phone
  ) loop
    loop
      code := public.gen_login_code(7);
      exit when not exists (select 1 from public.buyers where login_code = code);
    end loop;
    insert into public.buyers (phone, name, login_code)
    values (btrim(r.phone), r.name, code)
    on conflict (phone) do nothing;
  end loop;
end;
$$;

-- Refresh PostgREST schema cache so the new tables are recognised immediately.
notify pgrst, 'reload schema';
