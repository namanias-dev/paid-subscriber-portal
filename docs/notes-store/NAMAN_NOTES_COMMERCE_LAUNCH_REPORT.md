# Naman IAS Notes Store — commerce launch report

No secrets are included. No courier shipment, label, pickup, refund, or cancellation was created. No live payment was taken. Billable write flags stay unset.

## Shiprocket

| Item | Status |
| --- | --- |
| Shipping Gmail | PARTIAL — `namanias.shipping@gmail.com` exists. Opening the inbox still stops on Google's phone or QR check. Account creation was not restarted. |
| API user | READY — that address is the dedicated API user. The inactive API user was not changed. |
| API authentication | READY — external login succeeds. The token is not stored here. |
| Live rates | READY — `160017` to `110001`, 800 g prepaid, returned Delhivery Surface and Express plus five Shiprocket couriers. Prices are live integer paise and are not a rate card. |
| Webhook | READY — ENABLED, `x-api-key`, `https://www.namanias.com/api/notes/courier/events`. Missing key returns 401. Shiprocket's test call returned HTTP 200. |
| Shipment, AWB, label, pickup | PARTIAL — implemented and refused while the write gate is off. An AWB does not mark the order shipped. |
| Write gate | READY — `NOTES_STORE_SHIPPING_WRITES` and `NOTES_STORE_SHIPPING_WRITE_CONFIRM` are unset. |

## Delhivery

| Item | Status |
| --- | --- |
| API authentication | READY |
| Live rates | READY — Surface and Express, zone B, from the charge API. |
| Tracking mode | `DELHIVERY_TRACKING_MODE=API_RECONCILIATION` |
| Webhook | PARTIAL — the B2C developer document describes scan push, and it is not a self-service switch. Delhivery asks for a requirement form emailed to their last-mile integration team, then their tech team tests it. Launch does not wait on that. |
| Shipment, AWB, label, pickup | PARTIAL — gated. Facility name `NAMAN SHARMA IAS ACADEMY`, PIN `160017`. |
| Reverse | PARTIAL — Delhivery reverse pickup is gated. It was not called. |

Documented forward scans map as Manifested and Ready to Ship to manifested, Picked Up to picked up, In Transit to in transit, Dispatched and Out for Delivery to out for delivery, Delivered to delivered, Failed Delivery and NDR to delivery failed, RTO to rto, and Lost to lost. Delivered does not move backwards. The two-hour cron skips terminal shipments and a fresh webhook, and one provider error does not stop the next shipment.

## Admin

| Item | Status |
| --- | --- |
| Browser | BLOCKED — `/admin/notes` is the staff sign-in page. No staff password is available here, so Compare was not clicked in the browser. Anonymous dispatch returns 403. |
| Rate comparison | READY in code and in a live read-only compare. The write gate stayed closed. |
| Provider selection | READY — the chosen quote is what Create shipment would send. |
| Shipping gate | READY — the order screen says create shipment stays off until a live test is authorized. |
| Label and pickup | PARTIAL — present, and refused until the write gate is on. |
| Returns | PARTIAL — approve, reject, replacement, and gated reverse pickup. No photo upload. |
| Refunds | PARTIAL — request records `REFUND_PENDING` and says refund pending manual payment-gateway processing. A gateway reference can be recorded afterward. ICICI is not called. |
| Action required | READY — Overview lists AWB missing, failed create, pickup overdue, stale tracking, delayed delivery, delivery failed, NDR, RTO, return awaiting action, and refund awaiting manual gateway processing. No new tab. |

## Customer

| Item | Status |
| --- | --- |
| Checkout | READY — Indian Polity reached checkout for PIN `110001`. Pay was not clicked. The cart was cleared. |
| Tracking | READY — Packed until a carrier possession scan. |
| Support | PARTIAL — reason list exists. No photos. |

## Deployment

Master and production are `6e536164c320`. Shipping tests, the isolation guard, and `tsc` passed. `next lint` is not configured in this repo and was not given a new config. Write flags stay unset. The first real payment and the first real shipment are still waiting for an explicit authorization.
