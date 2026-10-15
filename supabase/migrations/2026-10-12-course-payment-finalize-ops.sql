-- Ops layer on top of atomic finalize:
-- 1) Atomic receipt-email claim/ack with leases
-- 2) Containment: block non-RPC schedule/receipt writes while cutover is on
-- 3) Deferred finalize queue for PAID payments waiting on drain
-- 4) Hardened repair baseline + outbox coordination

-- ---------- containment + deferred ----------
create table if not exists public.payment_finalize_settings (
  id int primary key default 1 check (id = 1),
  containment_enabled boolean not null default false,
  containment_reason text,
  updated_at timestamptz not null default now(),
  updated_by text
);

insert into public.payment_finalize_settings (id, containment_enabled, containment_reason)
values (1, false, null)
on conflict (id) do nothing;

create table if not exists public.payment_finalize_deferred (
  payment_id text primary key,
  reference_no text not null,
  enrollment_id text,
  reason text not null,
  created_at timestamptz not null default now(),
  drained_at timestamptz,
  drain_outcome text
);

create index if not exists idx_payment_finalize_deferred_open
  on public.payment_finalize_deferred (created_at)
  where drained_at is null;

alter table public.payment_finalize_settings enable row level security;
alter table public.payment_finalize_deferred enable row level security;
revoke all on public.payment_finalize_settings from public;
revoke all on public.payment_finalize_deferred from public;

create or replace function public.course_finalize_containment_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_on boolean;
  v_rpc text;
begin
  select containment_enabled into v_on from public.payment_finalize_settings where id = 1;
  if not coalesce(v_on, false) then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  v_rpc := current_setting('app.course_finalize_rpc', true);
  if v_rpc = '1' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  raise exception 'course_finalize_containment: non-RPC write blocked (%)', tg_table_name
    using errcode = 'restrict_violation';
end;
$$;

drop trigger if exists trg_course_enrollments_finalize_containment on public.course_enrollments;
create trigger trg_course_enrollments_finalize_containment
  before update of schedule, amount_paid, status on public.course_enrollments
  for each row execute function public.course_finalize_containment_guard();

drop trigger if exists trg_payment_receipts_finalize_containment on public.payment_receipts;
create trigger trg_payment_receipts_finalize_containment
  before insert or update or delete on public.payment_receipts
  for each row execute function public.course_finalize_containment_guard();

-- ---------- email claim columns ----------
alter table public.payment_finalize_ledger
  add column if not exists receipt_email_status text,
  add column if not exists receipt_email_attempts integer,
  add column if not exists receipt_email_next_attempt_at timestamptz,
  add column if not exists receipt_email_last_error text,
  add column if not exists receipt_email_payload jsonb,
  add column if not exists receipt_email_claim_token text,
  add column if not exists receipt_email_claim_expires_at timestamptz,
  add column if not exists receipt_email_provider_key text,
  add column if not exists receipt_email_history jsonb;

do $$ begin
  alter table public.payment_finalize_ledger drop constraint if exists payment_finalize_ledger_receipt_email_status_check;
exception when undefined_object then null;
end $$;
-- Recreate permissive check when a named constraint exists from create-table path.
do $$ begin
  alter table public.payment_finalize_ledger
    add constraint payment_finalize_ledger_receipt_email_status_check
    check (receipt_email_status in ('pending', 'claimed', 'sent', 'failed', 'skipped'));
exception when duplicate_object then null;
end $$;

update public.payment_finalize_ledger
set receipt_email_status = coalesce(receipt_email_status, 'skipped'),
    receipt_email_attempts = coalesce(receipt_email_attempts, 0),
    receipt_email_history = coalesce(receipt_email_history, '[]'::jsonb)
where true;

create or replace function public.claim_receipt_email_jobs(p_limit integer default 10, p_lease_seconds integer default 120)
returns table (
  payment_id text,
  receipt_no text,
  receipt_email_attempts integer,
  receipt_email_payload jsonb,
  claim_token text,
  provider_key text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_lease interval := make_interval(secs => greatest(30, coalesce(p_lease_seconds, 120)));
  v_ids text[];
begin
  -- Recover expired claims back to pending without burning attempts.
  update public.payment_finalize_ledger
  set receipt_email_status = 'pending',
      receipt_email_claim_token = null,
      receipt_email_claim_expires_at = null,
      receipt_email_last_error = 'lease_expired_reclaimed',
      updated_at = v_now
  where receipt_email_status = 'claimed'
    and receipt_email_claim_expires_at is not null
    and receipt_email_claim_expires_at < v_now;

  with due as (
    select l.payment_id as pid
    from public.payment_finalize_ledger l
    where l.status = 'completed'
      and l.receipt_email_status = 'pending'
      and (l.receipt_email_next_attempt_at is null or l.receipt_email_next_attempt_at <= v_now)
    order by coalesce(l.receipt_email_next_attempt_at, l.created_at) asc
    limit greatest(1, coalesce(p_limit, 10))
    for update skip locked
  )
  select array_agg(pid) into v_ids from due;

  if v_ids is null then
    return;
  end if;

  return query
  update public.payment_finalize_ledger l
  set receipt_email_status = 'claimed',
      receipt_email_claim_token = encode(gen_random_bytes(16), 'hex'),
      receipt_email_claim_expires_at = v_now + v_lease,
      receipt_email_provider_key = coalesce(
        l.receipt_email_provider_key,
        'receipt-email:' || l.payment_id || ':' || coalesce(l.receipt_no, 'none')
      ),
      updated_at = v_now
  from unnest(v_ids) as x(pid)
  where l.payment_id = x.pid
  returning
    l.payment_id,
    l.receipt_no,
    l.receipt_email_attempts,
    l.receipt_email_payload,
    l.receipt_email_claim_token,
    l.receipt_email_provider_key;
end;
$$;

create or replace function public.ack_receipt_email_job(
  p_payment_id text,
  p_claim_token text,
  p_result text, -- sent | failed | disabled | skipped
  p_error text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.payment_finalize_ledger%rowtype;
  v_attempts integer;
  v_next timestamptz;
  v_status text;
  v_hist jsonb;
begin
  if p_result not in ('sent', 'failed', 'disabled', 'skipped') then
    return jsonb_build_object('ok', false, 'error', 'bad_result');
  end if;

  select * into v_row
  from public.payment_finalize_ledger
  where payment_id = p_payment_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  if v_row.receipt_email_status <> 'claimed'
     or v_row.receipt_email_claim_token is distinct from p_claim_token then
    return jsonb_build_object('ok', false, 'error', 'claim_mismatch');
  end if;

  v_hist := coalesce(v_row.receipt_email_history, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
    'at', now(),
    'result', p_result,
    'error', p_error,
    'receipt_no', v_row.receipt_no,
    'claim_token', p_claim_token
  ));

  if p_result = 'disabled' then
    -- Stay pending; do not consume attempts.
    update public.payment_finalize_ledger
    set receipt_email_status = 'pending',
        receipt_email_claim_token = null,
        receipt_email_claim_expires_at = null,
        receipt_email_next_attempt_at = now() + interval '5 minutes',
        receipt_email_last_error = coalesce(p_error, 'email_disabled'),
        receipt_email_history = v_hist,
        updated_at = now()
    where payment_id = p_payment_id;
    return jsonb_build_object('ok', true, 'status', 'pending', 'attempts_consumed', false);
  end if;

  v_attempts := coalesce(v_row.receipt_email_attempts, 0) + 1;
  if p_result = 'sent' then
    v_status := 'sent';
    v_next := null;
  elsif p_result = 'skipped' then
    v_status := 'skipped';
    v_next := null;
  else
    if v_attempts < 8 then
      v_status := 'pending';
      v_next := now() + make_interval(secs => least(3600, 30 * (2 ^ greatest(0, v_attempts - 1))));
    else
      v_status := 'failed';
      v_next := null;
    end if;
  end if;

  update public.payment_finalize_ledger
  set receipt_email_status = v_status,
      receipt_email_attempts = v_attempts,
      receipt_email_claim_token = null,
      receipt_email_claim_expires_at = null,
      receipt_email_next_attempt_at = v_next,
      receipt_email_last_error = p_error,
      receipt_email_history = v_hist,
      updated_at = now()
  where payment_id = p_payment_id;

  return jsonb_build_object('ok', true, 'status', v_status, 'attempts', v_attempts);
end;
$$;

-- Patch finalize_course_payment to enter RPC session flag (containment bypass).
create or replace function public.finalize_course_payment_guarded(
  p_reference_no text,
  p_due_fills jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pay public.payments%rowtype;
  v_result jsonb;
begin
  perform public.course_finalize_rpc_enter();

  select * into v_pay from public.payments where reference_no = p_reference_no order by created_at asc limit 1;
  if found and v_pay.status in ('PAID', 'captured') and v_pay.enrollment_id is not null then
    insert into public.payment_finalize_deferred (payment_id, reference_no, enrollment_id, reason)
    values (v_pay.id, p_reference_no, v_pay.enrollment_id, 'finalize_attempt')
    on conflict (payment_id) do nothing;
  end if;

  v_result := public.finalize_course_payment(p_reference_no, p_due_fills);

  if coalesce((v_result->>'ok')::boolean, false) then
    update public.payment_finalize_deferred
    set drained_at = now(), drain_outcome = v_result->>'outcome'
    where payment_id = coalesce(v_result->>'payment_id', v_pay.id)
      and drained_at is null;
  end if;

  return v_result;
end;
$$;

-- Prefer guarded entrypoint for app; keep raw finalize for internal repair with rpc_enter.
do $$ begin
  grant execute on function public.course_finalize_rpc_enter() to service_role;
  grant execute on function public.claim_receipt_email_jobs(integer, integer) to service_role;
  grant execute on function public.ack_receipt_email_job(text, text, text, text) to service_role;
  grant execute on function public.finalize_course_payment_guarded(text, jsonb) to service_role;
exception when undefined_object then null;
end $$;
