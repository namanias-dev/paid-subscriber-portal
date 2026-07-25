-- ---------------------------------------------------------------------
-- THE `trg_leads_sync_legacy_columns` CONTRACT — measured, not assumed.
--
-- Phase 4 will promote legacy leads into the live pipeline. Before anyone
-- designs that, they need the ACTUAL semantics of this trigger, because one
-- of them is a silent data-scope bug waiting to happen.
--
--   CREATE TRIGGER trg_leads_sync_legacy_columns
--     BEFORE INSERT OR UPDATE OF attribution ON public.leads
--     FOR EACH ROW EXECUTE FUNCTION leads_sync_legacy_columns()
--
--   new.is_legacy := (((new.attribution ->> 'legacy') = 'true') is true);
--   if new.attribution ? 'legacy_source_tab'                  then ... end if;
--   if (new.attribution -> 'first_touch') ? 'campaign_clean'  then ... end if;
--
-- MEASURED BEHAVIOUR (run this file to reproduce; it rolls back):
--
--   step                                                     | is_legacy
--   ---------------------------------------------------------+----------
--   0. baseline legacy row                                   | true
--   1. SET is_legacy = false  (attribution NOT in SET list)  | false
--   2. SET attribution = attribution  (NO value change)      | TRUE  <-- !!
--   3. unrelated column write (work_status) after demote     | false
--   4. legacy_source_tab / campaign_clean keys removed       | true, both KEPT
--   5. SET attribution.legacy = false                        | false
--
-- THE LANDMINE (step 2)
-- `UPDATE OF attribution` fires on the column's PRESENCE IN THE SET LIST, not
-- on a value change. `SET attribution = attribution` — same bytes, nothing
-- modified — is enough to re-derive `is_legacy` from the blob. So a Phase 4
-- promotion that sets `is_legacy = false` will appear to work, and then any
-- later write that so much as mentions `attribution` silently drops that lead
-- back into legacy scope. No error, no audit row, and the lead vanishes from
-- the live pipeline weeks later.
--
-- WHY PHASE 2 IS UNAFFECTED (step 3)
-- Phase 2's writes go through `lib/legacy-crm/writes.ts::applyLeadWrite`, which
-- sends `client.from("leads").update(effectivePatch)`. `effectivePatch` holds
-- ONLY the fields whose value actually changed, drawn from the `WRITABLE_FIELDS`
-- allow-list; `attribution` is in `FROZEN_FIELDS` and is rejected at runtime by
-- `assertNoFrozenFieldWrite`. PostgREST emits SET for exactly those keys, so
-- `attribution` never enters the column list and the trigger never fires.
-- Pinned by tests/legacy-crm-phase2/phase2-guardrails.test.ts.
--
-- RECOMMENDATION FOR PHASE 4 — DO NOT FLIP `is_legacy` ON PROMOTION.
-- `is_legacy` should be read as immutable provenance: "this human arrived via
-- the Saarthi sheet import." That fact is true forever and is exactly what
-- requirement 4b means by keeping provenance byte-identical. Pipeline
-- MEMBERSHIP is a different question and should be expressed by
-- `promoted_at is not null` (with `cohort` as the frozen classification).
-- That approach:
--   * sidesteps the trigger completely — no write ever needs to touch the blob;
--   * makes demote a one-column, fully reversible write, not a JSONB edit;
--   * keeps the `is_legacy` partial indexes (and the exact 178,183 partition)
--     valid and stable forever;
--   * keeps every protected consumer's "hard-exclude legacy" filter honest,
--     because a promoted lead is still legacy-provenance and must still never
--     enter an SMS audience on consent grounds.
-- The alternative — flipping `is_legacy` and additionally writing
-- `attribution.legacy = false` (step 5) so the trigger agrees — is durable but
-- rewrites provenance, breaks 4b, and leaves the reversion bug live for anyone
-- who forgets the second write. Recommended against.
--
-- CONSEQUENCE FOR PHASE 2 SCOPE QUERIES (already handled)
-- "Live pipeline" must not be spelled `not is_legacy` once promoted leads
-- exist. The RPC's scope arm is a single predicate in
-- `public._leads_worklist_where`, so Phase 4 changes it in exactly one place.
--
-- MINOR, NOT WORTH FIXING NOW (step 4)
-- `legacy_source_tab` and `campaign_clean` are only synced when the key is
-- PRESENT (guarded by `?`), so the trigger never clears them. That correctly
-- avoids clobbering good values, but a stale value can outlive its key.
-- ---------------------------------------------------------------------

begin;
create temp table _probe(step text, seq int, is_legacy boolean,
                         source_tab text, campaign_clean text) on commit drop;

do $$
declare v_id text;
begin
  select id into v_id from public.leads
   where merged_into is null and is_legacy
     and legacy_source_tab is not null and campaign_clean is not null
   limit 1;

  insert into _probe select '0. baseline legacy row', 0, is_legacy, legacy_source_tab, campaign_clean from public.leads where id=v_id;

  update public.leads set is_legacy = false where id = v_id;
  insert into _probe select '1. set is_legacy=false (no attribution in SET)', 1, is_legacy, legacy_source_tab, campaign_clean from public.leads where id=v_id;

  update public.leads set attribution = attribution where id = v_id;
  insert into _probe select '2. UPDATE SET attribution = attribution (no value change)', 2, is_legacy, legacy_source_tab, campaign_clean from public.leads where id=v_id;

  update public.leads set is_legacy = false where id = v_id;
  update public.leads set work_status = 'in_progress' where id = v_id;
  insert into _probe select '3. unrelated column write after re-demoting', 3, is_legacy, legacy_source_tab, campaign_clean from public.leads where id=v_id;

  update public.leads
     set attribution = (attribution - 'legacy_source_tab')
                       || jsonb_build_object('first_touch', (attribution->'first_touch') - 'campaign_clean')
   where id = v_id;
  insert into _probe select '4. keys removed from blob', 4, is_legacy, legacy_source_tab, campaign_clean from public.leads where id=v_id;

  update public.leads set attribution = jsonb_set(attribution, '{legacy}', 'false'::jsonb) where id = v_id;
  insert into _probe select '5. attribution.legacy set to false', 5, is_legacy, legacy_source_tab, campaign_clean from public.leads where id=v_id;
end $$;

select step, is_legacy,
       source_tab is not null     as tab_kept,
       campaign_clean is not null as cc_kept
from _probe order by seq;

rollback;

-- Two-directional reconciliation. NOTE THE SHAPE: comparing a boolean against
-- `(attribution->>'legacy') = 'true'` with IS DISTINCT FROM reports every
-- ordinary live lead as a mismatch, because the right-hand side is NULL when
-- the key is absent and `false IS DISTINCT FROM NULL` is TRUE. Both arms below
-- must return 0. Tests should assert on `is_legacy` alone and never re-derive
-- the flag from the blob.
select
  count(*) filter (where is_legacy and (attribution->>'legacy') is distinct from 'true') as col_true_json_not,
  count(*) filter (where not is_legacy and (attribution->>'legacy') = 'true')            as col_false_json_true
from public.leads;
