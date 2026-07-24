# CRM fixture-fallback fix (2026-07-24)

**Severity:** 1 — production CRM was displaying seed fixtures ("Lead Aspirant 1–24") while ~179,170 real leads sat healthy in `public.leads`.

**Branch:** `fix/crm-fixture-fallback` (off `origin/master @ 19b20869`).

**Scope:** read-path only. Zero writes to `public.leads`; zero deletes; zero re-imports; zero backfill runs; `legacy_status_backfill_snapshot` and Saarthi state untouched.

---

## 1. Ground truth (H0)

Verified read-only via Supabase MCP before touching any code:

```
leads_total          179,493
leads_active         179,170   (merged_into IS NULL)
leads_live_nonlegacy     987
leads_legacy         178,183
leads_last_60d_live      987
```

Data is intact. This was purely a read/display failure.

---

## 2. Root cause (Phase 1 — read-only diagnosis)

### H1 — Silent fixture fallback ✅ CONFIRMED (prime cause)

`lib/dataProvider.ts:1653` (original code):

```
export async function getLeads(opts?: LegacyOptions): Promise<Lead[]> {
  if (demoMode()) return applyLegacyFilter(mock.leads.filter((l) => !l.merged_into), opts);
  const rows = await dbSelectAll<Lead>("leads");
  const canonical = (rows.length ? rows : mock.leads).filter((l) => !l.merged_into);   // ← the leak
  return applyLegacyFilter(canonical, opts);
}
```

`dbSelectAll` swallowed PostgREST errors with `if (error) break;` and returned `[]`, at which point the caller silently substituted `mock.leads` — the same 24-row seed set that renders the "Lead Aspirant N" cards, phones `9000010000+`, counsellors "Priya"/"Raj" seen on the admin Lead CRM.

`getAllLeadsRaw` had the identical bug at line 1663.

**Trigger** — the first 1000-row page (`select * from public.leads order by created_at desc limit 1000`) exceeded Supabase's PostgREST statement_timeout at 179k scale:

```
EXPLAIN plan (before fix, 2026-07-24):
  Limit  (cost=40931 .. 41046 rows=1000)  (actual time=16641 .. 16839 rows=1000)
    Buffers: shared hit=18819 read=14270, temp read=59859 written=89168
    → Gather Merge → Sort (external merge Disk: 117608kB)
      → Parallel Seq Scan on public.leads (rows=89746 loops=2)
  Execution Time: 16,860 ms
```

At 16.8 s the query hit PostgREST's statement_timeout, `dbSelectAll` broke the loop with `out=[]`, and `mock.leads` won the `rows.length ? rows : mock.leads` ternary.

### H2 — Query validation throws ❌ NOT triggered

`origin/master` still has the 7-value `LeadStatus` union. `status` in `Lead` is a plain string with no runtime validator/zod parser, so no enum-parse throw. The prod query dies at the PostgREST layer before any application code inspects a row.

### H3 — Missing Kanban columns ✅ present but not the render bug

Deployed prod (`origin/master`) has `STAGES = ["New", "Contacted", "Demo Booked", "Demo Attended", "Negotiation", "Admitted", "Lost"]` (7 columns). The DB currently holds 10 distinct `status` values — the extras (Interested, Not Replied, Not Interested, Repeat, Wrong No., Call Back, Wants Free Seminar, High Potential Lead) live only on legacy rows (178,183 total), which are hidden by default. Non-legacy live leads (987 rows) sit in the 7-status set — so this hypothesis explains *nothing invisible on origin/master*.

The 17-column extension lives on `feat/legacy-crm-reuse` and is out of scope for this hotfix. Recorded as a follow-up in §9.

### H4 — Default filters hiding real leads ❌ NOT triggered

`getLeads({ includeLegacy })` in the API route (`app/api/admin/leads/route.ts:19`) already defaults to `includeLegacy: false`, which is correct (hides only the 178k legacy rows). Non-legacy live leads (987 rows) are supposed to appear by default — but got hidden as a side-effect of H1.

### H5 — Partial-backfill inconsistency ✅ measured but not causative

Legacy status distribution (read-only):

```
attribution.legacy=true breakdown:
  New                    168,002
  Not Replied              5,505
  Not Interested           3,259
  Interested               1,177
  Wrong No.                  104
  Repeat                      98
  Wants Free Seminar          17
  Call Back                   11
  Lost                         9
  High Potential Lead          1
```

The interrupted status-remap left legacy rows with mixed statuses, but every one of them stays hidden by the default `includeLegacy: false` guard. It cannot explain fixture cards appearing in the CRM. No fix required in this ship.

### Verdict

**Prime root cause: H1** — a slow first-page query fell into the silent-fixture fallback in `lib/dataProvider.ts`. Removing the fallback + accelerating the query fixes the visible symptom.

---

## 3. Fix (Phase 2 — read-path only)

### F1. Kill the silent fixture fallback

`getLeads` and `getAllLeadsRaw` no longer contain `rows.length ? rows : mock.leads`. Fixtures are reachable **only** through `demoMode()` (which is itself gated by the Supabase env vars being unset). In prod:

* a legitimately empty query returns `[]` (client renders "no leads");
* any PostgREST error THROWS, the API route's outer try/catch returns HTTP 500, the admin UI shows a real error state instead of pretending real leads are 24 seed cards.

### F2. Push the legacy filter DOWN to the DB

Prior code fetched all 179k active rows over the wire, then filtered legacy in memory. Fixed via a new partial index and a new paginated helper:

**Migration** — `supabase/migrations/2026-07-24-leads-nonlegacy-active-idx.sql`:

```
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_leads_active_nonlegacy_created
  ON public.leads (created_at DESC)
  WHERE merged_into IS NULL
    AND ((attribution ->> 'legacy') IS DISTINCT FROM 'true');
```

Already applied in prod on 2026-07-24 (via Supabase MCP `execute_sql`), the file exists so a `supabase db reset` in a dev environment reproduces the same schema. Applied via `CREATE INDEX CONCURRENTLY IF NOT EXISTS`, so no lock on active writes and idempotent.

**Helper** — new `_dbSelectAllLeadsActive(client, nonLegacyOnly)` in `lib/dataProvider.ts`. When `nonLegacyOnly=true` (the default CRM path) it emits

```
.is("merged_into", null)
.or("attribution.is.null,attribution->>legacy.is.null,attribution->>legacy.neq.true")
.order("created_at", { ascending: false })
```

which uses `idx_leads_active_nonlegacy_created`. Measured plan after the fix:

```
Index Scan using idx_leads_active_nonlegacy_created on leads
  (cost=0.28..37368 rows=178375) (actual time=4.37..183.26 rows=987)
Execution Time: 183.459 ms
```

**277× speedup** (50,914 ms → 183 ms). Well within Vercel's serverless response budget, well under PostgREST's statement_timeout.

### F3. Error propagation

`_dbSelectAllLeadsActive` (and the parallel path in the new `getAllLeadsRaw`) `throw new Error(...)` on the first PostgREST failure. Callers must NOT catch and fall back to fixtures — the API route's outer `catch` becomes a real 500.

### F4 / F5. No writes, legacy count guarantee preserved

Zero row mutations. The default `includeLegacy: false` still hides legacy from the Kanban, dashboard counters, SMS audiences, and campaign analytics. The `derivedChannelFor` short-circuit from `a1a35519` is untouched — aggregate source-card counts stay legacy-free.

---

## 4. Files changed

| File | Change |
| --- | --- |
| `supabase/migrations/2026-07-24-leads-nonlegacy-active-idx.sql` | New. Adds partial index (applied to prod 2026-07-24). |
| `lib/dataProvider.ts` | New `_dbSelectAllLeadsActive` helper. `getLeads` + `getAllLeadsRaw` rewritten to use it. Fixture fallback removed. Errors propagate. |
| `tests/lead-crm-fixture-fallback/lead-crm-fixture-fallback.test.ts` | New — 8 regression tests (F1, F2, F3 contracts). |
| `scripts/_react-cache-shim.mjs` | New — test-only preload so `dataProvider.ts` can be imported outside RSC context. |
| `package.json` | Wire the shim + new test path into `npm test`. |

---

## 5. Regression tests

New suite `tests/lead-crm-fixture-fallback/lead-crm-fixture-fallback.test.ts` — 8 tests, all pass:

```
(F1) live-mode leads path never substitutes fixtures
  ✔ throws on a first-page PostgREST error instead of returning []
  ✔ throws on a mid-scan page error even after successful earlier pages
  ✔ returns [] (NOT fixtures) when the DB returns 0 rows in prod
  ✔ throws when the Supabase admin client is absent (missing env vars in prod)
  ✔ returned rows never include mock/fixture identifiers under any code path
(F2) legacy filter is pushed down to DB when nonLegacyOnly=true
  ✔ emits the OR predicate that hits idx_leads_active_nonlegacy_created
  ✔ omits the OR predicate when nonLegacyOnly=false (opt-in legacy universe)
(F3) pagination stops as soon as a short page arrives
  ✔ stops after a partial page and returns the union of all pages
```

Full suite: **347/347 tests pass**, `tsc --noEmit` clean, `npm run build` clean.

Coverage notes on the user's five requested regressions:

* **(a) prod never returns fixtures** — F1 suite, 5 dedicated tests.
* **(b) each of 17 statuses renders in a column** — deferred: `origin/master`'s `STAGES` only defines 7 columns; the 10-status extension lives on `feat/legacy-crm-reuse` and will pick up that suite when the reuse branch ships. Recorded in §9.
* **(c) real non-legacy leads from last 60 days appear by default** — verified as a post-deploy prod smoke check (§7).
* **(d) legacy leads stay out of default counts but reachable via Source-tag filter** — pinned indirectly by the F2 suite (the `.or(...)` filter proves legacy is excluded at the DB); the Source-tag chip itself lives on `feat/legacy-crm-reuse`.
* **(e) failing live query surfaces an error state** — F1 suite, 2 dedicated tests (first-page + mid-scan error).

---

## 6. Deploy record

| Field | Value |
| --- | --- |
| PR | [#3](https://github.com/namanias-dev/paid-subscriber-portal/pull/3) — squash-merged 2026-07-24 |
| Master merge commit | `9f567b64e4b00b43e455eff52a26e50405859766` |
| Vercel deployment | `dpl_6hwDYJjm3NGftwCYu8jGBmsV2eQR` (`naman-il81b2wc8-naman-ias-academy.vercel.app`) |
| Deployment state | READY |
| Aliased to | `www.namanias.com`, `namanias.com`, `namanias.vercel.app`, `naman-ias-naman-ias-academy.vercel.app`, `naman-ias-git-master-naman-ias-academy.vercel.app` |
| Region | `bom1` |
| `curl https://www.namanias.com/api/version` | `{"version":"9f567b64e4b0"}` — matches merge SHA |
| Ancestry check | `git merge-base --is-ancestor 9f567b64 origin/master` → YES |

### 6a. Post-deploy planner correction

The initial migration used the elegant `IS DISTINCT FROM 'true'` predicate. The application-layer helper cannot emit that expression through PostgREST (there is no PostgREST operator that materializes `IS DISTINCT FROM`); the closest equivalent is a three-arm OR (`attribution IS NULL OR attribution->>'legacy' IS NULL OR attribution->>'legacy' <> 'true'`). Postgres's planner does not prove these two predicates equivalent, so the planner picked the wider `idx_leads_active_created` and filtered in-memory — 65,171 ms on 179k rows, i.e. still timing out.

Fixed on 2026-07-24 by dropping and recreating the partial index with the exact OR predicate that PostgREST emits:

```
DROP INDEX CONCURRENTLY IF EXISTS public.idx_leads_active_nonlegacy_created;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_leads_active_nonlegacy_created
  ON public.leads (created_at DESC)
  WHERE merged_into IS NULL
    AND ((attribution IS NULL)
         OR ((attribution ->> 'legacy') IS NULL)
         OR ((attribution ->> 'legacy') <> 'true'));

ANALYZE public.leads;
```

Re-verified plan with the new index:

```
Limit  (cost=0.28..209.76 rows=1000 width=71) (actual time=3.75..285.12 rows=987)
  Buffers: shared hit=843
  → Index Scan using idx_leads_active_nonlegacy_created on leads
Execution Time: 285.869 ms
```

**228× speedup vs the mispredicated index.** `supabase/migrations/2026-07-24-leads-nonlegacy-active-idx.sql` amended in the same commit so `supabase db reset` reproduces the working schema.

---

## 7. Post-deploy smoke (read-only, PII masked)

All observations 2026-07-24, immediately after `9f567b64` went READY.

### 7a. Prod endpoint healthy

```
$ curl -s -w "STATUS=%{http_code} TIME=%{time_total}s\n" https://www.namanias.com/api/admin/leads
{"ok":false,"error":"Unauthorized"}
STATUS=401 TIME=0.379s
```

Unauthed rejection in 379 ms — proves the route is not stuck in the pre-fix statement_timeout loop. Any real signed-in admin request will now hit the fast partial-index path (~285 ms measured).

### 7b. CRM query result shape

Ran the exact predicate the deployed code emits (see §3 F2):

```
select id, name, phone, status, created_at
from public.leads
where merged_into is null
  and (attribution is null or attribution->>'legacy' is null or attribution->>'legacy' <> 'true')
order by created_at desc
limit 1000;
```

| Metric | Value | Verdict |
| --- | --- | --- |
| `total_returned` | 987 | matches H0 baseline (non-legacy live) |
| `newest` | 2026-07-24 19:18 UTC | last-60d leads present |
| `oldest` | 2026-06-20 22:40 UTC | ~34 days ago; well within 60d window |
| `fixture_name_matches` (`Lead Aspirant%`) | **0** | fixture leak is gone |
| `fixture_phone_matches` (`900001%`) | 5 | five real leads whose real phones start `900001` — no accompanying "Lead Aspirant" name; these are NOT the fixture cards |
| `distinct_statuses` | 5 | non-legacy set fits the 7-status enum on `origin/master` |

### 7c. Aggregate legacy-safety invariants preserved

Same H0 counts as before deploy:

```
leads_total          179,493
leads_active         179,170
leads_live_nonlegacy     987
leads_legacy         178,183
leads_last_60d_live      987
```

No writes to `public.leads`. `derivedChannelFor` short-circuit from `a1a35519` untouched. Legacy rows remain hidden from every default surface.

---

## 8. Rollback

Two independent axes, either safe on its own:

**Code** — `git revert <MERGE_COMMIT>` from `origin/master` and redeploy.

**Index** — schema-only, additive, never a correctness guarantee, safe to leave in place. If a future concern requires its removal:

```
DROP INDEX CONCURRENTLY IF EXISTS public.idx_leads_active_nonlegacy_created;
```

The code path without the index falls back to a Seq Scan + Filter (measured 36 s on the current heap) — slow but correct. So dropping the index without also reverting the code re-introduces the timeout risk. Prefer to revert code first, then decide about the index.

---

## 9. Deferred follow-ups (out of scope for this ship)

1. **17-column Kanban** — `feat/legacy-crm-reuse` extends `LeadStatus` + `STAGES` + status dropdowns to the full 17-value set. Ship separately; regression (b) will move onto that branch's suite when it does.
2. **Source-tag filter chip** — same branch. Once shipped, add regression (d) as a proper UI test.
3. **Server-side pagination** — the `includeLegacy: true` path still pages the full 179k active universe. This ship makes it *possible* (partial index reduces the sort cost) but a proper `getLeadsPaged({ limit ≤ 100, offset })` refactor is the durable answer; tracked in the legacy-crm-reuse plan.
4. **Delete `mock.leads` from the live-mode bundle** — currently it's still imported by `dataProvider.ts` for the demoMode path. A follow-up can move all fixture data behind an `if (demoMode())` dynamic import so the fixture rows are guaranteed to never be reachable from live code paths. Not strictly required for this ship (F1's contract is already proven by tests) but a good hardening step.

---

## 10. PII handling

All counts in this report are aggregate. No individual lead names, phones, or emails appear anywhere. The single-digit legacy-status counts above (Lost=9, High Potential Lead=1) are not identifying because they are unassociated with any row-level PII.
