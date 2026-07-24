-- =====================================================================
-- Phase 1b — `leads_paged` / `leads_paged_count` RPC.
--
-- WHY AN RPC AND NOT A POSTGREST QUERY
-- ------------------------------------
-- Tie-safe keyset pagination requires a ROW-VALUE comparison:
--
--     (created_at, id) < (:cursor_created_at, :cursor_id)
--
-- Postgres compiles that straight into an `Index Cond` on the composite
-- index and walks it in order. PostgREST has no syntax for row-value
-- comparison, and the two obvious workarounds both collapse:
--
--   MEASURED 2026-07-24, legacy set (178,183 rows), page at depth 150k:
--     OFFSET 150000                  -> 39,943 ms  (external merge, 37 MB disk)
--     OR-form keyset                 ->  9,510 ms  (BitmapOr + top-N sort)
--     ROW(created_at,id) < ROW(..)   ->     12.7 ms (Index Cond, ordered walk)
--
-- The OR form is the trap: `a < X OR (a = X AND b < Y)` is logically
-- identical to the row-value form but the planner cannot derive an ordered
-- index walk from it, so it bitmap-ORs 28k rows and sorts them. 750x.
--
-- A `created_at`-only cursor is NOT an option: 856 distinct timestamps are
-- shared by 2+ active rows and one is shared by 168, so a scalar cursor
-- silently drops rows inside a tie group straddling a page boundary.
--
-- PREDICATE SPELLING IS LOAD-BEARING
-- ----------------------------------
-- The legacy/non-legacy predicates below are built as literal SQL text in
-- EXACTLY the shape the partial indexes were created with. They are NOT
-- wrapped in a CASE over a parameter: a CASE-wrapped predicate is opaque to
-- the planner, which cannot then prove it implies the partial index
-- predicate, and every query would fall back to a full scan. That is the
-- same class of failure as the `IS DISTINCT FROM` incident that cost 65 s.
--
--   legacy-only  -> (attribution->>'legacy') = 'true'
--                   matches idx_leads_legacy_active_created and friends
--   non-legacy   -> three-arm OR
--                   matches idx_leads_active_nonlegacy_created
--
-- INJECTION SAFETY
-- ----------------
-- Every caller-supplied value is interpolated with `format(..., %L)`, which
-- emits a correctly-escaped SQL literal. `p_include_legacy` is never
-- interpolated — it is compared against three fixed strings and selects a
-- hard-coded predicate. `p_limit` / `p_offset` are integers, clamped.
--
-- Rollback: `drop function if exists public.leads_paged(...);` — see the
-- rollback migration.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.leads_paged(
  p_include_legacy      text        DEFAULT 'exclude',   -- 'exclude' | 'include' | 'only'
  p_queue               text        DEFAULT NULL,
  p_source_tag          text        DEFAULT NULL,
  p_status              text        DEFAULT NULL,
  p_assigned_to         text        DEFAULT NULL,
  p_search              text        DEFAULT NULL,
  p_consent_status      text        DEFAULT NULL,
  p_limit               integer     DEFAULT 50,
  p_cursor_created_at   timestamptz DEFAULT NULL,
  p_cursor_id           text        DEFAULT NULL,
  p_offset              integer     DEFAULT 0
)
RETURNS TABLE (
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
  legacy_call_status    text
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $fn$
DECLARE
  v_where text := 'l.merged_into is null';
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_needle text;
BEGIN
  IF p_include_legacy = 'only' THEN
    v_where := v_where || ' and ((l.attribution ->> ''legacy'') = ''true'')';
  ELSIF p_include_legacy = 'exclude' THEN
    v_where := v_where || ' and ((l.attribution is null) or ((l.attribution ->> ''legacy'') is null)'
                       || ' or ((l.attribution ->> ''legacy'') <> ''true''))';
  END IF;

  IF p_queue          IS NOT NULL THEN v_where := v_where || format(' and l.worklist_queue = %L', p_queue); END IF;
  IF p_status         IS NOT NULL THEN v_where := v_where || format(' and l.status = %L', p_status); END IF;
  IF p_assigned_to    IS NOT NULL THEN v_where := v_where || format(' and l.assigned_to = %L', p_assigned_to); END IF;
  IF p_consent_status IS NOT NULL THEN v_where := v_where || format(' and l.consent_status = %L', p_consent_status); END IF;
  IF p_source_tag     IS NOT NULL THEN v_where := v_where || format(' and (l.attribution ->> ''legacy_source_tab'') = %L', p_source_tag); END IF;

  IF p_search IS NOT NULL AND length(btrim(p_search)) > 0 THEN
    v_needle := '%' || btrim(p_search) || '%';
    v_where := v_where || format(' and (l.name ilike %L or l.phone ilike %L)', v_needle, v_needle);
  END IF;

  IF p_cursor_created_at IS NOT NULL AND p_cursor_id IS NOT NULL THEN
    v_where := v_where || format(
      ' and (l.created_at, l.id) < (%L::timestamptz, %L::text)',
      p_cursor_created_at, p_cursor_id);
  END IF;

  RETURN QUERY EXECUTE
       'select l.id, l.name, l.phone, l.city, l.state, l.source, l.campaign,'
    || '       l.attribution -> ''first_touch'' ->> ''campaign_clean'','
    || '       l.attribution ->> ''legacy_source_tab'','
    || '       l.status, l.created_at, l.counsellor, l.assigned_to, l.worklist_queue,'
    || '       l.follow_up_at, l.last_worked_at, l.consent_status, l.dnd_status,'
    || '       l.last_contacted_at, l.contact_attempt_count, l.suppression_reason,'
    || '       l.cohort, l.legacy_call_status'
    || '  from public.leads l'
    || ' where ' || v_where
    || ' order by l.created_at desc, l.id desc'
    || ' limit ' || v_limit || ' offset ' || v_offset;
END;
$fn$;

-- Exact count for the same filter set. Separate function so the page read
-- never pays for a count it was not asked for.
CREATE OR REPLACE FUNCTION public.leads_paged_count(
  p_include_legacy text DEFAULT 'exclude',
  p_queue          text DEFAULT NULL,
  p_source_tag     text DEFAULT NULL,
  p_status         text DEFAULT NULL,
  p_assigned_to    text DEFAULT NULL,
  p_search         text DEFAULT NULL,
  p_consent_status text DEFAULT NULL
)
RETURNS bigint
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $fn$
DECLARE
  v_where text := 'l.merged_into is null';
  v_needle text;
  v_count bigint;
BEGIN
  IF p_include_legacy = 'only' THEN
    v_where := v_where || ' and ((l.attribution ->> ''legacy'') = ''true'')';
  ELSIF p_include_legacy = 'exclude' THEN
    v_where := v_where || ' and ((l.attribution is null) or ((l.attribution ->> ''legacy'') is null)'
                       || ' or ((l.attribution ->> ''legacy'') <> ''true''))';
  END IF;

  IF p_queue          IS NOT NULL THEN v_where := v_where || format(' and l.worklist_queue = %L', p_queue); END IF;
  IF p_status         IS NOT NULL THEN v_where := v_where || format(' and l.status = %L', p_status); END IF;
  IF p_assigned_to    IS NOT NULL THEN v_where := v_where || format(' and l.assigned_to = %L', p_assigned_to); END IF;
  IF p_consent_status IS NOT NULL THEN v_where := v_where || format(' and l.consent_status = %L', p_consent_status); END IF;
  IF p_source_tag     IS NOT NULL THEN v_where := v_where || format(' and (l.attribution ->> ''legacy_source_tab'') = %L', p_source_tag); END IF;

  IF p_search IS NOT NULL AND length(btrim(p_search)) > 0 THEN
    v_needle := '%' || btrim(p_search) || '%';
    v_where := v_where || format(' and (l.name ilike %L or l.phone ilike %L)', v_needle, v_needle);
  END IF;

  EXECUTE 'select count(*) from public.leads l where ' || v_where INTO v_count;
  RETURN v_count;
END;
$fn$;

-- The worklist is admin-only and the app reaches Postgres with the service
-- role. Nothing anonymous should be able to page 178k phone numbers.
REVOKE ALL ON FUNCTION public.leads_paged(text,text,text,text,text,text,text,integer,timestamptz,text,integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.leads_paged_count(text,text,text,text,text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.leads_paged(text,text,text,text,text,text,text,integer,timestamptz,text,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.leads_paged_count(text,text,text,text,text,text,text) TO service_role;
