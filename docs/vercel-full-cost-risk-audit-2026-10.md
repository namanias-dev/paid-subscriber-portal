# Naman IAS — Vercel Cost Risk Audit

**Date:** 2026-10-17  
**Project:** `naman-ias` · **Site:** namanias.com  
**Audience:** Non-engineer owner + engineering follow-up

---

## Plain-English Verdict

**CURRENT SURPRISE-BILL RISK:** MEDIUM

**CAN THIS APP STILL CREATE ANOTHER $100+ BILL?** YES

**IF YES, TOP REASONS:**
1. Someone (or a scraper) hammers expensive public pages that rebuild on every visit (`/notes`, courses, quizzes).
2. Staff leave heavy admin screens open all day (Notes orders / support used to re-scan thousands of rows every 45 seconds).
3. A media regression could silently put large videos back through Vercel (the Oct FOT incident pattern).
4. ~1,600 automated background jobs/day (especially Telegram every 2 minutes) keep a steady compute floor.
5. A sudden campaign spike × force-dynamic storefront × bots could multiply server work without multiplying sales.

**MOST IMPORTANT THING TO FIX:** Keep public media on signed-R2 redirects (already done), stop background admin tabs from doing heavy work (fixes shipped this audit), and set a Vercel spend alert around ~$1/day FOT / ~$3/day total usage.

**SAFE MONTHLY VERCEL EXPECTATION:** ~$50–80 usage + Pro seat (~$20) ≈ **~$70–100/month** at current traffic (post-media-cutover days ~$1.5–1.8/day usage).

**WORST REALISTIC MONTH IF NOTHING CHANGES:** **$150–400** (campaign + scrapers on Notes + admin tabs + cron floor). Catastrophic media regression could exceed that (historically ~389 GB FOT in a month).

---

## Current Architecture

```
Public website (Next.js on Vercel, region bom1)
  → some pages cached (ISR)
  → some pages rebuild every visit (force-dynamic): Notes Store, courses, portal, lecture, payment status…

Public media
  Browser → /media/* → tiny Vercel 302 → signed R2 URL → Cloudflare serves bytes
  (MP4 bodies should NOT travel through Vercel)

Private files (lectures, proofs, invoices)
  Signed URLs / auth-gated redirects — not public catalogue

Background jobs (Vercel Cron)
  ~1,605 runs/day across 14 registered jobs
  Densest: telegram-dispatch every 2 minutes (720/day)

Admin (~93 pages, ~272 APIs) and Portal/Dashboard (authenticated)
```

---

## Cost Map

| Category | Surfaces | Cost shape |
|----------|----------|------------|
| PUBLIC WEBSITE | `/`, CA, resources, webinars | Mostly ISR — moderate |
| NOTES STORE | `/notes*` force-dynamic | **High per visit**; bots amplify |
| COURSES / QUIZZES / LECTURE | force-dynamic public | **High per visit** |
| MEDIA | `/media` signed redirect | **Safe** if CL=0 302 holds |
| ADMIN | `/admin*`, `/api/admin*` | Heavy one-shot + former polling |
| PORTAL / DASHBOARD | `/portal*`, `/dashboard*` | Auth + occasional progress APIs |
| PAYMENTS / ORDERS | bank, notes checkout, verify | Bursty; must stay correct |
| SHIPPING / TRACKING | courier webhooks + crons | Bounded if webhook-first |
| CRONS | 14 registered | Steady floor ~1.6k invocations/day |
| WEBHOOKS | Razorpay, Telegram, Meta, SMS DLR, courier | Must validate early |
| ANALYTICS | admin analytics, campaign rollup cron | Heavy on open; daily rollup OK |
| IMAGE OPT | next/image | Currently small (~$0.50/mo) |
| PDF / DOWNLOADS | invoices/labels signed; sample pages stream | Sample stream = residual risk |

**Observed usage (UTC day Oct 16→17):** FOT ~$0.40 · Fluid CPU ~$0.25 · Memory ~$0.16 · Invocations ~$0.13 · ISR+images ~$0.09 → **~$1.73/day** usage.

---

## Admin Findings

### Continuous polling (before / after this audit)

| Page | Before | 8h open (before) | After fix |
|------|--------|------------------:|-----------|
| Notes Orders | Every 45s + heavy `adminCounts` (5k-row scans) | ~641 heavy runs | Still ~641 list refreshes, but **KPI scans skipped** on silent refresh (`counts=0`) |
| Notes Support | Every 45s even in background; up to 2000 issues scanned | ~641 heavy runs | **Pauses when tab hidden** |
| SMS Send tab | Settings every 30s | ~961 light runs | **120s + visibility pause** (~240/8h) |

**If Aman leaves Notes Orders open 8 hours (after fix):** ~640 list refreshes (lighter) + initial full load with counts. KPI tiles refresh on filter change / manual load, not every silent tick.

### Heavy one-shot admin APIs (still YELLOW/ORANGE)

| API / page | Risk | Why |
|------------|------|-----|
| `/api/admin/payments` | ORANGE | Full payments + enrollments + leads map — no pagination |
| `/api/admin/students` | ORANGE | Full student universe rebuilt each visit |
| `/api/admin/leads?include_legacy=1` | RED if used | Can approach huge legacy sets |
| Notes `adminCounts` | ORANGE on full load | Necessary for KPIs; must not run every 45s (fixed) |
| Analytics overview | YELLOW | Multi-API on load; no short TTL |

No SWR/React Query in admin. Good.

---

## Portal Findings

| Behavior | Frequency | Scale math |
|----------|-----------|------------|
| Lecture progress save | Every **90s** while playing + visibility flush | 1h lecture ≈ 40 calls/student → 1,000 students ≈ 40k invocations (GREEN/YELLOW) |
| Lecture signed URL renew | ~TTL−120s (minutes, not seconds) | Low |
| Portal activity beacon | Once per IST day | Negligible |
| Payment status poll | 2s × max 15 after checkout | Bounded burst — OK |
| Notes order verify poll | Backoff ≤90s | Bounded — OK |

**Biggest portal risk:** Not heartbeats — it’s **force-dynamic lecture/course pages** under scraper traffic (middleware already blocks aggressive bots on `/lecture`, `/courses`, `/quizzes`).

---

## Cron Findings

| Cron | Schedule | Runs/day | Work sketch | Risk |
|------|----------|---------:|-------------|------|
| telegram-dispatch | `*/2` | **720** | Queue + outboxes + lead alerts; idle still does several DB checks | ORANGE (volume) |
| notes-store-prepare | `*/5` | 288 | Store prep / pickup retire | YELLOW |
| campaign-analytics | `*/5` | 288 | Today/yesterday rollups | YELLOW |
| sms-dispatch | `*/10` | 144 | SMS automations | YELLOW |
| notes-store-verify | `*/15` | 96 | Payment verify | YELLOW |
| telegram-reports | hourly@:35 | 24 | Digests | YELLOW |
| sms-dlr | hourly | 24 | DLR pull | GREEN |
| notes-store-tracking | every 2h | 12 | Tracking poll | GREEN |
| Others (daily/6h) | — | ~10 | Ping, purge, rollup, reminders | GREEN |

**Total registered:** ~**1,605 invocations/day** (~48k/month) before counting user traffic.

**telegram-dispatch specifics:**
- Always authorizes, checks due queue/automations, sweeps sales/notes outboxes and lead alerts.
- Idle path returns quickly but still hits DB several times — dominates **log lines**, not necessarily dollars alone.
- Fluid Active CPU (~$7–8/mo) is the bill line to watch.
- **Do not slow to 5–10 min without product sign-off** (sales/notes Telegram latency).

Unregistered but callable with secret: journey-engine, sms-followups, reconcile-payments, etc. — treat secrets as spend keys.

---

## Polling Findings

| Source | Req/user/hour | 1,000 users | Flag |
|--------|---------------:|------------:|------|
| Lecture progress (playing) | ~40 | 40k/h worst | Watch at scale |
| Admin Notes orders (visible) | ~80 | N/A (staff) | Mitigated |
| Admin SMS settings | ~30 → **~0.5** after fix | N/A | Mitigated |
| ClientHealth `/api/version` | ~1 | 1k/h | GREEN |
| Payment status | burst only | — | GREEN |

---

## Database Findings

- Many admin list endpoints still `select` large sets without pagination (payments, students).
- Notes support loader caps at 2000 — good upper bound, but was polled too often.
- Portal/lecture paths generally scoped by id — better.
- **N+1 risk** exists in some admin aggregations; not the top $ risk vs unbounded lists.

---

## External API Findings

| Provider | Risk pattern |
|----------|----------------|
| Telegram | Cron + queue; failures logged; not infinite client retry |
| JustGoSMS | Campaign live panel polls DLR for 5 min — bounded |
| Delhivery/Shiprocket | Webhook-first + tracking cron — OK if secrets held |
| ICICI / Razorpay | Verify crons + QStash ladder → production host (extra invocations per payment — intentional) |
| R2 | Signed GET preferred; sample page proxy still streams through Vercel |

**Outage amplifier:** Client payment-status retries are capped (15). Prefer keeping caps everywhere new code lands.

---

## Webhook Findings

| Webhook | Early auth? |
|---------|-------------|
| Razorpay | Signature verify before work |
| Telegram | Secret/token gated |
| Meta leadgen | Verify challenge + ingest |
| SMS DLR | Token query param |
| Courier events | Provider auth paths |

Bots without secrets should fail cheaply — keep it that way.

---

## Auth Findings

- Middleware matcher is **narrow** (dashboard, portal, selected public + media + now notes).
- Rolling cookies re-sign on activity (expected).
- Admin APIs enforce permissions server-side (page shell alone is not enough — good).

---

## Image Findings

- `minimumCacheTTL` 31 days — good.
- Current image optimization ~**$0.50/mo** — GREEN.
- Risk: staff upload huge sources → many transforms. Prefer upload size caps in product ops (not changed here).

---

## File / Download Findings

| Asset | Path |
|-------|------|
| Teaching MP4 | Signed R2 redirect — **SAFE** |
| Invoices / labels / career files | 302 / URL JSON — **SAFE** |
| Watermarked sample pages | `/api/notes/sample/[id]` **streams via Vercel** — YELLOW residual |
| CSV admin exports | Small text — GREEN |

---

## Analytics Findings

- Daily `analytics-rollup` is appropriate.
- `campaign-analytics` every 5 minutes is chatty; cost is moderate today.
- Admin analytics pages recompute on open — don’t leave open on a projector all day.

---

## ISR Findings

- Broad `POST /api/ops/revalidate-public` can bust all public tags — **secret-gated**; don’t call casually.
- Notes storefront is force-dynamic (`revalidate = 0`) — intentional for offers; main residual public cost driver after media fix.
- Moving Notes to ISR is **medium risk** (offer side effects) — recommend later with a read-only offer path.

---

## Bot / Abuse Findings

| Endpoint class | Rating |
|----------------|--------|
| Aggressive bots → courses/quizzes/lecture/media video | Already 403 |
| Aggressive bots → **`/notes*`** | **Now 403** (this audit) |
| Googlebot / social OG | Still allowed |
| Public lead/payment start | MODERATE — needs rate limits at edge eventually |
| Admin/cron without secret | Should 401 cheaply |

---

## Failure Amplification Findings

| Scenario | Amplification? |
|----------|----------------|
| Telegram down | Cron keeps trying every 2 min — CPU floor, not FOT bomb |
| R2 slow | Media 302/404; avoid stream fallback in prod |
| Shiprocket down | Tracking cron limited frequency |
| Supabase slow | Force-dynamic pages timeout → user refresh → more invocations |

---

## Top 10 "$100 Bill" Scenarios

1. **Media regression** (stream fallback returns) — CRITICAL — YES $100+  
2. **Scraper farm on `/notes` before bot fix** — RED — YES during campaigns  
3. **Admin Notes orders tab 24/7 with full counts every 45s** — ORANGE — YES with multi staff × days  
4. **Legacy leads dump (`include_legacy=1`) in a loop** — RED — YES  
5. **Instagram spike × force-dynamic Notes × no CDN HTML cache** — ORANGE — possible  
6. **telegram-dispatch + other crons under heavy queue backlog** — ORANGE — possible  
7. **Sample PDF/image proxy abuse** — YELLOW/ORANGE  
8. **Internal self-fetch storms** (enroll→lead is one extra invocation per checkout — YELLOW)  
9. **Ops revalidate-all during peak** — YELLOW  
10. **Upload/transform megapixel image spam** — YELLOW  

Likelihood × impact leaders: **#1 media**, **#2/#5 Notes force-dynamic**, **#3 admin**, **#6 crons**.

---

## Low-Risk Fixes Implemented

1. Notes Support queue: **pause polling when tab hidden**.  
2. SMS Send promo-window poll: **120s + visibility pause** (was 30s always).  
3. Notes Orders silent refresh: **`counts=0`** skips heavy `adminCounts` scans.  
4. Middleware: aggressive bots **403 on `/notes*`** (matcher updated).  
5. **`GET /api/ops/cost-health`** (CRON_SECRET) — lightweight media/cron posture report.  
6. Shared `PUBLIC_MEDIA_SIGNED_TTL_SECONDS` helper for ops + media route.  
7. Guard tests in `tests/notes-store-interest/cost-health.test.ts`.

---

## Medium-Risk Recommendations

| Item | Why | Ask before changing |
|------|-----|---------------------|
| Paginate `/api/admin/payments` & students | Cuts GB-seconds | Admin UX |
| Cache `adminCounts` 30–60s server-side | Safer than skipping forever | Ops KPI freshness |
| telegram-dispatch `*/2` → `*/5` if latency OK | Cuts ~430 cron runs/day | Sales/Telegram SLAs |
| campaign-analytics `*/5` → `*/15` | Cuts 192 runs/day | Marketing dashboards |
| Notes storefront ISR | Big public $ win | Offer hold-release design |
| Replace enroll→lead self-`fetch` with direct call | Saves 1 invocation/checkout | Attribution cookie behavior |
| Upload byte cap for admin images | Prevents transform bombs | Content workflow |

---

## Cost Guardrails

1. **Vercel alert:** FOT effectiveCost **>$1/day** for 2 consecutive days.  
2. **Vercel alert:** Total usage **>$3/day**.  
3. Weekly: `GET /api/ops/cost-health?secret=…` → `mediaProxySafe: true`.  
4. Spot-check: `/media/…/full.mp4` → 302, `Content-Length: 0`.  
5. Don’t leave Notes admin + SMS Send open on unused machines overnight.  
6. Treat `CRON_SECRET` like a credit card.  
7. Worker/`media.namanias.com` remains **optional later** — not required for bill control.

---

## Estimated Monthly Cost After Fixes

| Band | Monthly usage (excl. Pro seat) | Notes |
|------|-------------------------------:|-------|
| Normal (current traffic) | **~$45–70** | Matches ~$1.5–1.8/day post-cutover |
| High-traffic campaign month | **~$90–150** | Force-dynamic Notes still scales with visits |
| Abuse / regression month | **$200–500+** | Media stream back or scraper storm |

Pro subscription (~$20) sits on top of usage.

---

## Verification (2026-10-17)

- Live media: teaching MP4 **302** + `X-Media-Redirect: r2-signed` + TTL 21600.  
- `/` and `/notes` return 200 for humans.  
- Unit tests: `cost-health`, `media-cost-audit`, `teaching-videos` — **pass**.  
- Bot 403 on `/notes` requires deploy of this branch to production.

---

## Appendix — Cron runs/day math

`telegram-dispatch` 720 + `notes-store-prepare` 288 + `campaign-analytics` 288 + `sms-dispatch` 144 + `notes-store-verify` 96 + hourly jobs 60 + dailies ≈ **1605/day**.
