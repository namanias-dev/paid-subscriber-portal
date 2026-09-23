# Naman IAS Notes Store — commerce launch report

No secrets are included. No courier shipment, label, pickup, refund, or cancellation was created. No live payment was taken.

## Shiprocket

| Item | Status |
| --- | --- |
| API user | READY — `namanias.shipping@gmail.com` is ACTIVE. The inactive API user was not activated or reset. The panel email was not reused. |
| API authentication | READY — external login returned HTTP 200. The token was not stored in git or this report. |
| Rates | READY — `160017` to `110001`, 800 g prepaid, returned five couriers with a positive rate. Amounts are not a rate card. |
| Shipment | PARTIAL — create payload is implemented and tested. The write gate refuses the call. |
| AWB | PARTIAL — assignment runs only after a gated create, and an empty AWB is stored as empty. |
| Label | PARTIAL — generated only for a shipment that already has an AWB. Reprint does not create a second shipment. |
| Pickup | PARTIAL — gated. A pickup request does not mark the order shipped. |
| Tracking | PARTIAL — webhook first. A cron reads only non-terminal shipments that have gone quiet. Delivered shipments are not polled. |
| Webhook | READY — panel connection is ENABLED. Auth header type is `x-api-key`. URL is `https://www.namanias.com/api/notes/courier/events`. Production returns 401 without the key. Shiprocket's webhook test call returned HTTP 200. |

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
| Tracking | PARTIAL — read of an existing waybill, plus the same non-terminal cron. |
| Webhook | BLOCKED — the open Delhivery page is warehouse management and has no webhook control. |

## Admin

| Item | Status |
| --- | --- |
| Fulfillment | PARTIAL — paid through packed, then ready to ship, is in the order queue. A browser session reached the staff sign-in page. No staff password is available here, so Compare and Create were not clicked. Anonymous dispatch returns 403. |
| Rate comparison | READY in code — provider, service, price, ETA, prepaid/COD. The chosen quote is what Create shipment would send. |
| Label | PARTIAL — Print label reads a stored label and does not book a shipment. |
| Pickup | PARTIAL — Schedule pickup is present and refused until the write gate is on. |
| Returns | PARTIAL — approve, reject with a reason, or record a replacement. No photo upload. Delhivery reverse pickup is gated and was not called. |
| Refunds | PARTIAL — a confirmed request records `REFUND_PENDING`. A second request is a no-op. The store Eazypay client can initiate and verify only, so the gateway is not called. |
| Exception queue | PARTIAL — Problem filter, plus attention for failed delivery, RTO, return, refund, missing AWB, and missing label. Quiet open shipments are classified for pickup overdue, no first scan, stale sync, missed ETA, NDR, RTO, and webhook gap. |

## Customer

| Item | Status |
| --- | --- |
| Checkout and confirmation | READY — Indian Polity was added and the checkout form accepted a Delhi PIN. The pay button was not used. The cart was cleared. |
| Tracking | READY — Packed until a carrier possession scan. AWB and pickup requested stay Packed. |
| Return / support | PARTIAL — damaged, wrong subject, missing product, incomplete pages, print defect, delivery issue. No photos. |

## Deployment

Production and preview have `NOTES_STORE_PICKUP_POSTCODE`, `DELHIVERY_PICKUP_LOCATION`, `SHIPROCKET_PICKUP_LOCATION`, `DELHIVERY_API_TOKEN`, `NOTES_STORE_COURIER_WEBHOOK_KEY`, `SHIPROCKET_API_EMAIL`, and `SHIPROCKET_API_PASSWORD`. Values are not listed here.

- `NOTES_STORE_SHIPPING_WRITES` and `NOTES_STORE_SHIPPING_WRITE_CONFIRM` stay unset.
- A dual live quote from `160017` to `110001` at 800 g prepaid returned Delhivery and Shiprocket rates in integer paise. The write gate was closed. No shipment was created.
- The shipping mailbox exists. Opening Gmail still asks Google for a phone or QR code, so the inbox itself is not confirmed.
- The first real Polity payment was not placed. Stop remains before any billable create-shipment.

## Remaining blockers

`DELHIVERY_WEBHOOK_PANEL_NOT_FOUND`

`NAMANIAS_SHIPPING_GMAIL_INBOX_STILL_NEEDS_GOOGLE_CHECK`
