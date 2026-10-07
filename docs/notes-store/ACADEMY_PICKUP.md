# Academy Pickup

Academy Pickup is the second fulfilment method for Notes Store orders. It sits beside courier Delivery. The customer chooses it per order. They pay online the same way, shipping is ₹0, and they collect the notes from the academy in Chandigarh. Discovery notes are in `ACADEMY_PICKUP_DISCOVERY.md`.

## What the customer sees

- **Cart:** "How would you like your notes?" offers **Delivery** (the default) or **Pick up from academy**. The choice is a draft saved on `store_carts.fulfillment_method` (null means Delivery). The summary reads "Shipping: Calculated at checkout" for Delivery or "Academy pickup: Free" for pickup.
- **Checkout:** the steps are 1 How you'll get it, 2 Your details, 3 Delivery address or Pickup details, 4 Pay securely.
  - Pickup asks for name, mobile, optional email and a PIN code. The PIN is "For your invoice and order details. We won't deliver to this address."
  - The location card has a Google Maps link and a Call academy link.
  - Readiness copy: "Your notes will be ready after they are prepared, printed and packed. We'll let you know when they're ready to collect."
  - Pay stays disabled until the customer presses **Yes, I'll collect from Chandigarh**, which then reads **Collecting here ✓**.
  - Phones get a sticky pay bar. The counsellor launcher is hidden on `/notes/checkout`.
- **Order page / Track:** a 5-step timeline: Order confirmed, Preparing, Printing, Ready for collection, Collected. The page shows the location card. It never mentions a courier, AWB or ETA. Once collected, it shows the collection time. Pickup issue categories: Not ready yet, Can't collect, Missing or wrong item, Invoice or payment, Something else.
- **Not promised in V1:** opening hours, a collection SLA, OTP or QR handover, auto-cancel, and switching method after payment.

## Location

`lib/store/pickupLocation.ts`, code `CHD_17C`: Naman Sharma IAS Academy, SCO 173–174, 2nd Floor, Sector 17C, Chandigarh. Maps: https://maps.app.goo.gl/BSA5hDQhBMKxKTbg6. Phone: +91 84376 86541.

The postal PIN is deliberately unset. The invoice seller PIN (160030, in `store_invoice_settings`) is unchanged. The browser never supplies academy details. Checkout re-checks the location code and an FNV fingerprint against this record, then freezes a snapshot on the order (`pickup_location_snapshot`). If the record changes later, existing orders keep what their customer was shown.

## Server rules (checkout)

`POST /api/notes/checkout` must name `fulfillment_method`. If it is absent the request is treated as DELIVERY, which covers pages loaded before this release. Any other value is refused. The cart's draft method is never consulted. `placePickupCheckout` (`lib/store/checkout.ts`) runs every check before the first write that matters:

1. Creation flag `notes_store_academy_pickup` plus the master `notes_store` switch.
2. The location record, the acknowledged code and fingerprint, and `pickup_acknowledged === true`.
3. Contact fields. Delivery fields (address lines, landmark, instructions, address hash) are ignored.
4. The PIN through `lookupIndianPincode`: location only, cache first, with no zone or courier serviceability. A valid PIN we cannot deliver to is fine for pickup. An India Post outage returns a clean 503 that the client offers to retry. The state is normalized on the server.
5. Priced lines from the shared `buildQuoteLines`, shipping 0 (`buildPickupQuote`).
6. The pickup tax rule: only nil or exempt lines (`pickupTaxSupported`). A taxable line is refused before any order exists.
7. A conditional cart claim (`open → converted`), so a double tap or a second tab gets "already being placed" and no second order. A failure after the claim reopens the cart.

The order is then created by the same `createOrderFromQuote` statements as delivery: order row, items, offer hold, stock hold, payment row, event and lead hooks. Pickup-specific fields: `fulfillment_method`, `pickup_location_code`, `pickup_location_snapshot`, `pickup_acknowledged_at`, `customer_location_snapshot` (PIN, city, state, state code), `shipping_address_id` null, `promised_delivery_date` null.

Capture is unchanged. Verify does not read the method. The courier backstop triggers refuse any courier row for a pickup order.

## Lifecycle and staff SOP

`PAYMENT_CONFIRMED / ORDER_CONFIRMED → PROCESSING → PRINTING → READY_FOR_COLLECTION → COLLECTED`. The courier statuses (PACKED, READY_FOR_PICKUP, PICKUP_SCHEDULED, PICKED_UP, IN_TRANSIT…) are refused by `store_orders_status_method_check`. In the UI they read "Courier pickup…" so they are not confused with Academy Pickup.

1. **Prepare and print** as usual. The pick list marks the order `· ACADEMY PICKUP`.
2. **Mark ready for collection** (order detail, light confirmation). This stamps `ready_for_collection_at` and the staff name. No courier, label or package step exists for pickup.
3. **Tell the customer.** Use **Copy ready message**, **WhatsApp** or **Call**. These are staff-initiated only, and nothing is sent automatically yet. The `order_ready_for_collection` and `order_collected` SMS hooks stay inert until a DLT template and `notes_store_sms` exist.
4. **Hand over.** Ask for the order number and the registered mobile. Press **Mark collected** and confirm "Hand over order NIAS-N-… to <customer>?". This stamps `collected_at` and the staff name, and commits ready stock once. It cannot be undone. Double clicks and two staff members produce exactly one transition.
5. **Waiting orders.** The Orders list shows "Ready since …" and "Waiting N days", amber from 1 day and strong after 3 days. Follow up by phone. Nothing auto-cancels.

Mark ready and Mark collected need `store_manage_orders`. Both work when the creation flag is off.

## Admin

- A fulfilment filter (All / Delivery / Academy Pickup), independent of the status chips, persisted as `?fulfillment=` in the URL.
- A method badge on every row. Pickup rows show Ready since, Waiting, Next action and Collected by.
- The pickup detail panel shows the frozen location, acknowledgement time, readiness and handover with actors, and the customer location ("Not a delivery address").
- Hidden for pickup: Compare couriers, courier history, package, label, AWB, delivery address and Change address.
- `deliveryOnlyGuard` refuses pickup on every courier entry point: rates, label, pack, pickup, ship, carrier, provider-lookup, track, dispatch, the support-decision reverse branch, and address change. Auto-fulfil refuses pickup too. Database triggers on `store_shipments` and the three courier-quote tables are the backstop. `tests/notes-store-pickup/guards-and-transitions.test.ts` scans every API route for provider calls and fails if one is unguarded.

## Invoice

`placeOfSupplyFor` is the single rule.

- Delivery: the delivery address state, as before.
- **Pickup (interim, pending CA):** the customer's own state from the server-normalized PIN location. Every Notes product sold today is nil-rated, so this changes no amount.

Pickup invoices print "COLLECTION AT" with the academy block and "Academy pickup ₹0.00". They never print "SHIP TO".

## Analytics

The Notes analytics page has a fulfilment-method section: orders, units, revenue, AOV and share per method, reconciling to the KPI row. It also shows pickup operations: ready now, waiting over 1 and over 3 days, oldest, median paid→ready and ready→collected, and collected today. Shipping coverage and rate stats count delivery orders only, and the label says so. Geography uses the customer location for pickup orders. It makes no "savings" claims.

Events `notes_fulfillment_selected` and `notes_pickup_acknowledged` carry only the method and the surface. Leads record `fulfillment_method` and, for pickup, the PIN, city and state only.

## Flag and rollback

- `notes_store_academy_pickup` gates **creation only**. Turning it off hides the chooser and refuses new pickup checkouts within about 20 s (flag memo). Existing pickup orders still track, invoice, capture and move through staff actions.
- Release A (`5818c53`, `dpl_9pY9kEogb8i3jU6nNng7PjF52e5Q`) is the **safe compatibility** target. It reads and operates pickup orders but cannot create them. Once any pickup order exists, roll back to Release A or later, never to a pre-pickup SHA.
- Read-only verifier: `npm run release:verify-data -- notes-pickup`.
- Flag commands (`scripts/release/pickup-flag.mjs`, fixed SQL, no arguments, Supabase CLI login):
  - `npm run release:pickup-status`: read-only. Shows:
    - the flag row and the live SHA,
    - whether the app resolves pickup ON,
    - whether the active products are pickup-eligible,
    - the pickup columns, constraints and triggers,
    - the order count by method,
    - whether the location config is valid.
  - `npm run release:pickup-enable`: sets `enabled=true, scope='all'` on this one row, only when `kill_switch=false`. It refuses if the live app is not pickup-aware, the schema is incomplete, the location is invalid or an active product is taxable. It then reads the row back.
  - `npm run release:pickup-disable`: sets `enabled=false` on this one row and reads it back. Use it first for any pickup-only problem. Do not roll the app back for that.

## Local QA

`NOTES_STORE_LOCAL_FIXTURE=1 NOTES_STORE_PREVIEW_ENABLE=1 NOTES_STORE_PICKUP_LOCAL=1` runs the store on the in-memory fixture with pickup creation on. `NOTES_STORE_PICKUP_LOCAL` is ignored on Vercel and in production. Scene `ops_board` seeds pickup orders at every rung. Browser QA must stub `https://eazypay.icicibank.com/**`. Never run mutating checkout E2E against preview or production: preview shares the production database.
