# Naman IAS Notes Store — commerce launch report

No secrets are included. No courier shipment, label, pickup, refund, or cancellation was created. No live payment was taken.

## Shiprocket

`SHIPROCKET_API_USER_REQUIRES_SECOND_ACADEMY_EMAIL`

| Item | Status |
| --- | --- |
| API user | BLOCKED — waiting for a second academy-controlled email. The inactive API user was not activated or reset. The panel email was not reused. |
| API authentication | BLOCKED |
| Rates | BLOCKED until that API user exists |
| Shipment | PARTIAL — create payload is implemented and tested. The write gate refuses the call. |
| AWB | PARTIAL — assignment runs only after a gated create, and an empty AWB is stored as empty. |
| Label | PARTIAL — generated only for a shipment that already has an AWB. Reprint does not create a second shipment. |
| Pickup | PARTIAL — gated. A pickup request does not mark the order shipped. |
| Tracking | PARTIAL — read of an existing AWB, plus the webhook receiver. |
| Webhook | BLOCKED — panel connection stays disabled. |

## Delhivery

| Item | Status |
| --- | --- |
| API authentication | READY for read-only PIN and charge quotes |
| Pickup resolved | READY — Facility Name `NAMAN SHARMA IAS ACADEMY`, PIN `160017`, return address matches, slot 10:00–14:00 |
| Rates | READY as a quote |
| Shipment | PARTIAL — CMU body is implemented and tested. The write gate refuses the call. |
| AWB | PARTIAL — a waybill is kept only when Delhivery returns one. |
| Label | PARTIAL — packing slip is a read of an existing waybill. |
| Pickup | PARTIAL — gated request for an existing shipment. |
| Tracking | PARTIAL — read of an existing waybill, plus the webhook receiver. |
| Webhook | BLOCKED — not configured in the Delhivery panel. |

## Admin

| Item | Status |
| --- | --- |
| Fulfillment | READY — paid through packed, then ready to ship. Create shipment stays refused while the write gate is off. |
| Rate comparison | READY — provider, service, price, ETA, prepaid/COD. The chosen quote is what Create shipment would send. |
| Label | PARTIAL — Print label reads a stored label and does not book a shipment. |
| Pickup | PARTIAL — Schedule pickup is present and refused until the write gate is on. |
| Returns | PARTIAL — approve, reject with a reason, or record a replacement. No photo upload. Delhivery reverse pickup is gated and was not called. |
| Refunds | PARTIAL — full or partial amount can be recorded as `REFUND_PENDING`. The payment gateway is not called. |
| Exception queue | PARTIAL — Problem filter, plus attention for failed delivery, RTO, return, refund, missing AWB, and missing label. |

## Customer

| Item | Status |
| --- | --- |
| Checkout and confirmation | READY |
| Tracking | READY — Packed until a carrier possession scan. AWB and pickup requested stay Packed. |
| Return / support | PARTIAL — damaged, wrong subject, missing product, incomplete pages, print defect, delivery issue. No photos. |

## Deployment

Production and preview now have `NOTES_STORE_PICKUP_POSTCODE`, `DELHIVERY_PICKUP_LOCATION`, `SHIPROCKET_PICKUP_LOCATION`, `DELHIVERY_API_TOKEN`, and `NOTES_STORE_COURIER_WEBHOOK_KEY`. Values are not listed here.

- `NOTES_STORE_SHIPPING_WRITES` and `NOTES_STORE_SHIPPING_WRITE_CONFIRM` stay unset.
- `SHIPROCKET_API_EMAIL` and `SHIPROCKET_API_PASSWORD` stay unset until the new API user exists and a read-only login succeeds.
- A live Delhivery quote from `160017` to `110001` at 800 g prepaid returned two normalized rates (Surface and Express, zone B). The amounts are not a rate card. Shiprocket was not called.
- A missing or wrong courier callback key returns 401 on production. Provider panels were not turned on.
- The first real Polity checkout was not placed. Stop remains before any billable create-shipment.

## Remaining blocker

`SHIPROCKET_API_USER_REQUIRES_SECOND_ACADEMY_EMAIL`
