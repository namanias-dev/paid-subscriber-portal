# Academy Pickup + Delivery Discovery

Discovery only. No runtime code, migration, deploy, or production write was made for this report. Production facts below come from read-only `SELECT`s run through the Supabase CLI inside `begin transaction read only … rollback` (same wrapper as `scripts/release/verify-data.ts`). No customer PII was read: queries returned counts, zone rows, flags and seller settings only.

Date: 2026-10-04 · Author: Claude (discovery run)

---

## 1. Executive Verdict

**YES WITH CONDITIONS.**

Academy Pickup can be added as a thin order-level layer around the existing delivery checkout. Cart, offers, pricing, ICICI Eazypay, Verify, invoice numbering, Telegram, and the delivery pipeline all stay as they are. The order row is already created before payment (`lib/store/checkout.ts:156-187`), so the fulfilment method can be frozen there, and the callback never has to guess it.

The conditions:

1. **Use new statuses, not `PACKED` or `READY_FOR_PICKUP`, for pickup orders.** `READY_FOR_PICKUP` already means "packed, waiting for the courier" (written by `lib/store/shipping/book.ts:233,340`). About ten admin, issue and analytics rules treat `PACKED`/`READY_FOR_PICKUP` without an AWB as a problem. Pickup orders must leave the courier ladder entirely: `PRINTING → READY_FOR_COLLECTION → COLLECTED`.
2. **Enforce a server-side delivery-only guard** on every courier route (rates, dispatch, pack, label, courier pickup, ship, carrier, provider lookup, track, reconcile, address change). Add a DB trigger as a backstop. Hiding buttons is not enough.
3. **Pickup orders must never get a `store_shipments` row.** The current `pack` route inserts one just to save dimensions (`app/api/admin/notes/orders/[id]/pack/route.ts:62`).
4. **A CA/accountant must confirm the invoice "place of supply" for pickup.** Today it comes from the shipping-address state (`lib/store/invoice/issue.ts:231,301`).
5. **The owner must confirm the pickup address, PIN and map link.** The invoice seller PIN on file is `160030`, while the public address is SCO 173–174, Sector 17C. That mismatch has to be resolved before the address is promised to customers.

Ship v1 behind a new flag, `notes_store_academy_pickup`. Turning it off only stops *new* pickup checkouts. Existing pickup orders keep rendering, and staff can keep working them.

### Required direct answers

| # | Question | Answer |
|---|---|---|
| 1 | Where should Delivery vs Pickup be selected? | **Hybrid with one authority.** Show a compact two-card chooser in the Cart (it writes a draft to the server cart row). Checkout repeats it as **Step 1** (pre-selected, changeable), and checkout is authoritative. Delivery is pre-selected by default. |
| 2 | Buy Now: selector immediately or at Checkout? | **At Checkout, as Step 1.** No modal. Buy Now already adds to the server cart and pushes `/notes/checkout` (`components/notes/AddToCartButton.tsx:45-47`). |
| 3 | Pickup visible to everyone or only local PINs? | **Everyone.** The pickup card says "Pick up in Chandigarh" and requires an explicit "Yes, I'll collect from Chandigarh" confirmation. No PIN gating, no geo-detection. |
| 4 | Does a pickup customer need a full home address? | **No.** Ask for name, mobile, optional email (unchanged) and **PIN code**, with city and state auto-filled and editable. No street address. |
| 5 | Reuse delivery address fields for pickup? | **No.** Reuse the *contact* fields and the PIN lookup only. The street, landmark, delivery-instructions and confirm-address blocks are delivery-only. |
| 6 | What goes in `shipping_address_*` for pickup? | **Nothing.** `store_orders.shipping_address_id = NULL`. The customer's PIN/city/state go to a `store_addresses` row with `kind='billing'` via `billing_address_id`. The academy address goes to an immutable `pickup_location_snapshot` on the order, **never** into a customer address field. |
| 7 | Which field distinguishes the methods? | `store_orders.fulfillment_method text not null default 'DELIVERY' check (fulfillment_method in ('DELIVERY','ACADEMY_PICKUP'))`. |
| 8 | Should pickup orders ever create `store_shipments` rows? | **Never.** Enforce in the code guard and with a DB trigger. |
| 9 | Package weight/dimensions required for pickup? | **No.** Hide the Package panel and refuse the `pack` route for pickup orders. |
| 10 | What happens when staff mark it packed? | Pickup orders do not show "Mark packed". After Printing, the only button is **"Mark ready for collection"** (packing is part of that step). It sets `READY_FOR_COLLECTION` and records time and staff. No Compare Couriers anywhere. |
| 11 | Customer-facing pickup lifecycle | Order confirmed → Preparing your notes → Printing your notes → **Ready for collection** → **Collected**. |
| 12 | Admin lifecycle | New → Preparing (auto after 5 min, reused) → Printing → **Ready for collection** → **Collected**. |
| 13 | Final status DELIVERED or COLLECTED? | **COLLECTED**, a new terminal status. Completion KPIs treat "fulfilled" as `DELIVERED ∪ COLLECTED`; delivery metrics use `DELIVERED` only. |
| 14 | Invoice with zero shipping? | Works mathematically today: `goods + 0 = total`, and the gate is `|rounding| ≤ ₹1` (`issue.ts:46-49`). The PDF must replace "SHIP TO" with a collection block and print "Academy pickup ₹0.00" (or omit the shipping row; owner/CA choice). Place of supply needs CA confirmation. |
| 15 | Discounts? | Unchanged. Offers apply to product lines only (`lib/store/pricing.ts:118-136`) and never touch shipping, so pickup gets exactly the same discount. |
| 16 | ICICI merchant amount? | Unchanged. The payment row amount is `quote.total_paise` (`checkout.ts:245`), and Verify compares ICICI's `BA` merchant amount to it in integer paise (`payments/verify.ts:111-140`). For pickup, `total = subtotal − discount + tax + 0`. |
| 17 | Historical orders? | The column default `'DELIVERY'` makes all 41 paid orders DELIVERY with no table rewrite (Postgres 11+ constant default). No backfill job. |
| 18 | Analytics exclusion from shipping-rate denominators? | `rateShipmentFor` already excludes orders with no shipment or a non-courier status (`lib/store/orderOps.ts:248-257`). Change the coverage *context* denominator from all paid orders to **delivery** paid orders. |
| 19 | How do we stop courier APIs ever firing for pickup? | (a) `assertDeliveryOrder()` in all 11 courier/address routes; (b) a DB trigger refusing `store_shipments`, `store_courier_quote_sessions` and `store_courier_booking_attempts` inserts for pickup orders; (c) the tracking cron only reads `store_shipments`, so with no rows it never sees pickup; (d) a status constraint stopping pickup orders from entering any courier status. |
| 20 | Safest additive migration? | See §17. New nullable or defaulted columns; a widened status check (adds 2 values, removes none); `NOT VALID` → `VALIDATE` consistency checks; three guard triggers; one partial index. |
| 21 | Code that can stay completely unchanged | Offers/pricing math, Eazypay URL building, the callback shim, Verify/amount guard, invoice numbering/claim, `store_zones`/serviceability, PIN lookup, courier compare/book/quote-history internals, tracking cron, refunds, access tokens, phone track, search, auto-prepare. See §4. |

---

## 2. Current Production Architecture

| | |
|---|---|
| Production SHA | **`be8bb64`** ("Record every courier comparison and booking attempt as an immutable audit trail"), from `https://www.namanias.com/api/version` |
| Vercel deployment | `dpl_4p8rcidBvznUhhyTULnA3EKYnc1J` (`naman-ckqt3kc3l-naman-ias-academy.vercel.app`), target production, Ready, created 2026-10-04 |
| Production branch | `cursor/notes-courier-quote-history` (local HEAD `35d7a98` = live + docs only) |
| vs `origin/master` | live has 24 commits master lacks; master has 15 live lacks |
| Master-only work (not live) | Notes discount codes (`2026-09-27-notes-discount-codes.sql`), cookieless-view analytics fix, mobile address-confirm-above-cookie-sheet fix, counsellor no-auto-open, staff order-access refinements |
| Store state (read-only) | `notes_store` **enabled, scope all**. The store is live. `CURRENT_STATE.md`'s 2026-09-19 "disabled" header is stale. |
| Other flags | `notes_store_auto_fulfillment` enabled but `meta.auto` is null, and `runAutoFulfillment` has **no caller** in live code. `notes_store_coupons` is enabled but live code has no coupon path. `notes_store_sms`, `_shiprocket`, `_bundles`, `_free_shipping` are off. |
| Paid orders | 41: IN_TRANSIT 14 · DELIVERED 11 · PICKUP_SCHEDULED 8 · PROCESSING 5 · PACKED 3. All have a shipping address, all have billing = shipping, customer shipping ₹59–₹99, **no ₹0-shipping paid order has ever existed**. |
| Demand geography | Only **2 of 41** paid orders went to Tricity-pattern PINs (160/134/140). Top states: Delhi 6, Andhra Pradesh 6, Odisha 4, Karnataka 4. |
| Products | 2 active and 1 inactive non-archived products, all `on_demand` (no stock reservation in practice) |
| Invoices | 41 `BILL_OF_SUPPLY`, all READY, all with place of supply |

### Routes

| Area | Path |
|---|---|
| Storefront | `app/(site)/notes/page.tsx`, `[subject]`, `products/[slug]` |
| Cart | `app/(site)/notes/cart/page.tsx` → `components/notes/CartClient.tsx` |
| Checkout | `app/(site)/notes/checkout/page.tsx` → `components/notes/CheckoutForm.tsx` |
| Confirmation | `app/(site)/notes/order/[orderNumber]/page.tsx` → `components/notes/OrderStatus.tsx` |
| Track | `app/(site)/notes/track/page.tsx` → `TrackForm`/`TrackView` |
| Customer APIs | `app/api/notes/{cart,pin,checkout,checkout-lead,order/[orderNumber]/{verify,invoice,issues,support},track}` |
| Admin | `app/admin/notes/**` (Orders, detail, overview, analytics, leads, preparation, pick-list) |
| Admin APIs | `app/api/admin/notes/orders/[id]/{advance,pack,rates,dispatch,label,pickup,ship,carrier,provider-lookup,track,reconcile,refund,invoice,issues,note,courier-history,activity,support-decision}`, `orders/address` |
| Crons | `/api/cron/notes-store-verify` (Verify + auto-prepare + invoice repair + reservation expiry), `/notes-store-prepare` (auto-prepare), `/notes-store-tracking` (courier polling) |
| Payment return | `app/api/v1/bank/payment/route.ts` (shared; store branch is additive) |

### Tables (store domain)

`store_carts`, `store_cart_items`, `store_customers`, `store_addresses`, `store_orders`, `store_order_items`, `store_order_events`, `store_order_payments`, `store_payment_events`, `store_shipments`, `store_shipment_events`, `store_zones`, `store_pincode_cache`, `store_offers` + holds, `store_inventory_reservations`, `store_stock_ledger`, `store_invoices`, `store_invoice_settings`, `store_invoice_counters`, `store_checkout_leads`, `store_order_issues` + events, `store_courier_quote_sessions`, `store_courier_quote_options`, `store_courier_booking_attempts`, plus `app_feature_flags` rows `notes_store*`.

### Key services

`lib/store/cart.ts`, `quote.ts` (`buildFrozenQuote`, `lockQuote`), `pricing.ts` (`calculateStorePrice`), `serviceability.ts` (`checkPincode`), `checkout.ts` (`placeCheckout`), `deliveryAddress.ts`, `address.ts`, `payments/{eazypay,verify,eazypayAmounts,callback}.ts`, `invoice/{issue,tax,pdf}.ts`, `stages.ts` (`PROGRESS`, `STAFF_NEXT`), `opsBoard.ts`, `orderOps.ts`, `adminConsole.ts`, `shipping/**`, `trackingView.ts`, `projection.ts`, `orders.ts` (`getPublicOrder`), `checkoutLeads.ts`, `autoPrepare.ts`, `notifications.ts`, `lib/telegram/notesOrderAlert*.ts`, `lib/analytics/notesIntel*.ts`, `flags.ts`.

---

## 3. Current Delivery Checkout Flow

1. **PDP / product card.** `AddToCartButton` POSTs `/api/notes/cart` (server cart; the httpOnly cookie `nias_notes_cart` holds only the cart id, 30 days). **Buy now** is the same POST followed by `router.push("/notes/checkout")`. It does not bypass the cart.
2. **Cart** (`CartClient`). Loads `GET /api/notes/cart`. Lines are priced by `calculateCartPricing` with the active offer. The total shown is `subtotal − discount` and says "Shipping is calculated from your PIN at checkout." Cart state is server state in `store_carts`/`store_cart_items` and survives refresh and devices that share the cookie.
3. **Checkout mount** (`CheckoutForm`).
   - `GET /api/notes/checkout-lead` prefills name, phone and email from a draft.
   - `GET /api/notes/cart` loads the summary.
   - Analytics `notes_checkout_started` fires.
4. **Lead capture.** Once the phone is a valid Indian mobile and touched, a debounced (800 ms) `POST /api/notes/checkout-lead` sends name, phone, email, consent, an optional *complete* address (`line1`+city+state+PIN required, `checkoutLeadLogic.ts:73-81`) and `address_confirmed`. The lead is unique per open `phone_key`.
5. **PIN.** On PIN blur, `GET /api/notes/pin?pin=` runs `checkPincode`:
   - zone matched by longest `store_zones.pincode_prefix`;
   - city/state from `store_pincode_cache` or India Post;
   - promised date = dispatch_days + zone transit max + 2-day buffer;
   - server preview quote via `buildFrozenQuote`, which returns subtotal, discount, shipping, tax and total.
6. **Address confirm.** The client builds `canonicalDelivery(form)`. It shows a "Confirm delivery address" card with a Google Maps link and **"Yes, deliver here"**, which stores `addressFingerprint`. Pay is disabled until the fingerprint matches.
7. **Pay.** `POST /api/notes/checkout` with the form and `address_hash` runs `placeCheckout`:
   - validates phone, name and `line1`;
   - `lockQuote` re-runs serviceability and `buildFrozenQuote`, then stores `quote_json` on the cart with a 15-minute TTL;
   - checks the PIN/place conflict; the `address_hash` must equal the server fingerprint;
   - upserts `store_customers` by `phone_key`;
   - inserts a `store_addresses` row (`kind='shipping'`, confirmed);
   - `next_store_order_no()` → `NIAS-N-…`;
   - **inserts `store_orders` with `status='PAYMENT_PENDING'`**, `shipping_address_id = billing_address_id = addr.id`, money from the quote, `quote_json`, attribution and token hash;
   - inserts `store_order_items` (tax/HSN/weight snapshots);
   - offer hold (TTL) and ready-stock reservation (TTL);
   - inserts `store_order_payments` (`reference_no NIASN-N-…`, `amount_paise = quote.total_paise`, INITIATED);
   - builds the Eazypay URL;
   - inserts an event and **converts the cart**;
   - marks the lead PAYMENT_INITIATED and records analytics.
   - It returns `payment_url`. The route sets the order access cookie (raw token never in JSON).
8. **ICICI.** Full-page redirect. Return goes to the shared `app/api/v1/bank/payment` route; the store branch dispatches by `NIASN-N-`. The callback is advisory.
9. **Verify (terminal).** `applyStoreVerify` runs from the order page poll (`order/[orderNumber]/verify`, token-gated), the 15-minute cron, or the callback. It compares ICICI's `BA` merchant amount to `store_order_payments.amount_paise`; a mismatch fails closed and sends an ops alert. On paid it does `applyOrderTerminal`:
   - order → `ORDER_CONFIRMED`, `paid_at`, `amount_paid_paise`;
   - event;
   - `notifyOrderConfirmed` (inert);
   - Telegram paid alert (dual channel, idempotent);
   - reservations held until ship;
   - offer hold consumed;
   - `scheduleStoreInvoice`;
   - lead CONVERTED.
   - On failure or expiry, holds and reservations are released.
10. **Invoice.** `ensureStoreInvoice` reads order, items and **shipping address**; computes the tax document with `placeOfSupplyCode = stateCodeFromName(address.state)`; refuses unless lines + shipping ≈ total within ₹1; claims a number atomically; renders a PDF with "SHIP TO" and a "Shipping" row; stores it in R2.
11. **Fulfilment.**
    - Auto-prepare moves New → `PROCESSING` after 5 minutes.
    - Staff "Start printing" → `PRINTING`, then "Mark packed" → `PACKED` (`STAFF_NEXT`, `stages.ts:26-33`).
    - Staff save the package (`pack` route), Compare Couriers (`rates`; the quote session is persisted) and Book (`dispatch`: create, destination check, AWB, label, courier pickup request). The order becomes `READY_FOR_PICKUP` or `PICKUP_SCHEDULED`.
    - The tracking cron/webhook advances `PICKED_UP → IN_TRANSIT → OUT_FOR_DELIVERY → DELIVERED`.
    - Manual `/ship` sets `IN_TRANSIT` and commits reservations.
12. **Customer tracking.** The confirmation page (cookie or `?t=`) and `/notes/track` (phone + order number mint a fresh token) render `projectCustomerStage` + `buildTrackingTimeline` (9 delivery steps, including "Pickup scheduled" for the courier).

---

## 4. Existing Components We Can Reuse

| Component / service | Current purpose | Delivery | Pickup | Reuse unchanged? | Needs conditional? | New? |
|---|---|---|---|---|---|---|
| Server cart (`lib/store/cart.ts`, `/api/notes/cart`) | Lines, qty, offer pricing | ✓ | ✓ | Mostly | Add `fulfillment_method` draft read/write (PATCH) | — |
| `CartClient` | Cart UI | ✓ | ✓ | No | Chooser block + summary line by method | Chooser component |
| Checkout contact fields (name, mobile, email, consent) | Contact, payment, invoice name, lead | ✓ | ✓ | **Yes** | — | — |
| Address form (line1, line2, city, state, instructions) | Courier destination | ✓ | ✗ | Yes, for delivery | Rendered only for DELIVERY | — |
| PIN lookup (`/api/notes/pin`, `checkPincode`) | Zone, city/state, quote | ✓ | PIN→city/state only | Yes | Pickup uses the city/state part only | — |
| Address confirm ("Yes, deliver here") | Delivery fingerprint | ✓ | ✗ | Yes | Delivery only | Pickup acknowledgement mirrors the pattern |
| `buildFrozenQuote` / `lockQuote` | Authoritative totals | ✓ | Line math only | Delivery yes | Extract shared `buildQuoteLines()`; pickup wrapper adds shipping 0 | `buildPickupQuote`, `lockPickupQuote` |
| Order summary (checkout aside) | Totals | ✓ | ✓ | No | Shipping row: "Academy pickup · Free" | — |
| Offers / `calculateStorePrice` | Discount math | ✓ | ✓ | **Yes** | — | — |
| `placeCheckout` | Order + payment creation | ✓ | Shared tail | Delivery yes | Branch at entry; share customer upsert, order number, items, holds, payment, URL, events | `placePickupCheckout` (or a strategy object) |
| Eazypay (`payments/eazypay.ts`), callback shim, Verify, amount guard | Money | ✓ | ✓ | **Yes** | — | — |
| Invoice issue (`invoice/issue.ts`) | Number + PDF | ✓ | ✓ | No | Place of supply source + buyer/ship block by method | — |
| Invoice PDF (`invoice/pdf.ts`) | Layout | ✓ | ✓ | No | "SHIP TO" → "COLLECTION"; shipping row label | — |
| Lead capture (`checkoutLeads.ts`) | Funnel/CRM | ✓ | ✓ | Mostly | Accept PIN-only location for pickup; store `fulfillment_method` | — |
| Confirmation page (`OrderStatus`, `getPublicOrder`) | Status, invoice, issues | ✓ | ✓ | No | Pickup card, timeline, issue categories, no courier/AWB | Pickup tracking card |
| Track (`/notes/track`, `trackingView.ts`, `projection.ts`) | Customer lifecycle | ✓ | ✓ | No | Method-aware steps | Pickup steps |
| Admin Orders list (`/api/admin/notes/orders`, `CustomerViews`, `OrderOpsCell`) | Ops board | ✓ | ✓ | No | Method badge, filter, pickup ops line | — |
| Admin detail (`OrderDetail`) | Actions | ✓ | ✓ | No | Hide courier/package/address-change; show pickup panel | `PickupPanel` |
| `STAFF_NEXT` / advance route | Pre-ship steps | ✓ | ✓ | No | Method-aware next step | `collect` action |
| Auto-prepare cron | New→Preparing | ✓ | ✓ | **Yes** | — | — |
| Package resolver (`resolveBookingPackage`) | Courier package | ✓ | ✗ | Yes | Never called for pickup | — |
| Courier selector / Compare (`rates`, `CourierPicker`) | Rates | ✓ | ✗ | Yes | Server guard refuses pickup | `assertDeliveryOrder` |
| Courier quote history | Audit | ✓ | ✗ | Yes | DB trigger backstop | — |
| Booking / label / courier pickup / ship / carrier / reconcile / provider lookup | Courier | ✓ | ✗ | Yes | Server guard | — |
| Tracking cron / webhook | Courier status | ✓ | ✗ | **Yes** (reads shipments only) | — | — |
| Refunds (`refund` route) | Manual refunds | ✓ | ✓ | **Yes** | — | — |
| Analytics (`notesIntel*`, `reporting.ts`) | KPIs | ✓ | ✓ | Mostly | Method dimension, geo fallback to billing, coverage denominator | — |
| Telegram paid alert | Staff alert | ✓ | ✓ | No | Fulfilment line; city falls back to billing address | — |
| Phone track, access tokens, search | Customer/admin access | ✓ | ✓ | **Yes** | — | — |

---

## 5. Fulfillment Method Domain Design

### Vocabulary (one meaning per word)

| Concept | Code value | Customer copy | Admin copy |
|---|---|---|---|
| Method: courier | `DELIVERY` | Delivery | DELIVERY |
| Method: customer collects | `ACADEMY_PICKUP` | Pick up from Academy · Academy Pickup | ACADEMY PICKUP |
| Pickup order ready | status `READY_FOR_COLLECTION` | Ready for collection | Ready for collection |
| Pickup order done | status `COLLECTED` | Collected | Collected |
| Courier collects the parcel (existing) | `READY_FOR_PICKUP`, `PICKUP_SCHEDULED`, `PICKED_UP` (unchanged) | "Courier pickup scheduled", "Handed to courier" (label change) | "Courier pickup" |

The word "pickup" in the method name is fine because it is never a status. No customer-collection *status* uses the word "pickup".

### Order level, immutable after payment

- `fulfillment_method` is set once by `placeCheckout` / `placePickupCheckout` at the `store_orders` insert, before the payment URL exists. Verify, callback, cron and admin code **never write it**.
- A DB trigger enforces this: `fulfillment_method` cannot change once `paid_at` is set (see §17).
- For pickup, `pickup_location_code` and `pickup_location_snapshot` (name, address lines, city, state, PIN, map URL, phone, `snapshot_at`) are frozen at the same insert. The snapshot preserves the historical promise if the academy moves.
- The customer acknowledgement is recorded as `pickup_acknowledged_at` on the order (and in the order event payload).

### Pickup status ladder (new `PICKUP_PROGRESS`, separate from `PROGRESS`)

| Rung | Statuses | Admin | Customer |
|---|---|---|---|
| confirmed | `ORDER_CONFIRMED`, `PAYMENT_CONFIRMED` | New | Order confirmed |
| preparing | `PROCESSING` | Preparing | Preparing your notes |
| printing | `PRINTING`, `QUALITY_CHECK`, `READY_TO_PACK` | Printing | Printing your notes |
| ready | `READY_FOR_COLLECTION` | Ready for collection | Ready for collection |
| collected | `COLLECTED` | Collected | Collected |

`STAFF_NEXT` becomes method-aware.

- **Pickup:**
  - `ORDER_CONFIRMED/PAYMENT_CONFIRMED → PROCESSING`
  - `PROCESSING → PRINTING`
  - `PRINTING/QUALITY_CHECK/READY_TO_PACK → READY_FOR_COLLECTION`
  - `READY_FOR_COLLECTION → COLLECTED` (only via the dedicated confirmed action)
- **Delivery:** exactly the current map.

### Why no separate "Packed" rung for pickup

`PACKED` is coupled to courier rules in `adminConsole.ts:137,168`, `dispatch.ts:105,143`, `orderOps.ts:185,204,230`, `reporting.ts:210,295`, `OrderDetail.tsx:512`, `dispatch/route.ts:30`, `autoFulfillRun.ts:44` and analytics `PACKED` sets. A pickup order is packed and ready in the same physical moment, so one staff action is honest and avoids touching every rule.

### Mixed and partial carts

The method is order-level and covers the whole cart. No line-level method. No split orders in v1. There is no evidence of need: two subjects collected at one place, or two subjects delivered in one parcel, both work.

### Product eligibility

Store-wide for v1, via the flag. All current products are physical, `on_demand`. Defer a product-level `fulfillment_methods` column until a digital or non-pickup product exists.

---

## 6. Customer UX Recommendation

### Selection point

Cart shows the chooser (draft, server-persisted on `store_carts.fulfillment_method`). Checkout Step 1 repeats it, pre-selected and authoritative. Buy Now lands on Checkout Step 1, so there is no modal.

The default is **Delivery pre-selected**. 39 of 41 orders are non-local, so a forced extra tap would add friction for about 95% of buyers. The Pickup card is fully visible directly beside it.

### Pickup acknowledgement pattern

Use a **button inside the selected pickup card**: "Yes, I'll collect from Chandigarh". This mirrors the existing delivery "Yes, deliver here" button (`CheckoutForm.tsx:264-266`), so the two methods feel symmetric and staff and customers learn one pattern. Pay stays disabled until it is pressed. A bare checkbox is weaker (easy to tick blindly, and smaller on mobile). Selecting the card alone is not explicit enough.

### Location surfacing

A text card with name, address lines, a "View on Google Maps ↗" link (`target=_blank`, opens the native Maps app) and the phone number. **No embedded map.** An iframe costs about 500 KB+ plus third-party cookies on a payment page, and the link is enough.

### Wireframes (mobile 375–430 first)

**A. Cart — Delivery selected**

```
NOTES STORE
Cart                                         (Sora 28/700 navy)
Physical notes, printed in Chandigarh.

┌──────────────────────────────────────────┐ rounded-3xl white ns-elev-1
│ [cover] POLITY                            │
│         Indian Polity Notes      ₹2,999  │
│         − 1 +                   Remove    │
└──────────────────────────────────────────┘

HOW WOULD YOU LIKE YOUR NOTES?               (eyebrow, gold-dark, 11px tracking)
┌───────────────────┐ ┌───────────────────┐  2-col grid ≥375; each ≥ 112px tall
│ (●) 🚚 Delivery   │ │ ( ) 🏛 Pick up    │  radio cards
│ To your address   │ │ from Academy      │
│ Shipping from PIN │ │ Chandigarh · Free │
└───────────────────┘ └───────────────────┘
 selected: navy 1.5px border + ivory #f7f5ef fill + ✓ "Selected" (not colour-only)

┌ sticky summary ───────────────────────────┐ ns-elev-4
│ Subtotal                          ₹2,999 │
│ Launch Offer (20% OFF)             −₹600 │
│ Shipping            calculated at checkout│
│ Total so far                      ₹2,399 │
│ [      Continue to checkout      ]  gold  │ ns-buy-now min-h-14
└───────────────────────────────────────────┘
```

**B. Cart — Pickup selected**

```
… same items …
┌───────────────────┐ ┌───────────────────┐
│ ( ) 🚚 Delivery   │ │ (●) 🏛 Pick up    │
│ To your address   │ │ from Academy  ✓   │
└───────────────────┘ └───────────────────┘
 Pick up at Naman Sharma IAS Academy, Sector 17C, Chandigarh.
 You'll confirm at checkout.                  (13px navy/65)

┌ sticky summary ───────────────────────────┐
│ Subtotal                          ₹2,999 │
│ Launch Offer                       −₹600 │
│ Academy pickup                      Free  │  (crossfade 150ms)
│ Total                             ₹2,399 │
│ [      Continue to checkout      ]        │
└───────────────────────────────────────────┘
```

The cart total for pickup is final, apart from server re-validation at checkout.

**C. Checkout — Delivery**

```
CHECKOUT                                       eyebrow: Cart → Details → Secure payment
1 · HOW YOU'LL GET IT    [Delivery ●] [Pick up from Academy ○]   (compact segmented cards)
2 · YOUR DETAILS         Full name · Mobile · Email (optional) · ☐ updates consent
3 · DELIVERY ADDRESS     Address line 1 · Apartment/landmark · PIN · City · State
                         Delivery instructions (optional)
                         ┌ Confirm delivery address ───────────┐  (existing block, unchanged)
                         │ … Open in Google Maps · Edit         │
                         │ [ Yes, deliver here ]                │
                         └──────────────────────────────────────┘
4 · PAY SECURELY         Order summary (Subtotal, Offer, Shipping ₹59, Total)
                         [ Pay ₹2,458 securely ]   ICICI copy unchanged
```

**D. Checkout — Pickup**

```
1 · HOW YOU'LL GET IT    [Delivery ○] [Pick up from Academy ●]
   ┌ PICKUP LOCATION ─────────────────────────────┐ ivory card, gold eyebrow
   │ Naman Sharma IAS Academy                      │ Sora 17/600
   │ SCO 173–174, Sector 17C, Chandigarh <PIN>      │
   │ View on Google Maps ↗      Call 84376 86541    │ min-h-11 pill links
   │ Ready after your notes are printed and packed. │
   │ We'll let you know when it's ready to collect. │
   │ [ Yes, I'll collect from Chandigarh ]          │ navy button → "Collecting here ✓"
   └────────────────────────────────────────────────┘
2 · YOUR DETAILS         Full name · Mobile · Email (optional) · ☐ consent
                         PIN code (for your bill)  → City · State auto-filled, editable
                         helper: "For your invoice. We don't deliver to this address."
3 · PAY SECURELY         Subtotal · Offer · Academy pickup Free · Total ₹2,399
                         [ Pay ₹2,399 securely ]
```

There is no street address, no delivery instructions, no courier quote and no delivery date for pickup.

**E. Pickup payment confirmation**

```
✓ ORDER CONFIRMED                     NIAS-N-2026-0010xx
Pickup from Naman Sharma IAS Academy
We're preparing your notes. We'll let you know when they're ready to collect.

[ Order confirmed ●──○ Preparing ──○ Printing ──○ Ready for collection ──○ Collected ]

PICKUP LOCATION  (same card as checkout, without the confirm button)
Invoice: Bill of Supply NIA/… [View]      Copy order number
Need help? (issue sheet with pickup categories)
```

**F. Track Order — Pickup preparing**

```
PRINTING YOUR NOTES
Your notes are being printed. We'll tell you when they're ready to collect.
timeline: ✓ Confirmed ✓ Preparing ● Printing ○ Ready for collection ○ Collected
Pickup location card (collapsed, "View on Google Maps ↗")
```

**G. Track Order — Ready for collection**

```
READY FOR COLLECTION                              (gold-dark eyebrow, Sora 24)
Your notes are ready at the academy.
Naman Sharma IAS Academy
SCO 173–174, Sector 17C, Chandigarh
[ View on Google Maps ↗ ]   [ Call the academy ]
Please mention your order number NIAS-N-… when you collect.
timeline: ✓ ✓ ✓ ● Ready for collection ○ Collected
```

The last line is the safe minimum. Do not promise ID or OTP checks until the owner approves.

**H. Admin Orders row — Pickup (mobile card and desktop row share `customerView`)**

```
Priya S. · 98xxxxx321 (full in admin) · Chandigarh, Chandigarh
NIAS-N-2026-001044 · Polity ×1 · ₹2,399 · Paid
[ACADEMY PICKUP]  Ready for collection · since 4 Oct, 2:15 pm
Next: hand over and mark collected
```

There is no courier line, no rate, no "Courier not selected" and no "N options compared".

**I. Admin order detail — Pickup**

```
Header: NIAS-N-…  [ACADEMY PICKUP] [Paid]  stage dots (5)
┌ FULFILMENT ────────────────────────────────────┐
│ Academy Pickup                                  │
│ Naman Sharma IAS Academy, SCO 173–174, Sec 17C   │ (from order snapshot)
│ Customer acknowledged collection: 4 Oct 1:02 pm │
│ Status: Printing                                 │
│ [ Mark ready for collection ]                    │ store_manage_orders
│ — later —                                        │
│ Ready since 4 Oct 2:15 pm by Ravi               │
│ [ Mark collected ] → confirm dialog              │
│ Collected 6 Oct 11:40 am · handed over by Ravi   │
└─────────────────────────────────────────────────┘
Customer: Name · Phone (Copy) · Email · Bill-to location (PIN, city, state)
Items and payment (unchanged; Shipping row reads "Academy pickup ₹0")
Invoice actions (unchanged) · Activity (unchanged) · Internal note (unchanged)
Hidden: Courier panel, Compare couriers, Package, Courier price history,
        Change delivery address, Print label, View tracking
```

### Desktop (≥1024)

- **Cart:** two columns (items 7/12, summary 5/12 `lg:sticky lg:top-24`). The chooser sits above the summary, inside the right column.
- **Checkout:** keep the existing `lg:grid-cols-[1.2fr_0.8fr]`. Make the aside sticky (`lg:sticky lg:top-24`; today it is `h-fit` only). The step 1 chooser is horizontal cards in the left column.

### Mobile issues seen in live code (fix while touching these files)

- On mobile the checkout total and the Pay button come after the whole form. Add a compact sticky pay bar ("Total ₹X · Pay") that appears once Step 2 is valid.
- The counsellor launcher (`fixed right-4 bottom-5rem z-40`) is shown on `/notes/cart` and `/notes/checkout`. It would overlap any new sticky bar. Hide it on `/notes/checkout` the same way enrollment checkout hides it (`lib/enrollmentPath.ts`), or mark the bar `data-admin-bottom-bar`-style for dodge. It never auto-opens on live, so the chooser cannot trigger it.
- The master-only fix "keep mobile address confirmation above the cookie sheet" is not live. The cookie sheet can cover the confirm button. Merge it when this file changes.
- The step eyebrow "Cart → Address → Secure payment" becomes "Cart → Details → Secure payment".

### Design system reuse

- **Colour tokens:** `--ca-navy`, `--ca-gold`, `--ca-gold-dark (#9a7b2f)`, ivory `#f7f5ef` (already used for the confirm card).
- **Card and button classes:** `ns-elev-1/2/4`, `ns-buy-now` (gold CTA), `ns-press`, `rounded-3xl` cards, `rounded-full` buttons, `min-h-11/12/14`.
- **Type:** Sora headings, Inter body.
- **Icons and motion:** icons from `lucide-react` (`Truck`, `Building2`/`Store`, `MapPin`, `Check`), already a dependency. Motion via `framer-motion` 12 (`motion`, `AnimatePresence`, `useReducedMotion`), already shipped by the root layout.
- **No new libraries.**

### Motion

- **Card select:** border and background transition, 150 ms ease-out.
- **Method-specific section:** crossfade with a 6 px y-offset, 180 ms.
- **Summary shipping line:** crossfade.
- **Reduced motion:** instant swap via `useReducedMotion`.
- No bounce, no confetti.

### Accessibility

- Implement the chooser as a native `<fieldset>`/`<legend>` with two `<input type="radio" name="fulfillment">` inside full-card `<label>`s (visually-hidden input, visible focus ring `ca-focus`). Arrow-key navigation comes for free, and each radio has `aria-describedby` pointing at its subtitle.
- The selected state shows a ✓ icon plus the "Selected" text, not colour alone.
- Cards are at least 112 px tall with a full-card tap target.
- The confirm button has a clear text state change, announced through `aria-live="polite"`.

---

## 7. Customer Information Requirements

| Field | Why it exists today | Delivery | Pickup |
|---|---|---|---|
| Full name | Courier label, invoice buyer, store customer, lead | Required | **Required** (invoice + handover) |
| Mobile | Courier contact, Eazypay `mobile`, `phone_key` customer, tracking by phone, lead | Required | **Required** |
| Email | Eazypay field (falls back to `phone@namanias.invalid`, `checkout.ts:255`), receipt | Optional | Optional |
| Marketing consent | Lead CRM | Optional | Optional |
| Address line 1 | Courier destination; `store_addresses.line1 NOT NULL` | Required | **Not collected** |
| Apartment/landmark | Courier | Optional | Not collected |
| PIN | Zone, shipping, serviceability, geography, invoice place of supply | Required | **Required** (geography, invoice billing state, lead parity) |
| City / State | Courier, invoice place of supply, analytics, Telegram city | Required | **Required** (auto-filled from PIN, editable) |
| Delivery instructions | Courier | Optional | Not collected |
| Address confirmation | Delivery accuracy | Required | Replaced by the pickup acknowledgement |

### Classification

- **Payment:** Eazypay needs name, mobile and amount (email is optional).
- **Invoice/accounting:** customer name, plus a state for place of supply (the CA decides which state applies to pickup).
- **Contact:** mobile.
- **Lead:** phone (plus name, consent).
- **Delivery-only:** line1, line2, instructions, address confirmation, zone.

### Options

- **A. Full residential address.** Not required by payment, invoice math, CRM or fraud controls. Nothing in the code uses it for pickup. Unnecessary friction.
- **B. PIN + city + state.** **Recommended (safest minimal change).** It keeps geography analytics, Telegram city, lead location parity and a billing state for the invoice, and costs one numeric field.
- **C. Billing/contact address.** Same as B plus a street. No current consumer.
- **D. Contact only.** The smoothest UX, but it loses demand geography for pickup orders and leaves the invoice without a buyer state. Not recommended unless the CA confirms place of supply is always the pickup location *and* the owner accepts losing geography.

**Safest = B. Best UX = D. The difference is small (one field), so take B.**

---

## 8. Pickup Location

### What exists today (not centralized for the store)

| Source | Value | Notes |
|---|---|---|
| Admin → Settings brand (`getSiteSettings().brand`, academy domain) | address "SCO 173–174, Sector 17C, Chandigarh"; `maps_url` = `https://maps.app.goo.gl/BSA5hDQhBMKxKTbg6?g_st=ic`; `support_phone` | Live on `/` and `/contact`. `lib/maps.ts` `directionsUrl()` prefers `maps_url`. The `?g_st=ic` suffix is an iOS share artefact. |
| `lib/config.ts` `ACADEMY.address` | "Sector 17C, Chandigarh" | Short form |
| `lib/homeDefaults.ts:86` | "SCO 173–174, Sector 17C, Chandigarh" | Defaults |
| Notes branding footer (print preset) / `/contact` | "SCO 173-174, SEC-17C, CHANDIGARH • Ph: +91 843-768-6541"; `tel:8437686541` | Phone |
| `store_invoice_settings` (store domain) | NAMAN SHARMA IAS ACADEMY, sector 17C, CHANDIGARH, state code 04, **PIN 160030** | Registered seller address. **The PIN does not obviously match Sector 17C.** The owner must confirm. |
| Coordinates | none configured | — |
| Opening hours | **none anywhere** (no `openingHours` in JSON-LD, no hours copy) | **Do not invent hours.** |

### Constraint

`scripts/ci/guard-store-domain-isolation.mjs` forbids `lib/store/**` from importing `dataProvider`, so store code cannot read `getSiteSettings()`.

### Recommendation

- **One store-domain constant, flag-gated:** `lib/store/pickupLocation.ts` exporting `ACADEMY_PICKUP_LOCATIONS = { CHD_17C: { code, name, addressLines, city, state, pincode, mapsUrl, phone } }` and `DEFAULT_PICKUP_LOCATION = "CHD_17C"`.
- Values are owner-confirmed. The maps URL is copied from the live brand setting without `?g_st=ic`.
- This gives one copy for the whole store (cart, checkout, confirmation, track, admin, invoice, Telegram), and it is testable.
- Changing it is a deploy, which is right for a legal pickup promise. Every order freezes a snapshot anyway.
- No `pickup_locations` table in v1. The code shape (`code` → record) lets a second location become a second key later. A table only earns its place with multiple branches.

---

## 9. Pricing & Payment

### Live formula (verified)

`buildFrozenQuote` (`quote.ts:131-147`):

```
subtotal  = Σ unit_price × qty                (store_products.selling_price_paise, GST-inclusive)
discount  = Σ calculateStorePrice(...).discount_paise   (active offer, product lines only)
tax       = Σ lineTaxPaise(line_final, tax_treatment, rate)   (exempt books → 0)
shipping  = store_zones[longest prefix of PIN].shipping_paise   (₹49 local / ₹59–₹129; customer charge, not courier cost)
total     = subtotal − discount + tax + shipping
```

`store_orders.total_paise = store_order_payments.amount_paise = quote.total_paise`.

The **gateway fee** is not in the order total: ICICI's cardholder total can exceed `BA`, and Verify records the difference as a fee (`verify.ts:177-183`) but compares only the merchant amount.

### Pickup formula

The same line math, with `shipping = 0`:

```
total = subtotal − discount + tax + 0
```

### Implementation

1. Extract the line loop of `buildFrozenQuote` into `buildQuoteLines(cart)`, a pure move of code.
2. Delivery `buildFrozenQuote(cart, pin)` = lines + zone shipping (byte-for-byte the same totals).
3. `buildPickupQuote(cart, location, billingPin)` = lines + `shipping_paise: 0`, `fulfillment_method: 'ACADEMY_PICKUP'`, `zone: 'academy_pickup'`, `pincode: <customer PIN>`, `promised_delivery_date: null`.
4. `lockPickupQuote` writes `quote_json` to the cart exactly like `lockQuote`.

Do **not** synthesise a fake "academy PIN" zone. That would leak the academy PIN into customer geography and invoice place of supply.

### Zero-shipping assumptions found

- `total_paise >= 0`, `shipping_paise not null default 0`: OK.
- `getPublicOrder` maps `shipping_label` to `null` when shipping is 0 (`orders.ts:131`), so the confirmation page silently drops the row. Pickup must render "Academy pickup · Free".
- The invoice PDF always prints a "Shipping" row (`pdf.ts:202`): label change for pickup.
- Analytics merchandise = `total − shipping`, which is correct at 0.
- **No code requires `shipping > 0`.**

### Discounts

- Offer scope is product kinds/ids/categories only, so behaviour is identical for both methods. Offer holds and consumption are unchanged.
- No shipping discount exists (`notes_store_free_shipping` is off; `free_above_paise` is null on every zone).
- **Safeguard:** if master's discount codes are ever merged, codes must stay product-only (no "free shipping" code type that could apply to a ₹0 line).

### ICICI and Verify

Unchanged. Reference prefix, sub-merchant, amount equality on `BA`, idempotent `applyOrderTerminal` (conditional on the current status), callback advisory and Verify terminal. Nothing in the payment code reads address, shipping or method.

### Payment retry

Live has **no** same-order retry. There is exactly one `store_order_payments` insert, in `placeCheckout` (`checkout.ts:241`). A failed or abandoned payment leaves that order PAYMENT_FAILED/EXPIRED, and the customer starts a new checkout, which makes a new order with a newly chosen method. The method can therefore never mix across attempts.

The cart is converted at checkout, so after a failed payment the customer's next visit starts with an empty cart. That is an existing UX gap (master has related retry work). If a same-order retry is ever added, it must reuse the order's frozen `fulfillment_method` and `total_paise`.

### Price recalculation before payment

- Client: on method switch, re-request a server quote (`GET /api/notes/pin` for delivery, or a new `GET /api/notes/quote?method=pickup`).
- Server: `placeCheckout`/`placePickupCheckout` always recompute via `lock*Quote`. **A client total is never trusted.**

---

## 10. Invoice & Accounting

### Current assumptions (`lib/store/invoice/issue.ts`)

- The address is loaded from `shipping_address_id` (`:187`). Without one, `shipping_snapshot` is `{}`, `place_of_supply_state` is null, and the PDF prints "Address on order" (`:378`).
- `placeOfSupplyCode = stateCodeFromName(address.state)` feeds `computeTaxDocument` (intra/inter-state split; currently all exempt → `BILL_OF_SUPPLY`, 41/41 in production).
- `shippingPaise: order.shipping_paise` feeds the totals check; ₹0 is fine.
- `buyer_snapshot` holds only name, phone presence and placed time.
- The PDF has a "SHIP TO" block and a "Shipping" money row.

### Pickup implications (technical)

- Pass a fulfilment-aware context:
  - `fulfillment_method`;
  - `billTo` = billing address (customer PIN/city/state);
  - `collection` = pickup snapshot.
- `shipping_snapshot` stores `{ fulfillment_method: 'ACADEMY_PICKUP', pickup_location: {...} }`. **No new invoice column is needed** (the column is jsonb).
- The PDF block becomes "COLLECTION AT" (academy) plus "BILL TO" (name, city, state, PIN). The shipping row becomes "Academy pickup ₹0.00", or is hidden; that is a CA/owner wording choice.
- `place_of_supply_state` comes from a single function `placeOfSupplyFor(order)`. Its pickup branch is whatever the CA decides.

### Questions requiring CA/accountant confirmation (not legal advice)

1. For goods **collected by the buyer at the supplier's premises in Chandigarh**, which state is the place of supply on the Bill of Supply: Chandigarh (pickup location) or the buyer's state from their PIN?
2. Is a buyer street address required on a Bill of Supply for an unregistered (B2C) buyer, or are name + state (PIN) sufficient?
3. Should a zero-value "Academy pickup" line appear, or should the shipping line be omitted entirely?
4. The seller PIN on the invoice settings is `160030` while the trading address is Sector 17C. Which is correct for the registered address, and is the pickup address the same premises?
5. If a delivery order is later converted to pickup (not in v1), does that need a credit note for the shipping charge?

---

## 11. Customer Tracking

### Delivery (unchanged except labels)

Steps: confirmed → preparing → printing → packed → pickup → shipped → in_transit → out_for_delivery → delivered.

Rename the customer label of step `pickup` from "Pickup scheduled" to **"Courier pickup scheduled"**, and the `pickupDelayed` headline from "Pickup delayed" to **"Courier pickup delayed"** (`trackingView.ts:35,127,166,174,182`). This is label-only; the keys stay.

### Academy Pickup (new branch, selected by `order.fulfillment_method`)

**Steps:**

- confirmed — "Order confirmed"
- preparing — "Preparing your notes"
- printing — "Printing your notes"
- ready — "Ready for collection"
- collected — "Collected"

**Projection:**

- `projectCustomerStage` gains `READY_FOR_COLLECTION → ready_for_collection` and `COLLECTED → collected`. Today, unknown statuses fall back to "preparing" (`projection.ts:89`), which is a safe default during rollout.
- The courier-pickup copy (`PICKUP_ISSUE`, AWB, the "Track on courier site" link, the "Expected by" promise) is never shown for pickup.

**Issue categories for pickup:** "My notes aren't ready yet", "I can't come to collect", "Something is missing or wrong", "Invoice / payment question", "Update my phone".

**Post-collection block** (today `stage === 'delivered'` shows the review/problem block, `OrderStatus.tsx:463`): extend it to `collected`.

---

## 12. Admin Operations

### Orders list

- **Read model:** add `fulfillment_method`, `pickup_location_snapshot.name`, `ready_for_collection_at` and `collected_at` to the select in `/api/admin/notes/orders` (`route.ts:126,164`).
- **`customerView`/`opsLines`, pickup branch:**
  - badge ACADEMY PICKUP;
  - stage label from `PICKUP_PROGRESS`;
  - detail "Ready since 4 Oct, 2:15 pm" or "Collected 6 Oct";
  - next step "Mark ready for collection" or "Hand over and mark collected";
  - **no** courier, rate, "Courier not selected", "N options compared" or package lines.
- **Location:** for city/state the row uses the billing address when `shipping_address_id` is null.

### Filters (two independent axes)

- **Fulfilment:** `All · Delivery · Academy Pickup` → `?fulfillment=all|delivery|academy_pickup`.
- **Status buckets (existing):**
  - add `ready_for_collection: ['READY_FOR_COLLECTION']` and `collected: ['COLLECTED']`;
  - relabel the existing bucket `pickup` (`['PICKUP_SCHEDULED']`) as **"Courier pickup"**, keeping the key `pickup` so existing links keep working;
  - relabel the NOW_LINKS "Pickup" in analytics and the Overview "Pickup overdue" to "Courier pickup".
- A pickup order in `READY_FOR_COLLECTION` appears under Fulfilment=Academy Pickup and Status=Ready for collection, never under "Courier pickup".

### Detail actions (pickup)

| Stage | Button | Permission | Effect |
|---|---|---|---|
| New | (auto after 5 min) / "Start preparing" | `store_manage_orders` | `PROCESSING` (existing) |
| Preparing | "Start printing" | same | `PRINTING` (existing) |
| Printing | **"Mark ready for collection"** | same | `READY_FOR_COLLECTION`, `ready_for_collection_at`, event with actor; fires `notifyReadyForCollection` (inert until approved) |
| Ready | **"Mark collected"** → dialog "Hand over NIAS-N-… to {name}? Check the order number with the customer." [Cancel] [Yes, collected] | same | `COLLECTED`, `collected_at`, event `collected` with actor id/name; commits any ready-stock reservations (mirror `/ship`) |
| Collected | — | — | Terminal |

There is no undo button in v1. A mistaken "collected" is corrected by Super Admin via an event-logged revert only if it is ever needed (deferred).

### Reuse

The auto-prepare cron is reused unchanged. It selects `ORDER_CONFIRMED/PAYMENT_CONFIRMED` and moves them to `PROCESSING` regardless of method, which is correct. The print/pick-list (`/admin/notes/pick-list`) and preparation queue are reused; add `READY_FOR_COLLECTION` to `PREPARATION_STATUSES` so demand counts stay right.

---

## 13. Courier / Shipping Isolation

### Server guard

New file `lib/store/fulfillment.ts`:

```ts
export async function assertDeliveryOrder(db, orderId): Promise<null | NextResponse /* 409 */>
// select fulfillment_method; if 'ACADEMY_PICKUP' → 409 "Academy Pickup orders never use a courier."
```

Call it first, after the permission check, in:

- `rates`
- `dispatch` (all actions)
- `pack`
- `label`
- `pickup` (courier)
- `ship`
- `carrier`
- `provider-lookup`
- `track`
- `reconcile`
- `orders/address` (change delivery address)

Also call it in `runAutoFulfillment` before locking. It has no caller today, but it is flag-reachable code.

### DB backstop (trigger)

A `BEFORE INSERT` trigger on `store_shipments`, `store_courier_quote_sessions` and `store_courier_booking_attempts` raises if the referenced order's `fulfillment_method = 'ACADEMY_PICKUP'`.

### Natural isolation already present

- **Tracking cron:** selects from `store_shipments` only (`notes-store-tracking/route.ts:43`). With no rows, it never sees pickup orders.
- **Courier webhook:** matched by AWB/shipment, so the same applies.
- **Rates:** returns 400 when `shipping_address_id` is null (`rates/route.ts:68`). Pickup has none, but this is a backstop, not the guard.
- **`rateShipmentFor` and shipping analytics:** need a live shipment.

### Quote-history semantics

- A pickup order **never** has quote sessions, options or attempts.
- An abandoned *delivery* checkout followed by a pickup checkout makes two different orders, so courier history can never attach to the pickup order.
- Quote sessions are only created by staff Compare on paid, packed delivery orders anyway.

---

## 14. Status Naming Collision

### Every current "pickup" meaning (all = courier collects the parcel)

| Where | Text / key |
|---|---|
| `store_orders.status` check | `READY_FOR_PICKUP`, `PICKUP_SCHEDULED`, `PICKED_UP`, `RETURN_PICKUP_SCHEDULED` |
| `shipping/book.ts:233,340` | writes `READY_FOR_PICKUP` after AWB |
| `stages.ts:11-12` | PROGRESS packed includes `READY_FOR_PICKUP`; rung `pickup` "Pickup scheduled" |
| `trackingView.ts:8,35,82,127,164-182` | step `pickup`, "Pickup scheduled", "Pickup delayed", courier queue copy |
| `projection.ts:59-60` | `READY_FOR_PICKUP`/`PICKUP_SCHEDULED` → customer "packed" |
| `adminConsole.ts:76,111,137,168` | `READY_FOR_PICKUP` badge/issue/compare; `resolve_pickup` action |
| `orderOps.ts:119-138,172,204,231` | `pickupWhen`, "Pickup needs attention", `pickup_at` |
| `dispatch.ts:105-106,143`, `dispatch/route.ts:30,87,174` | bookable statuses, `requestProviderPickup` |
| `reporting.ts:210,295` | packed classification; "No courier booking" |
| `customerGroups.ts:20`, `availability.ts:123`, `status.ts:53`, `overview/route.ts:34,62`, `orders/route.ts:35,591,639` | sets and ranks |
| `notesIntel.ts:462`, `notesIntelLoad.ts:20` | analytics packed/shipment sets; "Picked up" metric |
| UI | `OrderQueue` bucket "Pickup"; `NotesAnalytics` NOW "Pickup"; `Overview` "Pickup overdue"; `OrderDetail` "Pickup wasn't completed", "Pickup" field; `CourierPicker` "Pickup requested"; `CourierQuotes` "Pickup PIN"; `OrderStatus` issue `PICKUP_ISSUE` "The courier has not collected it"; `StageArt` pickup art |
| Unrelated "collected" collision | `opsBoard.ts:5` `NOT_COLLECTED` means **payment not collected**. Do not reuse that identifier for customer collection; name the new things `READY_FOR_COLLECTION`/`COLLECTED` with "collection" only in fulfilment code. |

### Final terminology

- **Method:** `ACADEMY_PICKUP` / "Academy Pickup" / "Pick up from Academy".
- **Customer-collection lifecycle:** `READY_FOR_COLLECTION` ("Ready for collection") and `COLLECTED` ("Collected").
- **Courier lifecycle:** keep the codes. Relabel the UI to "Courier pickup scheduled", "Courier pickup delayed", "Courier pickup" (bucket) and "Handed to courier" (`PICKED_UP`, customer-facing "Shipped" can stay).
- **Never** use `READY_FOR_PICKUP` for academy pickup.

---

## 15. Notifications

### Current capabilities

| Channel | State |
|---|---|
| Customer SMS (DLT) | Inert. `notes_store_sms` off; no approved template ids; only `order_confirmed`/`order_shipped` types (`notifications.ts`). DLT bodies must match registered templates (sensitive area). |
| WhatsApp / email to customer | None in the store domain |
| Confirmation page / Track | Live, the primary customer surface |
| Staff Telegram paid alert | Live, dual channel, idempotent: subject, paid amount, customer name, phone, **city (from shipping address only)** (`notesOrderAlert.ts:594-609`, `notesOrderAlertFormat.ts:180-185`) |
| Ops alerts (amount mismatch, misroute) | Live |

### Recommendations

- **Telegram (v1):** add a line `🏛 <b>Fulfilment:</b> Academy Pickup — no courier booking` (delivery orders get `🚚 Delivery`). Read the city from the billing address when `shipping_address_id` is null. Keep it additive in the formatter so idempotency slots are unchanged.
- **Customer hooks (v1, inert):**
  - add `order_ready_for_collection` (and optionally `order_collected`) to `StoreNotificationType`, wired at the two staff actions and double-gated like the existing ones;
  - the paid hook sends `order_confirmed` with a pickup variable once templates exist.
- **Copy drafts for DLT submission (owner action):**
  - "Your Naman IAS Notes order {#var#} is confirmed for Academy Pickup. We'll message you when it's ready."
  - "Your Naman IAS Notes order {#var#} is ready to collect at Naman Sharma IAS Academy, Sector 17C, Chandigarh."
- **Until approved:** staff tell the customer by phone or WhatsApp. The admin "Ready" panel shows a **Copy message** button with the ready text and a `tel:`/`wa.me` link, staff-initiated only.

---

## 16. Analytics

### Order-level dimension

`fulfillment_method` on every order (default DELIVERY for history).

| Metric | Definition |
|---|---|
| Delivery orders / Pickup orders | Captured (paid, not refunded/cancelled) orders by method |
| Pickup share % | pickup ÷ captured, in range |
| Revenue by method | Σ `total_paise` by method (merchandise = total − shipping) |
| Customer shipping revenue | Σ `shipping_paise`, delivery only (pickup is always 0) |
| Booked courier cost | Existing `rateShipmentFor`/`shippingRateStats` (delivery only by construction) |
| Shipping-rate coverage | booked ÷ **delivery** captured orders (change the "paidOrders" context in `ShippingIntel` to delivery-only) |
| Anomalies / distribution / by courier | Unchanged (shipment-based) |
| Conversion by method | Checkout leads and `notes_checkout_*` events carry `fulfillment_method`; paid ÷ checkouts started per method |
| Ready-to-collected time | median `collected_at − ready_for_collection_at` |
| Uncollected | pickup orders in `READY_FOR_COLLECTION` > N days |
| Fulfilment complete | `DELIVERED ∪ COLLECTED` (executive "fulfilled" count); delivery-only metrics keep `DELIVERED` |

- **Geography:** customer location is the shipping address for delivery and the billing address for pickup. Tag pickup rows so the map can toggle "all / delivery only".
- **Executive status:** `notesExecutiveStatus` gains `ready_for_collection` and `collected`.

### "Shipping saved"

Do not call it savings. If shown, use **"Customer shipping charge waived (zone rate)"**: Σ `store_zones` rate for the pickup customer's PIN. That is a valid deterministic baseline for what the *customer* would have paid. There is **no** valid baseline for avoided courier cost (never quoted), so do not report it.

### Analytics events

Add `notes_fulfillment_selected { method, surface: cart|checkout }`, `notes_pickup_acknowledged`, and `fulfillment_method` on `notes_checkout_step_viewed`/`notes_payment_gateway_opened`. These events are PII-free (allow-list in `lib/analytics/events.ts`).

---

## 17. Database Changes

All changes are additive or widening. Apply with the existing hand-applied migration convention: one dated file, `supabase/migrations/2026-10-XX-notes-store-academy-pickup.sql`, idempotent, applied by the owner.

| Table | Column / object | Type | Null / default | Why | Backfill | Index | RLS |
|---|---|---|---|---|---|---|---|
| `store_orders` | `fulfillment_method` | text | not null default `'DELIVERY'`, check in (`'DELIVERY'`,`'ACADEMY_PICKUP'`) | Order-level method | Default covers history without a rewrite | partial `(status, paid_at desc) where fulfillment_method='ACADEMY_PICKUP'` | Inherits (RLS on, service role only) |
| `store_orders` | `pickup_location_code` | text | null | Which location | none | — | inherits |
| `store_orders` | `pickup_location_snapshot` | jsonb | null | Frozen promise (name, lines, city, state, PIN, maps URL, phone, snapshot_at) | none | — | inherits |
| `store_orders` | `pickup_acknowledged_at` | timestamptz | null | Customer confirmed they can collect | none | — | inherits |
| `store_orders` | `ready_for_collection_at` | timestamptz | null | Row "Ready since", analytics | none | — | inherits |
| `store_orders` | `collected_at` | timestamptz | null | Terminal time, analytics | none | — | inherits |
| `store_orders` | status check | — | **widen**: drop + re-add with `'READY_FOR_COLLECTION'`, `'COLLECTED'` added | New statuses | existing values unchanged | — | — |
| `store_orders` | constraint `store_orders_pickup_shape` | check `NOT VALID` → `VALIDATE` | `fulfillment_method <> 'ACADEMY_PICKUP' or (shipping_paise = 0 and shipping_address_id is null and pickup_location_snapshot is not null)` | No fake shipping address, no shipping charge | all rows DELIVERY → valid | — | — |
| `store_orders` | constraint `store_orders_status_by_method` | check `NOT VALID` → `VALIDATE` | `(fulfillment_method = 'ACADEMY_PICKUP') = (status in ('READY_FOR_COLLECTION','COLLECTED'))` **or** status is outside both method-specific sets. The build will write the exact predicate: pickup never in courier statuses; delivery never in collection statuses. | Prevents cross-lifecycle states | valid | — | — |
| `store_orders` | trigger `store_orders_method_immutable` | BEFORE UPDATE | raise if `old.paid_at is not null and new.fulfillment_method is distinct from old.fulfillment_method` | Immutable after payment | — | — | — |
| `store_shipments`, `store_courier_quote_sessions`, `store_courier_booking_attempts` | trigger `*_delivery_only` | BEFORE INSERT | raise if order is ACADEMY_PICKUP | Backstop: no courier records ever | — | — | — |
| `store_addresses` | `line1` | text | **drop not null** + check `(kind = 'billing' or line1 is not null)` | Billing location row (PIN/city/state) without a fake street | none | — | inherits |
| `store_carts` | `fulfillment_method` | text | null, check in (…) | Draft choice across Cart ↔ Checkout, refresh, back from ICICI | none (null → UI default Delivery) | — | inherits |
| `store_checkout_leads` | `fulfillment_method` | text | null, check in (…) | Funnel attribution; abandoned pickup leads stay visible | none | — | inherits |
| `app_feature_flags` | row `notes_store_academy_pickup` | data | enabled=false, scope=off | Rollout switch | insert row | — | existing |

**Not changed:** `store_invoices` (method goes into the existing `shipping_snapshot` jsonb), `store_order_payments`, `store_shipments` columns, `store_zones`.

**Types:** extend the `StoreFlagKey` union in `lib/store/flags.ts`.

---

## 18. API / Service Changes

| File | Change |
|---|---|
| `lib/store/pickupLocation.ts` (new) | Single location constant + `snapshotFor(code)` |
| `lib/store/fulfillment.ts` (new) | Method type, `assertDeliveryOrder`, `staffNextStatus(status, method)`, `PICKUP_PROGRESS`, `isPickup(order)` |
| `lib/store/flags.ts` | Add `notes_store_academy_pickup` to `StoreFlagKey` |
| `lib/store/cart.ts`, `app/api/notes/cart/route.ts` | Read/write `store_carts.fulfillment_method`; PATCH body `{ fulfillment_method }`; serialize the method; when the pickup flag is off the method is coerced to DELIVERY |
| `lib/store/quote.ts` | Extract `buildQuoteLines`; add `buildPickupQuote`, `lockPickupQuote`; add `fulfillment_method` to `FrozenQuote` (optional field; old `quote_json` reads as delivery) |
| `app/api/notes/quote/route.ts` (new, GET) | `?method=pickup&pin=` → pickup preview totals (no lock) |
| `lib/store/checkout.ts` | Split `placeCheckout` into shared helpers. Add `placePickupCheckout(cart, contact, billing, ack)`: flag check, location snapshot, billing address row (`kind='billing'`, no line1), order insert with `fulfillment_method`, `shipping_address_id: null`, `billing_address_id`, `shipping_paise: 0`, snapshot, `pickup_acknowledged_at`, `promised_delivery_date: null`; same items, holds, payment, URL, events, cart conversion, lead marking |
| `app/api/notes/checkout/route.ts` | Body `fulfillment_method`. DELIVERY → existing path untouched; ACADEMY_PICKUP → `placePickupCheckout`; unknown → 400 |
| `lib/store/checkoutLeadLogic.ts`, `checkoutLeads.ts`, `app/api/notes/checkout-lead/route.ts` | Accept `fulfillment_method`; for pickup accept `{pincode, city, state}` as the location (new `completePickupLocation`) so the stage reaches DETAILS_IN_PROGRESS; store the method |
| `lib/store/orders.ts` (`getPublicOrder`) | Expose `fulfillment_method`, pickup snapshot, ready/collected timestamps; `shipping_label` "Free" for pickup |
| `lib/store/projection.ts`, `trackingView.ts` | Pickup stages/steps/narrative; courier label renames |
| `components/notes/OrderStatus.tsx`, `track/*` | Pickup card, timeline, issue categories |
| `lib/store/invoice/issue.ts`, `pdf.ts` | `placeOfSupplyFor(order)`; billing address; collection block; shipping-row label |
| `lib/store/stages.ts`, `opsBoard.ts`, `orderOps.ts`, `orderOpsDisplay.ts`, `customerGroups.ts`, `adminConsole.ts`, `availability.ts` (`PREPARATION_STATUSES`), `shipping/status.ts` (`ORDER_RANK`/`TERMINAL_ORDER` add `READY_FOR_COLLECTION`/`COLLECTED`), `reporting.ts` | Method-aware ladders, buckets, ranks, executive status |
| `app/api/admin/notes/orders/route.ts` | Select new columns; `fulfillment` filter; new buckets; billing-address fallback for city/state |
| `app/api/admin/notes/orders/[id]/advance/route.ts` | Use `staffNextStatus(status, method)`; set `ready_for_collection_at` on that transition |
| `app/api/admin/notes/orders/[id]/collect/route.ts` (new) | POST `{confirm:"COLLECTED"}`, `store_manage_orders`, pickup-only, conditional on `READY_FOR_COLLECTION`, sets `COLLECTED` + `collected_at`, event with actor, `commitReservations` |
| 11 courier/address routes | `assertDeliveryOrder` |
| `lib/store/shipping/autoFulfillRun.ts` | Early return for pickup |
| `lib/store/notifications.ts` | New inert types |
| `lib/telegram/notesOrderAlert*.ts` | Fulfilment line; billing-city fallback |
| `lib/analytics/notesIntel*.ts`, `components/notes/admin/analytics/*` | Method dimension, coverage denominator, geo fallback, relabels |
| `lib/analytics/events.ts` | New allow-listed events |
| `components/notes/CartClient.tsx`, `CheckoutForm.tsx`, new `FulfillmentChooser.tsx`, `PickupLocationCard.tsx` | UI |
| `components/notes/admin/orders/*`, `OrderQueue.tsx`, `Overview.tsx`, `NotesAnalytics.tsx` | Badge, filters, pickup panel, hidden courier UI, relabels |
| `lib/ai-agent/conversationPolicy.ts` | Hide launcher on `/notes/checkout` |
| `lib/store/localFixture.ts` | Pickup fixtures (New, Printing, Ready, Collected) for local QA |

---

## 19. Risks

| Rank | Risk | Mitigation |
|---|---|---|
| CRITICAL | **Payment amount mismatch.** The client shows ₹0 shipping but the server charges zone shipping, or the reverse. | The server is the sole author of the total (`lock*Quote` at submit). The Pay label is taken from the server quote. Test: pickup payment row amount = lines total; ICICI `BA` comparison unchanged. |
| CRITICAL | **Pickup order enters the courier pipeline** (Compare, AWB, label, courier pickup, polling) and creates a real courier booking or charge. | Route guard on all 11 routes, DB triggers on the 3 courier tables, status constraint, `runAutoFulfillment` guard, UI hiding as the last layer. Tests assert 409 and no provider call. |
| HIGH | **Status collision.** Reusing `PACKED`/`READY_FOR_PICKUP` for pickup trips "No active shipment"/"Compare"/`awb_missing` rules and courier analytics. | Distinct `READY_FOR_COLLECTION`/`COLLECTED`; status-by-method constraint. |
| HIGH | **Delivery regression** while refactoring checkout/quote. | Pure-extract refactor (`buildQuoteLines`); the delivery path keeps the same function names and totals; golden test comparing old and new delivery quote outputs on fixtures; `placeCheckout` delivery path unchanged except shared helpers. |
| HIGH | **Invoice place of supply / wording wrong for pickup.** | `placeOfSupplyFor` with a CA-confirmed rule; until confirmed, use the billing state (matches today's behaviour for delivery) and record the decision in `DECISION_LOG.md`. |
| HIGH | **Pack route creates a `store_shipments` row for pickup**, which feeds the tracking cron (`pending` is an open status) and analytics. | `assertDeliveryOrder` on `pack`; DB trigger. |
| MEDIUM | **Admin Issues false positives** (missing shipment, package required, invoice/address). | Pickup statuses are outside the PACKED rules; add pickup-specific ops lines; ops-row tests per pickup stage. |
| MEDIUM | **Analytics distortion:** coverage denominator, geography gaps, "delivered" counts. | Delivery-only coverage context; billing-address geo fallback; fulfilled = `DELIVERED ∪ COLLECTED`. |
| MEDIUM | **Checkout lead loses pickup customers** (`completeAddress` requires `line1`). | Pickup location shape accepted; method stored on the lead; leads tests. |
| MEDIUM | **Wrong pickup address/PIN promised** (160030 vs Sector 17C). | Owner confirmation before enabling; snapshot per order. |
| MEDIUM | **Uncollected orders pile up** (no policy). | Ready-since age in the row; "uncollected > N days" view; owner decides the policy (PO question). |
| LOW | **Historical orders mis-classified.** | Constant default DELIVERY; no backfill; constraints validated against existing rows. |
| LOW | **Counsellor launcher overlaps the new sticky bars.** | Hide on `/notes/checkout`; dodge on cart. |
| LOW | **Stale cart choice** poisons a later purchase. | The draft lives on the cart row, which is converted at checkout; a new cart starts null (default Delivery). |
| LOW | **Flag flip mid-checkout** (pickup chosen, then flag turned off). | The server refuses a new pickup checkout with a clear message; the customer reselects Delivery; nothing is charged. |
| LOW | **Telegram format change breaks idempotency.** | Additive line only; slot keys unchanged; formatter tests. |

---

## 20. Recommended V1

1. Flag `notes_store_academy_pickup` (off by default) and the location constant (owner-confirmed values).
2. Additive migration (§17).
3. Order-level `fulfillment_method`, immutable after payment, with the pickup location snapshot and acknowledgement time.
4. Cart chooser (draft on the cart row) and Checkout Step 1 chooser; Delivery pre-selected; Buy Now lands on Step 1.
5. Pickup checkout: contact fields, PIN/city/state billing location, pickup card with Maps link and phone, "Yes, I'll collect from Chandigarh", ₹0 shipping, same offers, same ICICI.
6. Delivery checkout unchanged apart from the step label and sticky pay bar.
7. Server quote for pickup; zero shipping; invoice with a collection block and a fulfilment-aware place-of-supply function.
8. Pickup lifecycle: New → Preparing (auto) → Printing → Ready for collection → Collected (confirm dialog, actor, timestamp, reservation commit).
9. Admin: ACADEMY PICKUP badge, fulfilment filter, new buckets, pickup panel, courier UI hidden, "Courier pickup" relabels.
10. Courier isolation: route guards on 11 routes and DB triggers.
11. Customer confirmation and Track Order pickup variants; pickup issue categories.
12. Telegram fulfilment line; inert customer notification hooks plus staff "Copy ready message".
13. Analytics: method dimension, pickup share/revenue, delivery-only shipping coverage, billing-geo fallback.
14. Lead capture with the method.
15. Tests (§23) and doc updates (`CURRENT_STATE.md`, `DECISION_LOG.md`, `handoff-state.json`, new `ACADEMY_PICKUP.md`).

---

## 21. Defer to V2

- OTP, QR or 4-digit pickup codes.
- Proxy collection rules (someone else collects). V1 copy asks for the order number only; staff judgment applies.
- Multiple pickup locations or a `pickup_locations` table.
- Pickup scheduling windows, slots and opening hours (none exist today).
- Post-payment method switching (Delivery ↔ Pickup). V1 is no switch; use cancel/refund and reorder.
- Automatic local detection, geofencing, PIN-gated visibility.
- Product-level fulfilment eligibility.
- Branch-level inventory.
- Customer SMS/WhatsApp sends (need DLT template approval first).
- Auto-reminders for uncollected orders and auto-cancel policy.
- "Collected" undo UI.
- Same-order payment retry (an existing gap, not pickup-specific).

---

## 22. Implementation Plan

One run, in this order, starting from the **exact live SHA `be8bb64`** (not master).

1. **Branch and baseline.**
   - `git switch -c cursor/notes-academy-pickup be8bb64`.
   - Run `npx tsc --noEmit`, `npm test`, `node scripts/ci/guard-store-domain-isolation.mjs`, and record the baseline.
2. **Domain (pure, test-first).**
   - `lib/store/fulfillment.ts` (types, `PICKUP_PROGRESS`, method-aware `staffNextStatus`, `assertDeliveryOrder`).
   - `lib/store/pickupLocation.ts`.
   - The `StoreFlagKey` addition.
   - Unit tests for ladders, guards and snapshot.
3. **Migration file.** Additive (§17), idempotent, with `NOT VALID` → `VALIDATE`, and the flag row inserted disabled. Add a SQL test fixture to `DATABASE_AND_MIGRATIONS.md`. The owner applies it in the SQL editor; it is the only manual stop.
4. **Quote and checkout server.**
   - Extract `buildQuoteLines`.
   - `buildPickupQuote`/`lockPickupQuote`, `placePickupCheckout`.
   - Route dispatch.
   - Lead changes.
   - Quote preview route.
   - Golden tests: delivery totals unchanged; pickup total = lines.
5. **Courier isolation.** Guards on the 11 routes and the `runAutoFulfillment` guard. Tests: 409 for pickup and no provider fetch (inject `fetchImpl`).
6. **Statuses everywhere.**
   - `stages`/`opsBoard`/`orderOps`/`orderOpsDisplay`/`adminConsole`/`customerGroups`/`availability`/`status.ts`/`reporting`/`projection`/`trackingView`.
   - The `collect` route.
   - `advance` route changes.
   - Courier relabels.
7. **Public UI.**
   - `FulfillmentChooser`, `PickupLocationCard`.
   - `CartClient`, `CheckoutForm` (contact shared; address block delivery-only; pickup block; sticky pay bar; sticky desktop aside).
   - `OrderStatus`/track pickup variants.
   - Counsellor hidden on checkout.
8. **Admin UI.** List badge/filter/buckets, `OrderDetail` pickup panel and hidden courier sections, Overview/Analytics relabels.
9. **Invoice, Telegram, notifications, analytics.**
10. **Fixtures and visual QA.**
    - `localFixture` pickup scenes.
    - Playwright/headless screenshots at 375/390/430/1280 for Cart (both), Checkout (both), Confirmation, Track (preparing, ready, collected), Admin row, Admin detail.
    - Reduced-motion pass.
11. **Gates.** `tsc`, `npm test` (register any new test dir in `package.json`), isolation guard, `npm run build`.
12. **Docs.** `CURRENT_STATE.md` (also fix the stale "production disabled" header), `DECISION_LOG.md` (method, statuses, terminology, address rule, place-of-supply decision), new `ACADEMY_PICKUP.md`, `handoff-state.json`.
13. **Release.**
    - `npm run release:check`, push, `npm run release:smoke -- <preview>` with the pickup flag **off**: delivery unchanged.
    - `npm run release:verify-data -- notes-analytics` before.
    - `npm run release:prod -- <preview>` (auto-rollback).
    - Production smoke read-only.
    - Then the owner enables `notes_store_academy_pickup` (data edit) once the address/PIN/CA answers are in.
    - No real payment or AWB in QA.

---

## 23. Test Plan

| # | Test | Level |
|---|---|---|
| 1 | Delivery happy path unchanged: `buildFrozenQuote` golden totals equal pre-refactor; `placeCheckout` inserts the same rows/columns plus `fulfillment_method='DELIVERY'` | unit + integration (fixture db) |
| 2 | Pickup happy path: order row (method, `shipping_address_id` null, billing row kind=billing without line1, snapshot, ack time, `shipping_paise` 0), items, payment amount = total | integration |
| 3 | Pickup zero shipping: quote, order, public order label "Free", invoice shipping 0 | unit |
| 4 | Delivery shipping unchanged per zone (₹49 local, ₹99 national) | unit |
| 5 | Switch delivery → pickup: client clears the delivery quote, keeps contact fields, totals drop shipping; server ignores any client total | component + server |
| 6 | Switch pickup → delivery: requires PIN lookup + address confirm again; no academy address reused | component |
| 7 | Mixed cart (2 subjects) pickup: one order, one method | integration |
| 8 | Offer + pickup: same discount as delivery; hold/consume unchanged | unit |
| 9 | ICICI amount pickup: payment URL amount = total; Verify `BA` equality → captured; mismatch → refused | unit (`icici-merchant-amount` style) |
| 10 | Duplicate callback / Verify on a pickup order: idempotent, method unchanged | unit |
| 11 | Method immutability: an update after `paid_at` is rejected (trigger SQL test) and no code path writes it | SQL + grep test |
| 12 | Invoice pickup: number claimed, totals agree at 0 shipping, collection block, `placeOfSupplyFor` rule | unit |
| 13 | Admin pickup: row view (badge, stage, no courier lines), filters, buckets, detail panel hides courier/package/address change | unit (ops-row) + render |
| 14 | No courier quote for pickup: `rates` → 409, no `store_courier_quote_sessions` insert | route test |
| 15 | No shipment created: `pack`/`dispatch`/`ship`/`label`/`pickup` → 409; trigger blocks a direct insert | route + SQL |
| 16 | No tracking poll: cron selection contains no pickup order | unit |
| 17 | Ready for collection: advance from PRINTING → READY_FOR_COLLECTION for pickup only; delivery PRINTING → PACKED unchanged | unit |
| 18 | Collected: confirm required, actor and time recorded, reservations committed, terminal, customer timeline | route + unit |
| 19 | Historical delivery orders: default DELIVERY; ladders, issues and analytics identical on fixtures A–Q | regression |
| 20 | Analytics: pickup counted in revenue/orders/units/subjects/geo (billing), excluded from shipping coverage denominator and rate stats; fulfilled = DELIVERED ∪ COLLECTED | unit (notes-store-analytics) |
| 21 | Leads: pickup lead reaches DETAILS_IN_PROGRESS with a PIN-only location; abandoned pickup lead keeps the method | unit |
| 22 | Flag off: chooser hidden, checkout refuses ACADEMY_PICKUP, existing pickup orders still render and are actionable | route |
| 23 | Telegram: pickup line present, city from billing, slot keys unchanged | unit |
| 24 | Status constraints: pickup cannot enter courier statuses and delivery cannot enter collection statuses (SQL) | SQL |
| 25 | Mobile layout: 375/390/430 screenshots, no horizontal scroll, tap targets ≥ 44 px, counsellor not overlapping, reduced motion | visual QA |
| 26 | Isolation guard still OK; no `dataProvider` import in store code | CI |

---

## 24. Go / No-Go Checklist

**Go when all are true:**

- [ ] Owner confirmed the pickup display name, full address, PIN, maps link and phone (and resolved 160030 vs Sector 17C).
- [ ] CA confirmed the pickup place-of-supply rule and invoice wording (or the owner accepted the interim "billing state" rule in writing in `DECISION_LOG.md`).
- [ ] Owner decided the uncollected-order policy and readiness copy.
- [ ] Migration applied and verified read-only (columns, constraints validated, triggers present, flag row disabled).
- [ ] `tsc`, `npm test`, isolation guard and `next build` are green on the branch from `be8bb64`.
- [ ] Preview smoke with the flag off: delivery cart → checkout → (no payment) quote and UI identical; admin delivery rows unchanged.
- [ ] Preview with the flag on (preview override only): pickup UI at 375/390/430/desktop; server refuses courier routes for a pickup fixture.
- [ ] Production deploy via `release:prod` with automatic rollback, smoke passed, `release:verify-data` unchanged.
- [ ] The flag is enabled by the owner as a data edit. The first real pickup order is watched end to end (Telegram line, admin panel, ready → collected).

**No-go if any are true:**

- Any delivery total differs from the pre-change golden values.
- Any courier route accepts a pickup order.
- The invoice for a pickup fixture fails the totals check.
- The address is unconfirmed.

---

## 25. Questions / Decisions for Product Owner

1. **Pickup address.**
   - Confirm the exact pickup address and PIN for SCO 173–174, Sector 17C (the invoice settings say PIN **160030**; Sector 17 is commonly 160017).
   - Confirm that `https://maps.app.goo.gl/BSA5hDQhBMKxKTbg6` is the right map pin.
   - Confirm `84376 86541` is the number customers should call about pickup.
2. **Collection hours.** The site has none. Should v1 show hours (which?), or say "We'll share collection timings when your order is ready"?
3. **Readiness expectation.** May we say "usually ready in about 2–3 working days" (products carry `dispatch_days`, default 2), or only "We'll tell you when it's ready"?
4. **Ready notification.** Until DLT templates are approved, staff will tell customers by phone or WhatsApp. Should we submit the two pickup DLT templates now?
5. **Uncollected orders.** How long do we hold a ready order, and what happens after that (reminder, cancel and refund, or convert to delivery at the customer's cost)?
6. **Who may collect.** Only the buyer, or anyone quoting the order number and phone? (V1 recommendation: order number + the phone number on the order, with staff judgment.)
7. **Invoice place of supply.** This is the CA's question (§10). Until answered, is the interim "customer's billing state" rule acceptable?
8. **Post-payment method changes.** V1 does not support them. Confirm that staff handle a request with cancel/refund and a new order.

---

*Evidence base: live SHA `be8bb64` code paths cited inline; production read-only aggregates on 2026-10-04 (41 paid orders, zones, flags, invoice settings, product modes); live public pages `/`, `/contact`, `/notes` for address, map link and phone.*
