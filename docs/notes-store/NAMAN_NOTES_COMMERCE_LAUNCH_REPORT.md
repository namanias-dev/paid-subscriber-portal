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

| Item | Status |
| --- | --- |
| Portal access | READY — one login, session only in the agent browser |
| API authentication | BLOCKED |
| Pickup location | READY — nickname `work`, id `117035417`, PIN `160017`, primary, verified |
| Return address | READY — same pickup id |
| Live rates | BLOCKED until an active API user exists |
| Shipment / label / pickup | NOT BUILT as a live call |
| Tracking webhook | PARTIAL — receiver exists; panel webhook is DISABLED |

Account facts from the panel, with no credentials:

- Company id `11671821`, Lite plan, not expired, KYC completed, GST verified
- Panel header wallet balance ₹1,000
- Pickup: Sco 173-174, Second Floor, Sector 17 C, Chandigarh, Chandigarh, 160017
- One API user exists, on a different Gmail address, and the panel shows it INACTIVE
- A new API user must use an email that is not the registered panel email, so the academy Gmail cannot be the API login
- External `/auth/login` with the panel email still returns 403 because that login is not an API user
- Webhooks are disabled. No URL or token was saved

## Delhivery

| Item | Status |
| --- | --- |
| API authentication | READY for read-only PIN and charge quotes |
| Pickup warehouse id | BLOCKED |
| Live rates | READY as a quote, not a booked shipment |
| Shipment / label / pickup call | NOT BUILT |
| Tracking webhook | PARTIAL |

Warehouse list URLs still return 404. The create-warehouse path answers 405 to GET and was not called. The Delhivery website was not opened. One earlier read-only quote from PIN 160017 to 110001 at 800 g returned Surface ₹87.80 and Express ₹90.16. That figure is not a rate card.

## Notes Store

| Item | Status |
| --- | --- |
| Checkout, payment, order number, inventory | READY (already in production before this work) |
| Rate comparison | READY in code; production needs `DELHIVERY_API_TOKEN` and `NOTES_STORE_PICKUP_POSTCODE` |
| Packed size saved by staff | READY |
| Create shipment button | PARTIAL — refuses while billable writes are off |
| AWB, label, pickup | NOT BUILT as live courier calls |
| Customer Packed / Shipped / In Transit | READY |
| Tracking regression protection | READY |
| Customer problem report | READY for delivered orders; no photo upload; no reverse shipment |
| Refund request | PARTIAL — records `REFUND_PENDING` and does not call ICICI |
| Exception queue | PARTIAL — existing Problem filter on the order queue |

Mark shipped still requires a courier and AWB typed by staff. An AWB is not treated as shipped until the order status is pickup or in transit.

## Deployment

- Branch `cursor/notes-store-shipping-d465`
- Master before this Gmail continuation: `5eb1b3c`
- Feature flags: `notes_store_shiprocket` does not book a courier. `NOTES_STORE_SHIPPING_WRITES` and `NOTES_STORE_SHIPPING_WRITE_CONFIRM` stay unset.
- Production env names still required for live quotes: `DELHIVERY_API_TOKEN`, `NOTES_STORE_PICKUP_POSTCODE`. Later, an API-user email and password that are not the panel login, plus `SHIPROCKET_PICKUP_LOCATION` (`work`) and `DELHIVERY_PICKUP_LOCATION` once the warehouse name is known.

## Remaining blockers

1. An active Shiprocket API user on an academy mailbox that is not `namanstudycircle@gmail.com`.
2. Delhivery warehouse name.
3. Explicit authorization before any billable label or pickup.
