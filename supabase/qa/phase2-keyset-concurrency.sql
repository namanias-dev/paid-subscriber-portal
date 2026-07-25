-- ---------------------------------------------------------------------
-- Phase 2 QA — keyset pagination under concurrent head inserts.
--
-- WHY THIS EXISTS
-- The public site captures leads continuously, so the live lead count is a
-- moving target: rows land at the HEAD of the default (created_at desc,
-- id desc) ordering while a counsellor is part-way through paging the CRM.
-- OFFSET pagination counts rows rather than addressing them, so every head
-- insert shifts the whole tail down and the page boundary both repeats one
-- row and steps over another. The row that gets stepped over is a real lead
-- that no one ever sees, and nothing surfaces an error -- the UI looks fine.
--
-- This script proves the shipped compound ROW(created_at, id) keyset is
-- immune to that, and that the OFFSET alternative is not.
--
-- SAFETY
-- Everything runs inside a single transaction that ends in ROLLBACK, so the
-- simulated concurrent inserts are never committed. Verify with the final
-- query below: qa_fixture_rows_in_prod must be 0.
--
-- Note: `is_legacy` is trigger-derived from attribution->>'legacy' and
-- cannot be set directly by an INSERT, so the simulated concurrent writers
-- necessarily arrive as live leads -- which is exactly what the real site
-- does. The run therefore uses the 'include' (All) scope.
--
-- EXPECTED RESULT
--   pass   | rows_returned | duplicates | snapshot_rows_skipped
--   -------+---------------+------------+----------------------
--   keyset |            40 |          0 |                     0
--   offset |            40 |          5 |                    10
-- ---------------------------------------------------------------------

begin;

-- The true first 40 rows, frozen before any concurrent insert.
create temp table _snap on commit drop as
select id from public.leads
where merged_into is null
order by created_at desc, id desc
limit 40;

create temp table _got(pass text, page int, id text) on commit drop;

do $$
declare
  v_cur_created timestamptz; v_cur_id text; v_page int; r record;
begin
  -- PASS 1: keyset (shipped). Five new leads land at the head after page 1.
  v_cur_created := null; v_cur_id := null;
  for v_page in 1..4 loop
    for r in
      select p.id, p.created_at
      from public.leads_paged('include',null,null,null,null,null,null,10,
                              v_cur_created,v_cur_id,0,
                              null,null,null,null,null,'created_at','desc',null) p
    loop
      insert into _got values ('keyset', v_page, r.id);
      v_cur_created := r.created_at; v_cur_id := r.id;
    end loop;
    if v_page = 1 then
      insert into public.leads(id,name,phone,created_at)
      select 'qa-conc-k'||g, 'QA Conc K'||g, '90000001'||lpad(g::text,2,'0'),
             now() + interval '1 day'
      from generate_series(1,5) g;
    end if;
  end loop;

  -- PASS 2: offset, identical concurrent write pattern.
  for v_page in 1..4 loop
    for r in
      select p.id
      from public.leads_paged('include',null,null,null,null,null,null,10,
                              null,null,(v_page-1)*10,
                              null,null,null,null,null,'created_at','desc',null) p
    loop
      insert into _got values ('offset', v_page, r.id);
    end loop;
    if v_page = 1 then
      insert into public.leads(id,name,phone,created_at)
      select 'qa-conc-o'||g, 'QA Conc O'||g, '90000002'||lpad(g::text,2,'0'),
             now() + interval '2 day'
      from generate_series(1,5) g;
    end if;
  end loop;
end $$;

select
  g.pass,
  count(*)                                        as rows_returned,
  count(*) - count(distinct g.id)                 as duplicates,
  (select count(*) from _snap s
     where not exists (select 1 from _got x where x.pass=g.pass and x.id=s.id))
                                                  as snapshot_rows_skipped
from _got g group by g.pass order by g.pass desc;

rollback;

-- Post-condition: the simulation must have left nothing behind, and the
-- partition must still be exact. active_legacy is frozen at 178183;
-- active_live is a moving target and is only ever asserted as >=.
select
  count(*) filter (where id like 'qa-conc-%')             as qa_fixture_rows_in_prod,
  count(*) filter (where merged_into is null and is_legacy)     as active_legacy,
  count(*) filter (where merged_into is null and not is_legacy) as active_live,
  count(*) filter (where merged_into is null)                   as active_total,
  count(*) filter (where is_legacy is null)                     as is_legacy_null
from public.leads;
