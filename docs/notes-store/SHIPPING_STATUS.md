# Notes Store shipping status

Courier quotes and tracking ingestion are in the app. Create, label, pickup, cancel, and Delhivery reverse exist behind the billable write gate. That gate is unset, so those calls are not made.

## Already in the store before this work

Guest checkout, Eazypay, order numbers (`NIASN-N-`), inventory reservation, admin order queue, manual courier and AWB, customer tracking by phone plus access token.

## Added here

- Admin **Compare courier rates** on an order. Live Delhivery and Shiprocket quotes when the API credentials and `NOTES_STORE_PICKUP_POSTCODE` are set.
- Mark shipped still records a typed courier and AWB. It does not call Shiprocket or Delhivery.
- `POST /api/notes/courier/events` accepts tracking scans when `NOTES_STORE_COURIER_WEBHOOK_KEY` is set (`x-api-key`). Delivered does not move backwards. The path avoids the words Shiprocket forbids in a webhook URL.
- Customer tracking shows Packed, then Shipped, then In Transit. An AWB alone does not mean shipped.

## Verified without creating a shipment

- Delhivery production token: PIN `160017` is prepaid, COD, and pickup-capable. An 800 g prepaid quote from `160017` to `110001` returned Surface zone B at 8780 paise and Express zone B at 9016 paise. The charge API does not return an ETA. Staging rejected this token. Delhivery One shows one active pickup location whose Facility Name is `NAMAN SHARMA IAS ACADEMY`. Order creation must send that exact string as `pickup_location.name`.
- Shiprocket external login with the panel email returns 403. The API user is `namanias.shipping@gmail.com`, status ACTIVE. Read-only login and serviceability from `160017` to `110001` at 800 g prepaid succeeded. The inactive API user was left inactive.
- The panel pickup nickname is `work`, PIN `160017`. The panel webhook connection is ENABLED on `POST /api/notes/courier/events` with `x-api-key`. No label, AWB, or pickup was created.
- Open shipments are reconciled by `GET /api/cron/notes-store-tracking` (`CRON_SECRET`, every two hours). Delivered, cancelled, lost, and damaged shipments are not polled. A recent webhook suppresses the next read. Delhivery's B2C developer document describes scan-push webhooks, and enabling one requires a form emailed to Delhivery rather than a switch in the warehouse screen. Until that is enabled, Delhivery tracking mode is API reconciliation.

## Gmail OTP helper

`scripts/local/shipping-gmail-otp/` is a local read-only Gmail client (`gmail.readonly` only). It is not imported by the site. The Desktop client and token stay in gitignored files on the machine that runs the helper. They are not deployed.

## Gated, not live

Create shipment, AWB assignment, label, pickup, cancellation, and Delhivery reverse pickup are implemented and refused unless both write flags are set. A created AWB moves the order to ready for pickup. It does not mark it shipped. Customer reports can be approved, rejected, or recorded as a replacement without moving money. A refund request sets `REFUND_PENDING` and does not call ICICI. Repeating it does not write a second event. The store gateway client has no refund URL.

## Not built

Photo evidence on returns, a Shiprocket reverse call, refund execution, and courier SMS. Manual AWB remains the emergency override.
