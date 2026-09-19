# Notes Store — security and privacy

## Order access capability

| Property | Implementation |
|----------|----------------|
| Entropy | `randomBytes(24)` → 192 bits (`lib/store/accessToken.ts`) |
| DB storage | **Hash only** — `store_orders.tracking_token_hash` (SHA-256 of peppered token) |
| Pepper source | `STORE_ACCESS_TOKEN_PEPPER` or `JWT_SECRET` (names only; never commit values) |
| Raw token | httpOnly cookie `nsa_store_order_access` = `ORDER_NO.token` and/or optional `?t=` |
| Compare | `timingSafeEqual` on hash hex strings |
| Checkout JSON | Must **not** return `access_token` (cookie only) |
| Callback URL | Must **not** put token in query string (cookie from SameSite=Lax return) |
| Track | Phone+order proof mints **new** token, updates hash, sets cookie |
| Logging | Never log raw token; `redactAccessSecrets` helper available |
| Analytics | Do not send token or full capability URL |

## HTTP hardening

| Control | Where |
|---------|-------|
| `Cache-Control: no-store` | `lib/store/http.ts`, `next.config.js` for cart/checkout/order/track/admin |
| `robots: noindex,nofollow` | Order + track page metadata; `X-Robots-Tag` on order/track |
| `Referrer-Policy: no-referrer` | Order/track headers + metadata |
| Rate limits | `storeRateLimited` on checkout, track, verify (`lib/store/rateLimit.ts` → `auth_attempts`) |

## Non-enumeration

Invalid order/phone/token → same generic errors (`not found` / `No order matches that number and phone`) with 404. Do not reveal which field failed.

## Public order DTO (`PublicOrder`)

Exposed: `order_no`, `stage`, `stage_label`, `placed_at`, `promised_delivery_date`, `total_label`, `items[{name,qty,total}]`, `awb`, `courier`, `steps`, `confirming`, optional echoed `access_token`.  
**Not** exposed: DB ids, cost price, internal notes, provider payloads, audit metadata, raw payment rows.

## Admin

Admin Notes APIs use `requirePermission(...)` server-side (`store_manage_catalogue`, fulfilment perms in `lib/permissions.ts`). Never trust client role alone.

## Sample media

`store_product_media` sample_page: private R2, watermarked derivative only via `/api/notes/sample/[id]`. Route must never read `original_key` (tested).

## RLS

Store tables enable RLS in schema migration; app uses service role server-side. Do not expose service role to browser.

## Residual risks

- Preview Deployment Protection SSO blocks unauthenticated Lighthouse/browser automation.  
- Real payment path unproven end-to-end (owner deferred).  
- Legacy plaintext `tracking_token` column deprecated/null; migration wiped plaintext.  
- Cookie missing on return device → customer must use phone track.
