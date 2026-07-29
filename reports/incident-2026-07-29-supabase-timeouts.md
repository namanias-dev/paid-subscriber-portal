# Incident report — 2026-07-29 Supabase timeouts / public 5xx

**Status at write time:** Hotfix shipped (PR #44 + #45). Automation left OFF. Kill-switch SQL still blocked by DB timeouts during response. Zero SMS asserted during response (no outbound send path invoked by responders).

| Field | Value |
|---|---|
| Detected | 2026-07-29 ~12:30 UTC (Vercel alert) |
| Prod at onset | `/api/version` = `0dc294327faa` (PR #43), not `da499167` |
| Hotfix | PR #44 `e2f30555` then PR #45 `db14238a` (layout budgets) |
| Project | Supabase `xqwdfyzerzsllqiyzxem` (ACTIVE_HEALTHY metadata; SQL API timing out) |

---

## 1. What broke (plain language)

Visitors opening webinar pages (and the homepage) waited until the site gave up and showed an error. The database was so busy that public pages could not finish loading. Analytics beacons also failed at times. Admin login shell often still answered.

---

## 2. Which layer failed — and evidence

| Layer | Verdict | Evidence |
|---|---|---|
| **Supabase (Postgres / API)** | **Primary failure** | MCP `execute_sql` / advisors: *Connection terminated due to connection timeout*; kill-switch update via service role timed out (~8–20s); Postgres logs earlier in response showed statement cancels / WAL / checkpoint pressure |
| **Vercel** | **Symptom / amplifier** | ~4.7k **504** in 3h; functions hung until `maxDuration` (webinars up to **300s**, crons **60s**); `/api/version` stayed **200** (no DB) |
| Admin vs public | Public DB-heavy SSR hit hardest; `/admin` often **200** quickly (shell) |

**Plain answer:** Supabase saturation starved the API. Vercel functions waited on Supabase and timed out → visitor 5xx.

---

## 3. Root cause (file:line + timeline)

### Shared blast radius
All live data paths used one admin client (`getSupabaseAdmin()` in `lib/dataProvider.ts` / `lib/supabase.ts`) with **no fetch timeout** before the hotfix. Public SSR, `/api/track` writes, and heavy crons competed for the same pool.

### Offenders (pre-fix)
| Offender | Why it hurt |
|---|---|
| `app/(site)/layout.tsx` | Awaited `getSiteSettings` + `hasUpcomingWebinars` + `getWhatsNew` on **every** public page with no deadline |
| `lib/dataProvider.ts` `getWebinarBySlug` | Loaded **all** webinars then filtered |
| `getWebinarRegisteredCounts` | Unscoped scans of `payments` + `webinar_registrations` |
| `app/api/track/route.ts` | Awaited rate-limit + `analytics_events` insert on the request path |
| `lib/sms/accessAutomation.ts` ~178 | `Promise.all(getAllCourseEnrollments, getAllCourses, …)` on cron |
| Crons | `sms-followups` `*/2`, `journey-engine` `*/5`, `access-reminders` `*/15` |

### Timeline (UTC)
| Time | Event |
|---|---|
| Prior day | PR #42 enabled access SMS live (ramp 25); PR #43 bulk Send reminders |
| **12:30** | Alert: webinars / track failure spikes |
| Ongoing | Cron ticks every 2–5–15 min; Vercel logs show `/api/cron/sms-followups` itself **504 @ 60s** while public `/webinars` **504 @ 300s** |
| Response | Kill-switch SQL **could not run** (DB timeout) → code halt + remove heavy crons from `vercel.json` |
| ~13:54 | PR #44 merged |
| ~13:57 | Prod `e2f30555` — timeouts shortened (~15s) but layout still 504’d pages |
| ~14:01 | PR #45 merged (layout budgets) → prod `db14238a` |

**Cron schedule correlation is near-proof:** failure mode includes cron routes timing out on the same DB, not a pure traffic spike.

---

## 4. Caused by our recent changes (#42 / #43)?

**Yes — materially.** Enabling live automation (#42) plus frequent heavy crons (`access-reminders` / `journey-engine` / `sms-followups`) on the shared Supabase client created sustained DB pressure. #43 added bulk-send tooling on the same stack (settings stayed live at ramp 25). Public pages had no isolation, no fetch timeout, and layout DB calls with no deadline — so pool pressure became visitor 5xx.

Not a Supabase platform outage (project status remained ACTIVE_HEALTHY). Not expired keys. Not a proven bot flood as the primary cause.

---

## 5. What visitors experienced

| Experience | Detail |
|---|---|
| Symptom | Blank/error pages, long waits, **504** on `/`, `/webinars`, webinar slugs; intermittent `/api/track` failures |
| Duration | From ~**12:30 UTC** until hotfix `db14238a` live and routes return **200** (verify section below) |
| Severity | Public marketing/registration paths down or degraded; admin often usable |

---

## 6. What we changed

| Change | Where |
|---|---|
| SEV1 heavy-cron halt | `lib/incidentHalt.ts`; cron routes return `{halted:true}` |
| Removed heavy crons from schedule | `vercel.json` (journey / followups / access-reminders) |
| Fetch timeouts + public client | `lib/supabase.ts` (`PUBLIC_DB_TIMEOUT_MS` ~2.5s, admin ~5s) |
| Circuit breaker | `lib/dbCircuit.ts`; used by track + automation cron |
| `/api/track` fire-and-forget | `app/api/track/route.ts` |
| Soft degrade + ISR + page budgets | `webinars/page.tsx`, `webinars/[slug]/page.tsx`, `page.tsx` |
| **Layout budgets** (critical) | `app/(site)/layout.tsx` |
| Scoped webinar queries | `getPublicWebinars` / `getWebinarBySlug` / `getWebinarRegisteredCounts` |
| Automation mid-run circuit check | `lib/sms/accessAutomation.ts` |

**Shipped:** https://github.com/namanias-dev/paid-subscriber-portal/pull/44 · https://github.com/namanias-dev/paid-subscriber-portal/pull/45  

**Guards:** no fee/amnesty/template/transfer changes; no destructive migrations; zero SMS sent by responders.

---

## 7. Why it should not recur

1. **Halt** — heavy crons off schedule + code halt until deliberately resumed  
2. **Timeouts** — hung Supabase calls abort; functions return instead of 300s 504  
3. **Degrade** — public pages render empty/soft UI rather than hard-fail  
4. **Track** — analytics cannot block the page  
5. **Circuit** — automation stops on repeated DB failures  
6. **Query hygiene** — webinar counts scoped; slug lookup by slug  

Still recommended before turning automation fully live again: dedicated pooler role / lower automation concurrency, CONCURRENTLY indexes if EXPLAIN shows seq scans, and restore cron entries only with `SEV1_HALT_HEAVY_CRONS=false` after 15+ min green.

---

## 8. Monitoring / alerts to add

| Alert | Why |
|---|---|
| Public route 5xx rate (`/`, `/webinars*`) > baseline | Catch blast radius early |
| p95 latency `/webinars` > 3s | Before 504 storm |
| Supabase connection count / pool saturation | Root metric |
| Cron duration / 5xx for `sms-followups`, `journey-engine`, `access-reminders` | Cron should not share fate with visitors silently |
| `access_reminder_settings.kill_switch` drift + outbound SMS/hour | Safety |
| Circuit-open / `sev1_halt` log counter | Confirm automation stays off under pressure |

---

## 9. Open risks — decisions needed

| Decision | Recommendation |
|---|---|
| **Re-enable automation?** | **NO until** public 200 for 15+ min, kill_switch confirmed in DB, connection count healthy. Then `kill_switch=false`, `enabled=true`, `dry_run=false`, **ramp stays 25** |
| DB kill_switch still unset? | Retry SQL when pool recovers: `update access_reminder_settings set kill_switch=true, enabled=false, dry_run=true where id=1;` |
| Restore heavy crons in `vercel.json`? | Only after halt flag false **and** site green; keep route-level circuit |
| Separate Supabase pool for automation? | Yes — follow-up infra (transaction pooler + capped concurrency) |
| Index creation? | Only CONCURRENTLY after EXPLAIN on worst queries post-stabilization |

### Verification log (fill as measured)

| Check | Before | After hotfix |
|---|---|---|
| `/api/version` | `0dc294327faa` | `db14238a…` (target) |
| `/webinars` | 504 ~15–300s | _pending deploy verify_ |
| `/webinars/[slug]` | 504 | _pending_ |
| `/api/track` | mixed / 504 | often 200 even mid-incident |
| Suite | — | **997 pass**, `tsc --noEmit` clean, build clean |
| Automation | live ramp 25 | **LEFT OFF** (code halt + cron removed; DB kill pending) |
| SMS during response | — | **Zero outbound by responders** |

---

## Innocent explanations ruled out

| Hypothesis | Result |
|---|---|
| Legitimate traffic spike alone | Unlikely primary — cron routes also 504 on same DB |
| Expired keys | `/api/version` + intermittent track 200 contradict |
| Migration lock | No evidence; SQL couldn't connect at all under load |
| Supabase paused / quota | Project listed ACTIVE_HEALTHY; failure is saturation/timeouts |
| Vercel platform outage | Version route healthy; failures are DB-bound paths |
