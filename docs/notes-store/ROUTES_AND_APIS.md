# Notes Store — routes and APIs

## Public pages

| Path | File | Auth | Cache | Flag |
|------|------|------|-------|------|
| `/notes` | `app/(site)/notes/page.tsx` | public | ISR | dark → 404 |
| `/notes/[subject]` | `…/[subject]/page.tsx` | public | ISR | dark → 404 |
| `/notes/products/[slug]` | `…/products/[slug]/page.tsx` | public | ISR | dark → 404 |
| `/notes/cart` | `…/cart/page.tsx` | guest cookie | no-store | |
| `/notes/checkout` | `…/checkout/page.tsx` | guest | no-store | |
| `/notes/order/[orderNumber]` | `…/order/[orderNumber]/page.tsx` | token/cookie | no-store | noindex |
| `/notes/track` | `…/track/page.tsx` | phone proof API | no-store | noindex |

## Customer APIs

| Method | Path | Auth | Rate limit | Notes |
|--------|------|------|------------|-------|
| GET | `/api/notes/status` | none | — | `{ok, enabled}` for nav |
| GET/POST/PATCH/DELETE | `/api/notes/cart` | cart cookie | — | |
| POST | `/api/notes/checkout` | cart + body | yes | sets access cookie; strips token from JSON |
| GET | `/api/notes/pin` | none | — | serviceability + promised date; returns `quote` (authoritative subtotal/shipping/tax/total via `buildFrozenQuote`) when a live cart is serviceable |
| GET | `/api/notes/sample/[id]` | none | — | watermarked only |
| POST | `/api/notes/track` | phone+order | yes | mints token |
| POST | `/api/notes/order/[orderNumber]/verify` | access token | yes | triggers Verify |

## Admin APIs

| Method | Path | Auth |
|--------|------|------|
| GET | `/api/admin/notes/orders` | staff permission |
| POST | `/api/admin/notes/orders/[id]/advance` | staff |
| POST | `/api/admin/notes/orders/[id]/ship` | staff |
| GET/POST/PATCH | `/api/admin/notes/products` | `store_manage_catalogue` |
| GET/POST/PATCH/DELETE | `/api/admin/notes/media` | `store_manage_catalogue` — upload/reorder/cover/delete product photos + watermarked sample pages (Cloudflare R2) |

## Cron

| Path | Schedule | Auth |
|------|----------|------|
| `/api/cron/notes-store-verify` | `*/15 * * * *` | `CRON_SECRET` |

## Shared integration

| Path | Role |
|------|------|
| `/api/v1/bank/payment` | Course + store callback entry; store claimed via `NIASN-N-` |

Failure codes: prefer 404 for capability misses (non-enumerable); 429 when rate limited; 400 for validation; 503 if DB unavailable.
