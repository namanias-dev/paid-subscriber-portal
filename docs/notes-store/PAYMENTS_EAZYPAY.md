# Notes Store — Eazypay payments

> Implementation exists and automated isolation tests pass; a **real Eazypay transaction remains deliberately deferred and unverified by owner decision.**

## Non-negotiable design

| Rule | Implementation |
|------|----------------|
| Same ICICI Eazypay gateway | Academy merchant credentials (env names in `FEATURE_FLAGS_AND_ENV.md`) |
| Same registered return URL | `ICICI_EAZYPAY_RETURN_URL` → `app/api/v1/bank/payment/route.ts` |
| No second return URL | Absolute |
| No Razorpay for store | Absolute |
| No COD | Absolute |
| Payment reference namespace | **`NIASN-N-`** (`lib/store/references.ts`) |
| Human order numbers | **`NIAS-N-<year>-######`** (Postgres `next_store_order_no`) |
| Store ledger | `store_order_payments` + `store_payment_events` |
| Terminal authority | **`applyStoreVerify` only** (`lib/store/payments/verify.ts`) |
| Callback | **Advisory only** → at most `UNCONFIRMED` |

## Files

| Role | Path |
|------|------|
| Shared return URL (course + store) | `app/api/v1/bank/payment/route.ts` |
| Prefix dispatch (`req.clone()`, no middleware body parse) | `lib/store/payments/callbackDispatch.ts` |
| Advisory apply | `lib/store/payments/callback.ts` |
| Terminal Verify | `lib/store/payments/verify.ts` |
| Store Eazypay client | `lib/store/payments/eazypay.ts` |
| Status mapping (store-owned copy) | `lib/store/payments/status.ts` |
| Misroute probe (read-only academy `payments`) | `lib/store/payments/misrouteProbe.ts` |
| Recovery cron | `app/api/cron/notes-store-verify/route.ts` — `*/15 * * * *` in `vercel.json` |
| Customer Verify trigger | `app/api/notes/order/[orderNumber]/verify/route.ts` |

## Why not middleware body inspection

The shared return URL must not consume the request body in middleware before the course handler. Store dispatch uses **`req.clone()`** inside the route after the request arrives, then returns early for `NIASN-N-` references. Course behavior remains unchanged when the shim returns null.

## SubMerchantId

`storeSubMerchantId()` in `lib/store/payments/eazypay.ts` defaults to **`"21"`**, overridable via env `NOTES_STORE_SUBMERCHANT_ID`. Echoed SubMerchantId in callback is **logged on mismatch**, not used as the isolation guarantee — **reference prefix is isolation**. Real-world ICICI echo behavior: **not verified by a live store payment** (deferred).

## paymode

Store payment URL builder uses **paymode=9** (same pattern as Academy card/netbanking style initiation). Confirm against ICICI docs before changing.

## States (store payments)

Open: `INITIATED` → (`VERIFYING`) → `UNCONFIRMED` (callback advisory).  
Terminal (Verify only): `CAPTURED` | `FAILED` | `EXPIRED`.  
Amount mismatch: **not captured**; ops alerted.

## Confirmation UX

Order page shows **“Payment received — confirming your order.”** and polls store Verify with access capability for ~90s (`components/notes/OrderStatus.tsx`). Cron is recovery for abandoned browsers. Does **not** import course payment poll.

## Idempotency

- Unique `store_payment_events.event_id` for callbacks  
- Conditional UPDATEs on open statuses only  
- Verify concurrent callers: at most one capture  

## Quote / amount authority

Totals from server `lockQuote` / frozen `quote_json`; gateway amount must match paise (see `paiseToGatewayAmount`). Client cannot set price.

## Protected boundaries

- Do not modify `lib/eazypay.ts` for store features beyond what `lib/store/payments/eazypay.ts` already reuses.  
- Do not modify course Verify cron or course status poll for store needs.  
- Do not enable production store without owner decision.  
- Do not run a real charge to “finish” docs.
