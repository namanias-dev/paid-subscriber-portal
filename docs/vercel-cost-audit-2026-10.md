# Vercel Cost Audit — Naman IAS

**ROOT CAUSE:** Public Notes Store teaching / proof **videos (and other `media/*` assets) are streamed through the Vercel Node route `/media/[...path]`**, which pulls bytes from private Cloudflare R2 and sends them out as origin responses. Production has **no `CLOUDFLARE_R2_PUBLIC_BASE_URL` / `NEXT_PUBLIC_MEDIA_CDN_BASE`**, so the built-in CDN redirect never runs. HTML5 players issue **Range** requests against ~40–53 MB MP4s; those ranges frequently miss the Vercel CDN and refill from origin → Fast Origin Transfer.

**CONFIDENCE:** HIGH

**ESTIMATED SHARE OF 388 GB:** **250–360 GB (≈65–90%)** from `/media/*` video (and related Range fills). Remainder: next/image optimizer fetches, dynamic HTML/RSC for force-dynamic Notes + other pages, sample WebPs/PDFs, APIs.

**BEST FIX:** Serve public `media/*` from a **Cloudflare edge that only allows the `media/` prefix** (Worker or separate public bucket + custom domain). Set `CLOUDFLARE_R2_PUBLIC_BASE_URL` and `NEXT_PUBLIC_MEDIA_CDN_BASE` so `stablePublicMediaUrl()` emits CDN URLs and `/media/*` 308s off Vercel. **Do not make the whole private R2 bucket world-readable** (lectures, proofs, invoices live there).

**EXPECTED FUTURE FOT:** With CDN wired correctly: **TARGET 2 &lt;50 GB/month** is realistic; **stretch &lt;20 GB** if Notes catalog pages also stop being fully dynamic and bots are contained. Without CDN: bot/robots mitigations alone likely save only tens of GB, not hundreds.

---

## Executive Summary

Billing cycle **Sep 11 – Oct 10/11, 2026** showed **388.81 GB Fast Origin Transfer**, almost all **outgoing (382.67 GB)**. Repository + live production probes show the step-change aligns with **Notes Store go-live + teaching reels on `/media` (Sep 20–21)** and further **product-sample / printed-notes videos (Sep 26)**.

The app already contains the correct long-term design (`publicCdnUrl` → 308; `stablePublicMediaUrl` → CDN). Production simply **never configured the public media CDN**, so Vercel remains the media origin for ~294 MB of catalogue video alone (plus images/PDFs).

This audit maps architecture, ranks drivers, and records **low-risk mitigations** shipped in the same PR. The **high-impact CDN cutover requires your Cloudflare URL + Vercel env** (approval item).

---

## Top 5 findings (before code changes)

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
INTENDED (when CDN env set):
  Browser → Cloudflare (media/* only) → Browser
  /media/* → 308 → CDN

ACTUAL (production today):
  Browser (Range) → Vercel /media/[...path] (Node, force-dynamic)
                 → R2 GetObject
                 → stream body → Vercel origin egress (= Fast Origin Transfer)
```

Public URL builder: `lib/publicMediaUrl.ts` → `https://www.namanias.com/media/...` when CDN unset.  
Teaching catalogue: `lib/store/teachingVideos.ts` (`media/store/videos/<id>/full.mp4`).  
Proof videos/samples: `lib/store/notesProof.ts`.

### Caching layers in use

- Next Data Cache / `unstable_cache` (e.g. store categories tag `notes-store`, 600 s)
- ISR `revalidate` on marketing/CA pages
- Route `Cache-Control` / `CDN-Cache-Control` / `Vercel-CDN-Cache-Control` on `/media` (`MEDIA_LONG_CACHE`)
- next/image `minimumCacheTTL` 31 days
- Explicit **no-store** on cart, checkout, orders, admin, payments
- **No** production `CLOUDFLARE_R2_PUBLIC_BASE_URL`

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

| Question | Answer |
|----------|--------|
| Videos proxied through Vercel? | **YES** — teaching + physical-notes MP4s |
| PDFs proxied? | Public sample PDF via `/media` **yes**; invoices **no** (signed) |
| Images proxied? | Covers, posters, sample pages via `/media` when no CDN |
| Double hop next/image → `/media`? | Possible for optimized images (`remotePatterns` includes namanias.com) |
| Bucket private by design? | **YES** — `.env.example` states lectures/proofs use signed URLs; public prefix is `media/` only |

**Security constraint:** Enabling a blanket public R2 bucket would expose `processed/`, `payment-proofs/`, `store-private/`, etc. Public CDN must allowlist **`media/*` only**.

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

1. **Audit document** — this file.
2. **Middleware:** aggressive bots → 403 on `/media` video/PDF extensions (OG images untouched).
3. **robots.txt:** disallow `/media/store/videos/`.
4. **`Vary: Range` only on 206** responses.
5. **Cost probe:** `GET /api/ops/media-cost-probe` (CRON_SECRET, HEAD-only).
6. **Cloudflare Worker** `workers/public-media` — allowlists `media/*` only, ranged R2 gets, CORS for namanias.com, immutable cache headers. Cutover runbook: `docs/media-cdn-cutover.md`.
7. **App CDN wiring:** `publicCdnUrl` refuses non-`media/` keys; `/media` 308s public keys when CDN env set; `stablePublicMediaUrl` emits CDN URLs.
8. **Preload fix:** teaching/physical cards no longer attach/warm full MP4s on scroll; hover may warm ~256KB; `preload="none"` on full player; warm fetch uses `mode: "cors"` for CDN hosts.

**Blocked on your Cloudflare/DNS actions:** Worker deploy + `media.namanias.com` Custom Domain + Vercel env (see cutover doc). Until then production still streams via Vercel `/media`.

**Deferred (safe later):** Notes `/notes` ISR — `getPublicActiveOffer()` currently runs hold-release side effects; needs a read-only offer path before removing `force-dynamic`.

---

## Fixes Requiring Approval

| Fix | Why | Expected reduction | Risk |
|-----|-----|--------------------|------|
| **Configure path-scoped media CDN + env** | Removes video/image bytes from Vercel origin | **200–350 GB/mo** | Low if `media/*` only; **critical** not to publicize private prefixes |
| Re-encode teaching/physical MP4s (lower bitrate / shorter previews) | Smaller cold fills even before CDN | 30–50% of video FOT | Low–medium (quality) |
| ISR `/notes` + PDP (`revalidate` 60–300 + tags) | Cut function invocations + HTML origin | 5–20 GB + CPU | Medium |
| Soften teaching `preload="auto"` / warm bytes | Fewer speculative Range fills | 10–40 GB | Medium (playback start UX) |
| Separate public R2 bucket for store media | Cleaner than Worker allowlist | Same as CDN | Medium (migration) |
| Vercel WAF / bot rate limits on `/media` | Abuse | Variable | Low |

---

## Estimated Cost Reduction

| Scenario | Monthly FOT | Notes |
|----------|------------:|-------|
| CURRENT | ~389 GB | Measured billing |
| After bot/robots/Vary tweaks only | ~320–370 GB | Partial |
| TARGET 1 after CDN env | **&lt;100 GB** | Achievable |
| TARGET 2 CDN + ISR notes | **&lt;50 GB** | Achievable |
| STRETCH + smaller videos + bot WAF | **&lt;20 GB** | Stretch |

---

## Cost-model table

| Issue | Current behavior | Est. GB/mo | Why expensive | Recommended fix | Expected reduction | Risk | Complexity |
|-------|------------------|------------|---------------|-----------------|--------------------|------|------------|
| `/media` video proxy | R2→Vercel→client Range | 250–360 | 40–53 MB MP4s | Path-scoped CDN + env | 80–95% of this row | Low* | Low (config) |
| Sample/cover `/media` | Same proxy | 10–40 | High views | Same CDN | Most | Low* | Low |
| next/image × `/media` | Optimizer pulls origin | 5–25 | Double hop | CDN host in `remotePatterns` (already supports) | Most | Low | Low |
| Notes force-dynamic | SSR every hit | 5–30 | Invocations | ISR + client offer | Partial | Medium | Medium |
| Bot video scraping | Open `/media` mp4 | ?–30 | Full downloads | Middleware + robots (done) | Partial | Low | Low |
| Private sample API | Intentional proxy | &lt;5 | Authz | Keep | — | — | — |

\*Low only if CDN allowlists `media/*`.

---

## Testing Performed

- Live HEAD/GET probes of production `/media` videos/images (sizes, `x-vercel-cache`, no CDN redirect).
- Confirmed Vercel project env keys: R2 credentials present; **CDN base vars absent**.
- Confirmed `/api/media` 308 → `/media`.
- Repo tests for media/teaching (`tests/notes-store-interest/teaching-*.test.ts`, `notes-store-media`) run in CI suite after changes.
- No payment, webhook, shipping, or checkout logic modified.

Manual checklist after deploy / CDN cutover: homepage, `/notes`, Polity/Economy/Modern History PDPs, sample pages, teaching play, checkout load, track order, admin login (smoke).

---

## Monitoring Recommendations

1. Weekly Vercel **Fast Origin Transfer** + filter by path if available; alert at **5 GB/day** and **50 GB/month**.
2. Call `GET /api/ops/media-cost-probe?secret=…` after deploys: `cdnConfigured` must be `true` in production.
3. In browser DevTools on `/notes`, confirm video `Network` hosts are **CDN**, not `www.namanias.com/media/...` (except brief 308).
4. Watch `x-vercel-cache` on residual `/media` traffic — expect mostly redirects, not 200 bodies.
5. Do **not** log full request bodies; probe uses HEAD/size metadata only.

---

## Vercel Spend Protection Recommendations

| Control | Recommendation |
|---------|----------------|
| Spend / usage alerts | Alert at 50%, 75%, 100% of expected FOT budget |
| Hard spend limit | Set if Vercel plan allows — prefer alert + CDN fix over hard outage during campaigns |
| Bot management | Keep middleware list; consider Vercel Bot Protection / WAF on `/media` |
| Regions | `bom1` is appropriate for IN audience |
| Deployments | Production from `master`; avoid shipping large media through app again |
| Env guard | Treat missing `NEXT_PUBLIC_MEDIA_CDN_BASE` in production as a **release blocker** once CDN exists |

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

## Appendix B — CDN cutover checklist (approval)

1. Create Cloudflare mechanism that serves **only** `media/*` (Worker in front of private bucket, or dedicated public bucket synced from `media/`).
2. Custom domain e.g. `https://media.namanias.com` (prefer over rate-limited `*.r2.dev`).
3. Set Vercel Production (+ Preview if desired):
   - `CLOUDFLARE_R2_PUBLIC_BASE_URL=https://media.namanias.com`
   - `NEXT_PUBLIC_MEDIA_CDN_BASE=https://media.namanias.com`
4. Redeploy (public env must be present at **build** for client catalogue URLs).
5. Verify: teaching `full.mp4` URL host is CDN; `/media/...` returns **308**; FOT drops within 24–48 h.
6. Confirm private keys (`processed/`, `payment-proofs/`, `store-private/`) still **404/403** on the public hostname.

---

## Post-Cutover Verification

**Cutover live (production):** 2026-10-13. First signed-redirect deploy `dpl_2saXqjsYCBtaMtU8FXkbMf96QtcJ` ready **05:14:37 UTC**; master merge deploy `dpl_39vfhniRQqKcKCg6tfH4ZdNEyGfB` ready **05:23:10 UTC**.

**Hardening live (production):** `dpl_AUqgq9jyfC64M1xeKuJd17iAtWHf` (commit `afa203f`) ready **~06:42 UTC** — head-before-sign, CDN no-store, redirect `Referrer-Policy: no-referrer`, `X-Media-Signed-TTL`.

### Architecture in production (Phase 1)

```
Browser → namanias.com/media/<public-key>
       → tiny Vercel 302 (Content-Length: 0, X-Media-Redirect: r2-signed)
       → signed private R2 GET URL
       → Cloudflare/R2 serves MP4/PDF/image bytes (Range 206)
```

Worker + `media.namanias.com` remains **PHASE 2 CLEANUP** (needs `CLOUDFLARE_API_TOKEN`; do **not** move apex/www nameservers). Keep signed-R2 until then. Urgency: **LOW**.

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

### Billing / FOT trend (telemetry lag)

Vercel billing charges are **daily UTC windows** (~07:00Z→07:00Z). Hourly FOT Observability (`fot_out_bytes`) returns **400** without Observability Plus — use request-level evidence + daily effectiveCost until a full post-cutover day lands.

| Billing window (UTC) | Fast Origin Transfer **effectiveCost** |
|----------------------|---------------------------------------:|
| 2026-10-11 07:00 → 10-12 07:00 (**pre-cutover**) | **~$2.90** |
| 2026-10-12 07:00 → 10-13 07:00 (**mixed**; cutover only last ~1.75 h) | **~$3.19** |

**PRE-CUTOVER FOT RATE:** ~$2.90 / day (effectiveCost; prior audit ~388 GB month-scale MP4-driven)  
**POST-CUTOVER FOT RATE:** day-bill **not yet collapsed** (mixed window); request-level MP4 payload on Vercel = **0 bytes** (`Content-Length: 0` 302)  
**PERCENT DROP (request-level MP4 egress):** **~100%** eliminated  
**Expected monthly FOT after full days:** residual HTML/RSC + APIs + next/image origin pulls + tiny 302s — **orders of magnitude below** prior MP4-driven FOT (likely low single-digit $/day or less depending on traffic)

Runtime logs since cutover: `/media` not in top paths; **`/api/cron/telegram-dispatch` dominates** (2282 grouped lines).

### R2 cost risk

**LOW.** Bytes move to R2 Class B (HEAD+GET/Range) + egress (R2 egress to internet is typically free on current CF pricing — confirm in CF dashboard). Head-before-sign adds one Class B per miss/hit before sign; still tiny vs former Vercel FOT. No bucket-wide public access.

### Top 3 remaining avoidable Vercel costs (post-media)

| # | Item | Current behavior | Likely cause | Monthly order | Safe fix | Risk |
|---|------|------------------|--------------|---------------|----------|------|
| 1 | **Residual Fast Origin Transfer** | Still #1 in pre/mixed day bills | Dynamic HTML/RSC, image optimizer origin fetches, APIs | Drops hard after full post-cutover days; residual tens of $/mo possible | Re-check after 2026-10-14 07Z day; only then tune image/CDN | Low if observe-only |
| 2 | **Fluid Active CPU + Provisioned Memory** | ~$0.20–0.25/day combined in samples | Cron volume (`telegram-dispatch`) + force-dynamic routes | ~$6–10/mo order | Tighten cron schedule / batch; avoid rewriting checkout | Medium if cron changes wrong |
| 3 | **ISR Writes (+ image opt)** | ~$0.05–0.09/day combined | Catalogue/ISR churn + transforms | ~$2–3/mo order | Longer revalidate where safe; fewer image variants | Low–medium |

Do **not** chase sub-dollar checkout-adjacent changes. Function Invocations (~$0.05–0.09/day) are secondary to Fluid CPU.

### Hardening shipped after verification

- Head-before-sign: missing `media/*` keys → **404** (no signature minted). Live-verified on `dpl_AUqgq9…`.
- Stronger no-store CDN cache headers on signed redirects (live: `CDN-Cache-Control: private, no-store`).
- `Referrer-Policy: no-referrer` on signed redirects (live).
- TTL via `X-Media-Signed-TTL: 21600` (live).
- Build fix: do **not** `export` TTL constant from the Next.js route module (breaks typecheck).
