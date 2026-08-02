-- Payment outcome integrity: callback advisory, Verify-only terminals, PAID immutable.
-- Additive only — does not change amounts or schedules.

alter table public.payments
  add column if not exists callback_payload jsonb,
  add column if not exists verify_payload jsonb,
  add column if not exists payment_confirmed_notified_at timestamptz,
  add column if not exists verify_schedule_ids jsonb;

comment on column public.payments.callback_payload is
  'Raw ICICI return-URL callback fields (advisory). Never used alone to write PAID/FAILED.';
comment on column public.payments.verify_payload is
  'Raw ICICI Verify URL response packet. Sole authority for terminal status.';
comment on column public.payments.payment_confirmed_notified_at is
  'When the one-shot student payment confirmation (SMS/Telegram) was sent. Null = not yet.';
comment on column public.payments.verify_schedule_ids is
  'QStash message ids for the per-order verify ladder (cancel on terminal).';

-- Gateway transaction id uniqueness for real ICICI numeric refs only
-- (legacy import strings are excluded). Concurrent PAID writes cannot double-credit.
create unique index if not exists payments_gateway_ref_unique
  on public.payments (gateway_ref)
  where gateway_ref is not null
    and gateway_ref ~ '^[0-9]{8,}$';

-- PAID is immutable at the database level. No callback/verify/job may downgrade it.
create or replace function public.payments_prevent_paid_downgrade()
returns trigger
language plpgsql
as $$
begin
  if upper(coalesce(old.status, '')) in ('PAID', 'CAPTURED') then
    if upper(coalesce(new.status, '')) is distinct from upper(coalesce(old.status, ''))
       and upper(coalesce(new.status, '')) not in ('PAID', 'CAPTURED') then
      new.status := old.status;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_payments_prevent_paid_downgrade on public.payments;
create trigger trg_payments_prevent_paid_downgrade
  before update on public.payments
  for each row
  execute function public.payments_prevent_paid_downgrade();
