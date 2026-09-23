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
| Admin fulfilment code | READY — pack size, compare, and provider choice. Create shipment is refused on the server while writes are unset. Staff copy: “Live shipping is not enabled yet.” |
| Returns | READY as a workflow — approve, reject, replacement. Reverse pickup is refused while writes are unset. No photo upload. |
| Manual refunds | READY — request records `REFUND_PENDING` and does not say money moved. A later gateway reference can be recorded. ICICI is not called. |
| Security gates | READY — anonymous dispatch 403, courier webhook without the key 401, tracking cron without its secret 403. An order number alone does not return an address. |
| Action required | READY — Overview lists missing AWB, failed create, overdue pickup, stale tracking, delay, delivery failure, NDR, RTO, return waiting, and manual refund. No new tab. |

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
| Authenticated admin browser pass | Staff login is username and password against `admin_users`. No approved test password is in env, Vercel, or an existing browser session. The sign-in screen is open. Anonymous checks above still hold. |

## Deployment

Master is `07f8744daafd`. The running production build is `6e536164c320` because the later commit is the launch report only. `NOTES_STORE_SHIPPING_WRITES` and `NOTES_STORE_SHIPPING_WRITE_CONFIRM` stay unset. The remaining production action is an explicit authorization for the first real shipment.
