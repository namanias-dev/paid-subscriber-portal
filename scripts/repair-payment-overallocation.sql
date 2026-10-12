-- Hardened repair: baseline JSON preconditions, receipt ownership, outbox suspend.
-- Load after finalize migrations. Test on isolated fixture before production.

create table if not exists public.payment_repair_snapshots (
  id bigserial primary key,
  snapshot_token text not null,
  enrollment_id text not null,
  before_enrollment jsonb not null,
  before_payments jsonb not null,
  before_receipts jsonb not null,
  before_ledger jsonb not null,
  after_enrollment jsonb,
  created_at timestamptz not null default now()
);

create or replace function public.repair_course_overallocation_case(
  p_enrollment_id text,
  p_payment_id text,
  p_canonical_receipt_id text,
  p_supersede_receipt_ids text[],
  p_unpay_schedule_nos integer[],
  p_proposed_amount_paid integer,
  p_proposed_status text,
  p_snapshot_token text,
  p_baseline jsonb, -- reviewed before-state: enrollment, payments[], receipts[], ledger?, transfers?
  p_allow_write boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_enr public.course_enrollments%rowtype;
  v_schedule jsonb;
  v_elem jsonb;
  v_i integer;
  v_no integer;
  v_pay public.payments%rowtype;
  v_canon public.payment_receipts%rowtype;
  v_before_enr jsonb;
  v_before_pays jsonb;
  v_before_rcpts jsonb;
  v_before_ledger jsonb;
  v_net integer;
  v_base_enr jsonb;
  v_base_pay jsonb;
  v_rid text;
  v_r public.payment_receipts%rowtype;
  v_line_paid boolean;
  v_line_ref text;
  v_line_amt integer;
  v_suspended integer := 0;
begin
  if not p_allow_write then
    return jsonb_build_object('ok', false, 'error', 'allow_write_false');
  end if;
  if p_baseline is null then
    raise exception 'repair_abort: baseline_required';
  end if;

  perform public.course_finalize_rpc_enter();
  perform pg_advisory_xact_lock(hashtextextended('course_enr:' || p_enrollment_id, 0));

  select * into v_enr from public.course_enrollments where id = p_enrollment_id for update;
  if not found then raise exception 'repair_abort: enrollment_missing'; end if;

  select * into v_pay from public.payments where id = p_payment_id for update;
  if not found then raise exception 'repair_abort: payment_missing'; end if;
  perform pg_advisory_xact_lock(hashtextextended('course_pay:' || v_pay.id, 0));

  -- Already repaired?
  if exists (
    select 1 from public.payment_finalize_ledger
    where payment_id = p_payment_id and status = 'completed'
      and receipt_id = p_canonical_receipt_id and outcome = 'repair_applied'
  ) and v_enr.amount_paid = p_proposed_amount_paid and v_enr.status = p_proposed_status then
    return jsonb_build_object('ok', true, 'outcome', 'already_repaired');
  end if;

  v_base_enr := p_baseline->'enrollment';
  if v_base_enr is null then raise exception 'repair_abort: baseline_enrollment_missing'; end if;

  if v_enr.amount_paid is distinct from (v_base_enr->>'amount_paid')::int
     or v_enr.status is distinct from (v_base_enr->>'status')
     or v_enr.total_fee is distinct from (v_base_enr->>'total_fee')::int
     or v_enr.schedule is distinct from (v_base_enr->'schedule') then
    raise exception 'repair_abort: enrollment_drift_from_baseline';
  end if;

  if p_baseline ? 'updated_at' and v_enr.updated_at is distinct from (p_baseline->>'updated_at')::timestamptz then
    raise exception 'repair_abort: enrollment_updated_at_drift';
  end if;

  -- Payment identity + amount/status/ref must match baseline payment object.
  v_base_pay := p_baseline->'payment';
  if v_base_pay is null then raise exception 'repair_abort: baseline_payment_missing'; end if;
  if v_pay.id is distinct from (v_base_pay->>'id')
     or v_pay.amount is distinct from (v_base_pay->>'amount')::int
     or v_pay.status is distinct from (v_base_pay->>'status')
     or v_pay.reference_no is distinct from (v_base_pay->>'reference_no')
     or coalesce(v_pay.deleted_at::text,'') is distinct from coalesce(v_base_pay->>'deleted_at','') then
    raise exception 'repair_abort: payment_drift_from_baseline';
  end if;

  -- No unexpected extra PAID payments vs baseline list.
  if p_baseline ? 'payment_ids' then
    if exists (
      select 1 from public.payments p
      where (p.enrollment_id = p_enrollment_id or p.id = p_payment_id)
        and p.status in ('PAID','captured')
        and p.deleted_at is null
        and not (p.id = any(select jsonb_array_elements_text(p_baseline->'payment_ids')))
    ) then
      raise exception 'repair_abort: unexpected_paid_payment';
    end if;
  end if;

  -- Transfers fingerprint
  if p_baseline ? 'transfer_ids' then
    if exists (
      select 1 from public.enrollment_transfers t
      where (t.to_enrollment_id = p_enrollment_id or t.from_enrollment_id = p_enrollment_id)
        and not (t.id = any(select jsonb_array_elements_text(p_baseline->'transfer_ids')))
    ) then
      raise exception 'repair_abort: unexpected_transfer';
    end if;
  end if;

  -- Canonical receipt ownership
  select * into v_canon from public.payment_receipts where id = p_canonical_receipt_id for update;
  if not found then raise exception 'repair_abort: canonical_receipt_missing'; end if;
  if v_canon.payment_id is distinct from p_payment_id
     and v_canon.reference_no is distinct from v_pay.reference_no then
    raise exception 'repair_abort: canonical_receipt_not_owned';
  end if;

  -- Every supersede id must belong to the same payment/reference and match baseline.
  foreach v_rid in array p_supersede_receipt_ids loop
    select * into v_r from public.payment_receipts where id = v_rid for update;
    if not found then raise exception 'repair_abort: supersede_receipt_missing %', v_rid; end if;
    if v_r.payment_id is distinct from p_payment_id
       and v_r.reference_no is distinct from v_pay.reference_no then
      raise exception 'repair_abort: supersede_receipt_not_owned %', v_rid;
    end if;
    if v_rid = p_canonical_receipt_id then
      raise exception 'repair_abort: cannot_supersede_canonical';
    end if;
  end loop;

  -- Baseline schedule line checks for unpay targets
  foreach v_no in array p_unpay_schedule_nos loop
    select (e->>'paid')::boolean, e->>'reference_no', (e->>'amount')::int
      into v_line_paid, v_line_ref, v_line_amt
    from jsonb_array_elements(v_enr.schedule) e
    where (e->>'no')::int = v_no;
    if not coalesce(v_line_paid, false) then
      raise exception 'repair_abort: unpay_target_not_paid %', v_no;
    end if;
    if coalesce(v_line_ref,'') is distinct from coalesce(v_pay.reference_no,'') then
      raise exception 'repair_abort: unpay_target_wrong_reference %', v_no;
    end if;
  end loop;

  -- Suspend receipt-email outbox for this payment (preserve history).
  update public.payment_finalize_ledger
  set receipt_email_status = case
        when receipt_email_status in ('pending','claimed') then 'skipped'
        else receipt_email_status
      end,
      receipt_email_claim_token = null,
      receipt_email_claim_expires_at = null,
      receipt_email_last_error = 'suspended_for_repair:' || p_snapshot_token,
      receipt_email_history = coalesce(receipt_email_history, '[]'::jsonb) || jsonb_build_array(
        jsonb_build_object('at', now(), 'result', 'suspended_for_repair', 'token', p_snapshot_token)
      ),
      updated_at = now()
  where payment_id = p_payment_id
    and receipt_email_status in ('pending', 'claimed');
  get diagnostics v_suspended = row_count;

  v_before_enr := to_jsonb(v_enr);
  select coalesce(jsonb_agg(to_jsonb(p)), '[]'::jsonb) into v_before_pays
  from public.payments p where p.enrollment_id = p_enrollment_id or p.id = p_payment_id;
  select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) into v_before_rcpts
  from public.payment_receipts r
  where r.enrollment_id = p_enrollment_id or r.payment_id = p_payment_id;
  select coalesce(jsonb_agg(to_jsonb(l)), '[]'::jsonb) into v_before_ledger
  from public.payment_finalize_ledger l where l.payment_id = p_payment_id;

  insert into public.payment_repair_snapshots (
    snapshot_token, enrollment_id, before_enrollment, before_payments, before_receipts, before_ledger
  ) values (
    p_snapshot_token, p_enrollment_id, v_before_enr, v_before_pays, v_before_rcpts, v_before_ledger
  );

  v_schedule := coalesce(v_enr.schedule, '[]'::jsonb);
  foreach v_no in array p_unpay_schedule_nos loop
    for v_i in 0..jsonb_array_length(v_schedule)-1 loop
      v_elem := v_schedule->v_i;
      if coalesce((v_elem->>'no')::int, -999) = v_no then
        if coalesce(v_elem->>'reference_no','') = coalesce(v_pay.reference_no,'')
           or coalesce(v_elem->>'payment_id','') = p_payment_id then
          v_schedule := jsonb_set(
            v_schedule,
            array[v_i::text],
            (v_elem - 'paid_at' - 'gateway_ref' - 'reference_no' - 'payment_id' - 'paid_amount')
              || jsonb_build_object('paid', false, 'status', 'pending'),
            true
          );
        else
          raise exception 'repair_abort: schedule_line_%_not_owned', v_no;
        end if;
      end if;
    end loop;
  end loop;

  v_net := public.schedule_net_allocated(v_schedule);
  if v_net is distinct from p_proposed_amount_paid then
    raise exception 'repair_abort: proposed_amount_mismatch computed=% expected=%', v_net, p_proposed_amount_paid;
  end if;

  update public.course_enrollments
  set schedule = v_schedule,
      amount_paid = p_proposed_amount_paid,
      status = p_proposed_status,
      updated_at = now()
  where id = p_enrollment_id;

  update public.payment_receipts
  set superseded_at = now(),
      superseded_reason = 'overallocation_race_repair:' || p_snapshot_token,
      canonical_receipt_id = p_canonical_receipt_id
  where id = any(p_supersede_receipt_ids)
    and superseded_at is null;

  update public.payment_receipts
  set canonical_receipt_id = null,
      superseded_at = null,
      superseded_reason = null
  where id = p_canonical_receipt_id;

  update public.payments
  set receipt_no = v_canon.receipt_no
  where id = p_payment_id;

  insert into public.payment_finalize_ledger (
    payment_id, reference_no, enrollment_id, status, receipt_id, receipt_no,
    allocated_amount, allocation, payment_label, schedule_after, amount_paid_after,
    enrollment_status_after, outcome, receipt_email_status, receipt_email_history
  ) values (
    p_payment_id, v_pay.reference_no, p_enrollment_id, 'completed',
    p_canonical_receipt_id, v_canon.receipt_no,
    coalesce(v_pay.amount, 0), '[]'::jsonb, v_canon.payment_label,
    v_schedule, p_proposed_amount_paid, p_proposed_status,
    'repair_applied', 'skipped',
    jsonb_build_array(jsonb_build_object('at', now(), 'result', 'repair_applied_skip_email', 'token', p_snapshot_token))
  )
  on conflict (payment_id) do update
    set status = 'completed',
        receipt_id = excluded.receipt_id,
        receipt_no = excluded.receipt_no,
        schedule_after = excluded.schedule_after,
        amount_paid_after = excluded.amount_paid_after,
        enrollment_status_after = excluded.enrollment_status_after,
        outcome = 'repair_applied',
        receipt_email_status = 'skipped',
        receipt_email_claim_token = null,
        receipt_email_claim_expires_at = null,
        receipt_email_history = coalesce(public.payment_finalize_ledger.receipt_email_history, '[]'::jsonb)
          || jsonb_build_array(jsonb_build_object('at', now(), 'result', 'repair_applied_skip_email', 'token', p_snapshot_token)),
        updated_at = now();

  update public.payment_repair_snapshots
  set after_enrollment = (select to_jsonb(e) from public.course_enrollments e where e.id = p_enrollment_id)
  where id = (
    select max(id) from public.payment_repair_snapshots
    where snapshot_token = p_snapshot_token and enrollment_id = p_enrollment_id
  );

  return jsonb_build_object(
    'ok', true,
    'outcome', 'repaired',
    'enrollment_id', p_enrollment_id,
    'amount_paid', p_proposed_amount_paid,
    'status', p_proposed_status,
    'canonical_receipt_id', p_canonical_receipt_id,
    'emails_suspended', v_suspended
  );
end;
$$;

revoke all on function public.repair_course_overallocation_case(
  text, text, text, text[], integer[], integer, text, text, jsonb, boolean
) from public;
do $$ begin
  grant execute on function public.repair_course_overallocation_case(
    text, text, text, text[], integer[], integer, text, text, jsonb, boolean
  ) to service_role;
exception when undefined_object then null;
end $$;
