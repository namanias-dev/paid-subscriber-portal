# Naman IAS Notes Store — commerce launch report

No secrets are included.

## Gmail

| Item | Status |
| --- | --- |
| OAuth configured | BLOCKED |
| Read-only scope in the helper | READY |
| Helper tested | READY (parser only) |
| Inbox untouched | READY |
| Provider sender checks | READY in code, not verified against a live mailbox |

Google Cloud Console is open on the agent desktop at the Google sign-in page. There is no existing OAuth client on this machine. The helper at `scripts/local/shipping-gmail-otp/` is gitignored for `client_secret.json` and `token.json`. It was not authorized, and it has not read any mail.

## Shiprocket

| Item | Status |
| --- | --- |
| Portal access | BLOCKED (email OTP; not retried) |
| API authentication | BLOCKED (panel email returns 403 on the external API) |
| Pickup location | BLOCKED |
| Live rates | BLOCKED |
| Shipment / label / pickup code | NOT BUILT as a live call |
| Tracking webhook | PARTIAL (receiver exists; panel webhook not set) |

## Delhivery

| Item | Status |
| --- | --- |
| API authentication | READY for read-only PIN and charge quotes |
| Pickup warehouse id | BLOCKED (list endpoints returned 404) |
| Live rates | READY as a quote, not a booked shipment |
| Shipment / label / pickup call | NOT BUILT |
| Tracking webhook | PARTIAL |

One read-only quote from PIN 160017 to 110001 at 800 g returned Surface ₹87.80 and Express ₹90.16. That figure is not a rate card.

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
- Pull request https://github.com/namanias-dev/paid-subscriber-portal/pull/110
- Previous production commit on master: `59317e7` before this continuation
- Feature flags: `notes_store_shiprocket` does not book a courier. `NOTES_STORE_SHIPPING_WRITES` and `NOTES_STORE_SHIPPING_WRITE_CONFIRM` stay unset.

## Remaining blockers

1. Google sign-in on the agent desktop, then the Desktop OAuth client, then one Shiprocket login.
2. A Shiprocket API user. The panel email is not one.
3. Delhivery warehouse name.
4. Explicit authorization before any billable label or pickup.
