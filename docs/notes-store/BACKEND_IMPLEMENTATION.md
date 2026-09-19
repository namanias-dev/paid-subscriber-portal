# Notes Store — backend implementation

## Domain modules (`lib/store`)

| File | Responsibility |
|------|----------------|
| `db.ts` | Supabase accessor (no dataProvider) |
| `flags.ts` | Kill switch + preview override |
| `http.ts` | no-store JSON + requireLiveStore |
| `catalogue.ts` | Active-only product/category reads |
| `cart.ts` | Cookie cart id; qty clamp |
| `quote.ts` | Frozen quote + TTL |
| `checkout.ts` | Guest place order + attribution freeze |
| `orders.ts` | Public projection (token hash verify) |
| `accessToken.ts` | Mint/hash/cookie/redact |
| `inventory.ts` | Reserve/release/hold RPCs |
| `serviceability.ts` | PIN / promised date (+2 day buffer Phase 1) |
| `projection.ts` | Customer stages; Packed until AWB |
| `money.ts` / `productPrice.ts` | Paise + ₹1 SKU rules |
| `references.ts` | `NIASN-N-` |
| `rateLimit.ts` | auth_attempts counters |
| `alerts.ts` | Ops Telegram |
| `media/watermark.ts` | Sharp pipeline |
| `payments/*` | See `PAYMENTS_EAZYPAY.md` |

## Key behaviors

- **Active catalogue:** `.eq("is_active", true)` on public reads.  
- **Qty:** clamp to `min(sellable, max_quantity_per_order)`.  
- **Totals:** server quote only.  
- **Reservation:** at checkout with TTL; **hold until ship** only after CAPTURED.  
- **Cron:** Verify open payments + misroute probe.  
- **Admin advance/ship:** permission-gated route handlers.

## Idempotency / errors

Payment events unique; conditional status updates; customer APIs return safe messages without leaking internals.
