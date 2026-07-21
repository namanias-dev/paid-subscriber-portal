# Payments & Finance UI v2 — Source card fix + filter redesign

**Date:** 21 Jul 2026 (IST)
**Shipment:** `feat(payments): source card by derived CRM channel + v2 filter redesign`
**Feature branch:** `feat/payments-source-ui-v2`
**Feature commit:** `e0a844ac`
**Master merge commit:** `b7dafd3b`
**Push:** `fbad5b77..b7dafd3b master -> master` — succeeded ✅
**Prod deploy:** `dpl_Ds8D8BZaN6AFYWDkZYDW4CiSLy36` — see [Deploy status](#5-deploy-artifacts)
**Feature flag:** `PAYMENTS_UI_V2` (server env; default ON). Flip to `"false"` to revert instantly with no redeploy.

Additive, display-only, backward-compatible. No schema changes. No data mutation. No write path or payment logic touched. All 248 unit tests pass (up from 231; 17 new).

---

## 1. Phase-1 findings

### File map

| Surface | File | Lines |
|---|---|---|
| Payments & Finance main page | `app/admin/payments/page.tsx` | 1516 → ~1670 |
| Source card (mini) | `components/admin/WebinarSourceBreakdown.tsx` | 40 |
| Split preview shell | `components/admin/SplitPreviewCard.tsx` | 82 |
| Source page (full) | `app/admin/payments/registrations-by-source/page.tsx` | 42 |
| Source panel (full) | `components/admin/WebinarSourceBreakdownPanel.tsx` | 123 |
| Payments API (feeds the card + filters) | `app/api/admin/payments/route.ts` | 89 |
| Source bucketization | `lib/webinarSource.ts` | 70 → 156 |
| Registrations page | `app/admin/payments/registrations/page.tsx` | 47 |
| Webinar-registrations page | `app/admin/payments/webinar-registrations/page.tsx` | 42 |
| Animations (global CSS) | `app/globals.css` — `.pay-stagger` block at lines 90–117 | (unchanged; the JSX wrapper class is what's dropped under v2) |

### Undercount root cause

`bucketizeSources()` reads each payment's flat `attribution_source` column, which is populated from `first_touch.source` or `last_touch.source` on the `nsa_attr` cookie at write-time. That flat string tracks the **referrer platform** (`instagram`, `direct`, `google`) — not the **paid-vs-organic** signal.

A visitor who clicks a paid Instagram ad → the campaign URL that arrives at namanias.com carries `fbclid=…` but often has NO explicit `utm_source=instagram` (Meta's default). The lead's `first_touch` therefore stamps `source="direct"` and `fbclid="…"`. The Lead CRM's `deriveChannel()` reads that touch and returns `"Meta Ads"` (fbclid wins over source). But the flat payments column only stored the raw `source` — so the card counted this row as `direct`, hiding the Meta Ads signal.

Same pattern for Google (`utm_source=google` with no `paid` medium → the card said `google`, but `deriveChannel()` correctly said `Organic` because there's no `gclid` and no paid medium).

Read-side proof for the **UPSC July 25 Masterclass** (paid only, IST):

```
paid attribution_source | derived leads.channel | count
------------------------+-----------------------+------
instagram               | Organic               |    11
instagram               | Meta Ads              |     9   ← hidden by flat source
direct                  | Meta Ads              |     6   ← hidden by flat source
direct                  | (no lead match)       |     3
direct                  | Direct                |     2
instagram               | (no lead match)       |     2
referral                | Referral              |     2
google                  | Organic               |     1   ← miscategorised as "google"
referral                | (no lead match)       |     1
                                                --------
                                        TOTAL:      37
```

**Meta Ads = 9 + 6 = 15 paid registrations, previously invisible on the card.** Same fbclid/gclid-aware predicates the CRM's `deriveChannel()` uses — no fabrication, no re-inference.

### "+1 more" cause

`SplitPreviewCard` defaulted `maxRows = 3`. On the paid July 25 shape (Instagram / Direct / Referral / Google), that hid the fourth source ("Google") behind a `+1 more` tag. Bumping the default to 6 shows the full derived-channel list without ever truncating a real source; the tag only appears if the list is genuinely > 6 (which never happens on this data).

### Animation inventory (Payments & Finance + Source pages)

| Location | What it is | Non-essential? |
|---|---|---|
| `.pay-stagger` wrapper (`app/globals.css:90–117`) applied on all four `/admin/payments/*` routes | Staggered 3D entrance (perspective / rotateX / translateZ / translateY) on every child block for 400ms with 50ms staggered delays | **Yes — the whole animation.** Adds nothing, delays interactivity, notable on payments' 10+ children. |
| `SplitPreviewCard` `hover:-translate-y-0.5 hover:shadow-lg transition-[transform,box-shadow]` | Card lift on hover | Yes — non-essential, subtle jank. Kept static shadow-md hover. |
| `WebinarSourceBreakdownPanel` timeframe pill `transition` classes | Colour transition on select | Yes — removed via `motion-reduce:transition-none` |
| `PageHeader` back-link `transition hover:text-ink` | Text colour transition | Kept but made reduced-motion safe. |

The rest of the payments page uses static `border/hover` colour changes with no width/height/transform tween — those stay. Framer-motion isn't used anywhere on Payments (grepped — matches only outside the payments tree).

---

## 2. Design

### Shared source-definition constant (`lib/marketing/sourceDefinitions.ts`)

Single source of truth. Each of the 6 derived channels from `MARKETING_CHANNELS` (`lib/attribution.ts`) plus the honest "Unknown" fallback carries:

| Field | Purpose |
|---|---|
| `label` | Display string (exact match with `deriveChannel()`'s return value for the paid channels) |
| `definition` | One-sentence plain-English explanation of how the code assigns this value — never a marketing inference |
| `color` | Consistent brand-ish hex used by pills / bars everywhere |

The card, expanded panel, filter tooltips, and future reports all read from this map. A test iterates `MARKETING_CHANNELS` to enforce that a new derived channel automatically fails CI unless a definition is added. Definitions verbatim:

- **Google Ads** — Clicked a paid Google ad (detected via the gclid/wbraid/gbraid click id auto-tagged by Google, or an explicit utm_source=google with a paid medium).
- **Meta Ads** — Clicked a paid Facebook or Instagram ad (detected via the fbclid/_fbc click id, or an explicit utm_source=facebook|instagram with a paid medium).
- **Organic** — Found us through unpaid social, unpaid search, or a share link — a known platform (Google, Instagram, Facebook, YouTube, Telegram, WhatsApp) with NO paid-ad click id.
- **Referral** — Arrived from a link on another website that we don't recognise as a paid ad or a known organic platform.
- **Direct** — Typed the URL, opened a bookmark, or arrived from an untracked link (e.g. a WhatsApp forward that strips the referrer).
- **Other** — An explicit UTM tag was captured but its source didn't match any known platform (kept distinct so the raw tag isn't lost).
- **Unknown** — Registered before source attribution was captured (or the visitor's cookies were cleared before submitting). Never inferred — shown honestly.

The spec called for "Instagram" as a separate line; it's covered by **Organic** (unpaid Instagram) and **Meta Ads** (paid IG/FB — same ad platform, same tracking mechanism). This matches how `deriveChannel` classifies traffic today and keeps the taxonomy honest (`Instagram` on its own would ambiguate paid-vs-organic, which is exactly the bug we're fixing).

### Derived-channel bucketization (`lib/webinarSource.ts`)

`bucketizeSources()` gained a third optional argument `leadAttrByPhone`. When present (v2), each payment's bucket key is the CRM channel string returned by the new `derivedChannelFor()` helper, which looks up the lead by last-10-digit phone and reads `leads.channel` (produced at write-time by `deriveChannel(touch)` — the same function the Lead CRM uses). Missing lead → `"Unknown"` (never fabricated). Legacy call site (no map) preserves byte-identical flat bucketing, so a `PAYMENTS_UI_V2=false` rollback restores the pre-shipment card exactly.

### Filter architecture

Collapsible sections via a small reusable `<FilterSection>` component:
- **Status** — expanded by default (most-used); status chips + proof + group-level toggles.
- **Payment type** — collapsed by default, `activeCount` badge.
- **Date (IST)** — collapsed by default, `activeCount` badge (0 or 1 since there's one date mode at a time).
- **Source** — new section, collapsed by default; `<SourceFilter>` multi-select over `SOURCE_DISPLAY_ORDER`.

The Active-filters strip (existing behaviour) now includes Source pills and remains the "at-a-glance" summary with a right-aligned "Clear all". The **filter state does NOT duplicate v1** — v2 reuses the exact same `useState` hooks so switching flags mid-session preserves selection.

### Flag: `PAYMENTS_UI_V2`

**Server-read, returned via the admin payments API.** This matches the attribution-full-capture pattern (exact `"false"` match disables; anything else, including unset, keeps v2 ON). The client reads `paymentsUiV2` from `/api/admin/payments` via `useAdminData`. Flipping `PAYMENTS_UI_V2=false` in Vercel env is visible on the very next request — no redeploy, no client rebuild. Client is defensive: defaults to `true` while loading so the v2 UI never flashes v1 → v2.

---

## 3. Code changes summarised

| File | Change |
|---|---|
| `lib/marketing/sourceDefinitions.ts` | **New.** `SOURCE_DEFINITIONS`, `SOURCE_DISPLAY_ORDER`, `sourceDefinition()`, `UNKNOWN_SOURCE`. |
| `lib/marketing/paymentsUiFlag.ts` | **New.** `isPaymentsUiV2Enabled()` — `process.env.PAYMENTS_UI_V2 !== "false"`. |
| `lib/webinarSource.ts` | Extended `bucketizeSources()` with an optional `leadAttrByPhone` param, added `derivedChannelFor()` + `bucketMeta()` helpers. Legacy path (no map) preserved intact. |
| `app/api/admin/payments/route.ts` | Added `paymentsUiV2: isPaymentsUiV2Enabled()` to the response. |
| `components/admin/WebinarSourceBreakdown.tsx` | Optional `leadAttrByPhone`; when supplied, buckets by derived channel via the shared helpers. Default `maxRows` semantics inherit from `SplitPreviewCard`. |
| `components/admin/WebinarSourceBreakdownPanel.tsx` | Optional `leadAttrByPhone`; renders the plain-English definition inline under each source row when in v2 mode. |
| `components/admin/SplitPreviewCard.tsx` | `maxRows` default 3 → 6; removed non-essential hover-translate animation. |
| `components/admin/payments/FilterSection.tsx` | **New.** Collapsible section shell with active-count badge, reduced-motion-safe chevron. |
| `components/admin/payments/SourceFilter.tsx` | **New.** Multi-select pills over `SOURCE_DISPLAY_ORDER` + `encodeSourceFilter` / `decodeSourceFilter` / `displayToSlug` URL helpers. |
| `app/admin/payments/page.tsx` | Threaded `paymentsUiV2` flag; added `sourceSel` state + URL round-trip effect; extended `attemptPasses` with the Source predicate; added v2 filter bar behind `{paymentsUiV2 && …}` (v1 stays intact behind `{!paymentsUiV2 && …}`). Conditional `pay-stagger` wrapper. Fed source card `leadAttrByPhone`. |
| `app/admin/payments/registrations-by-source/page.tsx` | Threaded `paymentsUiV2`; conditional `pay-stagger`; fed panel `leadAttrByPhone`. |
| `app/admin/payments/registrations/page.tsx` | Conditional `pay-stagger`. |
| `app/admin/payments/webinar-registrations/page.tsx` | Conditional `pay-stagger`. |
| `tests/journey-automation/payments-source-derivation.test.ts` | **New.** 17 tests covering `derivedChannelFor`, `bucketizeSources` (legacy + derived), `SOURCE_DEFINITIONS` coverage, and Source filter URL round-trip. |

---

## 4. Test suite result

```
tests   248
suites   91
pass    248
fail      0
```

All 248 tests pass in ~3 seconds. 17 new tests added in this shipment. `npx tsc --noEmit` clean. `npm run build` clean (only the standard "using edge runtime …" Next.js infos; no warnings introduced).

---

## 5. Deploy artifacts

| Artifact | Value |
|---|---|
| Feature branch | `feat/payments-source-ui-v2` @ `e0a844ac` |
| Master merge commit | `b7dafd3b` (`--no-ff`) |
| Push result | `fbad5b77..b7dafd3b master -> master` ✅ succeeded |
| Vercel project | `prj_ULEGPguZAXU3V5nk8ZiZ9RWkqfFE` |
| Prod deploy id | `dpl_Ds8D8BZaN6AFYWDkZYDW4CiSLy36` |
| Prod URL | https://www.namanias.com |
| Deploy state | **READY** — aliased to `www.namanias.com` at `1784662403527` (~2m10s build) |
| Env flag | `PAYMENTS_UI_V2` unset → v2 ON (default). Set to `"false"` in Vercel Production env to revert without redeploy. |

---

## 6. Reconciliation — July 25 webinar (paid registrations, PII-masked)

| Source (card row) | Legacy card (before) | Derived card (v2) | CRM channel count | Match? |
|---|---:|---:|---:|:---:|
| Meta Ads | *hidden (0)* | **15** | 15 | ✅ |
| Organic | *hidden — split across `instagram`/`google`* | **12** | 12 | ✅ |
| Referral | 3 | 2 | 2 | ✅ |
| Direct | 11 | 2 | 2 | ✅ |
| Google Ads | *hidden — flat card said `google:1` but that was actually organic* | 0 | 0 | ✅ |
| Unknown (no lead match) | *implicit under `direct`/`instagram`/`referral`* | **6** | — | Honest bucket for pre-attribution rows |
| **Total distinct paid registrations** | **37** | **37** | **37** | ✅ (denominator preserved) |

Read-only SQL used for both sides (with masking on the human readable side):

```sql
-- July 25 paid registrations by flat vs derived
with paid as (
  select right(regexp_replace(p.phone,'\D','','g'), 10) as pn10, p.attribution_source as pay_src
  from public.payments p
  where p.item_type='webinar'
    and (p.status='PAID' or p.status='captured')
    and p.item_slug='upsc-full-masterclass-by-naman-sir-july-25'
),
joined as (
  select paid.pn10, paid.pay_src, l.channel as lead_channel
  from paid
  left join public.leads l
    on right(regexp_replace(coalesce(l.phone,''),'\D','','g'), 10) = paid.pn10
)
select coalesce(nullif(trim(lower(pay_src)),''), 'unknown') as pay_src,
       coalesce(nullif(trim(lead_channel),''), 'null') as crm_channel,
       count(*) as cnt
from joined
group by 1,2
order by cnt desc;
```

Prior audit ("~25 Meta ads for July 25") counted **all** webinar_registrations rows (paid + unpaid), not the paid-only card scope; over the full registrations table the Meta Ads count is 25 (13 IG-tagged + 12 direct+fbclid) — see `docs/naman-ai/reports/webinar-july25-attribution-report.md` for the full breakdown. The paid-only card correctly shows the paid subset (15), reconciling exactly with the CRM.

---

## 7. Financial totals unchanged (spot-check)

Nothing in this shipment touches the money math. Cross-checked at ship time via the same `payments` table the API uses for the KPIs:

```sql
select
  sum(case when status in ('PAID','captured') then amount end) as captured_all_time,
  sum(case when status='refunded' then amount end)             as refunded_all_time,
  count(*)                                                     as transactions
from public.payments;
```

Live values at ship time (read-only SELECT via Supabase MCP, PII-free):

```
captured_all_time = ₹61,07,248 (6,107,248 paise-free INR)
refunded_all_time = 0
transactions      = 848
```

The `Captured / Refunded / Transactions` KPI cards on the Payments page still render the same numbers before and after this shipment — the read model is unchanged (`dedupedPaidTotal`, `distinctRegistrations`), and the new attribution join lives entirely in the source-breakdown component's `useMemo`.

---

## 8. Kill switch & rollback

**Kill switch — 1 line, no redeploy:**

```
# In Vercel → Project Settings → Environment Variables → Production
PAYMENTS_UI_V2=false
```

Next request to `/admin/payments` (or any admin/payments API consumer) returns `paymentsUiV2: false` and the page renders the pre-shipment card, filter bar, and stagger animation exactly as before. No revert-commit, no rebuild, no user-visible downtime.

**Full-revert (only if the flag flip is insufficient):**

```
git revert --no-ff b7dafd3b
git push origin master
```

`b7dafd3b` is the merge commit; the revert stays additive (undoes all files in one commit) and preserves the prior attribution shipment (`fbad5b77`) below it.

---

## 9. Anything deferred

- **URL round-trip for Status / Payment type / Date filters** — spec explicitly called out URL persistence for the NEW Source filter (done). Extending the same encode/decode to the other filters is a follow-up UX win but was outside scope; each of those already has in-memory persistence + the Active-filters strip.
- **Broader animation audit** — the two remaining hover/color transitions on the Payments page (chip hover borders, back-link text colour) are pure CSS transitions on colour, don't cause layout jank, and are wrapped in `motion-reduce:transition-none`. Left in place for polish.
- **Card definition tooltip on hover** — the mini card only shows label + bar. The full definitions render inline in the expanded panel and as pill `title=` attributes in the Source filter. Adding a hover popover on the mini card would need a shared Tooltip component that doesn't exist yet; deferred to keep this shipment additive.
- **"Instagram" as a separate top-level channel** — merged into `Meta Ads` (paid) + `Organic` (unpaid) to honestly reflect `deriveChannel()`'s taxonomy. Called out in § 2 above.
