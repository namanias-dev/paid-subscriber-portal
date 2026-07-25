-- =====================================================================
-- Phase 1d — move `leads_paged` / `leads_paged_count` onto the promoted
-- columns added by 2026-07-24-leads-jsonb-slimming.sql.
--
-- Supersedes 2026-07-24-leads-paged-rpc.sql (kept as the rollback target).
--
-- THE PARAMETER SIGNATURE IS UNCHANGED. The deployed application keeps
-- calling these functions exactly as before, so this migration has no
-- dependency on deploy ordering — there is no window in which the
-- shipped code and the schema disagree. Only the bodies change, plus one
-- added output column (`is_legacy`).
--
-- WHAT CHANGED
-- ------------
--   legacy-only  : (attribution->>'legacy') = 'true'  ->  is_legacy
--   non-legacy   : three-arm OR over the JSONB        ->  not is_legacy
--   source tag   : (attribution->>'legacy_source_tab')->  legacy_source_tab
--   projection   : attribution->'first_touch'->>'..'  ->  campaign_clean
--
-- WHY THAT IS A SIMPLIFICATION AND NOT JUST A RENAME
-- --------------------------------------------------
-- The three-arm OR existed only because the JSONB expression is
-- three-valued: `(attribution->>'legacy') = 'true'` is NULL, not false,
-- when the key is absent, so neither `= 'true'` nor `<> 'true'`
-- partitions the table. Worse, its shape had to be spelled
-- character-identically to the partial index predicate or the planner
-- refused the index — 65,171 ms versus 285 ms on the same rows.
--
-- `is_legacy` is `boolean NOT NULL`, so `is_legacy` / `not is_legacy` is
-- a total, exact, two-valued partition and both arms are trivially
-- provable against the partial index predicates. The predicates are
-- still built as literal SQL text rather than CASE-wrapped over a
-- parameter — a CASE-wrapped predicate is opaque to the planner and
-- would fall back to a full scan.
--
-- MEASURED after the swap (warm, EXPLAIN ANALYZE, limit 50):
--   legacy page 1        0.119 ms   idx_leads_legacy_active_created_v2
--   keyset @ depth 150k  0.126 ms   idx_leads_legacy_active_created_v2
--   status filter        0.135 ms   idx_leads_legacy_status_created_v2
--   source tag           0.131 ms   idx_leads_legacy_tab_created_v2
--   consent              0.155 ms   idx_leads_consent_created
--   search '9876'        2.885 ms   legacy name+phone trigram (BitmapOr)
--   non-legacy page 1    0.113 ms   idx_leads_nonlegacy_active_created_v2
--
-- INJECTION SAFETY (unchanged): every caller-supplied value goes through
-- `format(..., %L)`. `p_include_legacy` is never interpolated — it is
-- compared against fixed strings and selects a hard-coded predicate.
-- `p_limit` / `p_offset` are integers, clamped.
--
-- Return type gains a column, so this is DROP + CREATE, not REPLACE.
-- Both run in one transaction, so the function is never missing.
-- =====================================================================

drop function if exists public.leads_paged(text,text,text,text,text,text,text,integer,timestamptz,text,integer);
drop function if exists public.leads_paged_count(text,text,text,text,text,text,text);

create function public.leads_paged(
  p_include_legacy      text        default 'exclude',   -- 'exclude' | 'include' | 'only'
  p_queue               text        default null,
  p_source_tag          text        default null,
  p_status              text        default null,
  p_assigned_to         text        default null,
  p_search              text        default null,
  p_consent_status      text        default null,
  p_limit               integer     default 50,
  p_cursor_created_at   timestamptz default null,
  p_cursor_id           text        default null,
  p_offset              integer     default 0
)
returns table (
  id                    text,
  name                  text,
  phone                 text,
  city                  text,
  state                 text,
  source                text,
  campaign              text,
  campaign_clean        text,
  legacy_source_tab     text,
  status                text,
  created_at            timestamptz,
  counsellor            text,
  assigned_to           text,
  worklist_queue        text,
  follow_up_at          timestamptz,
  last_worked_at        timestamptz,
  consent_status        text,
  dnd_status            text,
  last_contacted_at     timestamptz,
  contact_attempt_count integer,
  suppression_reason    text,
  cohort                text,
  is_legacy             boolean,
  legacy_call_status    text
)
language plpgsql
stable
security invoker
set search_path = public
as $fn$
declare
  v_where text := 'l.merged_into is null';
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_needle text;
begin
  if p_include_legacy = 'only' then
    v_where := v_where || ' and l.is_legacy';
  elsif p_include_legacy = 'exclude' then
    v_where := v_where || ' and not l.is_legacy';
  end if;

  if p_queue          is not null then v_where := v_where || format(' and l.worklist_queue = %L', p_queue); end if;
  if p_status         is not null then v_where := v_where || format(' and l.status = %L', p_status); end if;
  if p_assigned_to    is not null then v_where := v_where || format(' and l.assigned_to = %L', p_assigned_to); end if;
  if p_consent_status is not null then v_where := v_where || format(' and l.consent_status = %L', p_consent_status); end if;
  if p_source_tag     is not null then v_where := v_where || format(' and l.legacy_source_tab = %L', p_source_tag); end if;

  if p_search is not null and length(btrim(p_search)) > 0 then
    v_needle := '%' || btrim(p_search) || '%';
    v_where := v_where || format(' and (l.name ilike %L or l.phone ilike %L)', v_needle, v_needle);
  end if;

  -- Row-value comparison, not the OR form. Postgres compiles this into an
  -- Index Cond on the composite index and walks it in order; the
  -- logically identical `a < X or (a = X and b < Y)` cannot be turned
  -- into an ordered walk and cost 9,510 ms against 12.7 ms.
  if p_cursor_created_at is not null and p_cursor_id is not null then
    v_where := v_where || format(
      ' and (l.created_at, l.id) < (%L::timestamptz, %L::text)',
      p_cursor_created_at, p_cursor_id);
  end if;

  return query execute
       'select l.id, l.name, l.phone, l.city, l.state, l.source, l.campaign,'
    || '       l.campaign_clean, l.legacy_source_tab,'
    || '       l.status, l.created_at, l.counsellor, l.assigned_to, l.worklist_queue,'
    || '       l.follow_up_at, l.last_worked_at, l.consent_status, l.dnd_status,'
    || '       l.last_contacted_at, l.contact_attempt_count, l.suppression_reason,'
    || '       l.cohort, l.is_legacy, l.legacy_call_status'
    || '  from public.leads l'
    || ' where ' || v_where
    || ' order by l.created_at desc, l.id desc'
    || ' limit ' || v_limit || ' offset ' || v_offset;
end;
$fn$;

-- Exact count for the same filter set. Separate function so the page read
-- never pays for a count it was not asked for.
create function public.leads_paged_count(
  p_include_legacy text default 'exclude',
  p_queue          text default null,
  p_source_tag     text default null,
  p_status         text default null,
  p_assigned_to    text default null,
  p_search         text default null,
  p_consent_status text default null
)
returns bigint
language plpgsql
stable
security invoker
set search_path = public
as $fn$
declare
  v_where text := 'l.merged_into is null';
  v_needle text;
  v_count bigint;
begin
  if p_include_legacy = 'only' then
    v_where := v_where || ' and l.is_legacy';
  elsif p_include_legacy = 'exclude' then
    v_where := v_where || ' and not l.is_legacy';
  end if;

  if p_queue          is not null then v_where := v_where || format(' and l.worklist_queue = %L', p_queue); end if;
  if p_status         is not null then v_where := v_where || format(' and l.status = %L', p_status); end if;
  if p_assigned_to    is not null then v_where := v_where || format(' and l.assigned_to = %L', p_assigned_to); end if;
  if p_consent_status is not null then v_where := v_where || format(' and l.consent_status = %L', p_consent_status); end if;
  if p_source_tag     is not null then v_where := v_where || format(' and l.legacy_source_tab = %L', p_source_tag); end if;

  if p_search is not null and length(btrim(p_search)) > 0 then
    v_needle := '%' || btrim(p_search) || '%';
    v_where := v_where || format(' and (l.name ilike %L or l.phone ilike %L)', v_needle, v_needle);
  end if;

  execute 'select count(*) from public.leads l where ' || v_where into v_count;
  return v_count;
end;
$fn$;

-- The worklist is admin-only and the app reaches Postgres with the service
-- role. Nothing anonymous should be able to page 178k phone numbers.
revoke all on function public.leads_paged(text,text,text,text,text,text,text,integer,timestamptz,text,integer) from public, anon, authenticated;
revoke all on function public.leads_paged_count(text,text,text,text,text,text,text) from public, anon, authenticated;
grant execute on function public.leads_paged(text,text,text,text,text,text,text,integer,timestamptz,text,integer) to service_role;
grant execute on function public.leads_paged_count(text,text,text,text,text,text,text) to service_role;

-- ROLLBACK: re-apply 2026-07-24-leads-paged-rpc.sql verbatim (it is a
-- self-contained CREATE OR REPLACE + GRANT pair). Do that BEFORE dropping
-- the promoted columns.
