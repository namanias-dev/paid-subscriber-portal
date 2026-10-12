-- Executable, narrowly scoped repair for known course over-allocation races.
-- TEST ONLY against an isolated fixture DB unless explicitly approved for prod.
--
-- Usage (isolated):
--   select public.repair_course_overallocation_case(
--     p_enrollment_id := '...',
--     p_expected_amount_paid := 18500,
--     p_expected_status := 'partially_paid',
--     p_payment_id := '...',
--     p_canonical_receipt_id := '...',
--     p_supersede_receipt_ids := array['...','...'],
--     p_unpay_schedule_nos := array[2],
--     p_proposed_amount_paid := 10250,
--     p_proposed_status := 'partially_paid',
--     p_snapshot_token := 'dryrun-2026-10-12',
--     p_allow_write := true
--   );
--
-- Lock order: advisory enrollment → enrollment FOR UPDATE → payments FOR UPDATE.
-- Aborts if amount_paid/status/schedule paid flags/receipts/ledger/new payments
-- differ from expected before-state. Never deletes receipts. Repeat-safe.

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
  p_expected_amount_paid integer,
  p_expected_status text,
  p_payment_id text,
  p_canonical_receipt_id text,
  p_supersede_receipt_ids text[],
  p_unpay_schedule_nos integer[],
  p_proposed_amount_paid integer,
  p_proposed_status text,
  p_snapshot_token text,
  p_allow_write boolean default false,
  p_expected_updated_at timestamptz default null
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
  v_new_pay_count integer;
  v_transfer_count integer;
  v_before_enr jsonb;
  v_before_pays jsonb;
  v_before_rcpts jsonb;
  v_before_ledger jsonb;
  v_net integer;
begin
  if not p_allow_write then
    return jsonb_build_object('ok', false, 'error', 'allow_write_false_dry_probe_only');
  end if;

  perform pg_advisory_xact_lock(hashtextextended('course_enr:' || p_enrollment_id, 0));

  select * into v_enr from public.course_enrollments where id = p_enrollment_id for update;
  if not found then
    raise exception 'repair_abort: enrollment_missing %', p_enrollment_id;
  end if;

  select * into v_pay from public.payments where id = p_payment_id for update;
  if not found then
    raise exception 'repair_abort: payment_missing %', p_payment_id;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('course_pay:' || v_pay.id, 0));

  -- Repeat-safe: already repaired to the proposed end state.
  if exists (
    select 1 from public.payment_finalize_ledger
    where payment_id = p_payment_id and status = 'completed'
      and receipt_id = p_canonical_receipt_id
      and outcome = 'repair_applied'
  ) and v_enr.amount_paid = p_proposed_amount_paid
    and v_enr.status = p_proposed_status then
    return jsonb_build_object('ok', true, 'outcome', 'already_repaired', 'enrollment_id', p_enrollment_id);
  end if;

  if v_enr.amount_paid is distinct from p_expected_amount_paid
     or v_enr.status is distinct from p_expected_status then
    raise exception 'repair_abort: enrollment_precondition_mismatch amount_paid=% status=%',
      v_enr.amount_paid, v_enr.status;
  end if;

  if p_expected_updated_at is not null
     and v_enr.updated_at is distinct from p_expected_updated_at then
    raise exception 'repair_abort: enrollment_updated_at_changed';
  end if;

  select count(*) into v_new_pay_count
  from public.payments
  where enrollment_id = p_enrollment_id
    and status in ('PAID', 'captured')
    and deleted_at is null
    and id <> p_payment_id
    and created_at > v_pay.created_at
    and coalesce(is_superseded, false) = false;

  select count(*) into v_transfer_count
  from public.enrollment_transfers
  where to_enrollment_id = p_enrollment_id
     or from_enrollment_id = p_enrollment_id;

  select * into v_canon from public.payment_receipts where id = p_canonical_receipt_id for update;
  if not found then
    raise exception 'repair_abort: canonical_receipt_missing';
  end if;
  if v_canon.payment_id is distinct from p_payment_id
     and v_canon.reference_no is distinct from v_pay.reference_no then
    raise exception 'repair_abort: canonical_receipt_identity_mismatch';
  end if;

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
        -- Only unpay if currently attributed to the race payment reference.
        if coalesce(v_elem->>'reference_no','') = coalesce(v_pay.reference_no,'')
           or coalesce(v_elem->>'payment_id','') = p_payment_id then
          v_schedule := jsonb_set(
            v_schedule,
            array[v_i::text],
            (v_elem
              - 'paid_at'
              - 'gateway_ref'
              - 'reference_no'
              - 'payment_id'
              - 'paid_amount'
            ) || jsonb_build_object(
              'paid', false,
              'status', 'pending'
            ),
            true
          );
        else
          raise exception 'repair_abort: schedule_line_%_not_owned_by_race_payment', v_no;
        end if;
      end if;
    end loop;
  end loop;

  v_net := public.schedule_net_allocated(v_schedule);
  if v_net is distinct from p_proposed_amount_paid then
    raise exception 'repair_abort: proposed_amount_mismatch computed=% expected=%',
      v_net, p_proposed_amount_paid;
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
    enrollment_status_after, outcome, receipt_email_status
  ) values (
    p_payment_id, v_pay.reference_no, p_enrollment_id, 'completed',
    p_canonical_receipt_id, v_canon.receipt_no,
    coalesce(v_pay.amount, 0), '[]'::jsonb, v_canon.payment_label,
    v_schedule, p_proposed_amount_paid, p_proposed_status,
    'repair_applied', 'skipped'
  )
  on conflict (payment_id) do update
    set status = 'completed',
        receipt_id = excluded.receipt_id,
        receipt_no = excluded.receipt_no,
        schedule_after = excluded.schedule_after,
        amount_paid_after = excluded.amount_paid_after,
        enrollment_status_after = excluded.enrollment_status_after,
        outcome = 'repair_applied',
        updated_at = now();

  update public.payment_repair_snapshots
  set after_enrollment = (
    select to_jsonb(e) from public.course_enrollments e where e.id = p_enrollment_id
  )
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
    'transfers_seen', v_transfer_count,
    'new_pay_probe', v_new_pay_count
  );
end;
$$;

revoke all on function public.repair_course_overallocation_case(
  text, integer, text, text, text, text[], integer[], integer, text, text, boolean, timestamptz
) from public;
do $$ begin
  grant execute on function public.repair_course_overallocation_case(
    text, integer, text, text, text, text[], integer[], integer, text, text, boolean, timestamptz
  ) to service_role;
exception when undefined_object then null;
end $$;
