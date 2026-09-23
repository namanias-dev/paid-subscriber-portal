# Naman IAS Notes Store — commerce launch report

No secrets are included. No courier shipment, label, pickup, refund, or cancellation was created.

## Gmail

| Item | Status |
| --- | --- |
| OAuth configured | READY (local helper only) |
| Read-only scope | READY — `https://www.googleapis.com/auth/gmail.readonly` |
| Mailbox check | READY — `namanstudycircle@gmail.com` |
| Live Shiprocket OTP read | READY — one login code, not printed |
| Inbox mutation | READY — messages were not marked read or changed |

The Desktop client lives on Google Cloud project `namaniasacademy`. The app is External, Testing, with that mailbox as the only test user. `client_secret.json` and `token.json` stay next to `scripts/local/shipping-gmail-otp/` and are gitignored. They are not Vercel env vars.

The helper accepts mail from `net.shiprocket.in` and reads the code next to the OTP label, so a pincode in the footer is not treated as the code.

## Shiprocket

`SHIPROCKET_API_USER_REQUIRES_SECOND_ACADEMY_EMAIL`

| Item | Status |
| --- | --- |
| Portal login | READY |
| API user | BLOCKED — the only API user is inactive, named “API USER”, on a different Gmail, and is not an academy mailbox. It was not activated or reset. A new user cannot reuse the panel email. The spreadsheet and the repo have no second academy mailbox. |
| API authentication | BLOCKED |
| Pickup | READY — nickname `work`, id `117035417`, PIN `160017`. The API field is the nickname, not the id. |
| Rates | BLOCKED until an active API user exists |
| Shipment | NOT BUILT as a live call. Draft payload is tested and is not posted. |
| AWB | NOT BUILT as a live call |
| Label | NOT BUILT as a live call |
| Pickup API | NOT BUILT as a live call |
| Tracking | PARTIAL — webhook receiver and status rules exist |
| Webhooks | BLOCKED — panel connection is still disabled and was not turned on |

## Delhivery

| Item | Status |
| --- | --- |
| API authentication | READY for read-only PIN and charge quotes |
| Warehouse / pickup | READY — Facility Name `NAMAN SHARMA IAS ACADEMY`, Active, Chandigarh `160017`, return address same as pickup, default slot Mid Day. Create uses `pickup_location.name` with that exact string. |
| Rates | READY as a quote, not a booked shipment |
| Shipment | NOT BUILT as a live call. The CMU body is tested and is not posted. |
| Waybill | NOT BUILT as a live call |
| Label | PARTIAL — packing-slip path is for an existing AWB and does not create a shipment |
| Pickup | NOT BUILT as a live call |
| Tracking | PARTIAL — webhook receiver exists |
| Webhook | BLOCKED — not configured in the Delhivery panel |

Shiprocket panel: company `11671821`, Lite plan, KYC completed, GST verified, header wallet about ₹1,000. Delhivery One wallet shows ₹0. An earlier read-only Delhivery quote from `160017` to `110001` at 800 g was Surface ₹87.80 and Express ₹90.16. That figure is not a rate card.

## Admin

| Item | Status |
| --- | --- |
| Order workflow | READY — existing queue. Packed size can be saved without booking. |
| Shipping comparison | READY in code. Cards show provider, service, price, ETA, and prepaid/COD. |
| Label | PARTIAL — download path does not create a shipment; no label is stored yet |
| Pickup | NOT BUILT as a live call |
| Exceptions | PARTIAL — Problem filter plus `fulfilmentAttention` for failed delivery, RTO, return, refund, missing AWB, and missing label |
| Returns | PARTIAL — delivered-order report without photo upload or a reverse shipment |
| Refunds | PARTIAL — `REFUND_PENDING` only. ICICI is not called. |

## Customer

| Item | Status |
| --- | --- |
| Checkout and confirmation | READY |
| Tracking | READY — Packed, Shipped, In Transit, Out for Delivery, Delivered. AWB, label, and pickup requested stay Packed. |
| Returns / support | PARTIAL — reason and description after delivery. No photos. |

## Deployment

- Live version at the start of this pass: `2eab440578e0`
- `NOTES_STORE_SHIPPING_WRITES` and `NOTES_STORE_SHIPPING_WRITE_CONFIRM` stay unset, so Create shipment still refuses.
- Production env names still unset from this agent: `DELHIVERY_API_TOKEN`, `NOTES_STORE_PICKUP_POSTCODE`, `DELHIVERY_PICKUP_LOCATION`, `SHIPROCKET_PICKUP_LOCATION`, `SHIPROCKET_API_EMAIL`, `SHIPROCKET_API_PASSWORD`, `NOTES_STORE_COURIER_WEBHOOK_KEY`.

## Remaining blocker

`SHIPROCKET_API_USER_REQUIRES_SECOND_ACADEMY_EMAIL`

Billable shipment, AWB, label, and pickup stay off until that API user exists and a test order is explicitly authorized.
