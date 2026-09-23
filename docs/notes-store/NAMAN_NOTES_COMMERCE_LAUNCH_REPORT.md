# Naman IAS Notes Store — commerce launch report

No secrets are included. No courier shipment, label, pickup, refund, or cancellation was created. No live payment was taken.

`SHIPPING_GMAIL_DEVICE_VERIFICATION_DEFERRED`

`DELHIVERY_TRACKING_MODE=API_RECONCILIATION`

## Ready

| Item | Status |
| --- | --- |
| Storefront and checkout | READY — Indian Polity reached checkout for PIN `110001`. Pay was not clicked. |
| Orders and inventory | READY |
| Shiprocket API and rates | READY — API user active. Live compare from `160017` to `110001` at 800 g prepaid returned five couriers. |
| Delhivery API and rates | READY — Surface and Express. Pickup name `NAMAN SHARMA IAS ACADEMY`. |
| Carrier comparison | READY — live integer paise. Not stored as a rate card. |
| Shiprocket webhook | READY — ENABLED, `x-api-key`, missing key returns 401. Provider test returned HTTP 200. |
| Tracking reconciliation | READY — every two hours, open shipments only, fresh webhooks skipped, one provider error does not stop the next. |
| Admin fulfilment code | READY — signed-in staff session on production. Orders list, filters, and catalogue load. There are no store orders yet, so Compare was not clicked on a real order. Create shipment and pickup, called with that session, return 409 “Live shipping is not enabled yet” before any order is read. |
| Returns | READY as a workflow — approve, reject, replacement. Reverse pickup is refused while writes are unset. No photo upload. |
| Manual refunds | READY — request records `REFUND_PENDING` and does not say money moved. A later gateway reference can be recorded. ICICI is not called. |
| Security gates | READY — anonymous dispatch 403, courier webhook without the key 401, tracking cron without its secret 403. An order number alone does not return an address. |
| Action required | READY — signed-in Overview shows the section and “Nothing is waiting on a courier, return, or refund.” Counts are zero. No new tab. Desktop, laptop, tablet, and mobile widths did not overflow. |

## Ready, not live-executed

| Item | Status |
| --- | --- |
| Provider shipment, AWB, label, pickup | READY BUT NOT LIVE-EXECUTED — code and tests exist. Both write flags stay unset. |
| Reverse pickup | READY BUT NOT LIVE-EXECUTED — Delhivery only, same write gate. |

## Deferred, not a launch blocker

| Item | Status |
| --- | --- |
| Shipping Gmail | `namanias.shipping@gmail.com` exists and is the Shiprocket API identity. Interactive inbox device verification is deferred. Production shipping does not read that inbox. |
| Delhivery push webhook | OPTIONAL ENHANCEMENT. Delhivery can push scans after their integration team onboards and tests the endpoint. Production tracking uses API reconciliation. |
| Return, refund, and compare clicks | There is no production order to open. Those buttons were not clicked, and no paid order was invented. A refund call for a missing order returns 404 and does not say money moved. |

## Deployment

Production build is `eab13e6ccd50`. `NOTES_STORE_SHIPPING_WRITES` and `NOTES_STORE_SHIPPING_WRITE_CONFIRM` stay unset. The remaining production action is an explicit authorization for the first real shipment.
