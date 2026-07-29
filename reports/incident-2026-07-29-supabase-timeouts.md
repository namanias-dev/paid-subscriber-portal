# Incident report — 2026-07-29 Supabase timeouts / public 5xx

**Status:** Public routes restored (200 under load). Automation **LEFT OFF**. DB kill-switch still unreachable (SQL timeout). Zero SMS by responders. Prod `/api/version` = `39f343dd9300`.

| Field | Value |
|---|---|
| Detected | 2026-07-29 ~12:30 UTC (Vercel alert) |
| Prod at onset | `/api/version` = `0dc294327faa` (PR #43), not `da499167` |
| Hotfix | #44 → #45 → #46 (`39f343dd`) |
| Project | Supabase `xqwdfyzerzsllqiyzxem` (ACTIVE_HEALTHY; SQL API still timing out for writes) |

---

## 1. What broke (plain language)

Visitors opening webinar pages and the homepage waited until the site gave up and showed an error. The database was so busy that public pages could not finish loading. Analytics beacons also failed at times. Admin login shell often still answered.

---

## 2. Which layer failed — and evidence

| Layer | Verdict | Evidence |
|---|---|---|
| **Supabase (Postgres / API)** | **Primary failure** | MCP `execute_sql`: connection timeout; kill-switch update timed out; statement cancels / WAL pressure earlier in response |
| **Vercel** | **Symptom / amplifier** | ~4.7k **504** in 3h; functions hung until `maxDuration`; `/api/version` stayed **200** |
| Admin vs public | Public SSR hit hardest; `/admin` often **200** quickly |

**Plain answer:** Supabase saturation starved the API. Vercel functions waited on Supabase and timed out → visitor 5xx.

---

## 3. Root cause (file:line + timeline)

### Shared blast radius
One admin client (`getSupabaseAdmin()`) with **no fetch timeout** before hotfix. Public SSR, `/api/track` writes, and heavy crons shared the pool.

### Offenders (pre-fix)
| Offender | Why it hurt |
|---|---|
| `app/(site)/layout.tsx` | Awaited settings / webinars / announcements on **every** public page with no deadline |
| `lib/dataProvider.ts` `getWebinarBySlug` | Loaded **all** webinars then filtered |
| `getWebinarRegisteredCounts` | Unscoped scans of `payments` + `webinar_registrations` |
| `app/api/track/route.ts` | Awaited DB write on the request path |
| `lib/sms/accessAutomation.ts` ~178 | Full enrollment/course scans on cron |
| Crons | `sms-followups` `*/2`, `journey-engine` `*/5`, `access-reminders` `*/15` — themselves 504 @ 60s |

### Timeline (UTC)
| Time | Event |
|---|---|
| Prior day | #42 live SMS (ramp 25); #43 bulk reminders |
| **12:30** | Alert spikes on `/webinars*`, `/api/track` |
| Response | Kill-switch SQL **could not run** → code halt + remove heavy crons from `vercel.json` |
| ~13:57 | #44 live — timeouts shorter; layout still 504’d pages |
| ~14:04 | #45 live — `/webinars` **200**; `/` still 504 @ 10s |
| ~14:08 | #46 live — `/` **200** |

---

## 4. Caused by our recent changes (#42 / #43)?

**Yes — materially.** Live automation + frequent heavy crons on a shared untuned Supabase client saturated the DB. Public pages had no isolation/timeouts/layout budgets, so visitors got 5xx. Not a platform pause; not expired keys.

---

## 5. What visitors experienced

| | |
|---|---|
| Symptom | Long waits / **504** on `/`, `/webinars`, slugs; intermittent track failures |
| Duration | ~**12:30 UTC → ~14:08 UTC** (~1.5–2h) until `39f343dd` restored all three |

---

## 6. What we changed

| Change | Where |
|---|---|
| Heavy-cron halt + remove from schedule | `lib/incidentHalt.ts`, cron routes, `vercel.json` |
| Fetch timeouts + public client | `lib/supabase.ts` |
| Circuit breaker | `lib/dbCircuit.ts` |
| Track fire-and-forget | `app/api/track/route.ts` |
| Soft degrade + ISR + budgets | webinars pages, homepage |
| Layout budgets | `app/(site)/layout.tsx` |
| Scoped webinar queries | `lib/dataProvider.ts` |

PRs: [#44](https://github.com/namanias-dev/paid-subscriber-portal/pull/44) · [#45](https://github.com/namanias-dev/paid-subscriber-portal/pull/45) · [#46](https://github.com/namanias-dev/paid-subscriber-portal/pull/46)

---

## 7. Why it should not recur

Halt + cron removal, fetch timeouts, soft degrade, fire-and-forget track, layout budgets, circuit breaker, scoped queries. Restore automation only after 15+ min green and confirmed kill_switch / resume process.

---

## 8. Monitoring / alerts to add

- Public 5xx rate and p95 on `/`, `/webinars*`
- Supabase connection / pool saturation
- Cron 5xx / duration for followups, journey, access-reminders
- Outbound SMS/hour + kill_switch drift
- Circuit-open / `sev1_halt` counters

---

## 9. Open risks — decisions needed

| Decision | Recommendation |
|---|---|
| Re-enable automation? | **NO today.** Leave OFF. Site green but home p95 ~18s and DB writes still timing out |
| Kill-switch SQL | Retry when pool recovers: `update access_reminder_settings set kill_switch=true, enabled=false, dry_run=true where id=1;` |
| Restore crons in `vercel.json`? | Only with halt cleared after sustained green |
| Separate pool for automation? | Follow-up yes |

### Verification (measured)

| Check | Before | After (`39f343dd`) |
|---|---|---|
| `/webinars` ×15 | 504 ~15–300s | **200** p50 **7.3s** p95 **7.3s** |
| `/webinars/[slug]` ×10 | 504 | **200** p50 **4.5s** p95 **4.5s** |
| `/api/track` ×20 | mixed/504 | **200** p50 **0.9s** p95 **1.2s** |
| `/` ×8 | 504 | **200** p50 **18.1s** p95 **18.3s** (degraded OK; still slow) |
| Suite | — | **997** pass; `tsc --noEmit` clean; build clean |
| Automation | live ramp 25 | **OFF** (code halt + cron removed; DB kill still pending) |
| SMS during response | — | **Zero outbound by responders** |

### Innocent explanations ruled out

Traffic-only spike, expired keys, migration lock, Supabase pause, Vercel platform outage — all inconsistent with evidence (cron 504s + healthy `/api/version` + ACTIVE_HEALTHY + shared-client saturation).
