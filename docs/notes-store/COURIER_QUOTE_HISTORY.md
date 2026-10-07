# Courier quote history

An immutable audit trail of every Compare Couriers result staff saw, and every booking attempt made from it. Recording began 2026-10-04. Earlier orders show their booked courier and rate with "Historical quote list unavailable". Nothing was backfilled or reconstructed.

## Model

```
store_orders
  └─ store_courier_quote_sessions   one per Compare Couriers action (never updated)
       └─ store_courier_quote_options    the rows exactly as shown, in display order (never updated)
            └─ store_courier_booking_attempts   one per Book click; only its outcome columns change
                 └─ store_shipments (shipment_id, awb)
```

Migration: `supabase/migrations/2026-10-04-notes-store-courier-quote-history.sql`. It is additive and idempotent. RLS is enabled with no policies, and access is revoked from `anon`/`authenticated`, so only the service role can use these tables.

Stored: package (grams, mm, source), destination city/state/PIN, provider, courier/service names, courier id, mode, quoted paise, ETA as returned, eligibility and reason, cheapest flag (ties are all cheapest), and the staff username. Not stored: street address, phone, email, or raw provider payloads. Provider failures are kept only as a category (`ERROR` / `TIMEOUT` / `NOT_CONFIGURED`).

## Flow

1. **Compare** (`POST /api/admin/notes/orders/[id]/rates`):
   - Runs the existing package and address checks, then one `compareCourierRates` call (Delhivery and Shiprocket, unchanged).
   - Runs `presentCourierQuotes` on the server: the same eligibility and price order the picker used before.
   - Saves the session and options, and returns the saved rows. The picker renders those rows, so the history is exactly what staff saw.
   - If the save fails, the route returns *"Courier rates were received but could not be saved. Please retry Compare Couriers."* with no bookable rows.
   - Each picker open sends a `request_key`. A replayed request returns the saved session without calling the providers again.
2. **Book** (`POST /api/admin/notes/orders/[id]/dispatch`):
   - The body is `quote_session_id` + `quote_option_id` only. Provider, courier, service, courier id and price are read from the stored option. The browser cannot set them.
   - The booking is refused, with no provider call and a `BLOCKED` attempt recorded, when:
     - the session belongs to another order;
     - the option is ineligible;
     - the rates are older than 15 minutes (*"Courier rates have expired. Compare Couriers again."*);
     - the package or address no longer matches `booking_fingerprint` (a sha256 of the resolved package and the address line1/line2/city/state/PIN).
   - A `BOOKING` attempt is written before `createProviderShipment`. If that write fails, nothing is booked.
   - The existing booking path then runs unchanged: order lock, one-active-AWB check, destination check, label, pickup.
   - The attempt ends `BOOKED` (with `shipment_id` and AWB), `CITY_CONFIRM`, or `FAILED` (with a category such as `ADDRESS_CONFIRMATION_FAILED`, `DUPLICATE_SHIPMENT_BLOCK`, `PROVIDER_CREATE_FAILED`).
   - City confirm and decline resolve a `CITY_CONFIRM` attempt to `BOOKED` or `FAILED`.
   - The shipment's `provider_payload` also carries `quote_session_id`, `quote_option_id` and `booking_attempt_id`.
3. **Read** (`GET /api/admin/notes/orders/[id]/courier-history`, `requireStoreOrderRead`): returns sessions newest first, numbered from the oldest, with options, attempts, outcome, cheapest, and the selected premium (paise and percent).

Rates are not reserved by Shiprocket or Delhivery. The 15-minute window matches the dispatch route's booking lock.

## UI

- **Order detail → Courier price history**, below Package:
  - A Courier decision summary: selected, cheapest available, price difference from cheapest, options compared, selected by, compared and booked times.
  - Each comparison as an accordion, with the latest one open.
  - Options are a compact table on desktop and stacked rows on mobile, with Cheapest and Selected/Booked/Failed chips.
  - The wording is neutral. A dearer courier can be a deliberate choice.
- **Orders list:** one muted line under the courier, such as "4 options compared". It adds "· cheapest ₹X" only when the booked option was at least ₹25 above the cheapest. The list reads counts only (two batched queries) and never option rows.
- **Picker:**
  - If the chosen rate is at least ₹25 (`PREMIUM_NOTICE_PAISE`) above the cheapest eligible rate, the confirm step shows *"X is ₹Y more than the cheapest eligible option, Z."* It never blocks or reorders.
  - Expired or changed rates show "Compare couriers again".

Booked-rate analytics are unchanged. `booked_rate_paise` on the shipment is the stored quoted rate, and Shipping Intelligence still reads that.

## Tests

`tests/notes-store-orders/courier-quote-history.test.ts` covers:

- capture order and cheapest ties, ineligible rows, provider outage, and privacy;
- the normal, cheapest-selected and failed-then-second-choice cases;
- multiple sessions, expiry, package change, address change, foreign or ineligible options, and replay;
- list summaries, missing history, and the premium notice;
- route contracts: one provider comparison per click, attempt before create, no browser prices;
- migration safety.
