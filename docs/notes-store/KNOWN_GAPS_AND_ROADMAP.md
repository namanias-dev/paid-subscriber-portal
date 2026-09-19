# Notes Store — known gaps and roadmap

Prioritized honest queue. **Do not repeatedly ask for real payment** — it is owner-deferred; checklist remains for later.

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
| Bundle merchandising UX | Schema exists |
| Store analytics event parity | view/add/checkout/purchase |
| Playwright safe journey to payment URL | Add only if team wants dependency |

## P3 / polish

| Item | Notes |
|------|-------|
| Further ProductCard → CourseCard alignment | Design debt |
| Account order history | Needs product decision |

## Out of phase

Coupons, Shiprocket, reviews, returns portal, invoices — flags off; do not build without phase plan.
