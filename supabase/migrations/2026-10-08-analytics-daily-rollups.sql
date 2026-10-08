-- Daily analytics rollups for Growth Intelligence and Campaign Links.
-- Additive and idempotent. Dashboards sum these rows instead of scanning
-- analytics_events / payments / orders on every page load.
-- A completed day is replaced only when refresh_analytics_day() is called
-- (today and yesterday on the cron; older days stay frozen after backfill).

create table if not exists public.analytics_touch_daily (
  rollup_date date not null,
  touch text not null,
  exclude_staff boolean not null default false,
  source text not null,
  visitors integer not null default 0,
  registrations integer not null default 0,
  paid_students integer not null default 0,
  revenue numeric not null default 0,
  updated_at timestamptz not null default now(),
  constraint analytics_touch_daily_pkey primary key (rollup_date, touch, exclude_staff, source),
  constraint analytics_touch_daily_touch_chk check (touch in ('first', 'last'))
);

create index if not exists idx_analytics_touch_daily_date
  on public.analytics_touch_daily (rollup_date);

create table if not exists public.campaign_link_daily (
  rollup_date date not null,
  short_code text not null,
  clicks integer not null default 0,
  product_views integer not null default 0,
  add_to_cart_events integer not null default 0,
  registrations integer not null default 0,
  leads integer not null default 0,
  orders_created integer not null default 0,
  paid_orders integer not null default 0,
  units integer not null default 0,
  revenue_paise bigint not null default 0,
  paid_admissions integer not null default 0,
  paid_webinars integer not null default 0,
  admissions_revenue numeric not null default 0,
  updated_at timestamptz not null default now(),
  constraint campaign_link_daily_pkey primary key (rollup_date, short_code)
);

create index if not exists idx_campaign_link_daily_code_date
  on public.campaign_link_daily (short_code, rollup_date);

-- One row per visitor per link per day. Window uniques are count(distinct),
-- which stays cheap because only campaign-attributed visitors are stored.
create table if not exists public.campaign_link_visitor_days (
  rollup_date date not null,
  short_code text not null,
  visitor_key text not null,
  added_cart boolean not null default false,
  started_checkout boolean not null default false,
  constraint campaign_link_visitor_days_pkey primary key (rollup_date, short_code, visitor_key)
);

create index if not exists idx_cl_visitor_days_date
  on public.campaign_link_visitor_days (rollup_date);

create table if not exists public.analytics_rollup_meta (
  rollup_date date primary key,
  updated_at timestamptz not null default now()
);

alter table public.analytics_touch_daily enable row level security;
alter table public.campaign_link_daily enable row level security;
alter table public.campaign_link_visitor_days enable row level security;
alter table public.analytics_rollup_meta enable row level security;

revoke all on public.analytics_touch_daily from public, anon, authenticated;
revoke all on public.campaign_link_daily from public, anon, authenticated;
revoke all on public.campaign_link_visitor_days from public, anon, authenticated;
revoke all on public.analytics_rollup_meta from public, anon, authenticated;

create or replace function public.refresh_analytics_day(p_day date)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  p_start timestamptz;
  p_end timestamptz;
  excl boolean;
begin
  if p_day is null then
    return;
  end if;
  p_start := (p_day::timestamp at time zone 'Asia/Kolkata');
  p_end := ((p_day + 1)::timestamp at time zone 'Asia/Kolkata');

  delete from public.analytics_touch_daily where rollup_date = p_day;
  delete from public.campaign_link_daily where rollup_date = p_day;
  delete from public.campaign_link_visitor_days where rollup_date = p_day;

  -- Growth: visitors + registrations by first and last touch, with and without staff phones.
  foreach excl in array array[false, true]
  loop
    insert into public.analytics_touch_daily (rollup_date, touch, exclude_staff, source, visitors, registrations)
    select p_day, 'first', excl, source, count(distinct visitor_id), count(*) filter (where event_name = 'registration_created')
    from (
      select
        lower(coalesce(attribution->'first_touch'->>'source', attribution->'last_touch'->>'source', 'untracked')) as source,
        visitor_id,
        event_name,
        phone
      from public.analytics_events
      where occurred_at >= p_start and occurred_at < p_end and coalesce(is_bot, false) = false
    ) e
    where not excl
       or phone is null
       or right(regexp_replace(phone, '\D', '', 'g'), 10) not in (
         select right(regexp_replace(au.phone, '\D', '', 'g'), 10)
         from public.admin_users au
         where au.phone is not null and length(regexp_replace(au.phone, '\D', '', 'g')) >= 10
       )
    group by source;

    insert into public.analytics_touch_daily (rollup_date, touch, exclude_staff, source, visitors, registrations)
    select p_day, 'last', excl, source, count(distinct visitor_id), count(*) filter (where event_name = 'registration_created')
    from (
      select
        lower(coalesce(attribution->'last_touch'->>'source', attribution->'first_touch'->>'source', 'untracked')) as source,
        visitor_id,
        event_name,
        phone
      from public.analytics_events
      where occurred_at >= p_start and occurred_at < p_end and coalesce(is_bot, false) = false
    ) e
    where not excl
       or phone is null
       or right(regexp_replace(phone, '\D', '', 'g'), 10) not in (
         select right(regexp_replace(au.phone, '\D', '', 'g'), 10)
         from public.admin_users au
         where au.phone is not null and length(regexp_replace(au.phone, '\D', '', 'g')) >= 10
       )
    group by source
    on conflict (rollup_date, touch, exclude_staff, source) do update
      set visitors = excluded.visitors,
          registrations = excluded.registrations,
          updated_at = now();

    -- Paid students + revenue. Retries with the same phone/item/kind/installment/amount count once.
    insert into public.analytics_touch_daily (rollup_date, touch, exclude_staff, source, paid_students, revenue)
    select p_day, t.touch, excl, t.source, count(distinct t.payer), sum(t.amount)
    from (
      select
        touch,
        source,
        payer,
        amount
      from (
        select distinct on (
          coalesce(p.phone_key, ''),
          lower(coalesce(p.item_slug, p.item, '')),
          coalesce(p.payment_kind, ''),
          coalesce(p.installment_no, -1),
          p.amount
        )
          p.amount,
          coalesce(nullif(p.phone_key, ''), p.id::text) as payer,
          case
            when lower(coalesce(p.gateway, '')) in ('offline', 'admin', 'manual') then 'admin'
            else lower(coalesce(nullif(b.first_touch->>'source', ''), nullif(p.attribution_source, ''), 'untracked'))
          end as first_source,
          case
            when lower(coalesce(p.gateway, '')) in ('offline', 'admin', 'manual') then 'admin'
            else lower(coalesce(nullif(p.attribution_source, ''), nullif(b.last_touch->>'source', ''), nullif(b.first_touch->>'source', ''), 'untracked'))
          end as last_source,
          p.phone_key
        from public.payments p
        left join public.buyers b
          on right(regexp_replace(coalesce(b.phone, ''), '\D', '', 'g'), 10) = p.phone_key
         and length(coalesce(p.phone_key, '')) >= 10
        where p.deleted_at is null
          and p.status in ('PAID', 'captured')
          and p.created_at >= p_start and p.created_at < p_end
          and (
            not excl
            or p.phone_key is null
            or p.phone_key not in (
              select right(regexp_replace(au.phone, '\D', '', 'g'), 10)
              from public.admin_users au
              where au.phone is not null and length(regexp_replace(au.phone, '\D', '', 'g')) >= 10
            )
          )
        order by
          coalesce(p.phone_key, ''),
          lower(coalesce(p.item_slug, p.item, '')),
          coalesce(p.payment_kind, ''),
          coalesce(p.installment_no, -1),
          p.amount,
          p.created_at asc
      ) deduped
      cross join lateral (values ('first', first_source), ('last', last_source)) as src(touch, source)
    ) t
    group by t.touch, t.source
    on conflict (rollup_date, touch, exclude_staff, source) do update
      set paid_students = excluded.paid_students,
          revenue = excluded.revenue,
          updated_at = now();
  end loop;

  -- Campaign link clicks.
  insert into public.campaign_link_daily (rollup_date, short_code, clicks)
  select p_day, lower(short_code), count(*)
  from public.campaign_link_clicks
  where occurred_at >= p_start and occurred_at < p_end and coalesce(is_bot, false) = false
    and short_code is not null and short_code <> ''
  group by lower(short_code)
  on conflict (rollup_date, short_code) do update
    set clicks = excluded.clicks, updated_at = now();

  -- Campaign behaviour from events that carry a clid (first touch, else last).
  insert into public.campaign_link_daily (
    rollup_date, short_code, product_views, add_to_cart_events, registrations
  )
  select
    p_day,
    code,
    count(*) filter (where event_name = 'notes_product_viewed'),
    count(*) filter (where event_name in ('notes_added_to_cart', 'notes_add_to_cart')),
    count(*) filter (where event_name = 'registration_created')
  from (
    select
      lower(coalesce(nullif(attribution->'first_touch'->>'clid', ''), nullif(attribution->'last_touch'->>'clid', ''))) as code,
      event_name
    from public.analytics_events
    where occurred_at >= p_start and occurred_at < p_end and coalesce(is_bot, false) = false
  ) e
  where code is not null and code <> ''
  group by code
  on conflict (rollup_date, short_code) do update
    set product_views = excluded.product_views,
        add_to_cart_events = excluded.add_to_cart_events,
        registrations = excluded.registrations,
        updated_at = now();

  -- Visitor-day presence for window-level uniques (clicks + any clid event).
  insert into public.campaign_link_visitor_days (rollup_date, short_code, visitor_key, added_cart, started_checkout)
  select p_day, code, visitor_key, bool_or(added_cart), bool_or(started_checkout)
  from (
    select lower(short_code) as code, visitor_id as visitor_key, false as added_cart, false as started_checkout
    from public.campaign_link_clicks
    where occurred_at >= p_start and occurred_at < p_end and coalesce(is_bot, false) = false
      and visitor_id is not null and short_code is not null
    union all
    select
      lower(coalesce(nullif(attribution->'first_touch'->>'clid', ''), nullif(attribution->'last_touch'->>'clid', ''))),
      visitor_id,
      event_name in ('notes_added_to_cart', 'notes_add_to_cart'),
      event_name = 'notes_checkout_started'
    from public.analytics_events
    where occurred_at >= p_start and occurred_at < p_end and coalesce(is_bot, false) = false
      and visitor_id is not null
  ) v
  where code is not null and code <> '' and visitor_key is not null and visitor_key <> ''
  group by code, visitor_key
  on conflict (rollup_date, short_code, visitor_key) do update
    set added_cart = public.campaign_link_visitor_days.added_cart or excluded.added_cart,
        started_checkout = public.campaign_link_visitor_days.started_checkout or excluded.started_checkout;

  -- Notes paid orders. paid_at is the authority; pending/failed/cancelled/refunded are excluded.
  insert into public.campaign_link_daily (rollup_date, short_code, paid_orders, units, revenue_paise)
  select p_day, o.code, count(*), coalesce(sum(i.units), 0), coalesce(sum(o.revenue_paise), 0)
  from (
    select
      id,
      lower(coalesce(nullif(attribution_json->'first_touch'->>'clid', ''), nullif(attribution_json->'last_touch'->>'clid', ''))) as code,
      coalesce(amount_paid_paise, 0) as revenue_paise
    from public.store_orders
    where paid_at >= p_start and paid_at < p_end
      and paid_at is not null
      and status not in (
        'PAYMENT_PENDING', 'PAYMENT_FAILED', 'PAYMENT_EXPIRED',
        'CANCELLED', 'CANCEL_REQUESTED', 'REFUNDED', 'PARTIALLY_REFUNDED'
      )
  ) o
  left join (
    select order_id, sum(coalesce(qty, 0)) as units
    from public.store_order_items
    where order_id in (
      select id from public.store_orders
      where paid_at >= p_start and paid_at < p_end and paid_at is not null
    )
    group by order_id
  ) i on i.order_id = o.id
  where o.code is not null and o.code <> ''
  group by o.code
  on conflict (rollup_date, short_code) do update
    set paid_orders = excluded.paid_orders,
        units = excluded.units,
        revenue_paise = excluded.revenue_paise,
        updated_at = now();

  -- Orders created (secondary), same clid rule, any non-pending status that day by created_at.
  insert into public.campaign_link_daily (rollup_date, short_code, orders_created)
  select p_day, code, count(*)
  from (
    select lower(coalesce(nullif(attribution_json->'first_touch'->>'clid', ''), nullif(attribution_json->'last_touch'->>'clid', ''))) as code
    from public.store_orders
    where created_at >= p_start and created_at < p_end
  ) o
  where code is not null and code <> ''
  group by code
  on conflict (rollup_date, short_code) do update
    set orders_created = excluded.orders_created, updated_at = now();

  -- Leads whose buyer already carries this clid.
  insert into public.campaign_link_daily (rollup_date, short_code, leads)
  select p_day, code, count(*)
  from (
    select lower(coalesce(nullif(b.first_touch->>'clid', ''), nullif(b.last_touch->>'clid', ''))) as code
    from public.leads l
    join public.buyers b
      on right(regexp_replace(coalesce(b.phone, ''), '\D', '', 'g'), 10) = l.phone_key
     and length(coalesce(l.phone_key, '')) >= 10
    where l.created_at >= p_start and l.created_at < p_end
  ) x
  where code is not null and code <> ''
  group by code
  on conflict (rollup_date, short_code) do update
    set leads = excluded.leads, updated_at = now();

  -- Admissions / paid webinars. Same retry dedupe as growth, attributed by buyer clid.
  insert into public.campaign_link_daily (rollup_date, short_code, paid_admissions, paid_webinars, admissions_revenue)
  select
    p_day,
    code,
    count(distinct payer) filter (where item_type = 'course'),
    count(distinct payer) filter (where item_type = 'webinar'),
    coalesce(sum(amount), 0)
  from (
    select distinct on (
      coalesce(p.phone_key, ''),
      lower(coalesce(p.item_slug, p.item, '')),
      coalesce(p.payment_kind, ''),
      coalesce(p.installment_no, -1),
      p.amount
    )
      lower(coalesce(nullif(b.first_touch->>'clid', ''), nullif(b.last_touch->>'clid', ''))) as code,
      coalesce(nullif(p.phone_key, ''), p.id::text) as payer,
      p.item_type,
      p.amount
    from public.payments p
    join public.buyers b
      on right(regexp_replace(coalesce(b.phone, ''), '\D', '', 'g'), 10) = p.phone_key
     and length(coalesce(p.phone_key, '')) >= 10
    where p.deleted_at is null
      and p.status in ('PAID', 'captured')
      and p.created_at >= p_start and p.created_at < p_end
    order by
      coalesce(p.phone_key, ''),
      lower(coalesce(p.item_slug, p.item, '')),
      coalesce(p.payment_kind, ''),
      coalesce(p.installment_no, -1),
      p.amount,
      p.created_at asc
  ) d
  where code is not null and code <> ''
  group by code
  on conflict (rollup_date, short_code) do update
    set paid_admissions = excluded.paid_admissions,
        paid_webinars = excluded.paid_webinars,
        admissions_revenue = excluded.admissions_revenue,
        updated_at = now();

  insert into public.analytics_rollup_meta (rollup_date, updated_at)
  values (p_day, now())
  on conflict (rollup_date) do update set updated_at = excluded.updated_at;
end;
$$;

create or replace function public.refresh_analytics_rollups(p_from date, p_to date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  d date;
  n integer := 0;
  started timestamptz := clock_timestamp();
begin
  if p_from is null or p_to is null or p_to < p_from or (p_to - p_from) > 120 then
    return jsonb_build_object('ok', false, 'reason', 'range');
  end if;
  d := p_from;
  while d <= p_to loop
    perform public.refresh_analytics_day(d);
    n := n + 1;
    d := d + 1;
  end loop;
  return jsonb_build_object('ok', true, 'days', n, 'ms', (extract(epoch from clock_timestamp() - started) * 1000)::int);
end;
$$;

create or replace function public.campaign_link_window(p_from date, p_to date)
returns table (
  short_code text,
  clicks integer,
  product_views integer,
  add_to_cart_events integer,
  add_to_cart_users integer,
  checkout_users integer,
  visitors integer,
  registrations integer,
  leads integer,
  orders_created integer,
  paid_orders integer,
  units integer,
  revenue_paise bigint,
  paid_admissions integer,
  paid_webinars integer,
  admissions_revenue numeric,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  with daily as (
    select
      d.short_code,
      sum(d.clicks)::integer as clicks,
      sum(d.product_views)::integer as product_views,
      sum(d.add_to_cart_events)::integer as add_to_cart_events,
      sum(d.registrations)::integer as registrations,
      sum(d.leads)::integer as leads,
      sum(d.orders_created)::integer as orders_created,
      sum(d.paid_orders)::integer as paid_orders,
      sum(d.units)::integer as units,
      sum(d.revenue_paise)::bigint as revenue_paise,
      sum(d.paid_admissions)::integer as paid_admissions,
      sum(d.paid_webinars)::integer as paid_webinars,
      sum(d.admissions_revenue) as admissions_revenue,
      max(d.updated_at) as updated_at
    from public.campaign_link_daily d
    where d.rollup_date between p_from and p_to
    group by d.short_code
  ),
  uniq as (
    select
      v.short_code,
      count(distinct v.visitor_key)::integer as visitors,
      count(distinct v.visitor_key) filter (where v.added_cart)::integer as add_to_cart_users,
      count(distinct v.visitor_key) filter (where v.started_checkout)::integer as checkout_users
    from public.campaign_link_visitor_days v
    where v.rollup_date between p_from and p_to
    group by v.short_code
  )
  select
    coalesce(daily.short_code, uniq.short_code),
    coalesce(daily.clicks, 0),
    coalesce(daily.product_views, 0),
    coalesce(daily.add_to_cart_events, 0),
    coalesce(uniq.add_to_cart_users, 0),
    coalesce(uniq.checkout_users, 0),
    coalesce(uniq.visitors, 0),
    coalesce(daily.registrations, 0),
    coalesce(daily.leads, 0),
    coalesce(daily.orders_created, 0),
    coalesce(daily.paid_orders, 0),
    coalesce(daily.units, 0),
    coalesce(daily.revenue_paise, 0),
    coalesce(daily.paid_admissions, 0),
    coalesce(daily.paid_webinars, 0),
    coalesce(daily.admissions_revenue, 0),
    daily.updated_at
  from daily
  full join uniq on uniq.short_code = daily.short_code;
$$;

create or replace function public.growth_touch_window(
  p_from date,
  p_to date,
  p_touch text,
  p_exclude_staff boolean
)
returns table (
  source text,
  visitors integer,
  registrations integer,
  paid_students integer,
  revenue numeric,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    source,
    sum(visitors)::integer,
    sum(registrations)::integer,
    sum(paid_students)::integer,
    sum(revenue),
    max(updated_at)
  from public.analytics_touch_daily
  where rollup_date between p_from and p_to
    and touch = p_touch
    and exclude_staff = p_exclude_staff
  group by source;
$$;

revoke all on function public.refresh_analytics_day(date) from public;
revoke all on function public.refresh_analytics_rollups(date, date) from public;
revoke all on function public.campaign_link_window(date, date) from public;
revoke all on function public.growth_touch_window(date, date, text, boolean) from public;
grant execute on function public.refresh_analytics_day(date) to service_role;
grant execute on function public.refresh_analytics_rollups(date, date) to service_role;
grant execute on function public.campaign_link_window(date, date) to service_role;
grant execute on function public.growth_touch_window(date, date, text, boolean) to service_role;
