# Notes analytics intelligence

`/admin/notes/analytics` (Super Admin only). Read-only. Nothing on this page writes to orders, payments, invoices, shipments, couriers, leads, or Telegram.

Spec: `docs/notes-store/analytics-intelligence-2.md`.

## Page order

1. Date range (one selector for every cohort section)
2. Primary KPIs (unchanged definitions)
3. Commerce & fulfillment strip
4. Subject performance
5. Sales over time (Daily / Cumulative; sales and fulfillment metrics)
6. Funnel (unchanged)
7. Geographic intelligence (India map, state ranking, state table, city ranking)
8. Shipping intelligence (summary, ₹100 target, distribution, by state, by city, courier performance, rate anomalies)
9. Existing acquisition, campaigns, products, content, checkout health, landings, devices, promotions, CTAs, checkout leads

## Three time semantics

| Label in UI | Population | Used by |
|---|---|---|
| Orders paid in range (sales cohort) | Captured, non-QA orders with `paid_at` in the range. Identical to the KPI row. | KPIs, subjects, states, cities, shipping economics, anomalies, Avg booked shipping card |
| Fulfillment events | Picked up / shipped / delivered whose own timestamp is in the range, whatever day the order was paid | Picked up, Shipped, Delivered metrics in Sales over time |
| Current fulfillment | Order status now, ignores the range | Packed, Pickup, In transit, Out for delivery |

"Today · IST" counts fulfillment events in the current IST day.

All buckets are Asia/Kolkata. Ranges up to 36 h use hourly buckets, longer ranges use daily buckets. Empty buckets are zero, never omitted.

## Definitions

- **Revenue, AOV, Paid orders:** unchanged (`aggregateNotesAnalytics`). Revenue is `store_orders.total_paise` of captured orders.
- **Units:** sum of line `qty` (a missing or zero qty counts 1), same as the existing chart.
- **Subject:** `store_products.subject`, falling back to the product short name, then the product name, then the line snapshot name. Nothing is hard-coded. A new live product appears as soon as it sells.
- **Subject orders:** unique captured orders containing the subject. A Polity + Economy order adds 1 to each subject and 1 to its state.
- **Net product revenue (subjects):** line `line_total_paise`, which is already net of line-level offer discounts. Any residual between the order's merchandise value (`total_paise − shipping_paise`) and the sum of line totals (order-level discount, tax-exclusive tax, rounding) is allocated across lines in proportion to line value with the largest-remainder method in integer paise. Customer shipping is never allocated. Bundles are split into component subjects by component selling price × quantity.
  - Reconciliation: Σ subject net product revenue = Σ (total − customer shipping) over the cohort. It is not the Revenue KPI. The difference is customer shipping.
  - If bundles are sold, subject units count component books, so they can exceed Paid units.
- **Fulfillment event times:** picked up is the earliest `store_shipments.picked_up_at` on a usable shipment of that order. Shipped is `store_orders.shipped_at`, which is set when the order first enters Picked up or In transit. Delivered is `store_orders.delivered_at`, falling back to the live shipment's `delivered_at`. These are tracking-sync times. `created_at` and `updated_at` are never used. There is no "entered transit" event, so In transit is a snapshot only.
- **Current fulfillment buckets:** Packed = `PACKED`, `READY_FOR_PICKUP`. Pickup = `PICKUP_SCHEDULED`. In transit = `PICKED_UP`, `IN_TRANSIT`. Out for delivery = `OUT_FOR_DELIVERY`. Cards link to the existing Orders filters (`?status=packed|pickup|shipped`).

## Booked shipping rate

- Source: `savedCourierRatePaise(provider_payload)` (`booked_rate_paise`, else `rate_paise`) on the one shipment `rateShipmentFor` returns. This function is shared with the Notes Orders tile (`lib/store/orderOps.ts`), so both pages use one formula.
- Eligible: captured, non-QA order in Packed (with a live AWB) through Delivered. The newest live shipment with an AWB is used, and cancelled, failed, expired, superseded, `do_not_use` and pending courier-city confirmation rows are excluded. A second order carrying an AWB already counted is skipped.
- Never the customer's checkout shipping charge (₹59/₹79/₹99). Never a provider invoice. UI copy says "Booked courier rate. Final provider billing may differ." A future `provider_charge_paise` must be shown as a separate "Actual provider cost" metric and not mixed with this one.
- A missing rate is shown as a coverage gap ("Booked rate coverage 31 of 34 shipments"), never as ₹0. It is never an anomaly.
- **Orders page vs Analytics:** the Orders tile covers every captured order (all time). The Analytics card covers orders paid in the selected range. With the same population the values are identical (test: "uses the same eligible population and rule as the Notes Orders tile").
- Shipping burden = booked rate ÷ captured order total.
- Distribution buckets: < ₹60, ₹60–79, ₹80–99, ₹100–149, ₹150–199, ₹200+. Target: "At or under ₹100" is the share of rated shipments with rate ≤ ₹100.00. "Over ₹100" is surfaced for review only and is not treated as wrong.
- Courier = the booked service name as stored (`courier_name`), so "Blue Dart Air" and "Blue Dart Surface" stay separate. Provider = Shiprocket / Delhivery Direct / Manual, with a provider rollup toggle. "Picked up" counts canonical shipments that reached pickup or later.

## Rate anomaly rule (fixed, documented)

A booked rate is flagged **High rate** when both conditions hold:

- rate ≥ 1.5 × peer median, and
- rate − peer median ≥ ₹40.

Peers are other rated canonical shipments, from any date, to the same delivery state in the same package weight band (≤600 g, 601–1100 g, 1101–2000 g, >2000 g). At least 3 peers are required. With fewer, peers fall back to the same weight band nationally, and the row says "nationally". With fewer than 3 national peers, nothing is flagged. A shipment is never its own peer. Unknown weight or unknown rate is never flagged.

Weight is the booked shipment's `weight_grams`, else the canonical package resolver (`resolvePackageDisplay`: saved order package, then product profile).

The tooltip and table show the peer interquartile range ("Typical ≤600 g Maharashtra: ₹68.94–₹98.72") and the percentage above the median. Rows link read-only to `/admin/notes/orders/[id]`. Nothing is cancelled, rebooked, refunded or messaged because of a flag.

## Geography

- Delivery place: the invoice `shipping_snapshot` city/state, else the order's `store_addresses` row (`destinationForOrder`). Courier hubs are never read. This is unchanged from the existing city ranking.
- States: `lib/analytics/indiaStates.ts`. Canonical codes are the GST state codes from `lib/store/invoice/gstin.ts`. Matching is exact after trimming, casing, punctuation and "&". Aliases cover known historical names (Orissa, Uttaranchal, Pondicherry, NCT of Delhi), the pre-2020 Dadra & Nagar Haveli / Daman & Diu names, two common spellings of Chhattisgarh, and ISO 3166-2:IN letters. Nothing is fuzzy-matched. Anything else is **Unknown**, which is kept in every total.
- Cities: existing `normalizeCity` (trim, case, spacing, trailing "City"), keyed with the canonical state. No fuzzy merging.
- Reconciliation (tests): Σ state orders = Paid orders, Σ state revenue = Revenue, Σ state units = Paid units, Σ state rated shipments = global coverage, Unknown included.
- Selecting a state on the map or ranking only filters the geography section's detail card and city ranking. The page date range is untouched.
- No names, phones or street addresses reach the page.

## India map asset

- File: `components/notes/admin/analytics/indiaShapes.ts`.
- Source: `@svg-maps/india` 2.0.0 (https://github.com/VictorCazanave/svg-maps), based on the MapSVG India map (https://mapsvg.com/maps/india).
- License: Creative Commons Attribution 4.0 International (CC BY 4.0). Attribution is in the file header and here.
- Changes: relative SVG path commands were converted to absolute coordinates rounded to 0.1 units. Boundaries were not edited. The package is not installed as a dependency.
- The asset predates 2019. Ladakh is drawn inside the Jammu & Kashmir outline, so that outline is labelled "Jammu & Kashmir and Ladakh" and shows both UTs' combined numbers. The two Dadra & Nagar Haveli and Daman & Diu outlines both show the merged UT. Rankings and tables keep every state and UT separate.
- Loaded with `next/dynamic` from the geography section only (admin route), so `/notes`, checkout and tracking bundles are unaffected. No tiles, no geocoding, no external requests. A load failure shows a local message, and the ranking stays usable.

## Loading, failure isolation, performance

- `app/admin/notes/analytics/page.tsx` runs the existing KPI loader, the checkout-lead loader and `loadNotesIntel` in parallel with a shared `now`.
- `loadNotesIntel` returns `null` on any failure. The commerce strip, subjects, geography and shipping sections then show local "unavailable" messages, and the existing city ranking falls back to its previous data. KPIs, sales and the funnel are unaffected.
- Queries: paid orders paginated 1,000 at a time (cap 20,000), the product catalogue, bundle items, then order items and shipments in 200-id batches four at a time, plus destinations through the existing invoice/address loader. There are no per-order queries. Aggregation is server-side (`lib/analytics/notesIntel.ts`, pure and unit-tested). The browser receives aggregates only.
- Indexes: `store_orders` (`paid_at`), `store_shipments_order_idx`, and `store_order_items` by `order_id` cover these reads. No migration was added. If order volume makes the all-time pool slow, the next step is an additive SQL RPC returning the same shapes.
- Behaviour events are paged in full: an exact count, then 1,000-row pages read four at a time and ordered by (`occurred_at`, `event_id`), up to `MAX_NOTES_EVENTS` (100,000). The page shows a warning if a range exceeds that. Before 2026-10-04 the loader stopped at the newest 8,000 events, which halved 30-day Visitors and the funnel.
- Range changes keep the current numbers on screen, dimmed, until the next range has loaded.

## Tests

`tests/notes-store-analytics/intel.test.ts` (registered in `npm test`) covers cumulative sums and KPI end-value reconciliation, hourly Today, zero days, discount allocation, shipping exclusion, multi-subject orders, bundles, dynamic subjects, state aliases and Unknown, state/units/revenue/coverage reconciliation, cancelled shipments, missing rates, customer shipping exclusion, parity with the Orders tile, duplicate AWBs, distribution buckets, the anomaly rule (state, weight band, national fallback, thresholds), fulfillment event timing, privacy, lazy admin-only map loading, and read-only sources.
