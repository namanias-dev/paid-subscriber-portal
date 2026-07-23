# Payments Source Pill — Restore Report

**Branch:** `fix/payment-source-restore`
**Base:** `master @ c59c6ab9`
**Date:** 2026-07-23
**Guardrails honored:** G1 (thread the needle), G2 (real first_touch on
collisions), G3 (no data writes / no DDL / no importer / no SMS / no flag
flips), G4 (tsc + build + tests green before deploy), G5 (single squashable
branch + revertable), G6 (masked PII).

All PII in this report is masked: phones show last-4 only, names as initial,
emails as `prefix***@domain`.

---

## Root cause

The legacy-lead migration shipped on 2026-07-21 (`c84f2538` /
`2542f0c8`) added a legacy-aware option to the lead loader:

- `lib/dataProvider.ts:1648` — `getLeads(opts?: LegacyOptions)` now runs
  `applyLegacyFilter(rows, opts)` and DEFAULTS to `includeLegacy: false`.

That default is CORRECT for the seven aggregate call-sites documented in the
legacy-migration Phase 2+3 shipment (`docs/naman-ai/reports/
lead-migration-phase-2-3-shipment.md`) — Kanban list, dashboard counter,
source-card totals, SMS bulk audiences, campaign analytics. They all want
legacy rows OUT of aggregate counts.

But it also silently regressed the two admin ROUTES whose `getLeads()` call
was NOT counting anything — it was building a per-phone SOURCE-DISPLAY map
consumed by the read-only `SourcePill`:

| File | Line | What broke |
|---|---|---|
| `app/api/admin/payments/route.ts` | pre-fix `35` | `getLeads()` (default `includeLegacy: false`) → any payment whose phone matched ONLY a legacy row (or a real row over-flagged legacy by the buggy 2026-07-22T02:54:55.394Z batch) got NO entry in `leadAttrByPhone` → `SourcePill` rendered blank on the row. |
| `app/api/admin/students/route.ts` | pre-fix `86` | Same call, same regression on the People / Students row source pill. |

The `~129 collision leads` are the phones that exist BOTH in the live CRM and
the legacy sheet. Post-`c59c6ab9` collisions no longer set
`attribution.legacy=true` (the merge helper appends only to
`legacy_touches[]`), so their non-legacy status is stable going forward. A
handful (4 in prod) still carry the flag as a residual from the rolled-back
batch — those must still be treated as legacy for aggregate counts (G1) but
their preserved real `channel` should still be shown on the pill (G2).

### Evidence (git)

```
2542f0c8  Merge branch 'feat/legacy-lead-migration'          (merge commit)
c84f2538  feat(leads): legacy-lead migration + Sheets sync scaffold …
c59c6ab9  fix(legacy-import): collision merge must not flag pre-existing rows legacy
```

`git show c84f2538 -- app/api/admin/analytics/lead-campaigns/route.ts
app/api/admin/leads/route.ts lib/sms/audiences.ts lib/dataProvider.ts` shows
the seven-site refactor. The two ROUTES that render `SourcePill` were not
touched — they inherited the new default silently.

### Evidence (prod SQL, read-only, masked)

Queries executed via `plugin-supabase-supabase.execute_sql` (read-only). All
counts as of 2026-07-23 09:59 IST.

**Lead universe:**
```
total leads                                        179,469
attribution.legacy = 'true'                        178,183
import_source = 'legacy_sheet'                     178,312
channel_legacy IS NOT NULL                         178,312
non-legacy universe (returned by getLeads() today)   1,286
collision leads (import_source='legacy_sheet',
  attribution.legacy IS NOT 'true')                    129
residual buggy-batch legacy=true w/ real channel       4
```

**Payments (873 total, phone-keyed):**
```
no lead match                                          112
matched legacy-flagged lead                             59
   … of which have channel populated                    3   (buggy residuals)
matched non-legacy lead                                702
   … of which have channel populated                   95
```

Interpretation:

- 59 payments today have NO source pill because their matching lead is
  `attribution.legacy=true`. Of those, only 3 have a real channel (residuals).
- Once we broaden the map to `includeLegacy: true` and mark the entries with
  the legacy flag, **3 additional pills** are restored on the payments page
  (small in aggregate; the fix is primarily forward-looking: any future
  under-tagging of a real lead as legacy stops silently blanking its pill).
- 129 collision leads (post-fix) have `attribution.legacy` UNSET → they are
  currently counted as NON-legacy by the fix. Their scalar `channel` is
  populated for **14** of them (the rest are older leads with no captured
  channel — SourcePill correctly renders nothing for those, honest).

---

## Fix (implemented, per G1–G3)

Zero data writes, zero DDL, zero flag flips, zero SMS. Display/query logic only.

### New shared helper

`lib/marketing/leadAttrByPhone.ts` — pure builder used by both admin routes.
Contract:

1. Loops all leads returned by `getLeads({ includeLegacy: true })`.
2. Normalizes phone via `normPhone` (last-10 digits) — same convention
   `SourcePill.lastDigits10` uses on the reader side.
3. Preference order (deterministic, order-independent):
   1. Non-legacy lead (`hasLegacyFlag === false`) always beats a legacy lead
      when both exist for the same phone → **collision-lead contract G2:**
      the ~129 collision phones surface their PRESERVED real
      `attribution.first_touch` (materialized on the scalar `channel` column
      at real ingestion). Never the appended `legacy_touches[]` — that array
      is never read here.
   2. Given equal legacy status, first row wins (order stable).
4. Every entry carries `legacy: boolean` captured from `hasLegacyFlag(lead)`.

### Source-card counts stay legacy-free

`lib/webinarSource.ts::derivedChannelFor` now short-circuits any map entry
whose `legacy === true` back to `"Unknown"`. That keeps the aggregate
source-card totals + Source filter bucketing byte-identical to the
pre-shipment legacy-EXCLUDED numbers (**G1**): including legacy leads in the
DISPLAY map does not re-pollute analytics.

### Display path is not gated on `legacy`

`SourcePill` renders the pill whenever `attr.channel` is populated. A
residual buggy-batch row with a real captured channel (Meta Ads / Google Ads /
Organic) IS a real customer's honest source and should be visible; the
`legacy` flag on the map entry is purely informational for the counts path.

### Files changed

| File | Why |
|---|---|
| `app/api/admin/payments/route.ts` | Call `getLeads({ includeLegacy: true })`; build `leadAttrByPhone` via the shared helper; extend `PaymentsLeadAttr` with optional `legacy?: boolean`. |
| `app/api/admin/students/route.ts` | Same fix (People / Students row SourcePill). |
| `components/admin/SourcePill.tsx` | Extend `LeadAttrStamp` with optional `legacy?: boolean` (informational). Rendering unchanged. |
| `lib/webinarSource.ts` | Extend `DerivedChannelAttr` with optional `legacy?: boolean`; `derivedChannelFor` returns `UNKNOWN_SOURCE` on `legacy === true`. |
| `lib/marketing/leadAttrByPhone.ts` | **NEW** — shared pure builder documented above. |
| `tests/lead-migration/legacy-isolation.test.ts` | Update the source-card assertion: the map now DOES include legacy entries, but `derivedChannelFor` short-circuits them to Unknown — the aggregate invariant survives. |
| `tests/payment-source-restore/payment-source-restore.test.ts` | **NEW** — 12 regression assertions across the four required contracts. |
| `package.json` | Include the new test folder in the `test` script. |

### Other surfaces checked

- `app/api/admin/sms/meta/route.ts` — SMS `leadSources` dropdown uses default
  `getLeads()` (legacy-free). LEFT UNCHANGED — the SMS surface must never
  expose legacy phones by default (documented in `lib/sms/audiences.ts`).
- `lib/sms/audiences.ts` — 3 explicit `getLeads({ includeLegacy: false })`
  calls. LEFT UNCHANGED — CRITICAL SMS safety.
- `app/api/admin/analytics/lead-campaigns/route.ts` — explicit
  `getAllLeadsRaw({ includeLegacy: false })`. LEFT UNCHANGED — campaign
  analytics counts must exclude legacy.
- `app/api/admin/leads/route.ts` — Kanban list, `?include_legacy=1` URL toggle.
  LEFT UNCHANGED — future admin "Show legacy" toggle.
- `app/api/admin/students/[id]/route.ts` — per-student header pill via
  `findActiveLeadByPhone` (returns oldest live row for the phone; not the
  filtered `getLeads()` universe). Verified fine as-is: collision live row is
  preserved, its `channel` is real.
- Lead INGESTION path — `lib/dataProvider.ts::addLead`,
  `lib/marketing/leadAttribution.ts::leadAttributionFromState +
  newLeadAttributionColumns`. Verified pure and untouched by the legacy
  migration; explicit regression tests added (contract d).

---

## Test results

`npx tsc --noEmit`: **clean** (0 errors, ~9.5s).

`rm -rf .next && npm run build`: **clean** (0 errors, 0 warnings blocking,
~136s, all routes prerendered as static/dynamic per prior config).

`npm run test`: **331/331 pass** (~18.5s), including:

- **12 new regression tests** in `tests/payment-source-restore/
  payment-source-restore.test.ts`:
  - `(a) normal payment resolves the correct SourcePill` — 3 tests
  - `(b) collision-lead payment shows its ORIGINAL non-legacy source` — 3
    tests (both-orders map preference, post-fix collision, buggy residual
    display vs count split)
  - `(c) legacy leads stay OUT of aggregate channel counts (source card)` —
    3 tests (pure legacy w/ residual channel, pure legacy w/ null channel,
    reconcile 5-phone mixed set)
  - `(d) ingestion path records source scalars correctly` — 3 tests (fbclid
    → Meta Ads, gclid → Google Ads, empty stamp writes zero columns)

- **Updated** `tests/lead-migration/legacy-isolation.test.ts` — asserts the
  new mechanism (map includes legacy; `derivedChannelFor` short-circuits it)
  and adds a non-legacy control (same channel string must still route to the
  real channel — legacy short-circuit is scoped to `legacy === true` only).

- All 319 pre-existing tests still pass (unchanged).

---

## Prod smoke (pre-deploy, read-only, masked)

Sample of 5 recent captured payments matched to a lead (all details masked):

```
payment_id  masked_phone   student_initial   lead_channel     is_legacy?
p_2A5F       ******4321          A              Meta Ads         no
p_2A46       ******9970          B              Google Ads       no
p_29F1       ******6788          S              Organic          no
p_29E3       ******5510          D              Meta Ads         no
p_29B2       ******9002         (none)          NULL             no  ← honest, no pill
```

Baseline counts (used for post-deploy diff):

```
paid webinar registrations                       (per source card)   [snapshot below]
non-legacy leads with channel populated                                95
legacy-flagged leads with residual channel                              4
payments matched to legacy-flagged lead                                59
payments matched to legacy-flagged lead with channel                    3
```

---

## Exact rollback command

If any post-deploy check fails or a bug is reported, revert immediately:

```bash
# 1. Revert the merge on master and push
git -C /Users/ashar139/Projects/naman-ias-portal-master checkout master
git -C /Users/ashar139/Projects/naman-ias-portal-master pull --ff-only
git -C /Users/ashar139/Projects/naman-ias-portal-master revert --no-edit <MERGE_COMMIT_SHA>
git -C /Users/ashar139/Projects/naman-ias-portal-master push origin master

# 2. Vercel: either wait for the revert build, or promote the prior READY
#    deployment via the Vercel MCP (`plugin-vercel-vercel.deploy_to_vercel`
#    or promote in the dashboard). Alias `namanias.com` should point back to
#    the pre-fix commit within ~90s.
```

`<MERGE_COMMIT_SHA>` will be filled in by Phase 4 below once the squash-merge lands.

---

## Deploy record

_(populated by Phase 4 automation — deploy id, alias, timestamp, post-deploy
smoke checks with masked evidence — see the section appended below after
merge)_
