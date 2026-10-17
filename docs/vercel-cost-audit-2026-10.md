# Vercel Cost Audit — Naman IAS

## STATUS: REMEDIATED IN PRODUCTION — October 13, 2026

**ROOT CAUSE (historical):** Public Notes Store MP4/media was proxied through Vercel from private R2 via `/media/[...path]`, driving Fast Origin Transfer.

**PRODUCTION FIX (current):** Public `media/*` gets a **zero-byte 302** to a **six-hour signed private R2 GET URL**. Cloudflare/R2 serves MP4/PDF/image bytes (including Range 206). Vercel does not carry public Notes Store media payloads.

**VERCEL MP4 EGRESS:** **ELIMINATED** (live-verified 2026-10-17: `Content-Length: 0`, body 0 bytes, `X-Media-Redirect: r2-signed`).

**CLOUDFLARE WORKER / `media.namanias.com`:** Deferred **Phase 2 cleanup** — **not required** for current cost remediation. Recommendation: **LATER** (optional stable CDN URLs / caching), not soon.

**FINAL BILLING VERIFICATION (2026-10-17):** Full post-cutover UTC billing windows show **~86% FOT $/day reduction** vs immediate pre-cutover days. Projected new monthly FOT ≈ **40 GB / ~$10** at bom1 list rate ($0.25/GB) vs ~**292 GB / ~$73** at the recent pre-cutover rate.

---

## Executive Summary

### CURRENT PRODUCTION (after Oct 13, 2026)

| Item | State |
|------|--------|
| Public media path | Browser → `/media/…` → tiny Vercel **302** → signed R2 → Cloudflare bytes |
| Teaching / physical MP4 | Live **302** + R2 **206**; no `x-vercel-*` on payload |
| `/notes` initial load | `preload="none"`; **0** MP4 in HTML |
| FOT (avg full post-cutover days) | **~$0.33/day** (~**1.3 GB/day** @ bom1 $0.25/GB) |
| FOT (avg pre-cutover sample days) | **~$2.43/day** (~**9.7 GB/day**) |
| Worker cutover | **Not urgent** — signed-R2 is the production fix |

### BEFORE (historical incident)

Billing cycle **Sep 11 – Oct 10/11, 2026** showed **388.81 GB Fast Origin Transfer**, almost all **outgoing (382.67 GB)**. Root cause: Notes Store teaching/physical MP4s (~40–53 MB) streamed through the Vercel Node route `/media/[...path]` from private R2, amplified by Range requests after Notes Store go-live (Sep 20–26).

A Worker + `media.namanias.com` CDN was designed as the long-term edge path; production cost remediation shipped first as **signed-R2 redirects** (no apex/www DNS / nameserver moves). That path is live and verified.

Sections below retain the original forensic analysis. Treat architecture diagrams labeled **BEFORE** as historical; **CURRENT PRODUCTION** supersedes them for ops decisions.

---

## Top 5 findings (BEFORE remediation — forensic)

| # | Finding | Evidence | Est. FOT share | Risk of fix |
|---|---------|----------|----------------|-------------|
| 1 | **`/media/[...path]` R2→Vercel stream for 40–53 MB MP4s; no public CDN env** | `app/media/[...path]/route.ts`; Vercel env has R2 creds but **no** `CLOUDFLARE_R2_PUBLIC_BASE_URL` / `NEXT_PUBLIC_MEDIA_CDN_BASE`; live `x-matched-path: /media/[...path]`, `x-vercel-cache: MISS` on cold/Range | **250–360 GB** | Config: low (path-scoped CDN). Whole-bucket public: **unsafe** |
| 2 | **Notes teaching + physical-copy videos enabled Sep 20–26** | Commits `7e5a044`, `d466f72`, `5237d09`, `1d8ae46`; live sizes below | Explains Sep 26 **~100 GB/day** spike | N/A (root cause timeline) |
| 3 | **Range streaming + `preload=auto` / 256 KB warm on active card** | `TeachingVideoCard.tsx`, `teachingPlayer.ts`; `Vary: Range` in `mediaDelivery.ts` | Amplifies #1 (many unique ranges) | Medium if UX changed |
| 4 | **Notes storefront pages `force-dynamic` + `revalidate = 0`** | `app/(site)/notes/page.tsx`, `[subject]/page.tsx`; layout awaits `storeEnabled()` | Invocations + HTML FOT (tens of GB?), not primary | Medium (offers/flag freshness) |
| 5 | **Aggressive scrapers can pull public `/media` videos** | Middleware bot list covers courses/enroll only, **not** `/media`; `robots.ts` allows `/` | Secondary amplifier | Low (bots only) |

---

## Billing Evidence

| Metric | Value |
|--------|------:|
| Period | Sep 11 – Oct 10/11, 2026 |
| Fast Origin Transfer | **388.81 GB** |
| Incoming | ~6.13 GB |
| Outgoing | **~382.67 GB** |
| Project | `naman-ias` (`prj_ULEGPguZAXU3V5nk8ZiZ9RWkqfFE`) |
| Domains | namanias.com, www.namanias.com |
| Also elevated | Function invocations (millions), ISR reads/writes, Fluid CPU, image optimization |

Spike shape (from your graph): ~100 GB (Sep 26) → 30 GB (27) → ~66 GB (28/29) → 8–20 GB baseline → 22–28 GB (Oct 8–9).

---

## Architecture Map

### Runtime

| Item | Value |
|------|--------|
| Framework | Next.js **14.2.x** (App Router) |
| Package | `naman-ias-portal` |
| Deploy | Vercel project `naman-ias`, region preference **bom1** (`vercel.json`) |
| Production git | Branch **`master`** (not empty `main`) |
| Data | Supabase Postgres |
| Object storage | Cloudflare R2 (S3 API) — **private bucket** |
| Payments | ICICI Eazypay (+ Razorpay legacy paths) |
| Shipping | Delhivery / Shiprocket (+ Amazon Shipping work) |
| Crons | Many under `/api/cron/*` (notes verify/prepare/tracking, SMS, Telegram, analytics, …) |

### Router categories (simplified)

| Category | Examples | Caching |
|----------|----------|---------|
| Public ISR | `/`, `/webinars`, `/current-affairs/*`, `/resources`, `/careers`, `/about` | `revalidate` 300–3600 |
| Public force-dynamic | `/notes`, `/notes/[subject]`, cart/checkout/track/order, `/courses`, `/enroll`, `/quizzes`, `/payment/*` | `dynamic = "force-dynamic"` / `revalidate = 0` |
| Auth apps | `/dashboard/*`, `/portal/*`, `/admin/*` | Session + no-store APIs |
| Media origin | **`/media/[...path]`** | Intended long CDN cache; **streams R2 when no CDN base** |
| Legacy media | `/api/media/[...path]` | 308 → `/media/…` or CDN |
| Webhooks / crons | Telegram, courier, SMS, payment verify | force-dynamic, no-store |
| Short links | `/go/[code]` | force-dynamic, no-store |

### Media architecture (critical path)

```
CURRENT PRODUCTION (since 2026-10-13; CDN Worker env still unset):
  Browser → /media/<public-key>
         → Vercel 302 (Content-Length: 0, X-Media-Redirect: r2-signed, TTL 6h)
         → signed private R2 GET URL
         → Cloudflare/R2 serves bytes (Range 206)

PHASE 2 (optional later — Worker + media.namanias.com):
  Browser → media.namanias.com/<key>  (or /media 308 → CDN)
         → Cloudflare Worker allowlisting media/* only
         → R2 binding (stable URL, long cache)

BEFORE (incident — Sep 20 → Oct 13 morning):
  Browser (Range) → Vercel /media/[...path] (Node, force-dynamic)
                 → R2 GetObject
                 → stream body → Vercel origin egress (= Fast Origin Transfer)
```

Public URL builder still emits stable `https://www.namanias.com/media/...` (unsigned page URLs).  
Teaching catalogue: `lib/store/teachingVideos.ts` (`media/store/videos/<id>/full.mp4`).  
Proof videos/samples: `lib/store/notesProof.ts`.

### Caching layers in use

- Next Data Cache / `unstable_cache` (e.g. store categories tag `notes-store`, 600 s)
- ISR `revalidate` on marketing/CA pages
- **Signed redirect:** `Cache-Control` / `CDN-Cache-Control: private, no-store` (must not outlive signature)
- R2 object responses: long cache at Cloudflare after redirect
- next/image `minimumCacheTTL` 31 days
- Explicit **no-store** on cart, checkout, orders, admin, payments
- **No** production `CLOUDFLARE_R2_PUBLIC_BASE_URL` (Worker path deferred; signed-R2 is live)

---

## Top Suspected Cost Drivers

| Rank | Driver | Why expensive | Est. monthly FOT |
|-----:|--------|---------------|------------------|
| 1 | `/media` teaching + physical MP4 Range proxy | 39–53 MB/file × plays × Range MISSes | **250–360 GB** |
| 2 | `/media` sample WebPs + sample PDF + covers via same proxy | Smaller objects; high view count on PDP/landing | **10–40 GB** |
| 3 | next/image optimizer fetching same-origin `/media` | Extra origin pull for transforms | **5–25 GB** |
| 4 | Force-dynamic Notes + other HTML/RSC | Many invocations; small bodies vs video | **5–30 GB** |
| 5 | APIs / crons / admin JSON | Usually small; high count | **&lt;10 GB** |
| 6 | Invoice/label PDFs | **Signed R2 redirect** — not primary FOT | Low |
| 7 | `/api/notes/sample/[id]` private derivative proxy | Watermarked pages; lower volume than teaching reels | Low–medium |

### Live size inventory (probed 2026-10-13 against www.namanias.com)

| Object | Bytes | ≈ MB |
|--------|------:|-----:|
| naman-sir-teaches-01/full.mp4 | 40,793,277 | 38.9 |
| naman-sir-teaches-02/full.mp4 | 52,064,186 | 49.6 |
| naman-sir-teaches-03/full.mp4 | 41,830,702 | 39.9 |
| physical-notes/full.mp4 | 52,969,347 | 50.5 |
| physical-notes-economy/full.mp4 | 51,439,234 | 49.1 |
| physical-notes-modern-history/full.mp4 | 45,993,912 | 43.9 |
| previews (3×) | ~9.2 MB total | |
| modern-history sample.pdf | 4,601,389 | 4.4 |
| **Catalogue video total** | | **~294 MB** |

Back-of-envelope: **~8,800 full-equivalent ~45 MB origin fills ≈ 388 GB**. That does not require 8,800 complete watches — Range cold fills, previews, multi-clip carousel warming, and bots all count.

---

## Sep 26 Spike Investigation

### Timeline (master / production-relevant)

| When | Commit | Change |
|------|--------|--------|
| Sep 20 | `132cdab` / `af2ded4` | Notes Store promoted; launch toggle (initially OFF) |
| Sep 20 | `a43fbda` | Product photos/covers via **`/media` stream fallback** |
| Sep 20 | `7e5a044` | **Enable three live teaching reels from R2** + Range-aware `/media` |
| Sep 21 | `d466f72` | Teaching playback: **Range stream**, warm full MP4, `force-dynamic` on media route |
| Sep 21 | `5237d09` | **Launch Notes Store** with three real PDPs |
| Sep 26 | `1d8ae46` | Economy FDI sample + **own printed-notes video** |
| Sep 26 | `7a2bd02` | Optional 4:5 subject-card thumbnails |
| Sep 26 | Invoice/GST commits | PDF generation to R2 (download via signed URL — secondary) |

### Most likely causes of the Sep 26 bandwidth step-change

| Cause | Confidence | Evidence |
|-------|------------|----------|
| Teaching + physical-notes **MP4s through `/media` under real store traffic / ads** | **HIGH** | Sizes + proxy path + Sep 20–21 enablement; Sep 26 adds Economy video; Instagram/ManyChat campaign links in `docs/notes-store/CAMPAIGN_LINKS.md` |
| Storefront force-dynamic HTML + analytics beacons | MEDIUM | Explains invocations; not 100 GB/day alone |
| Invoice PDF generation | LOW | Bytes stored in R2; customer download uses `signGetUrl` redirect |
| Shipping/label PDF proxy | LOW | Label API returns provider URL JSON, not multi‑GB streams |
| Unrelated deploy misconfig | LOW | No evidence of accidental open proxy beyond intentional `/media` |

---

## Route-Level Findings

### HIGH — `GET/HEAD /media/[...path]`

- **File:** `app/media/[...path]/route.ts`
- **Behavior:** `getObject(key, { range })` from R2 → `NextResponse` stream; `dynamic = "force-dynamic"`; CDN 308 only if `publicCdnUrl(key)` non-null
- **Transfer:** Full response body leaves Vercel origin on CDN MISS (especially Range)
- **Volume:** Every Notes landing/PDP visitor who hits the teaching showcase or physical-copy player
- **Fix:** Path-scoped Cloudflare public origin + env; keep route as fallback 308

### HIGH — Teaching / proof URL construction

- **Files:** `lib/store/teachingVideos.ts`, `lib/store/notesProof.ts`, `lib/publicMediaUrl.ts`
- **Behavior:** `stablePublicMediaUrl` → `https://www.namanias.com/media/...` without CDN
- **Fix:** Set `NEXT_PUBLIC_MEDIA_CDN_BASE` (rebuild) + server `CLOUDFLARE_R2_PUBLIC_BASE_URL`

### MEDIUM — `GET /api/notes/sample/[id]`

- **File:** `app/api/notes/sample/[id]/route.ts`
- **Behavior:** Streams `store-private/sample-pages/*` (watermarked) through Vercel — **must stay server-side** for access control
- **Fix:** Keep; ensure UI prefers public `/media/store/samples/...` WebPs (already primary path in `notesProof.ts`)

### LOW — Invoice / CA PDF

- Invoice: redirect to signed R2 (`invoiceDownloadUrl`)
- CA PDF download API: returns `file_url` JSON, does not stream file body

### LOW — Legacy `/api/media/*`

- 308 to stable `/media` or CDN — small redirect bodies

---

## Media Delivery Findings

| Question | BEFORE (incident) | CURRENT PRODUCTION (2026-10-17) |
|----------|-------------------|----------------------------------|
| Videos proxied through Vercel? | **YES** — teaching + physical MP4 body bytes | **NO** — zero-byte 302 → R2 |
| PDFs proxied? | Public sample PDF via `/media` body | Public sample via signed redirect; invoices still signed |
| Images proxied? | Covers/posters via `/media` body | Same redirect path; next/image may still pull `/media` for transforms (residual FOT) |
| Double hop next/image → `/media`? | Possible | Possible (small residual; not MP4 playback) |
| Bucket private by design? | **YES** | **YES** — only `media/*` is signable via `/media` |

**Security constraint:** Enabling a blanket public R2 bucket would expose `processed/`, `payment-proofs/`, `store-private/`, etc. Public CDN (if Phase 2) must allowlist **`media/*` only**.

---

## ISR Findings

### CURRENT ISR BEHAVIOR

| Surface | Setting | Notes |
|---------|---------|-------|
| Marketing/CA/resources | `revalidate` 300–600–3600 | Normal ISR; contributes to ISR read/write metrics |
| `/notes`, `/notes/[subject]` | `force-dynamic` + `revalidate = 0` | Every request renders on server; layout calls `storeEnabled()` |
| Store data | `unstable_cache` … `revalidate: 600`, tag `notes-store` | Invalidated on admin product/media/store-state mutations |
| Cart/checkout/order/track | force-dynamic / no-store | Correct |

`revalidateTag(STORE_CACHE_TAG)` on admin product/media routes is appropriate (not per analytics event).

### EXPECTED BEHAVIOR

Public catalogue HTML should be ISR (e.g. 60–600 s) with tag invalidation on catalogue edits. Offer countdown can be client-fetched.

### RECOMMENDED CHANGE

| Change | Risk |
|--------|------|
| ISR for `/notes` + PDP shells; keep cart/checkout/order dynamic | **MEDIUM** — needs offer/inventory freshness review |
| Leave admin-driven `revalidateTag` as-is | LOW |

Hundreds of thousands of ISR writes are more consistent with **sitewide ISR (CA tags, homepage, webinars) + frequent deploys** than with Notes tag churn alone. Still worth watching after media is off-origin.

---

## Middleware Findings

**File:** `middleware.ts`  
**Matcher:** dashboard, portal, courses, enroll, quizzes, home-cinematic, payment, CA saved, lecture — **not** static assets, **not** `/media`.

Aggressive-bot 403 applies only to listed force-dynamic marketing routes. **Video scrapers can still hit `/media/**/*.mp4`.**

Static assets are already excluded (good). No change needed for `_next/static`, fonts, etc.

**Shipped mitigation:** extend bot short-circuit to `/media` video/PDF paths for the existing aggressive UA list (Googlebot / social preview UAs unchanged).

---

## Bot/Abuse Findings

| Vector | Status |
|--------|--------|
| Ahrefs/Semrush/GPTBot/etc. on `/courses`… | Already 403 in middleware |
| Same bots on `/media` videos | **Open** before this PR |
| Googlebot on public HTML | Allowed (SEO preserved) |
| Social preview bots | Intentionally allowed (OG) |
| `robots.ts` | Disallowed private/API paths; **did not** disallow video prefix |

---

## Cache Findings

| Observation | Detail |
|-------------|--------|
| Headers on `/media` | `public, max-age=31536000, immutable` + CDN variants — correct intent |
| Live CDN | Cold **MISS**, then **HIT** for identical full GET / identical Range |
| Range fragmentation | Players request many ranges → repeated origin fills for large MP4s |
| `force-dynamic` on media route | Does not fully disable Vercel CDN caching of responses, but route always executes on MISS |
| No public R2 CDN | Largest structural gap |

---

## Fixes Implemented

### Shipped and live in production

1. **Signed-R2 public media redirects** — `/media/[...path]` 302 → 6h signed GET; body bytes on Cloudflare/R2 (**Oct 13 cutover**).
2. **Hardening** — head-before-sign (missing keys 404), redirect `no-store` + `Referrer-Policy: no-referrer`, `X-Media-Signed-TTL` (**Oct 13**).
3. **Preload fix** — teaching/physical cards: `preload="none"`; no full MP4 on scroll; hover warm capped.
4. **Middleware:** aggressive bots → 403 on `/media` video/PDF extensions (OG images untouched).
5. **robots.txt:** disallow `/media/store/videos/`.
6. **Allowlist** — only `media/*` keys are addressable/signable via `/media`.
7. **Worker code prepared** (`workers/public-media`) — **not deployed**; optional Phase 2.

### Deferred (not required for FOT remediation)

- Worker + `media.namanias.com` Custom Domain + Vercel CDN env — **LATER** (ops polish, not cost firefight).
- Notes `/notes` ISR — needs read-only offer path before removing `force-dynamic`.

---

## Fixes Requiring Approval (post-remediation)

Media FOT incident is **resolved**. Remaining items are optional / secondary:

| Fix | Why | Expected impact | Risk | Priority |
|-----|-----|-----------------|------|----------|
| Worker + `media.namanias.com` | Stable URLs, edge cache, no signed query strings | Small Vercel $ (redirects only); mainly DX/caching | Medium (CF token + DNS subdomain) | **Later** |
| ISR `/notes` + PDP | Cut Fluid CPU / HTML FOT | ~$ few/mo + cleaner | Medium | Optional |
| Re-encode teaching MP4s | Smaller R2 egress / faster start | UX; not Vercel FOT | Low–medium | Optional |
| Telegram-dispatch schedule | Dominates log volume (`*/2`); Fluid CPU ~$7/mo | Maybe $2–5/mo if lengthened carefully | Medium (alert latency) | Only if savings justify |

---

## Estimated Cost Reduction

### Actual post-cutover (billing API, UTC 07:00Z windows)

| Window | Class | FOT effectiveCost | Est. GB @ bom1 $0.25/GB | Total usage effectiveCost |
|--------|-------|------------------:|------------------------:|--------------------------:|
| Oct 10→11 | PRE | **$1.96** | ~7.8 | $3.27 |
| Oct 11→12 | PRE | **$2.90** | ~11.6 | $4.16 |
| Oct 12→13 | MIXED | **$3.21** | ~12.8 | $5.03 |
| Oct 13→14 | FULL POST | **$0.31** | ~1.2 | $1.59 |
| Oct 14→15 | FULL POST | **$0.25** | ~1.0 | $1.45 |
| Oct 15→16 | FULL POST | **$0.37** | ~1.5 | $1.78 |
| Oct 16→17 | FULL POST | **$0.40** | ~1.6 | $1.73 |

| Metric | Value |
|--------|------:|
| Avg PRE FOT | **$2.43/day** (~**9.7 GB/day**) |
| Avg FULL POST FOT | **$0.33/day** (~**1.3 GB/day**) |
| Reduction | **~86%** |
| Projected monthly FOT @ new rate | **~40 GB / ~$10** |
| Pre-rate projection (for contrast) | ~292 GB / ~$73 |

GB estimates use **bom1** list price **$0.25/GB** (project `preferredRegion`). Multi-region traffic can blend rates; **dollar figures are from Vercel billing `effectiveCost`**. ConsumedQuantity GB was not present in truncated FOCUS samples.

### Historical targets (from incident audit)

| Scenario | Monthly FOT | Notes |
|----------|------------:|-------|
| Incident month (Sep 11–Oct 10) | ~389 GB | Measured |
| TARGET after media off-origin | **&lt;50 GB** | **Met** (~40 GB projected) |
| STRETCH | **&lt;20 GB** | Needs residual HTML/image work |

---

## Cost-model table (BEFORE remediation — forensic)

| Issue | Behavior during incident | Est. GB/mo then | Status now |
|-------|--------------------------|-----------------|------------|
| `/media` video proxy | R2→Vercel→client Range | 250–360 | **Fixed** — signed-R2 redirect |
| Sample/cover `/media` | Same proxy | 10–40 | **Fixed** — same redirect path |
| next/image × `/media` | Optimizer pulls origin | 5–25 | Residual (small redirects / transforms) |
| Notes force-dynamic | SSR every hit | 5–30 | Still true — secondary cost |
| Bot video scraping | Open `/media` mp4 | ?–30 | Middleware + robots mitigations |
| Private sample API | Intentional proxy | &lt;5 | Keep |

---

## Testing Performed

### Incident / cutover (Oct 13)

- Live probes: sizes, Range 206, no CDN env, then signed redirect cutover.
- Hardening: missing key 404, traversal 404, TTL/cache headers.

### Final verification (Oct 17)

- Teaching + physical-notes MP4: **302**, `Content-Length: 0`, `X-Media-Redirect: r2-signed` → R2 **206**, `Server: cloudflare`, `cf-ray`, no `x-vercel-*`.
- `/notes`: four `preload="none"`; **0** `.mp4` in HTML.
- Missing key: **404** JSON, no Location.
- Runtime logs (12h): `/media` **not** in top paths; `/api/cron/telegram-dispatch` dominates log lines (`*/2` schedule).
- Billing: four full post-cutover days vs two pre days — **~86% FOT $ drop**.

No payment, webhook, shipping, or checkout logic modified in this verification pass.

---

## Monitoring Recommendations

1. Weekly Vercel **Fast Origin Transfer** (billing/usage): alert if **&gt;$1/day** or **&gt;5 GB/day** @ bom1 (regression signal).
2. Spot-check `/media/…/full.mp4`: must stay **302** + `Content-Length: 0` + `X-Media-Redirect: r2-signed`.
3. On `/notes`, Network: no MP4 until intentional play; posters only at load.
4. Residual FOT is expected from HTML/RSC + next/image + APIs — investigate only if daily FOT returns to pre-cutover levels.
5. Do **not** log signed URL query strings.

---

## Vercel Spend Protection Recommendations

| Control | Recommendation |
|---------|----------------|
| Spend / usage alerts | Alert if FOT effectiveCost exceeds **~$1/day** for 2 consecutive days |
| Hard spend limit | Optional; prefer alerts over hard outage during campaigns |
| Bot management | Keep middleware list |
| Regions | `bom1` remains appropriate for IN audience |
| Deployments | Never reintroduce R2→Vercel body streaming for public `media/*` |
| Worker env | Optional Phase 2 — **not** a release blocker while signed-R2 is healthy |

---

## Appendix A — Key code references

```15:45:app/media/[...path]/route.ts
export const dynamic = "force-dynamic";
// ...
const cdn = publicCdnUrl(key);
if (cdn) {
  return NextResponse.redirect(cdn, { status: 308, ... });
}
const obj = await getObject(key, { range });
return new NextResponse(obj.body.transformToWebStream(), { ... });
```

```25:34:lib/publicMediaUrl.ts
export function stablePublicMediaUrl(keyOrRest: string): string {
  // ...
  if (cdn) return `${cdn}/media/${rest}`;
  return `${SITE_MEDIA_ORIGIN}/media/${rest}`;
}
```

```23:24:app/(site)/notes/page.tsx
export const dynamic = "force-dynamic";
export const revalidate = 0;
```

---

## Appendix B — Worker / `media.namanias.com` (Phase 2 — optional)

### Recommendation: **LATER** (not KEEP forever as “only option”, not SOON)

| Factor | Signed-R2 (current) | Worker + `media.namanias.com` |
|--------|---------------------|-------------------------------|
| Vercel cost | Already cut ~86% FOT; residual ~$10/mo | Saves only tiny redirect invocations — **not material** vs current residual |
| Cloudflare cost | Class B GET/HEAD + (usually free) egress | Similar Class B; Worker requests negligible |
| Latency | Extra 302 hop | One hop; better for repeat Range via edge cache |
| Security | Allowlist + head-before-sign; signed URLs time-bound | Stable public `media/*` only if Worker allowlists correctly |
| Ops complexity | Uses existing R2 creds on Vercel | Needs CF API token, Worker deploy, subdomain DNS |
| DNS risk | None | Low if **subdomain CNAME only** (no apex/NS move) — still coordination |
| Signed URL privacy | Query string in player network panel | Stable path URLs |
| Caching | Redirect no-store; R2 object cache helps after first hop | Stronger immutable CDN cache on stable URLs |

**Do not migrate for cost alone.** Revisit when CF token is ready and you want stable CDN URLs / longer edge cache — **without** touching apex/www nameservers.

Checklist (when/if):

1. Deploy Worker allowlisting **only** `media/*`.
2. Custom domain `https://media.namanias.com` (CNAME; no NS migration).
3. Set `CLOUDFLARE_R2_PUBLIC_BASE_URL` + `NEXT_PUBLIC_MEDIA_CDN_BASE`; redeploy.
4. Verify `/media` → **308** CDN; private prefixes still blocked.
5. Keep signed-R2 as fallback until proven.

---

## Post-Cutover Verification

**Cutover live (production):** 2026-10-13. First signed-redirect deploy `dpl_2saXqjsYCBtaMtU8FXkbMf96QtcJ` ready **05:14:37 UTC**; master merge deploy `dpl_39vfhniRQqKcKCg6tfH4ZdNEyGfB` ready **05:23:10 UTC**.

**Hardening live (production):** `dpl_AUqgq9jyfC64M1xeKuJd17iAtWHf` (commit `afa203f`) ready **~06:42 UTC** — head-before-sign, CDN no-store, redirect `Referrer-Policy: no-referrer`, `X-Media-Signed-TTL`.

**Final billing verification:** 2026-10-17 (four complete FULL POST windows).

### Architecture in production (Phase 1)

```
Browser → namanias.com/media/<public-key>
       → tiny Vercel 302 (Content-Length: 0, X-Media-Redirect: r2-signed)
       → signed private R2 GET URL
       → Cloudflare/R2 serves MP4/PDF/image bytes (Range 206)
```

Worker + `media.namanias.com` remains **PHASE 2 CLEANUP** — recommendation **LATER**. Keep signed-R2 as production.

### Request-level evidence (post-cutover + harden)

| Check | Result |
|-------|--------|
| `/media/…/full.mp4` | **302**, `content-length: 0`, `X-Media-Redirect: r2-signed`, `X-Media-Signed-TTL: 21600` |
| Follow Location Range `0-1048575`, `5e6-5999999`, `2e7-20999999` | **206** from `Server: cloudflare`, `cf-ray` present, **no** `x-vercel-*` |
| Subsequent Range on same signed URL | Stays on R2 (no re-hit `/media` per byte-range) |
| Teaching object size | 40,793,277 bytes |
| Traversal / encoded `..` / bad encoding | **404**, no `Location` |
| Root private prefixes (`/processed`, `/payment-proofs`, `/store-private`) | **404** (not under `/media`) |
| Missing `media/*` object | **404** JSON `{ok:false}` — **no** signature minted (head-before-sign) |
| Missing follow | **1** redirect max → R2 403 pre-harden; post-harden **0** redirects |
| Invalid Range on R2 | **416** from Cloudflare (no Vercel storm) |
| `/notes` preload | `preload="none"`; **0** `.mp4` URLs in initial HTML; posters only |

**MEDIA BYTES ON INITIAL `/notes` LOAD (intentional play off):** ~233 KB poster webp (4 posters from Cloudflare) + page HTML; **0** MP4 bytes.

### Signed URL TTL & redirect cache

| Item | Value |
|------|------:|
| Signed URL TTL | **21 600 s (6 h)** (`PUBLIC_MEDIA_SIGNED_REDIRECT_TTL_SECONDS`, floor 1800) |
| Redirect cache | `Cache-Control: private, no-store, max-age=0, must-revalidate` + `CDN-Cache-Control: private, no-store` (+ `Vercel-CDN-Cache-Control: no-store` in code) |
| Redirect `Referrer-Policy` | **no-referrer** (live on 302) |
| Safe vs expiry | **YES** |

6 h is appropriate for Notes Store clips (~3 min) plus pause/seek on mobile/Safari; not multi-day. Recommend keep **6 h** (acceptable band 1–12 h).

### Signing oracle

- Only keys under allowlisted **`media/*`** can be signed.
- Path traversal / `%2e%2e` / nested `..` → **404**.
- Private bucket prefixes at root are not addressable via `/media`.
- Post-harden: non-existent `media/*` keys → **404** without minting (closes 302→403 existence probe).

**PRIVATE OBJECT SIGNING: BLOCKED**

### Analytics / log leak

- Teaching/physical analytics emit **`video_id` only** (no src / no signed URL).
- Client `fullSrc` stays stable `/media/…` until the browser follows the 302; signed query is not a page URL for GA/PostHog.
- `/media` redirects set **`Referrer-Policy: no-referrer`**.
- Server logs on sign failure log **error message only**, not the Location URL.

**SIGNED URL LOG LEAK: NO** (code paths audited; no complete signed URL in analytics props).

### Billing / FOT trend — FINAL (verified 2026-10-17)

Vercel billing charges are **daily UTC windows** (~07:00Z→07:00Z). Hourly `fot_out_bytes` Observability still **400** without Observability Plus. Day `effectiveCost` is authoritative for this report.

See **Estimated Cost Reduction** table above for all seven windows.

| Metric | Result |
|--------|--------|
| PUBLIC MEDIA BODY BYTES ON VERCEL (live) | **0** (302 body length 0) |
| `/media` in top runtime paths (12h) | **Absent** (not a material log/path driver) |
| PRE avg FOT | **$2.43/day** (~9.7 GB/day @ bom1 $0.25) |
| FULL POST avg FOT | **$0.33/day** (~1.3 GB/day) |
| Reduction | **~86%** |
| Projected monthly FOT | **~40 GB / ~$10** |

### R2 cost risk

**LOW.** Bytes on R2 Class B (HEAD+GET/Range) + egress (typically free to internet — confirm in CF dashboard). Head-before-sign adds one Class B per request before sign. No bucket-wide public access.

### Top remaining monthly Vercel costs (post-media, from POST-day averages)

| # | Item | ~/day | ~/mo | Notes |
|---|------|------:|-----:|-------|
| 1 | **Residual Fast Origin Transfer** | $0.33 | **~$10** | HTML/RSC, APIs, next/image — not MP4 bodies |
| 2 | **Fluid Active CPU** | $0.23 | **~$7** | Cron-heavy; `telegram-dispatch` every **2 min** dominates log lines (~24k/12h) |
| 3 | **Fluid Provisioned Memory** | $0.16 | **~$5** | Same compute footprint |

Function Invocations (~$3/mo), ISR Writes (~$1.6/mo), image opt (&lt;$1/mo) are below the meaningful-optimization bar unless obviously pathological. **Do not change Telegram** unless alert latency tradeoff is accepted — schedule `*/2` is product intent for queue/outbox latency; log dominance ≠ large $ alone.

### Hardening shipped after verification

- Head-before-sign: missing `media/*` keys → **404** (no signature minted).
- Redirect `no-store` + `Referrer-Policy: no-referrer` + `X-Media-Signed-TTL: 21600`.
- Build fix: TTL constant is module-local (not a Next.js Route export).
