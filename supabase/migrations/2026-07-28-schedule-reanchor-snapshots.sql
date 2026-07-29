-- Schedule re-anchor snapshots + atomic apply/revert (amounts never change).
create table if not exists public.schedule_reanchor_snapshots (
  id uuid primary key default gen_random_uuid(),
  enrollment_id text not null references public.course_enrollments(id),
  phone text not null,
  course_id text not null,
  batch_start text,
  reason text not null,
  actor text not null default 'System · re-anchor',
  schedule_before jsonb not null,
  schedule_after jsonb not null,
  lines jsonb not null default '[]'::jsonb,
  rupees_moved_out_of_month integer not null default 0,
  reverted_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists schedule_reanchor_snapshots_enr_idx
  on public.schedule_reanchor_snapshots (enrollment_id, created_at desc);
create index if not exists schedule_reanchor_snapshots_phone_idx
  on public.schedule_reanchor_snapshots (phone, created_at desc);

alter table public.schedule_reanchor_snapshots enable row level security;

create or replace function public.apply_schedule_reanchor(
  p_enrollment_id text,
  p_new_schedule jsonb,
  p_expected_amount_paid integer,
  p_batch_start text,
  p_reason text,
  p_actor text,
  p_lines jsonb,
  p_rupees_moved integer default 0
) returns uuid
language plpgsql
as $$
declare
  src public.course_enrollments%rowtype;
  snap_id uuid := gen_random_uuid();
  paid_before integer;
  paid_after integer;
  amt_before integer;
  amt_after integer;
begin
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 're-anchor requires a reason';
  end if;

  select * into src from public.course_enrollments where id = p_enrollment_id for update;
  if not found then
    raise exception 'enrollment % not found', p_enrollment_id;
  end if;
  if src.amount_paid is distinct from p_expected_amount_paid then
    raise exception 'amount_paid changed while re-anchor was reviewed';
  end if;

  select coalesce(sum((line->>'amount')::integer), 0) into amt_before
    from jsonb_array_elements(coalesce(src.schedule, '[]'::jsonb)) line;
  select coalesce(sum((line->>'amount')::integer), 0) into amt_after
    from jsonb_array_elements(p_new_schedule) line;
  if amt_before is distinct from amt_after then
    raise exception 'amount drift refused: % → %', amt_before, amt_after;
  end if;

  select coalesce(sum((line->>'amount')::integer), 0) into paid_before
    from jsonb_array_elements(coalesce(src.schedule, '[]'::jsonb)) line
   where coalesce((line->>'paid')::boolean, false);
  select coalesce(sum((line->>'amount')::integer), 0) into paid_after
    from jsonb_array_elements(p_new_schedule) line
   where coalesce((line->>'paid')::boolean, false);
  if paid_before is distinct from paid_after then
    raise exception 'paid-line amount drift refused';
  end if;

  insert into public.schedule_reanchor_snapshots (
    id, enrollment_id, phone, course_id, batch_start, reason, actor,
    schedule_before, schedule_after, lines, rupees_moved_out_of_month
  ) values (
    snap_id, p_enrollment_id, src.phone, src.course_id, p_batch_start, p_reason,
    coalesce(nullif(btrim(p_actor), ''), 'System · re-anchor'),
    coalesce(src.schedule, '[]'::jsonb), p_new_schedule, coalesce(p_lines, '[]'::jsonb),
    coalesce(p_rupees_moved, 0)
  );

  update public.course_enrollments
     set schedule = p_new_schedule,
         payment_plan_changed_at = now(),
         payment_plan_changed_by = coalesce(nullif(btrim(p_actor), ''), 'System · re-anchor'),
         payment_plan_change_reason = 'Schedule re-anchor: ' || p_reason,
         updated_at = now()
   where id = p_enrollment_id;

  return snap_id;
end;
$$;

create or replace function public.revert_schedule_reanchor(
  p_snapshot_id uuid,
  p_actor text default 'System · re-anchor revert'
) returns text
language plpgsql
as $$
declare
  snap public.schedule_reanchor_snapshots%rowtype;
  src public.course_enrollments%rowtype;
begin
  select * into snap from public.schedule_reanchor_snapshots where id = p_snapshot_id for update;
  if not found then
    raise exception 'snapshot % not found', p_snapshot_id;
  end if;
  if snap.reverted_at is not null then
    raise exception 'snapshot % already reverted', p_snapshot_id;
  end if;

  select * into src from public.course_enrollments where id = snap.enrollment_id for update;
  if not found then
    raise exception 'enrollment % not found', snap.enrollment_id;
  end if;

  update public.course_enrollments
     set schedule = snap.schedule_before,
         payment_plan_changed_at = now(),
         payment_plan_changed_by = coalesce(nullif(btrim(p_actor), ''), 'System · re-anchor revert'),
         payment_plan_change_reason = 'Schedule re-anchor reverted',
         updated_at = now()
   where id = snap.enrollment_id;

  update public.schedule_reanchor_snapshots
     set reverted_at = now()
   where id = p_snapshot_id;

  return snap.enrollment_id;
end;
$$;
