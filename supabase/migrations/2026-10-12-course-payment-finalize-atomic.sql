-- Atomic course payment finalize.
-- One successful PAID payment allocates at most once, even under concurrent
-- callback + verify + status-poll. Enrollment rows are locked so two distinct
-- payments against the same enrollment cannot interleave schedule writes.
--
-- Idempotency key is payments.id (not reference_no alone): duplicate historical
-- receipts for one reference already exist, and offline/bulk flows may share
-- patterns we must not break with a global unique(reference_no).

alter table public.payment_receipts
  add column if not exists superseded_at timestamptz,
  add column if not exists superseded_reason text,
  add column if not exists canonical_receipt_id text;

create table if not exists public.payment_finalize_ledger (
  payment_id text primary key,
  reference_no text not null,
  enrollment_id text not null,
  status text not null check (status in ('completed')),
  receipt_id text,
  receipt_no text,
  allocated_amount integer not null default 0,
  allocation jsonb not null default '[]'::jsonb,
  payment_label text,
  schedule_after jsonb,
  amount_paid_after integer,
  enrollment_status_after text,
  outcome text not null default 'created',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_payment_finalize_ledger_ref
  on public.payment_finalize_ledger (reference_no);
create index if not exists idx_payment_finalize_ledger_enr
  on public.payment_finalize_ledger (enrollment_id);

alter table public.payment_finalize_ledger enable row level security;
revoke all on public.payment_finalize_ledger from public, anon, authenticated;

-- Net allocated rupees on a schedule (mirrors enrollmentFeeState lineAllocatedAmount).
create or replace function public.schedule_net_allocated(p_schedule jsonb)
returns integer
language sql
immutable
as $$
  select coalesce(sum(
    case
      when coalesce(elem->>'status', '') = 'waived' then 0
      when coalesce(elem->>'status', '') = 'cancelled'
        and coalesce((elem->>'paid')::boolean, false) = false
        and coalesce((elem->>'paid_amount')::numeric, 0) <= 0 then 0
      when coalesce((elem->>'paid')::boolean, false) then greatest(0, coalesce((elem->>'amount')::numeric, 0))::integer
      else greatest(0, coalesce((elem->>'paid_amount')::numeric, 0))::integer
    end
  ), 0)::integer
  from jsonb_array_elements(coalesce(p_schedule, '[]'::jsonb)) elem;
$$;

create or replace function public.schedule_line_remaining(elem jsonb)
returns integer
language sql
immutable
as $$
  select case
    when coalesce((elem->>'paid')::boolean, false) then 0
    when coalesce(elem->>'status', '') in ('paid', 'waived') then 0
    when coalesce(elem->>'status', '') = 'cancelled'
      and coalesce((elem->>'paid_amount')::numeric, 0) <= 0 then 0
    else greatest(
      0,
      coalesce((elem->>'amount')::numeric, 0)
        + coalesce((elem->>'carried_in')::numeric, 0)
        - coalesce((elem->>'paid_amount')::numeric, 0)
        - coalesce((elem->>'carried_out')::numeric, 0)
    )::integer
  end;
$$;

create or replace function public.schedule_line_outstanding(elem jsonb)
returns boolean
language sql
immutable
as $$
  select public.schedule_line_remaining(elem) > 0
    and coalesce((elem->>'paid')::boolean, false) = false
    and coalesce(elem->>'status', '') not in ('waived', 'paid', 'cancelled', 'partially_paid');
$$;

-- partially_paid lines are not the "Pay now" target in TS (isFeeLineOutstanding
-- returns false for them). Mirror that: remaining>0 partially_paid is NOT
-- outstanding for sequencing. For allocation of a new proof remainder we still
-- need to find them — handled separately in the installment branch.

create or replace function public.finalize_course_payment(p_reference_no text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pay public.payments%rowtype;
  v_enr public.course_enrollments%rowtype;
  v_ledger public.payment_finalize_ledger%rowtype;
  v_receipt public.payment_receipts%rowtype;
  v_schedule jsonb;
  v_kind text;
  v_budget integer;
  v_allocated integer := 0;
  v_label text := 'Payment';
  v_lines jsonb := '[]'::jsonb;
  v_paid_at timestamptz := now();
  v_idx integer;
  v_elem jsonb;
  v_need integer;
  v_prev integer;
  v_left integer;
  v_open integer[];
  v_i integer;
  v_j integer;
  v_tmp integer;
  v_best integer;
  v_best_due timestamptz;
  v_due timestamptz;
  v_due_a timestamptz;
  v_due_b timestamptz;
  v_elem_a jsonb;
  v_elem_b jsonb;
  v_net integer;
  v_status text;
  v_receipt_id text;
  v_receipt_no text;
  v_outcome text := 'created';
  v_existing_count integer;
  v_canonical_id text;
begin
  if p_reference_no is null or length(trim(p_reference_no)) = 0 then
    return jsonb_build_object('ok', false, 'outcome', 'bad_reference', 'error', 'missing_reference');
  end if;

  select * into v_pay
  from public.payments
  where reference_no = p_reference_no
  order by created_at asc
  limit 1
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'outcome', 'not_found', 'error', 'payment_not_found');
  end if;

  if v_pay.deleted_at is not null then
    return jsonb_build_object('ok', false, 'outcome', 'deleted', 'error', 'payment_deleted');
  end if;

  if v_pay.status not in ('PAID', 'captured') then
    return jsonb_build_object('ok', false, 'outcome', 'not_paid', 'error', 'payment_not_paid', 'status', v_pay.status);
  end if;

  if v_pay.enrollment_id is null or length(trim(v_pay.enrollment_id)) = 0 then
    return jsonb_build_object('ok', false, 'outcome', 'no_enrollment', 'error', 'not_a_course_emi_payment');
  end if;

  -- Enrollment lock first (stable order via advisory keys), then payment already locked.
  perform pg_advisory_xact_lock(hashtextextended('course_enr:' || v_pay.enrollment_id, 0));
  perform pg_advisory_xact_lock(hashtextextended('course_pay:' || v_pay.id, 0));

  select * into v_enr
  from public.course_enrollments
  where id = v_pay.enrollment_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'outcome', 'no_enrollment', 'error', 'enrollment_missing');
  end if;

  -- Completed ledger short-circuit.
  select * into v_ledger
  from public.payment_finalize_ledger
  where payment_id = v_pay.id;

  if found and v_ledger.status = 'completed' then
    select * into v_receipt from public.payment_receipts where id = v_ledger.receipt_id;
    return jsonb_build_object(
      'ok', true,
      'outcome', 'already_finalized',
      'payment_id', v_pay.id,
      'enrollment_id', v_enr.id,
      'receipt', to_jsonb(v_receipt),
      'enrollment', jsonb_build_object(
        'id', v_enr.id,
        'schedule', v_enr.schedule,
        'amount_paid', v_enr.amount_paid,
        'status', v_enr.status,
        'total_fee', v_enr.total_fee,
        'phone', v_enr.phone,
        'student_name', v_enr.student_name,
        'email', v_enr.email,
        'course_title', v_enr.course_title,
        'course_slug', v_enr.course_slug,
        'batch_label', v_enr.batch_label,
        'plan_type', v_enr.plan_type,
        'discount_amount', v_enr.discount_amount
      ),
      'allocated_amount', v_ledger.allocated_amount
    );
  end if;

  -- Any prior receipt for this payment_id means finalize already happened
  -- (including historical races that created duplicates). Never allocate again.
  select count(*) into v_existing_count
  from public.payment_receipts
  where payment_id = v_pay.id
     or (reference_no = p_reference_no and payment_id is null);

  if v_existing_count > 0 or coalesce(v_pay.receipt_no, '') <> '' then
    -- Canonical: payment.receipt_no, else earliest non-superseded, else earliest.
    select id into v_canonical_id
    from public.payment_receipts
    where (payment_id = v_pay.id or reference_no = p_reference_no)
      and (v_pay.receipt_no is null or receipt_no = v_pay.receipt_no)
    order by issued_at asc
    limit 1;

    if v_canonical_id is null then
      select id into v_canonical_id
      from public.payment_receipts
      where payment_id = v_pay.id or reference_no = p_reference_no
      order by (superseded_at is not null), issued_at asc
      limit 1;
    end if;

    select * into v_receipt from public.payment_receipts where id = v_canonical_id;

    insert into public.payment_finalize_ledger (
      payment_id, reference_no, enrollment_id, status, receipt_id, receipt_no,
      allocated_amount, allocation, payment_label, schedule_after, amount_paid_after,
      enrollment_status_after, outcome
    ) values (
      v_pay.id, p_reference_no, v_enr.id, 'completed', v_receipt.id, v_receipt.receipt_no,
      coalesce(v_receipt.amount, v_pay.amount, 0), '[]'::jsonb, v_receipt.payment_label,
      v_enr.schedule, v_enr.amount_paid, v_enr.status, 'reconciled_existing'
    )
    on conflict (payment_id) do update
      set updated_at = now(),
          outcome = excluded.outcome,
          receipt_id = coalesce(public.payment_finalize_ledger.receipt_id, excluded.receipt_id),
          receipt_no = coalesce(public.payment_finalize_ledger.receipt_no, excluded.receipt_no);

    return jsonb_build_object(
      'ok', true,
      'outcome', 'reconciled_existing',
      'payment_id', v_pay.id,
      'enrollment_id', v_enr.id,
      'receipt', to_jsonb(v_receipt),
      'enrollment', jsonb_build_object(
        'id', v_enr.id,
        'schedule', v_enr.schedule,
        'amount_paid', v_enr.amount_paid,
        'status', v_enr.status,
        'total_fee', v_enr.total_fee,
        'phone', v_enr.phone,
        'student_name', v_enr.student_name,
        'email', v_enr.email,
        'course_title', v_enr.course_title,
        'course_slug', v_enr.course_slug,
        'batch_label', v_enr.batch_label,
        'plan_type', v_enr.plan_type,
        'discount_amount', v_enr.discount_amount
      ),
      'note', 'prior_receipts_present_no_reallocation'
    );
  end if;

  v_schedule := coalesce(v_enr.schedule, '[]'::jsonb);
  v_kind := lower(coalesce(v_pay.payment_kind, 'full'));
  v_budget := greatest(0, coalesce(v_pay.amount, 0));
  v_paid_at := coalesce(
    case when v_pay.transaction_date ~ '^\d{4}-' then v_pay.transaction_date::timestamptz else null end,
    v_pay.created_at,
    now()
  );

  if v_kind = 'one_time' then
    return jsonb_build_object('ok', false, 'outcome', 'no_enrollment', 'error', 'one_time_skipped');
  end if;

  if v_kind = 'seat' then
    v_idx := null;
    for v_i in 0..jsonb_array_length(v_schedule)-1 loop
      v_elem := v_schedule->v_i;
      if coalesce(v_elem->>'kind','') = 'seat'
         and public.schedule_line_outstanding(v_elem)
         and coalesce((v_elem->>'no')::int, -1) = coalesce(v_pay.installment_no, 0) then
        v_idx := v_i; exit;
      end if;
    end loop;
    if v_idx is null then
      for v_i in 0..jsonb_array_length(v_schedule)-1 loop
        v_elem := v_schedule->v_i;
        if coalesce(v_elem->>'kind','') = 'seat' and public.schedule_line_outstanding(v_elem) then
          v_idx := v_i; exit;
        end if;
      end loop;
    end if;
    if v_idx is null then
      return jsonb_build_object('ok', false, 'outcome', 'noop', 'error', 'no_outstanding_seat');
    end if;
    v_elem := v_schedule->v_idx;
    v_need := public.schedule_line_remaining(v_elem);
    if v_budget < v_need and coalesce(v_pay.payment_source, '') = 'student_proof' then
      v_schedule := jsonb_set(v_schedule, array[v_idx::text], v_elem || jsonb_build_object(
        'paid', false,
        'status', 'partially_paid',
        'paid_amount', coalesce((v_elem->>'paid_amount')::numeric, 0) + v_budget,
        'reference_no', p_reference_no,
        'gateway_ref', coalesce(v_pay.gateway_ref, v_pay.razorpay_payment_id),
        'payment_id', v_pay.id
      ), true);
      v_allocated := v_budget;
      v_label := coalesce(v_elem->>'label', 'Book Your Seat') || ' (partial)';
      v_lines := v_lines || jsonb_build_array(jsonb_build_object('no', (v_elem->>'no')::int, 'kind', 'seat', 'amount', v_budget));
    elsif v_budget < v_need then
      return jsonb_build_object('ok', false, 'outcome', 'insufficient_budget', 'error', 'seat_amount_too_low', 'need', v_need, 'budget', v_budget);
    else
      v_schedule := jsonb_set(v_schedule, array[v_idx::text], v_elem || jsonb_build_object(
        'paid', true,
        'status', 'paid',
        'paid_at', v_paid_at,
        'paid_amount', coalesce((v_elem->>'amount')::numeric, 0),
        'reference_no', p_reference_no,
        'gateway_ref', coalesce(v_pay.gateway_ref, v_pay.razorpay_payment_id),
        'payment_id', v_pay.id
      ), true);
      v_allocated := v_need;
      v_label := coalesce(v_elem->>'label', 'Book Your Seat');
      v_lines := v_lines || jsonb_build_array(jsonb_build_object('no', (v_elem->>'no')::int, 'kind', 'seat', 'amount', v_need));
    end if;

  elsif v_kind = 'installment' then
    -- Oldest outstanding installment (due asc nulls first, then no).
    v_best := null;
    v_best_due := null;
    for v_i in 0..jsonb_array_length(v_schedule)-1 loop
      v_elem := v_schedule->v_i;
      if coalesce(v_elem->>'kind','') <> 'installment' then continue; end if;
      if not public.schedule_line_outstanding(v_elem) then continue; end if;
      v_due := case when nullif(v_elem->>'due','') is null then '-infinity'::timestamptz
                    else (v_elem->>'due')::timestamptz end;
      if v_best is null
         or v_due < v_best_due
         or (v_due = v_best_due and coalesce((v_elem->>'no')::int,0) < coalesce(((v_schedule->v_best)->>'no')::int,0)) then
        v_best := v_i;
        v_best_due := v_due;
      end if;
    end loop;
    if v_best is null then
      return jsonb_build_object('ok', false, 'outcome', 'noop', 'error', 'no_outstanding_installment');
    end if;
    v_elem := v_schedule->v_best;
    v_need := public.schedule_line_remaining(v_elem);
    v_prev := greatest(0, coalesce((v_elem->>'paid_amount')::numeric, 0)::integer);
    if coalesce(v_pay.payment_source, '') = 'student_proof'
       and v_budget > 0
       and (v_prev + v_budget) < (coalesce((v_elem->>'amount')::numeric, 0) + coalesce((v_elem->>'carried_in')::numeric, 0)) then
      v_schedule := jsonb_set(v_schedule, array[v_best::text], v_elem || jsonb_build_object(
        'paid', false,
        'status', 'partially_paid',
        'paid_amount', v_prev + v_budget,
        'reference_no', p_reference_no,
        'gateway_ref', coalesce(v_pay.gateway_ref, v_pay.razorpay_payment_id),
        'payment_id', v_pay.id
      ), true);
      v_allocated := v_budget;
      v_label := coalesce(v_elem->>'label', 'Installment') || ' (partial)';
      v_lines := v_lines || jsonb_build_array(jsonb_build_object('no', (v_elem->>'no')::int, 'kind', 'installment', 'amount', v_budget));
    elsif v_budget < v_need then
      return jsonb_build_object('ok', false, 'outcome', 'insufficient_budget', 'error', 'installment_amount_too_low', 'need', v_need, 'budget', v_budget);
    else
      v_schedule := jsonb_set(v_schedule, array[v_best::text], v_elem || jsonb_build_object(
        'paid', true,
        'status', 'paid',
        'paid_at', v_paid_at,
        'paid_amount', coalesce((v_elem->>'amount')::numeric, 0),
        'reference_no', p_reference_no,
        'gateway_ref', coalesce(v_pay.gateway_ref, v_pay.razorpay_payment_id),
        'payment_id', v_pay.id
      ), true);
      v_allocated := v_need;
      v_label := coalesce(v_elem->>'label', 'Installment');
      v_lines := v_lines || jsonb_build_array(jsonb_build_object('no', (v_elem->>'no')::int, 'kind', 'installment', 'amount', v_need));
    end if;

  else
    -- full remaining: waterfall in oldest-outstanding order (due, then no)
    v_left := v_budget;
    v_open := array[]::integer[];
    for v_i in 0..jsonb_array_length(v_schedule)-1 loop
      if public.schedule_line_outstanding(v_schedule->v_i) then
        v_open := v_open || v_i;
      end if;
    end loop;
    -- bubble sort by due/no
    if coalesce(array_length(v_open, 1), 0) > 1 then
      for v_i in 1..array_length(v_open, 1) loop
        for v_j in 1..array_length(v_open, 1) - v_i loop
          v_elem_a := v_schedule->v_open[v_j];
          v_elem_b := v_schedule->v_open[v_j + 1];
          v_due_a := case when nullif(v_elem_a->>'due','') is null then '-infinity'::timestamptz else (v_elem_a->>'due')::timestamptz end;
          v_due_b := case when nullif(v_elem_b->>'due','') is null then '-infinity'::timestamptz else (v_elem_b->>'due')::timestamptz end;
          if v_due_b < v_due_a
             or (v_due_b = v_due_a and coalesce((v_elem_b->>'no')::int,0) < coalesce((v_elem_a->>'no')::int,0)) then
            v_tmp := v_open[v_j];
            v_open[v_j] := v_open[v_j + 1];
            v_open[v_j + 1] := v_tmp;
          end if;
        end loop;
      end loop;
    end if;
    if coalesce(array_length(v_open, 1), 0) > 0 then
      foreach v_i in array v_open loop
        if v_left <= 0 then exit; end if;
        v_elem := v_schedule->v_i;
        v_need := public.schedule_line_remaining(v_elem);
        if v_need <= 0 then continue; end if;
        if v_left >= v_need then
          v_schedule := jsonb_set(v_schedule, array[v_i::text], v_elem || jsonb_build_object(
            'paid', true, 'status', 'paid', 'paid_at', v_paid_at,
            'paid_amount', coalesce((v_elem->>'amount')::numeric, 0),
            'reference_no', p_reference_no,
            'gateway_ref', coalesce(v_pay.gateway_ref, v_pay.razorpay_payment_id),
            'payment_id', v_pay.id
          ), true);
          v_left := v_left - v_need;
          v_allocated := v_allocated + v_need;
          v_lines := v_lines || jsonb_build_array(jsonb_build_object('no', (v_elem->>'no')::int, 'kind', v_elem->>'kind', 'amount', v_need));
        else
          v_schedule := jsonb_set(v_schedule, array[v_i::text], v_elem || jsonb_build_object(
            'paid', false, 'status', 'partially_paid',
            'paid_amount', coalesce((v_elem->>'paid_amount')::numeric, 0) + v_left,
            'reference_no', p_reference_no,
            'gateway_ref', coalesce(v_pay.gateway_ref, v_pay.razorpay_payment_id),
            'payment_id', v_pay.id
          ), true);
          v_allocated := v_allocated + v_left;
          v_lines := v_lines || jsonb_build_array(jsonb_build_object('no', (v_elem->>'no')::int, 'kind', v_elem->>'kind', 'amount', v_left));
          v_left := 0;
        end if;
      end loop;
    end if;
    v_label := 'Full Remaining Payment';
    if v_allocated = 0 then
      return jsonb_build_object('ok', false, 'outcome', 'noop', 'error', 'nothing_to_allocate');
    end if;
  end if;

  if v_allocated > v_budget then
    return jsonb_build_object('ok', false, 'outcome', 'invariant_violation', 'error', 'allocated_exceeds_payment', 'allocated', v_allocated, 'budget', v_budget);
  end if;

  v_net := public.schedule_net_allocated(v_schedule);
  if v_net > coalesce(v_enr.total_fee, 0) then
    v_net := coalesce(v_enr.total_fee, 0);
  end if;

  if v_net >= coalesce(v_enr.total_fee, 0) and coalesce(v_enr.total_fee, 0) > 0 then
    v_status := 'fully_paid';
  elsif v_net > 0 and exists (
    select 1 from jsonb_array_elements(v_schedule) e where coalesce(e->>'kind','') = 'seat' and coalesce((e->>'paid')::boolean,false)
  ) and not exists (
    select 1 from jsonb_array_elements(v_schedule) e where coalesce(e->>'kind','') = 'installment' and coalesce((e->>'paid')::boolean,false)
  ) then
    v_status := 'seat_booked';
  elsif v_net > 0 then
    v_status := 'partially_paid';
  else
    v_status := coalesce(v_enr.status, 'pending');
  end if;

  update public.course_enrollments
  set schedule = v_schedule,
      amount_paid = v_net,
      status = v_status,
      updated_at = now()
  where id = v_enr.id;

  v_receipt_id := gen_random_uuid()::text;
  -- Prefer DB sequence when present.
  begin
    v_receipt_no := public.next_receipt_no();
  exception when others then
    v_receipt_no := 'NSA/' || to_char(now() at time zone 'Asia/Kolkata', 'YY') || '/' || substr(replace(v_receipt_id, '-', ''), 1, 8);
  end;

  insert into public.payment_receipts (
    id, receipt_no, enrollment_id, payment_id, reference_no, phone, student_name, email,
    course_title, batch_label, payment_kind, payment_label, amount, gateway_ref,
    total_fee, paid_to_date, remaining, installments_summary, status, method, issued_at
  ) values (
    v_receipt_id, v_receipt_no, v_enr.id, v_pay.id, p_reference_no, v_enr.phone, v_enr.student_name, v_enr.email,
    v_enr.course_title, v_enr.batch_label,
    case when v_kind in ('seat','installment','full') then v_kind else 'full' end,
    v_label, v_pay.amount, coalesce(v_pay.gateway_ref, v_pay.razorpay_payment_id),
    v_enr.total_fee, v_net, greatest(0, coalesce(v_enr.total_fee,0) - v_net),
    v_label, case when v_status = 'fully_paid' then 'Fully Paid' when v_status = 'seat_booked' then 'Seat Booked' else 'Partially Paid' end,
    coalesce(v_pay.payment_mode, v_pay.mode), v_paid_at
  );

  update public.payments
  set receipt_no = v_receipt_no
  where id = v_pay.id;

  insert into public.payment_finalize_ledger (
    payment_id, reference_no, enrollment_id, status, receipt_id, receipt_no,
    allocated_amount, allocation, payment_label, schedule_after, amount_paid_after,
    enrollment_status_after, outcome
  ) values (
    v_pay.id, p_reference_no, v_enr.id, 'completed', v_receipt_id, v_receipt_no,
    v_allocated, v_lines, v_label, v_schedule, v_net, v_status, v_outcome
  );

  select * into v_receipt from public.payment_receipts where id = v_receipt_id;
  select * into v_enr from public.course_enrollments where id = v_enr.id;

  return jsonb_build_object(
    'ok', true,
    'outcome', v_outcome,
    'payment_id', v_pay.id,
    'enrollment_id', v_enr.id,
    'allocated_amount', v_allocated,
    'allocation', v_lines,
    'receipt', to_jsonb(v_receipt),
    'enrollment', jsonb_build_object(
      'id', v_enr.id,
      'schedule', v_enr.schedule,
      'amount_paid', v_enr.amount_paid,
      'status', v_enr.status,
      'total_fee', v_enr.total_fee,
      'phone', v_enr.phone,
      'student_name', v_enr.student_name,
      'email', v_enr.email,
      'course_title', v_enr.course_title,
      'course_slug', v_enr.course_slug,
      'batch_label', v_enr.batch_label,
      'plan_type', v_enr.plan_type,
      'discount_amount', v_enr.discount_amount
    )
  );
end;
$$;

revoke all on function public.finalize_course_payment(text) from public;
revoke all on function public.schedule_net_allocated(jsonb) from public;
revoke all on function public.schedule_line_remaining(jsonb) from public;
revoke all on function public.schedule_line_outstanding(jsonb) from public;
grant execute on function public.finalize_course_payment(text) to service_role;
grant execute on function public.schedule_net_allocated(jsonb) to service_role;
grant execute on function public.schedule_line_remaining(jsonb) to service_role;
grant execute on function public.schedule_line_outstanding(jsonb) to service_role;
