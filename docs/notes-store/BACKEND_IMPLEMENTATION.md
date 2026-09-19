# Notes Store — backend implementation

## Domain modules (`lib/store`)

| File | Responsibility |
|------|----------------|
| `db.ts` | Supabase accessor (no dataProvider) |
| `flags.ts` | Kill switch + preview override |
| `http.ts` | no-store JSON + requireLiveStore |
| `catalogue.ts` | Active-only product/category reads |
| `cart.ts` | Cookie cart id; qty clamp |
| `quote.ts` | `buildFrozenQuote` (authoritative compute, no persist) → `lockQuote` (persist) + TTL; preview reuses `buildFrozenQuote`; ready_stock enforces stock, on_demand skips the check, coming_soon/unavailable rejected |
| `availability.ts` | Pure availability model: `resolveAvailability` (state/label/purchasable), `maxPurchasableQty`, `PREPARATION_STATUSES` |
| `preparation.ts` | `aggregatePreparation` (pure, explodes bundles → component demand, nets ready stock) + `computePreparationDemand` (DB) |
| `media/upload.ts` | Admin R2 uploads: watermarked sample pages (private original) + product photos (public); delete/reorder/cover/list |
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

## Availability model (spec §5)

Each product has an `availability_mode`, orthogonal to `is_active`:
- **ready_stock** — sells down real `on_hand`; oversell-protected via the reservation RPC; low-stock at `low_stock_threshold`.
- **on_demand** — always purchasable when live, **no stock counter and no reservation**; paid orders accrue as preparation demand.
- **coming_soon / unavailable** — visible (if `is_active`) but not purchasable; checkout/quote reject them.

`resolveAvailability()` is the single source of truth used by catalogue cards, PDP, cart clamping (`maxPurchasableQty`) and the quote path. `checkout.ts` reserves stock only for `ready_stock` lines.

## Preparation-demand engine (spec §21)

`computePreparationDemand()` sums qty from `store_order_items` across orders in `PREPARATION_STATUSES` (paid, not-yet-dispatched — excludes cart/pending/failed/cancelled/shipped), explodes bundle lines into component demand, and nets ready stock to `additional_required`. Surfaced at `/admin/notes/preparation`.

## Key behaviors

- **Active catalogue:** `.eq("is_active", true)` on public reads.  
- **Qty:** clamp via `maxPurchasableQty(mode, sellable, max)` — stock ceiling for ready_stock, per-order max only for on_demand.  
- **Totals:** server quote only.  
- **Reservation:** at checkout with TTL; **hold until ship** only after CAPTURED.  
- **Cron:** Verify open payments + misroute probe.  
- **Admin advance/ship:** permission-gated route handlers.

## Idempotency / errors

Payment events unique; conditional status updates; customer APIs return safe messages without leaking internals.
