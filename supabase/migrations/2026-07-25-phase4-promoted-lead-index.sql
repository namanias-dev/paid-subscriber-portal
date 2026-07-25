-- PHASE 4 — index the promoted-lead set.
--
-- Promotion keeps `is_legacy = true` and expresses live-pipeline membership as
-- `promoted_at IS NOT NULL`. Two Phase 4 paths read that set directly:
--
--   * `buildLivePhoneIndex` (lib/legacy-crm/promote.ts) — the duplicate guard
--     has to see promoted leads, because a promoted lead IS a live lead and a
--     second promotion onto the same number must be blocked.
--   * `getLeadsForPillMap` (lib/dataProvider.ts) — a promoted lead that enrols
--     and pays needs its source pill to resolve.
--
-- Without this index that predicate has nothing to match and the planner falls
-- back to a sequential scan of all 178,183 legacy rows, which exceeds the
-- 8s `statement_timeout` on the `authenticator` role. The failure mode is
-- particularly bad: it is the DUPLICATE GUARD that times out, so promotion
-- fails closed but noisily, and every promotion is blocked until it is fixed.
--
-- Partial and tiny — it indexes only promoted, unmerged rows, currently zero of
-- them, growing only as leads are actually promoted. `id` is the payload
-- because both callers page by id.
--
-- CONCURRENTLY: `leads` is written continuously by the public site.

create index concurrently if not exists idx_leads_promoted_active
  on public.leads (id)
  where merged_into is null and promoted_at is not null;

-- Verified after creation on 2026-07-25:
--
--   Index Scan using idx_leads_promoted_active on leads
--     Filter: is_legacy
--   Execution Time: 0.049 ms   (was: seq scan, >8s timeout)
--
-- ROLLBACK
--   drop index concurrently if exists public.idx_leads_promoted_active;
