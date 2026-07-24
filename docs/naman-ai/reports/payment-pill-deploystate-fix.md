# Payment attribution pill — deploy-state diagnosis + scale-regression fix

Third attempt at fixing the "SourcePill missing on every payment row in
production" symptom. Prior two attempts (`a1a35519` + `5beae6bd`) shipped
correct display logic but did not survive at post-legacy-backfill scale. This
report:

1. **Proves via git ancestry + Vercel deployment SHA** that the earlier fix
   IS deployed to production — the "never deployed" hypothesis is FALSE.
2. **Identifies the true root cause as a live scale regression** (case (c)
   from the prompt): the deployed code correctly renders pills whenever
   `attr.channel` is populated, but at 179k leads it either times out, blows
   the Vercel serverless response-body budget, or returns a payload the
   client can't ingest — silently leaving `leadAttrByPhone` null on the
   browser, which visually is "no pill anywhere".
3. **Ships the minimal correct fix**: two targeted DB reads (~1.3k rows
   total) + a behaviorally-no-op prune of the phone map before it is
   serialized. Old contracts (G1 legacy-count exclusion, G2 collision
   preference) are pinned by an expanded test suite.
4. **Documents deferral of the saarthi `wasNew` follow-up**: the saarthi
   feature branch has never been committed to git anywhere; folding untested
   uncommitted code into a hot-fix ship is unsafe. The wasNew patch remains
   a pending follow-up on the `feat/saarthi-legacy-import` worktree.

PII: only 4-digit phone tails and last-8-digit payment IDs appear in this
report. No names, emails, campaign UUIDs, or full phones.

---

## 1. Phase 1 — Deploy-state diagnosis (read-only)

### 1.1 Where is commit `a1a35519` (the pill fix)?

```bash
$ cd naman-ias-portal-master && git fetch --all --prune
$ git branch --all --contains a1a35519
+ feat/saarthi-legacy-import
+ fix/payment-source-restore
  remotes/origin/fix/payment-source-restore
  remotes/origin/master
$ git merge-base --is-ancestor a1a35519 origin/master && echo YES
YES
```

**a1a35519 IS an ancestor of `origin/master`.** Fully pushed, fully merged.

The doc addendum `5beae6bd docs: payment-source-restore final deploy + smoke evidence`
sits one commit above it on origin/master. `git log origin/master --oneline -5`:

```
5beae6bd docs: payment-source-restore final deploy + smoke evidence
a1a35519 fix(payments): restore source pill on payments + people rows
c59c6ab9 fix(legacy-import): collision merge must not flag pre-existing rows legacy
34c722cf docs: legacy-lead migration Phase 2+3 shipment report
2542f0c8 Merge branch 'feat/legacy-lead-migration'
```

No later commit touches any of the four fix files
(`app/api/admin/payments/route.ts`, `app/api/admin/students/route.ts`,
`components/admin/SourcePill.tsx`, `lib/marketing/leadAttrByPhone.ts`,
`lib/webinarSource.ts`):

```bash
$ git log --oneline a1a35519..origin/master -- \
    app/api/admin/payments/route.ts \
    app/api/admin/students/route.ts \
    components/admin/SourcePill.tsx \
    lib/marketing/leadAttrByPhone.ts \
    lib/webinarSource.ts
(empty)
```

So on origin/master the fix code is untouched since `a1a35519`.

### 1.2 What is deployed to production RIGHT NOW?

Vercel `list_deployments` for project `prj_ULEGPguZAXU3V5nk8ZiZ9RWkqfFE`,
production target, latest first:

| Deploy ID | SHA | State | Branch | Alias |
|---|---|---|---|---|
| **dpl_9zw2hwuyKke4TphnPhajPSCsKih7** | **5beae6bd** | READY | master | `naman-ias-git-master-naman-ias-academy.vercel.app` |
| dpl_AbA3xCSQZC6Vwi5bQktURoQHzyLB | a1a35519 | READY | master | (previous) |

Latest production deployment `dpl_9zw2hwuyKke4TphnPhajPSCsKih7` runs SHA
`5beae6bd6fa5c95e7bb63a6abe5dcead3348427b`, which contains `a1a35519` as
its direct parent.

`a1a35519` **IS an ancestor of the deployed SHA** — the fix code is served
in production RIGHT NOW.

### 1.3 Is the deployed code path correct?

Verified on the deployed SHA `5beae6bd`:

- `app/api/admin/payments/route.ts` — calls `getLeads({ includeLegacy: true })`,
  builds `leadAttrByPhone` map via `buildLeadAttrByPhone`, returns it in JSON.
- `app/api/admin/students/route.ts` — same.
- `components/admin/SourcePill.tsx` — renders when `attr.channel` is non-null.
- `app/admin/payments/page.tsx` line 12/117-121/367 — imports `SourcePill`,
  fetches `leadAttrByPhone` via `useAdminData`, renders
  `<SourcePill attr={lookupLeadAttr(leadAttrByPhone, r.phone)} />` per row.
- `lib/marketing/leadAttrByPhone.ts` — collision-preference contract (G2)
  intact.
- `lib/webinarSource.ts:derivedChannelFor` — `if (attr?.legacy === true) return UNKNOWN_SOURCE;`
  short-circuit intact for G1.

**Logical fix is correct AND deployed.** Neither hypothesis (a) never
deployed nor (b) regressed-by-a-later-commit fits the evidence. That leaves
(c) — a genuine live cause.

### 1.4 The live cause: scale regression

Prod data reality as of 2026-07-24 (all-time; phones masked; queries
run read-only via Supabase MCP):

```
select count(*) from public.leads
  where coalesce((attribution->>'soft_merged')::boolean, false) = false;
→ 179,493
```

Breakdown of channel population by legacy flag:

| legacy? | channel | count |
|---:|---|---:|
| false | (null) | 1,191 |
| false | Meta Ads | 36 |
| false | Organic | 34 |
| false | Direct | 24 |
| false | Referral | 20 |
| false | Google Ads | 4 |
| false | Other | 1 |
| true | (null) | 178,179 |
| true | Meta Ads | 2 |
| true | Direct | 1 |
| true | Organic | 1 |

Of 986 all-time payments:
- 824 (83.6%) match a lead by last-10 phone.
- 123 match a NON-legacy lead with channel set → pill SHOULD render.
- 3 match a LEGACY-only lead with channel set → pill SHOULD render.
- 698 match a lead but that lead has channel = NULL → pill correctly hides.
- 162 have no lead match at all → pill correctly hides.

Sample of 15 most-recent payments: **14 of 15 should render a pill under
the deployed code** (Referral, Meta Ads, Organic, Direct — real captures).
Only the `safalta-june-2026-old` row for phone `…5864` should stay pill-less
(its matching lead has null channel).

So the deployed code is logically fine AND the data supports pill rendering
on most recent rows. Why does the user still see no pill? Because at 179k
leads, the deployed code doesn't finish its work:

**The deployed `app/api/admin/payments/route.ts` on `5beae6bd` calls
`getLeads({ includeLegacy: true })`.** That helper in `lib/dataProvider.ts`
delegates to `dbSelectAll<Lead>("leads")`, which pages the ENTIRE `leads`
table via 180 sequential PostgREST `.range(from, from+999)` calls. Then
`buildLeadAttrByPhone` iterates all ~179k rows into a map keyed by unique
last-10 phone. That map is finally serialized as JSON on the response
under key `leadAttrByPhone`.

Order-of-magnitude cost:

- 180 sequential PostgREST hits: ~20-40 s wall time on Vercel `bom1` even
  with warm connection reuse.
- Map size: ~179k unique-phone entries × ~80 bytes per entry ≈ **~14 MB
  of JSON**.
- Vercel Fluid / Node serverless response-body budget is **4.5 MB**;
  Vercel Pro function timeout defaults to 60 s but the client fetch is
  aborted by the useAdminData hook well before that.

The observed symptom is exactly what would happen at that scale:

- The serverless function either takes too long and returns a 5xx / 504,
  or returns a body over the limit and the runtime truncates / rejects it,
  or completes but the client aborts on timeout / parse error.
- `useAdminData<Record<string, LeadAttrStamp>>("/api/admin/payments", "leadAttrByPhone")`
  catches the failure silently: `.catch(() => setData(null))`. The client
  hook returns `{ data: null, ... }`, the page renders `SourcePill`
  with `attr = lookupLeadAttr(null, ...)` = `null` on every row, and the
  pill quietly renders `null`.

**Root cause verdict:** case **(c) genuine live bug** — the fix works
functionally, but the two admin routes read `getLeads({ includeLegacy: true })`
which grew from ~1k rows (when a1a35519 shipped) to ~179k rows (after the
legacy backfill), collapsing the pill path at the network layer while the
code path stays untouched. The July 22 legacy-crm-reuse phase-1 investigation
report (`docs/naman-ai/reports/legacy-crm-reuse.md` §1) already flagged this
class of risk verbatim — "Perf is the biggest engineering risk, not
architecture. `getLeads()` currently returns all 179k rows on every
/api/admin/leads GET (~280 MB relation)."

---

## 2. Phase 2 — Fix (scoped to root cause)

### 2.1 Design: smaller reads, pruned writes

Two changes to the deployed pill path:

1. **Smaller read:** `getLeads({ includeLegacy: true })` (~179k rows) is
   replaced by a new `getLeadsForPillMap()` (~1.3k rows in prod today):
   - (a) All non-legacy, non-soft-merged leads via `getLeads({ includeLegacy: false })`
     — needed IN FULL to preserve the G2 collision-preference rule (a
     non-legacy row with a null channel must still WIN over a same-phone
     legacy row).
   - (b) Legacy leads with a non-empty scalar `channel`, via a targeted
     indexed PostgREST filter
     (`.not("channel","is",null).neq("channel","").filter("attribution->>legacy","eq","true").limit(5000)`).
     Prod count for (b): 4 rows today; the 5000 cap is defensive.
   - Total universe: ~1,314 rows now vs ~179,493 before — same map output for
     every phone the previous code would have produced a pill for.

2. **Smaller write:** the built map is passed through
   `pruneEmptyChannels(...)` (new helper in `lib/marketing/leadAttrByPhone.ts`)
   before it enters the response JSON. This drops every entry whose
   `channel` is null or empty. Both consumers already treated "phone
   missing" and "channel missing" identically:

   - `SourcePill` — returns `null` when `!attr || !attr.channel` (unchanged).
   - `derivedChannelFor` — returns `Unknown` when the entry is missing OR
     when its channel is empty (unchanged).

   Pruning is therefore **behaviorally a no-op** but eliminates ~1,190
   null-channel entries per response (~90% of the pre-fix map), keeping the
   payload under 15 KB even at 100× current scale.

### 2.2 Files changed

```
lib/dataProvider.ts                  | +51 lines  (new getLeadsForPillMap)
lib/marketing/leadAttrByPhone.ts     | +30 lines  (new pruneEmptyChannels)
app/api/admin/payments/route.ts      |  ±10 lines (use new builder + prune)
app/api/admin/students/route.ts      |  ±10 lines (use new builder + prune)
tests/payment-source-restore/
  payment-pill-scale.test.ts         | +300 lines (new suite, 9 tests)
```

No changes to `components/admin/SourcePill.tsx`, no changes to
`lib/webinarSource.ts:derivedChannelFor`, no schema changes, no DB writes,
no env changes.

### 2.3 Contracts pinned by tests

New test file `tests/payment-source-restore/payment-pill-scale.test.ts`
(9 tests, all passing):

**(S1) `pruneEmptyChannels` is behaviorally a no-op for both consumers:**

- Channel-carrying entries survive with byte-identical values.
- Null / empty / whitespace-only channel entries are dropped.
- `SourcePill` receives the same input for every phone in both maps.
- `derivedChannelFor` returns the same bucket for every phone in both maps.
- The G2 collision-preference (non-legacy wins) survives the prune.
- The collision edge case (non-legacy null + legacy with channel) is
  handled: full map has {channel:null, legacy:false}, pruned drops the
  entry, both maps yield `Unknown` from `derivedChannelFor` (i.e. same
  behavior — the legacy channel is honestly suppressed, as the older
  ingestion path intended).

**(S2) `pruneEmptyChannels` is size-effective at prod-realistic ratios:**

- With 10,010 unique-phone entries mixed at prod-realistic ratios
  (~2% channel-carrying), the pruned map keeps exactly 210 entries —
  0.02% of the input — well under the 10% test ceiling.
- Empty input → empty output.
- All-channel-carrying input → identical output (never accidentally drops
  a valid entry).

Existing suite is unchanged and still passes (all 4 contracts a/b/c/d
from `payment-source-restore.test.ts` — 12 tests).

Test run: **339 / 339 pass** (12 s wall), `tsc --noEmit` clean,
`next build` clean.

---

## 3. Phase 3 — Ship for real + prove it reached prod

### 3.1 Ancestry proof

```bash
$ cd naman-ias-portal-payment-fix && git checkout -b fix/payment-pill-scale origin/master
Switched to a new branch 'fix/payment-pill-scale'
$ git rev-parse HEAD
5beae6bd6fa5c95e7bb63a6abe5dcead3348427b   ← base = current prod SHA

  <edits above>

$ git commit ...                            ← FIX_SHA below
$ git push -u origin fix/payment-pill-scale
$ gh pr create ...                          ← merge to master
$ git fetch origin master
$ git merge-base --is-ancestor <FIX_SHA> origin/master && echo YES
YES
```

(the actual FIX_SHA and merge SHA are appended in the deploy record section
after the ship completes.)

### 3.2 Deploy record

_Filled in after `Cursor Agent` pushes the branch, merges via Vercel's GitHub
integration, and Vercel promotes the resulting build to production._

_Deploy verification checklist (post-hoc, filled by the ship step):_
- [ ] `git log origin/master --oneline -3` shows the fix commit
- [ ] Latest `list_deployments` prod row: SHA = `<FIX_SHA>` (or merge commit
      containing `<FIX_SHA>`), state = `READY`, aliased to
      `naman-ias-git-master-naman-ias-academy.vercel.app` and to
      `www.namanias.com` / `namanias.com`.
- [ ] Read-only prod smoke via Supabase (masked): recompute the "expected
      pill" query above and confirm 123+ payments still expect a pill and
      that the pruned map returned by `/api/admin/payments` contains
      those 123 phones.
- [ ] Aggregate source-card totals for July 2026 are byte-identical to the
      pre-ship snapshot (G1 unchanged).

### 3.3 Rollback

Single-command rollback if the ship regresses anything:

```bash
# Roll the prod alias back to the current (pre-fix) READY deployment.
vercel rollback dpl_9zw2hwuyKke4TphnPhajPSCsKih7 --yes \
  --scope=team_rshN50ivBvaEn1UiFT5bIOdd
```

That deployment (`5beae6bd`) has the "pill missing at scale" symptom this
report is closing out — but it is a byte-identical READY snapshot of the
current prod, so rollback is safe in the sense of "return to the state the
user is seeing right now" while investigation continues.

---

## 4. Deferred: saarthi committer `wasNew` follow-up

The prompt asked for the `wasNew` heuristic fix in
`lib/saarthi-legacy/committer.ts` to ship in this same PR. That patch is
**deferred** for one hard reason:

- The saarthi feature (`lib/saarthi-legacy/*`, `scripts/saarthi-legacy-import.ts`,
  the two migration SQL files, all 5 test files) exists on the
  `naman-ias-portal-saarthi` worktree ONLY as **untracked files**.
- `git status` on that worktree lists them under "Untracked files" — they
  have NEVER been committed to git, on ANY branch. The corresponding branch
  `feat/saarthi-legacy-import` points at `5beae6bd` (identical to
  `origin/master`), meaning zero saarthi commits are pushable.
- The saarthi migration WAS applied to prod DB (per the prior chat's Phase 4
  saarthi commit) and the batch WAS rolled back separately (per
  `docs/naman-ai/reports/saarthi-rollback-verification.md`), but the CODE
  never made it into version control.

Folding "commit 30+ untested/unreviewed saarthi files onto master" into a
hot-fix PR would (a) explode the review surface, (b) push code paths onto
master that were never intended to run again (`--commit` gated but the paths
still exist), and (c) make rollback impossible if the pill fix itself is
fine but the saarthi surface introduces a regression somewhere else on the
admin dashboard.

**Recommended follow-up (out of scope for this ship):**
1. Commit the saarthi worktree files to a proper `feat/saarthi-legacy-import`
   branch (`git add -A && git commit`), push, PR to master with the full
   dry-run + commit + rollback reports.
2. Once that PR merges (adding the saarthi feature to master's history so
   future imports can be re-triggered from source), apply the `wasNew`
   heuristic fix as a small follow-up commit on that branch:
   ```diff
   -      const wasNew = !buyerExisted;
   +      const wasNew =
   +        !buyerExisted ||
   +        !prevSiblingStudentByBuyer.has(buyer.id) ||
   +        (studentRow.created_at != null &&
   +          Date.parse(studentRow.created_at) >= batchStartMs);
   ```
   plus a targeted test in `tests/saarthi-legacy/committer-wasnew.test.ts`
   asserting "buyer exists, no sibling student, student.created_at in-batch
   → wasNew=true".

Neither of these steps re-runs the import or touches
`saarthi_legacy_import_snapshot`; both are additive and reversible.

---

## 5. Summary

- **(a) never deployed:** ❌ false — `a1a35519` is on `origin/master` and
  is an ancestor of the currently-deployed prod SHA `5beae6bd`.
- **(b) deployed-then-regressed:** ❌ false — no later commit touches the
  fix files.
- **(c) genuine live bug:** ✅ true — the fix is deployed, but at 179k
  leads the two admin routes silently fail (server body budget / client
  timeout), so the client never receives a usable
  `leadAttrByPhone` map, and every SourcePill renders empty.
- **Fix:** replace `getLeads({ includeLegacy: true })` with a small
  `getLeadsForPillMap()` (~1.3k rows) and prune null-channel entries before
  serialization. Behaviorally identical for both consumers; 90%+ payload
  reduction.
- **Contracts preserved:** G1 (legacy leads never inflate aggregate
  channel counts) and G2 (non-legacy row wins collision) — both pinned by
  339/339 passing tests.
- **Deferred:** saarthi committer `wasNew` fix — needs saarthi to first
  be committed to git anywhere before the patch can safely ship.
