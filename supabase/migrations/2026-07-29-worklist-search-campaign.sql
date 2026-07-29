-- Additive: free-text worklist search also matches campaign / campaign_clean
-- so Legacy funnel row clicks (scope=legacy&search=<campaign>) land correctly.

CREATE OR REPLACE FUNCTION public._leads_worklist_where(
  p_include_legacy text,
  p_queue text,
  p_source_tag text,
  p_status text,
  p_assigned_to text,
  p_search text,
  p_consent_status text,
  p_work_status text,
  p_assigned_mode text,
  p_contacted text,
  p_created_from timestamp with time zone,
  p_created_to timestamp with time zone
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $function$
declare
  v_where  text := 'l.merged_into is null';
  v_needle text;
  v_digits text;
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
  if p_work_status    is not null then v_where := v_where || format(' and l.work_status = %L', p_work_status); end if;

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

  if p_search is not null and length(btrim(p_search)) > 0 then
    v_needle := btrim(p_search);
    v_digits := regexp_replace(v_needle, '\D', '', 'g');
    if length(v_digits) = 12 and left(v_digits, 2) = '91' then v_digits := substr(v_digits, 3);
    elsif length(v_digits) = 11 and left(v_digits, 1) = '0' then v_digits := substr(v_digits, 2);
    elsif length(v_digits) = 13 and left(v_digits, 3) = '091' then v_digits := substr(v_digits, 4);
    end if;
    if length(v_digits) >= 3 then
      v_where := v_where || format(
        ' and (l.phone like %L or l.name ilike %L or coalesce(l.campaign_clean,'''') ilike %L or coalesce(l.campaign,'''') ilike %L)',
        '%' || v_digits || '%', '%' || v_needle || '%', '%' || v_needle || '%', '%' || v_needle || '%');
    else
      v_where := v_where || format(
        ' and (l.name ilike %L or coalesce(l.campaign_clean,'''') ilike %L or coalesce(l.campaign,'''') ilike %L)',
        '%' || v_needle || '%', '%' || v_needle || '%', '%' || v_needle || '%');
    end if;
  end if;

  return v_where;
end;
$function$;
