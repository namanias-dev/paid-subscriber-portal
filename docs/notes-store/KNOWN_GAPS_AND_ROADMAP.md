# Notes Store — known gaps and roadmap

Prioritized honest queue. **Do not repeatedly ask for real payment** — it is owner-deferred; checklist remains for later.

## Delivered in the 2026-09-19 continuation (moved OUT of the roadmap)

PDP content completeness · server-authoritative checkout total · Cloudflare R2 admin
media upload · availability model (Ready Stock / On Demand / Coming Soon / Unavailable)
· preparation-demand queue · operational order management (search/buckets/copy/exceptions)
· admin overview · **bundles (admin components + storefront detail + savings)** ·
**Notes commerce analytics events** · **shipping-provider abstraction (manual + Shiprocket boundary)**
· **notification boundary (order confirmed/shipped, gated)**. Availability migration
applied + demo catalogue seeded on the Academy DB.

## Blocked ONLY by owner-side external access (not code)

| Item | Exact blocker |
|------|---------------|
| Browser QA / Lighthouse on preview | Vercel Deployment Protection (SSO) on preview URLs |
| Preview `/notes` opens | `NOTES_STORE_PREVIEW_ENABLE=1` on Vercel Preview env (no Vercel auth here) |
| Runtime R2 upload round-trip | R2 creds live only in Vercel env |
| Order-confirmed / shipped SMS | DLT templates not yet approved (no template ids) |
| Real ₹1 Eazypay | Owner-deferred |
| Shiprocket automation | Shiprocket account/creds not provisioned (boundary ready) |

## P0 (blocked or safety)

| Item | State | Acceptance |
|------|-------|------------|
| Real Eazypay end-to-end proof | DEFERRED BY OWNER | Owner runs ₹1; Stage 8 isolation evidence |
| Production remain disabled | Done / ongoing | Flag off until explicit enable |

## P1 (unblocked, high value)

| Item | Acceptance |
|------|------------|
| Authenticated browser QA on preview (375–430 + desktop) | Manual pass on store journeys up to payment page |
| Valid Lighthouse local or unprotected preview | Scores for real `/notes` pages, not SSO login |
| Test SKU cover + sample media | Labelled TEST imagery uploaded via store media path |
| Admin fulfil dry-run on a non-paid or paid-later order | Advance + ship UI verified by ops |
| DLT submit/approve when ready | Template IDs stored; still leave `notes_store_sms` off until tested |

## P2

| Item | Notes |
|------|-------|
| Playwright safe journey to payment URL | Not added: no runnable preview/DB target in the agent env (SSO + secrets), so e2e can't execute here; pure logic is unit-tested. Add when a reachable preview exists |
| Landing cinematic/3D hero pass | Optional premium polish; current landing is on-brand and fast |

## P3 / polish

| Item | Notes |
|------|-------|
| Further ProductCard → CourseCard alignment | Design debt |
| Account order history | Needs product decision |

## Out of phase

Coupons, Shiprocket, reviews, returns portal, invoices — flags off; do not build without phase plan.
