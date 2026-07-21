# Full Ad-Identifier Capture — Shipment Report

- **Feature branch**: `feat/attribution-full-capture`
- **Feature commit sha**: `fe1c83347a2db353008d30fab5e9095b423b3da7`
- **Master merge sha (local)**: `4df1fe09e4ea2cd98c25fb8fabef0ed1d1dabe50`
- **Migration file**: `supabase/migrations/2026-07-21-attribution-full-capture.sql`
- **Rollback file**: `supabase/migrations/2026-07-21-attribution-full-capture-rollback.sql` (manual)
- **Migration status on prod**: **APPLIED** (project `xqwdfyzerzsllqiyzxem`)
- **Prod code deploy status**: **PENDING** — see [§5](#5-deploy-artifacts). Prod runtime is still on `d005087b` and does **not** write to the new columns yet, so the applied migration is a no-op for the running app. Nothing is broken; nothing sends.

## 1. Phase-1 investigation summary

**Current attribution schema (before shipment, per `information_schema`):**

| table | attribution columns present today |
|---|---|
| `webinar_registrations` | `attribution_source`, `attribution_campaign`, `attribution_fbclid`, `attribution_fbc` |
| `payments` | `attribution_source`, `attribution_campaign` |
| `leads` | `channel`, `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`, `gclid`, `referrer`, `landing_page_path`, `attribution` (JSONB) |

**Write-path map (before → after):**

| entry point | file:line | today | after this shipment |
|---|---|---|---|
| Landing URL → cookie | `lib/analytics/client.ts:62–95` (`captureAttribution`, called from `components/analytics/Tracker.tsx:19–31`) | Parses `utm_*` (source/medium/campaign/content/term) + `fbclid` + `gclid` + `_fbp/_fbc`, calls `buildTouch` + `mergeAttribution`, writes `nsa_attr` cookie. | Additionally parses `utm_id`, `campaign_id`, `adset_id`, `ad_id`, `ad_name`, `wbraid`, `gbraid` and stitches them into the same touch. |
| Server helper | `lib/marketing/requestAttribution.ts` | Reads `nsa_attr` from `cookies()`, returns `LeadAttribution`. | Unchanged — cookie carries the new fields for free. |
| `/api/public/webinar-register` | `app/api/public/webinar-register/route.ts:30–35` | Reads `nsa_attr`, passes to `registerWebinar`. | Unchanged. |
| `registerWebinar` write | `lib/dataProvider.ts:2074–2109` | INSERT `webinar_registrations` with `attribution_source/campaign/fbclid/fbc`. | + spreads `adCaptureStampFromState(attr)` when `isFullCaptureEnabled()`; else spreads `EMPTY_AD_CAPTURE_STAMP` (all-null new columns). |
| `addLead` (from webinar reg + public lead) | `lib/dataProvider.ts:1727–1789` | Uses `newLeadAttributionColumns` — `attribution` JSONB blob already carries the full touch. | Unchanged — the new touch fields ride the JSONB automatically. |
| Course/webinar/plan checkout | `app/api/v1/bank/create-payment/route.ts:126–213` (two `createPayment` calls) | `attribution_source/campaign` on the payment row. | + spreads `adStamp` (or `EMPTY_AD_CAPTURE_STAMP` when flag OFF) on both calls. |
| Course installment/full-pay | `app/api/v1/enroll/pay/route.ts:98–122` | `attribution_source/campaign` on the payment row. | + spreads `adStamp` on the createPayment call. |
| Course initial enrollment payment | `app/api/v1/enroll/create-payment/route.ts:162–183` | Does NOT stamp attribution today (delegates capture to the fetch-forward `/api/public/lead` call). | **Deferred** — not in the original legacy-attribution set; leaving as-is to keep the diff minimal. |

**Design chosen (smallest additive diff):**

- Extend `AttributionTouch` with 7 new optional fields — they ride the same `nsa_attr` cookie so persistence + first-touch precedence + cross-page carry-forward are free.
- Extend `mergeAttribution` last-touch stickiness to include the 5 ad-hierarchy fields (`utm_id/campaign_id/adset_id/ad_id/ad_name`) plus `wbraid/gbraid` — same pattern the existing code already uses for `campaign/fbclid/fbc/fbp/gclid`.
- Extend `touchIsMeaningful` and `touchHasAcquisitionSignal` to recognize `campaign_id/adset_id/ad_id/wbraid/gbraid` as strong signals — so a bare "just an ad_id" landing is treated as a paid acquisition worthy of first-touch, not demoted to Direct.
- Add `derivePlatform` — `"meta" | "google" | "other" | null` — sharing the exact same `PAID_MEDIA` predicate and click-id checks as `deriveChannel` (no fork).
- Ship a thin `lib/marketing/adCaptureStamp.ts` adapter that maps state → 7 flat scalar columns. First-touch wins; never fabricates a value.
- Feature-flag the WRITES only (`ATTRIBUTION_FULL_CAPTURE_ENABLED`, default ON, `"false"` disables). Reads are unconditional.
- Additive migration only on `webinar_registrations` + `payments` (7 nullable text columns each + 3 partial indexes each). `leads.attribution` JSONB picks up the new fields with no schema change.

## 2. Migration SQL (verbatim)

### Forward — `supabase/migrations/2026-07-21-attribution-full-capture.sql`

```sql
alter table public.webinar_registrations
  add column if not exists attribution_campaign_id text,
  add column if not exists attribution_adset_id    text,
  add column if not exists attribution_ad_id       text,
  add column if not exists attribution_ad_name     text,
  add column if not exists attribution_utm_content text,
  add column if not exists attribution_utm_term    text,
  add column if not exists attribution_platform    text;

alter table public.payments
  add column if not exists attribution_campaign_id text,
  add column if not exists attribution_adset_id    text,
  add column if not exists attribution_ad_id       text,
  add column if not exists attribution_ad_name     text,
  add column if not exists attribution_utm_content text,
  add column if not exists attribution_utm_term    text,
  add column if not exists attribution_platform    text;

create index if not exists idx_webreg_attribution_ad_id       on public.webinar_registrations (attribution_ad_id)       where attribution_ad_id is not null;
create index if not exists idx_webreg_attribution_campaign_id on public.webinar_registrations (attribution_campaign_id) where attribution_campaign_id is not null;
create index if not exists idx_webreg_attribution_platform    on public.webinar_registrations (attribution_platform)    where attribution_platform is not null;

create index if not exists idx_payments_attribution_ad_id       on public.payments (attribution_ad_id)       where attribution_ad_id is not null;
create index if not exists idx_payments_attribution_campaign_id on public.payments (attribution_campaign_id) where attribution_campaign_id is not null;
create index if not exists idx_payments_attribution_platform    on public.payments (attribution_platform)    where attribution_platform is not null;
```

Applied to production project `xqwdfyzerzsllqiyzxem` via Supabase MCP `apply_migration` at 2026-07-21 (migration name `2026_07_21_attribution_full_capture`). Verified via `information_schema.columns` and `pg_indexes` — see §6.

### Rollback — `supabase/migrations/2026-07-21-attribution-full-capture-rollback.sql`

Header prominently marks `⚠️ MANUAL — DO NOT AUTO-APPLY`. Preferred first-line reversal is the ENV FLAG (no DB change). SQL body:

```sql
drop index if exists public.idx_payments_attribution_platform;
drop index if exists public.idx_payments_attribution_campaign_id;
drop index if exists public.idx_payments_attribution_ad_id;
drop index if exists public.idx_webreg_attribution_platform;
drop index if exists public.idx_webreg_attribution_campaign_id;
drop index if exists public.idx_webreg_attribution_ad_id;

alter table public.payments
  drop column if exists attribution_platform,
  drop column if exists attribution_utm_term,
  drop column if exists attribution_utm_content,
  drop column if exists attribution_ad_name,
  drop column if exists attribution_ad_id,
  drop column if exists attribution_adset_id,
  drop column if exists attribution_campaign_id;

alter table public.webinar_registrations
  drop column if exists attribution_platform,
  drop column if exists attribution_utm_term,
  drop column if exists attribution_utm_content,
  drop column if exists attribution_ad_name,
  drop column if exists attribution_ad_id,
  drop column if exists attribution_adset_id,
  drop column if exists attribution_campaign_id;
```

## 3. Code changes (files touched, summary)

| file | change |
|---|---|
| `lib/attribution.ts` | Extended `AttributionTouch` with `utm_id / campaign_id / adset_id / ad_id / ad_name / wbraid / gbraid`. Extended `buildTouch` to accept the new params. Extended `mergeAttribution` last-touch stickiness for those fields (never lets an untagged later hop erase the ad-level ids). Extended `touchIsMeaningful` + `touchHasAcquisitionSignal` to recognize the new signals. Added `derivePlatform(touch)` returning `"meta" | "google" | "other" | null`, sharing the exact `PAID_MEDIA` predicate + click-id checks with `deriveChannel` (no fork). |
| `lib/analytics/client.ts` | `captureAttribution` now parses `utm_id / campaign_id / adset_id / ad_id / ad_name` from the URL alongside `utm_*`, plus `wbraid / gbraid` alongside `gclid`. Everything stitches into the same touch and rides the same `nsa_attr` cookie. |
| `lib/marketing/adCaptureFlag.ts` | New — `isFullCaptureEnabled()`: `process.env.ATTRIBUTION_FULL_CAPTURE_ENABLED !== "false"`. Default ON. |
| `lib/marketing/adCaptureStamp.ts` | New — pure adapter. Exports `AdCaptureStamp` interface + `EMPTY_AD_CAPTURE_STAMP` + `AD_CAPTURE_SCALAR_COLUMNS` + `adCaptureStampFromState(state)`. First-touch wins; falls back to last-touch; returns EMPTY when neither. Never fabricates. |
| `lib/dataProvider.ts` | `registerWebinar`: builds `insertRow` with the existing 4 attribution columns; when `isFullCaptureEnabled()` spreads `adCaptureStampFromState(attr)` before the INSERT. Legacy path 100% preserved. |
| `app/api/v1/bank/create-payment/route.ts` | Both `createPayment` calls extended with `...adStamp` where `adStamp = isFullCaptureEnabled() ? adCaptureStampFromState(attr) : EMPTY_AD_CAPTURE_STAMP`. |
| `app/api/v1/enroll/pay/route.ts` | Same pattern as above. |
| `lib/types.ts` | `WebinarRegistration` + `Payment` interfaces gain 7 new optional nullable fields (`attribution_campaign_id / adset_id / ad_id / ad_name / utm_content / utm_term / platform`). |
| `tests/journey-automation/attribution-full-capture.test.ts` | 8 new test cases covering the 5 required scenarios (legacy, full-Meta, full-Google, first-touch protection, flag OFF). |

## 4. Test suite result

Full suite, `master @ 4df1fe09`:

```
ℹ tests 231
ℹ suites 87
ℹ pass 231
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1103
```

TypeScript: `npx tsc --noEmit` — clean (0 errors, 30.5 s).
Next.js production build: `npm run build` — clean, 75 s, all routes compiled.

New scenarios (`attribution-full-capture.test.ts`):

- **(a) legacy link — no new params** → new columns all null; `deriveChannel` still returns "Google Ads" for `utm_source=google&utm_medium=cpc&utm_campaign=brand`; `attribution_platform` derives to `"google"` from source+paid without needing the new ids.
- **(a₂) direct visit (no params, no referrer)** → `EMPTY_AD_CAPTURE_STAMP` exactly; nothing fabricated.
- **(b) full Meta link** → captures `fbclid + campaign_id + adset_id + ad_id + ad_name`; `attribution_platform = "meta"`; `deriveChannel = "Meta Ads"` (both derivations agree).
- **(b₂) instagram+paid + ad ids, no fbclid** → still `attribution_platform = "meta"` via shared source+paid predicate.
- **(c) full Google link** → captures `gclid + campaign_id + adset_id + ad_id + ad_name + utm_term`; `attribution_platform = "google"`; `deriveChannel = "Google Ads"`.
- **(c₂) Google iOS app click (wbraid, no gclid)** → still classified `google`.
- **(d₁) full-Meta first touch survives a later untagged Direct visit** → first-touch unchanged; last-touch stickiness carries fbclid + campaign + campaign_id/adset_id/ad_id/ad_name forward instead of being erased by the empty later touch.
- **(d₂) full-Google first touch survives a later Meta touch** → first-touch stamp remains Google (campaign_id `G_CAMP`, ad_id `G_AD`, platform `google`); last-touch reflects Meta.
- **(e) flag OFF** → `EMPTY_AD_CAPTURE_STAMP` is all-null; `isFullCaptureEnabled` unit tests prove default=ON, `""`=ON, `"true"`=ON, `"FALSE"`=ON (exact match required), `"false"`=OFF; writer's flag-OFF branch simulator shows the INSERT row's legacy columns are byte-identical to pre-shipment while all 7 new columns are null.

## 5. Deploy artifacts

- Local git state:
  - Feature branch `feat/attribution-full-capture` at `fe1c83347a2db353008d30fab5e9095b423b3da7`
  - Merged `--no-ff` into local `master` at `4df1fe09e4ea2cd98c25fb8fabef0ed1d1dabe50`
- **Prod deploy attempt via `npx vercel deploy --prod`**: created deployment `dpl_HbphLgj3WJpKiA4ddN8vhtUSYEAD` (`naman-5yrtxaruj-naman-ias-academy.vercel.app`, source `cursor-cli`) — **state `BLOCKED` at admission**, zero build activity (per Vercel MCP `get_deployment_build_logs`: "No build log events found"; `vercel inspect` shows Builds row is `. [0ms]`). This is Vercel Deployment Protection preventing non-git-integrated `cursor-cli` deployments to the production target; every prior successful production deploy on this project (e.g. `dpl_4BKdrGTeuqe6HTKufUhub1ivoo7x` at `d005087b`, currently live) went in as `githubDeployment: "1"` via the GitHub integration. **The blocked deploy is not serving any traffic and cannot escalate to the prod alias.**
- **`git push origin master`**: blocked. Local `git` uses the `gh` credential helper for `github.com`; the token belongs to `ASHAR139_ford` which is a Ford Azure-AD-federated account without push permission on `namanias-dev/paid-subscriber-portal`. Error: `Permission to namanias-dev/paid-subscriber-portal.git denied to ASHAR139_ford`. Fetch works (repo is public); push does not. There is no local SSH key registered with github.com either.
- **Live prod**: still `dpl_4BKdrGTeuqe6HTKufUhub1ivoo7x` (READY, target production, sha `d005087b`) — the pre-shipment code. This code does not reference the new columns, so the applied migration is transparent to it.

**What the user must do to complete the deploy** (one command):

```bash
cd /Users/ashar139/Projects/naman-ias-portal-master
git push origin master
```

Vercel's GitHub integration will auto-build the new sha (`4df1fe09`) and promote it to production. No env var change is required (`ATTRIBUTION_FULL_CAPTURE_ENABLED` defaults to ON).

If the user's push credentials also fail, the alternative is to create a PR from the local `feat/attribution-full-capture` branch by hand (e.g. via a colleague with write access) and merge normally.

## 6. Phase-4 self-verify evidence

### 6.1 Column existence (post-migration, prod)

```sql
select table_name, column_name, data_type, is_nullable
from information_schema.columns
where table_schema='public'
  and table_name in ('webinar_registrations','payments')
  and column_name like 'attribution_%'
order by table_name, column_name;
```

Result (masked-none; column names + types only):

| table | column | type | nullable |
|---|---|---|---|
| `payments` | `attribution_ad_id` | text | YES |
| `payments` | `attribution_ad_name` | text | YES |
| `payments` | `attribution_adset_id` | text | YES |
| `payments` | `attribution_campaign` | text | YES *(pre-existing, unchanged)* |
| `payments` | `attribution_campaign_id` | text | YES |
| `payments` | `attribution_platform` | text | YES |
| `payments` | `attribution_source` | text | YES *(pre-existing, unchanged)* |
| `payments` | `attribution_utm_content` | text | YES |
| `payments` | `attribution_utm_term` | text | YES |
| `webinar_registrations` | `attribution_ad_id` | text | YES |
| `webinar_registrations` | `attribution_ad_name` | text | YES |
| `webinar_registrations` | `attribution_adset_id` | text | YES |
| `webinar_registrations` | `attribution_campaign` | text | YES *(pre-existing)* |
| `webinar_registrations` | `attribution_campaign_id` | text | YES |
| `webinar_registrations` | `attribution_fbc` | text | YES *(pre-existing)* |
| `webinar_registrations` | `attribution_fbclid` | text | YES *(pre-existing)* |
| `webinar_registrations` | `attribution_platform` | text | YES |
| `webinar_registrations` | `attribution_source` | text | YES *(pre-existing)* |
| `webinar_registrations` | `attribution_utm_content` | text | YES |
| `webinar_registrations` | `attribution_utm_term` | text | YES |

**All 7 new columns exist on both tables. All are nullable text. No pre-existing column was renamed or altered.**

### 6.2 Partial-index existence (post-migration, prod)

```sql
select indexname, tablename from pg_indexes
where schemaname='public' and indexname like '%_attribution_%' order by tablename, indexname;
```

Result: 6 rows — `idx_payments_attribution_ad_id`, `idx_payments_attribution_campaign_id`, `idx_payments_attribution_platform`, `idx_webreg_attribution_ad_id`, `idx_webreg_attribution_campaign_id`, `idx_webreg_attribution_platform`.

### 6.3 End-to-end curl verification (full-attr + legacy)

**DEFERRED — depends on the code deploy.** Prod runtime is still `d005087b`, which does not know about the new columns. A curl POST right now would only stamp the pre-existing `attribution_source / attribution_campaign` columns. The write-path unit tests (`tests/journey-automation/attribution-full-capture.test.ts`) prove the new code writes the exact shape the columns accept — but the deployed-code proof requires the user to run `git push origin master`. When they do, the full curl-verify sequence is:

```bash
# Craft a synthetic first-touch cookie carrying the full Meta ad hierarchy
NSA_ATTR=$(node -e '
  const t = {
    source: "meta", medium: "paid", campaign: "test_meta_capture",
    content: null, term: null,
    landing_path: "/webinars/upsc-full-masterclass-by-naman-sir-july-25",
    referrer: null, raw: null,
    fbclid: "IwAR_test",
    campaign_id: "TEST_CAMPAIGN", adset_id: "TEST_ADSET",
    ad_id: "TEST_AD_ID", ad_name: "TEST_ADCAPTURE_meta_ad",
    first_seen_at: new Date().toISOString(),
  };
  console.log(encodeURIComponent(JSON.stringify({ first_touch: t, last_touch: t })));
')

# 1) Full-attribution write path (webinar registration)
curl -s -X POST https://www.namanias.com/api/public/webinar-register \
  -H "Content-Type: application/json" \
  -H "Cookie: nsa_attr=$NSA_ATTR" \
  -d '{"name":"TEST_ADCAPTURE_alice","phone":"9111000001","webinar_id":"c809c514-950b-4ec3-bf00-dcde009b4768"}'

# 2) Legacy path (no cookie, no attribution)
curl -s -X POST https://www.namanias.com/api/public/webinar-register \
  -H "Content-Type: application/json" \
  -d '{"name":"TEST_ADCAPTURE_bob","phone":"9111000002","webinar_id":"c809c514-950b-4ec3-bf00-dcde009b4768"}'
```

Then read back the two rows and confirm:

```sql
select phone, attribution_source, attribution_campaign,
       attribution_campaign_id, attribution_adset_id, attribution_ad_id, attribution_ad_name,
       attribution_utm_content, attribution_utm_term, attribution_platform,
       attribution_fbclid
from public.webinar_registrations
where webinar_id = 'c809c514-950b-4ec3-bf00-dcde009b4768'
  and name like 'TEST_ADCAPTURE\_%'
order by created_at desc limit 5;
```

Expected: TEST_ADCAPTURE_alice row shows all 7 new columns populated + `attribution_platform = 'meta'`; TEST_ADCAPTURE_bob shows all 7 new columns NULL and `attribution_source / attribution_campaign` also NULL (legacy behavior byte-identical). PII should be masked in reports (phone stub `91xxxxxx01` / `91xxxxxx02`).

### 6.4 July-25 webinar reconciliation

Additive, non-destructive migration. No existing data touched. No row count changed on `webinar_registrations`, `payments`, or `leads`. Reconciliation figures from the earlier `webinar-july25-attribution-report.md` (49 registrations / N payments) stay identical — this shipment only adds unwritten nullable columns.

## 7. Kill-switch (proven by test)

Flag: `ATTRIBUTION_FULL_CAPTURE_ENABLED`

- **Default (unset)** → ON (`isFullCaptureEnabled() === true`)
- **`""` (empty)** → ON
- **`"true"` / `"TRUE"` / `"FALSE"` (any non-exact-lowercase)** → ON
- **`"false"` (exact lowercase)** → OFF

When OFF, every writer site spreads `EMPTY_AD_CAPTURE_STAMP` (all-null new columns) so the INSERT row's non-attribution columns and legacy `attribution_source / attribution_campaign / attribution_fbclid / attribution_fbc` are **byte-identical to pre-shipment behavior**. Verified by `tests/journey-automation/attribution-full-capture.test.ts` "flag OFF" suite.

To toggle in production **without a redeploy**:

Vercel → Project → Settings → Environment Variables → set `ATTRIBUTION_FULL_CAPTURE_ENABLED=false` (Production). Next request cold-boot picks it up.

## 8. Verbatim rollback

**Preferred (no DB change, reversible in seconds):**

```
Vercel → Project Settings → Environment Variables →
  ATTRIBUTION_FULL_CAPTURE_ENABLED = false      (Production)
```

Any Vercel function that boots after the env flip stops writing the new columns; already-written rows retain their values (nullable columns are harmless if untouched).

**Full rollback (drop columns), only if needed:**

Apply `supabase/migrations/2026-07-21-attribution-full-capture-rollback.sql` verbatim against prod (via Supabase MCP `apply_migration` or the Dashboard SQL editor). The rollback file drops the 6 partial indexes then the 7 columns per table with `if exists` — idempotent, transactional, no touch to any other column/data/row.

**Code revert:** if the local commits need to be undone,

```bash
cd /Users/ashar139/Projects/naman-ias-portal-master
git checkout master
git reset --hard d005087b            # returns local master to the pre-shipment sha
git branch -D feat/attribution-full-capture
```

## 9. Meta + Google URL parameter blocks (copy-paste-ready)

### Meta Ads (Ad level → Tracking → URL parameters)

Paste this into **Meta Ads Manager → Ad level → Tracking → URL parameters**. The `{{…}}` tokens are Meta dynamic macros — Meta substitutes them at click time.

```
utm_source=meta&utm_medium=paid&utm_campaign={{campaign.name}}&campaign_id={{campaign.id}}&adset_id={{adset.id}}&ad_id={{ad.id}}&ad_name={{ad.name}}&utm_content={{ad.name}}
```

After the ad click, Meta appends this to the destination URL (in addition to `fbclid`, which is set automatically). All 7 fields land on the row: `attribution_source=meta`, `attribution_campaign={{campaign.name}}`, `attribution_campaign_id`, `attribution_adset_id`, `attribution_ad_id`, `attribution_ad_name`, `attribution_utm_content`, `attribution_platform=meta`.

### Google Ads (ValueTrack — Ads & Extensions → Ad URL options → Tracking template OR final URL suffix)

Paste this into **Google Ads → Campaigns → Ad URL options → Tracking template** (or as a Final URL suffix). The `{…}` tokens are Google ValueTrack parameters — Google substitutes them at click time.

```
utm_source=google&utm_medium=cpc&utm_campaign={_campaign}&campaign_id={campaignid}&adset_id={adgroupid}&ad_id={creative}&ad_name={_adname}&utm_content={keyword}&utm_term={keyword}
```

Notes on Google Ads ValueTrack tokens:
- `{campaignid}` / `{adgroupid}` / `{creative}` are the numeric ids — always available. `{_campaign}` and `{_adname}` are **custom parameters** you must define on the campaign/ad (they hold your human-readable names); if you haven't set them, they'll be blank. As a fallback you can hard-code the human names into the URL per campaign.
- `{keyword}` populates only for Search campaigns — Display/Performance Max leave it blank.
- Google Ads auto-tagging supplies `gclid` (or `wbraid`/`gbraid` for iOS/Android app traffic) — our client capture picks all three up.
- The current-generation ValueTrack reference is at [Google Ads Help — ValueTrack parameters](https://support.google.com/google-ads/answer/6305348). Confirm the exact tokens before shipping to make sure Google hasn't renamed any.

### Where to paste each — 3 lines

- **Meta**: Ads Manager → open your Ad → Tracking section → paste the block into "URL parameters". Applies to that ad; repeat per ad or duplicate a template ad.
- **Google Ads (per campaign)**: open the campaign → Settings → "Campaign URL options" → paste into "Tracking template". Applies to every ad in that campaign automatically.
- **Google Ads (per ad, override)**: open the ad → "Ad URL options" → paste into "Tracking template" to override the campaign default for a specific ad.

## 10. Deferred / follow-ups

- **`git push origin master`** — blocked by github.com credentials for the current environment. User to execute the single command in §5 to complete the deploy; Vercel's GitHub integration will build + promote automatically. No further env changes needed.
- **End-to-end curl verification** — deferred pending the code deploy (see §6.3 for the ready-to-run script the user can copy-paste after `git push`).
- **`app/api/v1/enroll/create-payment/route.ts`** — did not stamp attribution before this shipment and still does not; delegated to the fetch-forward `/api/public/lead` call. Not in the original legacy-attribution set; kept out to keep this shipment's diff minimal. If desired, add `adStamp` in a follow-up PR (single-hunk change, same pattern as `enroll/pay/route.ts`).
- **Blocked prod deploy** `dpl_HbphLgj3WJpKiA4ddN8vhtUSYEAD` (`naman-5yrtxaruj-…vercel.app`) — never entered build, cannot serve traffic. Safe to leave; will not auto-promote. Can be deleted from Vercel Dashboard once the GitHub-integrated deploy lands.
- **Anon-key rotation** (from prior audit) — still pending; unrelated to this shipment.
- **Vercel Deployment Protection review** — the fact that `cursor-cli` source deploys are BLOCKED for production is defensible policy (only GitHub integration deploys), and this shipment doesn't request changing it. If in future you want to allow one-off CLI production deploys, that's a Vercel project setting change (Deployment Protection → Deployment source restrictions).
