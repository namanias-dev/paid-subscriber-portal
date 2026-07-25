-- =====================================================================
-- PHASE 2 — extend `leads_paged` / `leads_paged_count` into the full
-- server-side worklist reader.
--
-- Supersedes 2026-07-24-leads-paged-rpc-typed-columns.sql (the rollback
-- target). This EXTENDS the existing pair rather than adding a parallel
-- path, so there is exactly one filtered-read implementation to reason
-- about, audit, and keep indexed.
--
-- NO DEPLOY-ORDER DEPENDENCY
-- --------------------------
-- Every new parameter has a DEFAULT that reproduces the previous
-- behaviour exactly (`p_sort='created_at'`, `p_dir='desc'`, all new
-- filters NULL). The currently deployed application calls this function
-- with the old argument set and gets byte-identical results, so the
-- migration can land before, during, or after the deploy.
--
-- WHAT PHASE 2 ADDS
-- -----------------
--   sort         : created_at | name | follow_up_at | last_contacted_at,
--                  each direction, each on a matching index
--   filters      : work_status, assigned/unassigned, contacted/never,
--                  created-date range
--   search       : phone needle is DIGIT-NORMALISED before matching
--   projection   : legacy_call_status_raw (verbatim), work_status trio,
--                  import_batch, first_seen_at, promoted_at
--
-- =====================================================================
-- FOUR INVARIANTS THIS FUNCTION MUST NEVER LOSE
-- =====================================================================
--
-- 1. COMPOUND ROW-VALUE CURSOR, NEVER THE OR-FORM.
--    `(k, id) < (:k, :id)` compiles to an Index Cond and an ordered
--    walk. The logically identical `k < :k or (k = :k and id < :id)`
--    does not, and measured 9,510 ms against 12.7 ms. 856 `created_at`
--    values are shared by 2+ active rows and one is shared by 168, so
--    the id tiebreaker is not optional — without it a tie group
--    straddling a page boundary silently loses every row after the
--    first, which looks exactly like a working paginator.
--
-- 2. THE SORT KEY MUST BE NON-NULL.
--    A row-value comparison with a NULL on the left evaluates to NULL,
--    not false, so the row is dropped. `follow_up_at` and
--    `last_contacted_at` are NULL on 100% of legacy rows today.
--    MEASURED on a 500-row slice: the naive nullable cursor matched 0
--    rows; the coalesced form matched all 500. Sorting by follow-up
--    would have returned an empty page and read as "no results".
--    Hence coalesce(..., '-infinity') here AND in the matching index.
--
-- 3. UNIFORM SORT DIRECTION ACROSS BOTH CURSOR COMPONENTS.
--    `ORDER BY k <dir>, id <dir>` with `(k, id) <op> (:k, :id)` where
--    op is '<' for desc and '>' for asc. A mixed-direction ORDER BY
--    cannot be expressed as a single row-value comparison at all, and a
--    mixed-direction index cannot serve one.
--
-- 4. NEVER PROJECT THE `attribution` JSONB ON A LIST PATH.
--    Bulk-selecting it cost 13.2 s in deTOAST alone. Every column below
--    is an explicit scalar. `attribution.first_touch` is read ONLY on
--    the single-lead detail path, from the `lead_legacy_touches` side
--    table.
--
-- INJECTION SAFETY: every caller-supplied VALUE goes through
-- `format(..., %L)`. Every caller-supplied IDENTIFIER (`p_sort`,
-- `p_dir`) is mapped through a hard-coded whitelist and never
-- interpolated. `p_include_legacy` is compared against fixed strings
-- and selects a literal predicate. `p_limit`/`p_offset` are clamped
-- integers.
--
-- Return type gains columns, so this is DROP + CREATE. Both statements
-- run in one transaction, so the function is never missing.
-- =====================================================================

drop function if exists public.leads_paged(text,text,text,text,text,text,text,integer,timestamptz,text,integer);
drop function if exists public.leads_paged_count(text,text,text,text,text,text,text);

-- ---------------------------------------------------------------------
-- Shared predicate builder. ONE definition of "what this filter set
-- means", used by both the page read and the count, so the two can
-- never disagree and show "Showing 1–50 of 0".
-- ---------------------------------------------------------------------
create or replace function public._leads_worklist_where(
  p_include_legacy text,
  p_queue          text,
  p_source_tag     text,
  p_status         text,
  p_assigned_to    text,
  p_search         text,
  p_consent_status text,
  p_work_status    text,
  p_assigned_mode  text,
  p_contacted      text,
  p_created_from   timestamptz,
  p_created_to     timestamptz
) returns text
language plpgsql
immutable
security invoker
set search_path = public
as $fn$
declare
  v_where  text := 'l.merged_into is null';
  v_needle text;
  v_digits text;
begin
  -- `is_legacy` is boolean NOT NULL, so these two arms are a total, exact
  -- partition and both are trivially provable against the partial indexes.
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
  if p_work_status    is not null then v_where := v_where || format(' and l.work_status = %L', p_work_status); end if;

  -- Assignment scope. 'unassigned' matches the partial index
  -- idx_leads_legacy_unassigned_created; today that is 100% of legacy rows,
  -- and after Phase 3 bulk assignment it becomes the selective residue.
  if p_assigned_mode = 'unassigned' then
    v_where := v_where || ' and l.assigned_to is null';
  elsif p_assigned_mode = 'assigned' then
    v_where := v_where || ' and l.assigned_to is not null';
  end if;

  if p_contacted = 'yes' then
    v_where := v_where || ' and l.last_contacted_at is not null';
  elsif p_contacted = 'no' then
    v_where := v_where || ' and l.last_contacted_at is null';
  end if;

  if p_created_from is not null then v_where := v_where || format(' and l.created_at >= %L::timestamptz', p_created_from); end if;
  if p_created_to   is not null then v_where := v_where || format(' and l.created_at <  %L::timestamptz', p_created_to);   end if;

  -- SEARCH — the needle is normalised, never the column.
  -- All 179,209 active phones are stored as bare 10 digits (verified: 178,183
  -- legacy + 1,026 live, zero exceptions), so the STORED form is already the
  -- normalised form. Normalising the column with an expression would throw
  -- away the existing trigram indexes for no gain; normalising the NEEDLE
  -- means "+91 98765 43210", "098765-43210" and "9876543210" all reach the
  -- same indexed match. Mirrors normalizeIndianMobile() in lib/phone.ts.
  if p_search is not null and length(btrim(p_search)) > 0 then
    v_needle := btrim(p_search);
    v_digits := regexp_replace(v_needle, '\D', '', 'g');

    -- Strip the country/trunk prefixes normalizeIndianMobile() strips.
    if length(v_digits) = 12 and left(v_digits, 2) = '91' then v_digits := substr(v_digits, 3);
    elsif length(v_digits) = 11 and left(v_digits, 1) = '0' then v_digits := substr(v_digits, 2);
    elsif length(v_digits) = 13 and left(v_digits, 3) = '091' then v_digits := substr(v_digits, 4);
    end if;

    if length(v_digits) >= 3 then
      -- Digit needle: match phone on the normalised digits, and still allow a
      -- name hit so searching a numeric-containing name keeps working.
      v_where := v_where || format(
        ' and (l.phone like %L or l.name ilike %L)',
        '%' || v_digits || '%', '%' || v_needle || '%');
    else
      v_where := v_where || format(' and l.name ilike %L', '%' || v_needle || '%');
    end if;
  end if;

  return v_where;
end;
$fn$;


-- ---------------------------------------------------------------------
-- Sort whitelist. Returns the SQL expression for a sort key, or raises.
-- A caller-supplied identifier NEVER reaches the query text.
-- ---------------------------------------------------------------------
create or replace function public._leads_worklist_sort_expr(p_sort text)
returns text
language plpgsql
immutable
security invoker
set search_path = public
as $fn$
begin
  return case coalesce(p_sort, 'created_at')
    when 'created_at'        then 'l.created_at'
    when 'name'              then 'l.name'
    -- coalesce is REQUIRED: see invariant 2 in the file header. Must stay
    -- character-identical to idx_leads_legacy_followup_sort /
    -- idx_leads_legacy_lastcontact_sort or the index stops being chosen.
    when 'follow_up_at'      then 'coalesce(l.follow_up_at, ''-infinity''::timestamptz)'
    when 'last_contacted_at' then 'coalesce(l.last_contacted_at, ''-infinity''::timestamptz)'
    else null
  end;
end;
$fn$;


-- ---------------------------------------------------------------------
-- The page read.
-- ---------------------------------------------------------------------
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
  p_offset              integer     default 0,
  -- Phase 2 additions. Defaults reproduce the pre-Phase-2 behaviour byte
  -- for byte, so the deployed app keeps working unchanged.
  p_work_status         text        default null,
  p_assigned_mode       text        default null,        -- 'assigned' | 'unassigned'
  p_contacted           text        default null,        -- 'yes' | 'no'
  p_created_from        timestamptz default null,
  p_created_to          timestamptz default null,
  p_sort                text        default 'created_at',
  p_dir                 text        default 'desc',      -- 'asc' | 'desc'
  p_cursor_sort_value   text        default null
)
returns table (
  id                     text,
  name                   text,
  phone                  text,
  city                   text,
  state                  text,
  source                 text,
  campaign               text,
  campaign_clean         text,
  legacy_source_tab      text,
  status                 text,
  created_at             timestamptz,
  counsellor             text,
  assigned_to            text,
  worklist_queue         text,
  follow_up_at           timestamptz,
  last_worked_at         timestamptz,
  consent_status         text,
  dnd_status             text,
  last_contacted_at      timestamptz,
  contact_attempt_count  integer,
  suppression_reason     text,
  cohort                 text,
  is_legacy              boolean,
  legacy_call_status     text,
  -- Phase 2 projection. All explicit scalars — the `attribution` JSONB is
  -- deliberately absent (invariant 4).
  legacy_call_status_raw text,
  work_status            text,
  work_status_at         timestamptz,
  work_status_by         text,
  import_batch           text,
  first_seen_at          timestamptz,
  promoted_at            timestamptz
)
language plpgsql
stable
security invoker
set search_path = public
as $fn$
declare
  v_where  text;
  v_limit  integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_sort   text;
  v_dir    text;
  v_op     text;
  v_cursor text;
  v_castto text;
begin
  v_sort := public._leads_worklist_sort_expr(p_sort);
  if v_sort is null then
    raise exception 'leads_paged: unsupported sort key %', p_sort
      using hint = 'allowed: created_at, name, follow_up_at, last_contacted_at';
  end if;

  -- Whitelist, never interpolate.
  v_dir := case lower(coalesce(p_dir, 'desc')) when 'asc' then 'asc' when 'desc' then 'desc' else null end;
  if v_dir is null then
    raise exception 'leads_paged: unsupported sort direction %', p_dir using hint = 'allowed: asc, desc';
  end if;
  -- Invariant 3: the comparison operator follows the sort direction, and
  -- BOTH cursor components use it.
  v_op := case v_dir when 'desc' then '<' else '>' end;

  -- OFFSET IS A FALLBACK, NOT A PAGINATION STRATEGY.
  -- Postgres implements OFFSET by walking and DISCARDING every skipped row, so
  -- the cost grows linearly with depth: offset 150,000 timed out (>8 s) where
  -- the equivalent keyset page read took 59 ms. This RAISES rather than
  -- silently clamping, because a clamped offset would return page 20's rows
  -- while the caller believed it asked for page 3,000 — wrong data presented
  -- as right, which is worse than an error.
  if v_offset > 10000 then
    raise exception 'leads_paged: offset % exceeds the 10000 fallback cap', v_offset
      using hint = 'OFFSET makes Postgres walk and discard every skipped row and times out past ~100k. Page with the keyset cursor instead: it is O(1) per page (59 ms at row 150,000).';
  end if;

  v_where := public._leads_worklist_where(
    p_include_legacy, p_queue, p_source_tag, p_status, p_assigned_to,
    p_search, p_consent_status, p_work_status, p_assigned_mode,
    p_contacted, p_created_from, p_created_to);

  -- Keyset. `p_cursor_sort_value` is the general form; `p_cursor_created_at`
  -- is retained so the previously deployed call shape keeps working.
  v_cursor := coalesce(p_cursor_sort_value, p_cursor_created_at::text);
  if v_cursor is not null and p_cursor_id is not null then
    v_castto := case when p_sort = 'name' then 'text' else 'timestamptz' end;
    v_where := v_where || format(
      ' and (%s, l.id) %s (%L::%s, %L::text)',
      v_sort, v_op, v_cursor, v_castto, p_cursor_id);
  end if;

  return query execute
       'select l.id, l.name, l.phone, l.city, l.state, l.source, l.campaign,'
    || '       l.campaign_clean, l.legacy_source_tab,'
    || '       l.status, l.created_at, l.counsellor, l.assigned_to, l.worklist_queue,'
    || '       l.follow_up_at, l.last_worked_at, l.consent_status, l.dnd_status,'
    || '       l.last_contacted_at, l.contact_attempt_count, l.suppression_reason,'
    || '       l.cohort, l.is_legacy, l.legacy_call_status,'
    || '       l.legacy_call_status_raw, l.work_status, l.work_status_at,'
    || '       l.work_status_by, l.import_batch, l.first_seen_at, l.promoted_at'
    || '  from public.leads l'
    || ' where ' || v_where
    || ' order by ' || v_sort || ' ' || v_dir || ', l.id ' || v_dir
    || ' limit ' || v_limit || ' offset ' || v_offset;
end;
$fn$;


-- ---------------------------------------------------------------------
-- Exact count for the SAME filter set, via the SAME predicate builder.
-- Separate function so a page read never pays for a count it did not ask
-- for. Sort/cursor are irrelevant to a count and are not parameters.
-- ---------------------------------------------------------------------
create function public.leads_paged_count(
  p_include_legacy text        default 'exclude',
  p_queue          text        default null,
  p_source_tag     text        default null,
  p_status         text        default null,
  p_assigned_to    text        default null,
  p_search         text        default null,
  p_consent_status text        default null,
  p_work_status    text        default null,
  p_assigned_mode  text        default null,
  p_contacted      text        default null,
  p_created_from   timestamptz default null,
  p_created_to     timestamptz default null,
  -- Bound the work. See the note below.
  p_count_cap      integer     default null
)
returns bigint
language plpgsql
stable
security invoker
set search_path = public
as $fn$
declare
  v_where text;
  v_count bigint;
  v_cap   integer;
begin
  v_where := public._leads_worklist_where(
    p_include_legacy, p_queue, p_source_tag, p_status, p_assigned_to,
    p_search, p_consent_status, p_work_status, p_assigned_mode,
    p_contacted, p_created_from, p_created_to);

  -- BOUNDED COUNT.
  -- An exact count(*) must visit EVERY matching row. For the indexed filters
  -- that is cheap, because idx_leads_legacy_count_cover serves them
  -- index-only (12-240 ms over the full 178k). A free-text search cannot be
  -- served that way — ILIKE is not an index condition, so the count degrades
  -- to scanning and filtering:
  --
  --   count(name ilike '%kumar%')  exact    1,749 ms
  --   same, bounded at 5,000         108 ms   <- stops early
  --
  -- Counting to cap+1 keeps "more than cap" distinguishable from "exactly
  -- cap", so the caller can render an honest "5,000+" instead of a precise
  -- number it did not actually compute.
  if p_count_cap is not null and p_count_cap > 0 then
    v_cap := least(p_count_cap, 1000000);
    execute format(
      'select count(*) from (select 1 from public.leads l where %s limit %s) t',
      v_where, v_cap + 1) into v_count;
  else
    execute 'select count(*) from public.leads l where ' || v_where into v_count;
  end if;

  return v_count;
end;
$fn$;


-- ---------------------------------------------------------------------
-- Grants. The worklist is admin-only and the app reaches Postgres with
-- the service role. Nothing anonymous may page 178k phone numbers.
-- ---------------------------------------------------------------------
revoke all on function public._leads_worklist_where(text,text,text,text,text,text,text,text,text,text,timestamptz,timestamptz) from public, anon, authenticated;
revoke all on function public._leads_worklist_sort_expr(text) from public, anon, authenticated;
revoke all on function public.leads_paged(text,text,text,text,text,text,text,integer,timestamptz,text,integer,text,text,text,timestamptz,timestamptz,text,text,text) from public, anon, authenticated;
revoke all on function public.leads_paged_count(text,text,text,text,text,text,text,text,text,text,timestamptz,timestamptz,integer) from public, anon, authenticated;

grant execute on function public._leads_worklist_where(text,text,text,text,text,text,text,text,text,text,timestamptz,timestamptz) to service_role;
grant execute on function public._leads_worklist_sort_expr(text) to service_role;
grant execute on function public.leads_paged(text,text,text,text,text,text,text,integer,timestamptz,text,integer,text,text,text,timestamptz,timestamptz,text,text,text) to service_role;
grant execute on function public.leads_paged_count(text,text,text,text,text,text,text,text,text,text,timestamptz,timestamptz,integer) to service_role;

-- =====================================================================
-- ROLLBACK: re-apply 2026-07-24-leads-paged-rpc-typed-columns.sql
-- verbatim, then drop the two helpers:
--   drop function if exists public._leads_worklist_where(text,text,text,text,text,text,text,text,text,text,timestamptz,timestamptz);
--   drop function if exists public._leads_worklist_sort_expr(text);
-- Do that BEFORE dropping the Phase 2 columns.
-- =====================================================================
