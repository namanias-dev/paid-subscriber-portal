# Notes Store shipping status

Read-only courier quotes and tracking ingestion are in the app. Billable shipment creation is not.

## Already in the store before this work

Guest checkout, Eazypay, order numbers (`NIASN-N-`), inventory reservation, admin order queue, manual courier and AWB, customer tracking by phone plus access token.

## Added here

- Admin **Compare courier rates** on an order. Live Delhivery surface and express quotes when `DELHIVERY_API_TOKEN` and `NOTES_STORE_PICKUP_POSTCODE` are set. Shiprocket quotes use the external API and currently fail closed.
- Mark shipped still records a typed courier and AWB. It does not call Shiprocket or Delhivery.
- `POST /api/notes/courier/events` accepts tracking scans when `NOTES_STORE_COURIER_WEBHOOK_KEY` is set (`x-api-key`). Delivered does not move backwards. The path avoids the words Shiprocket forbids in a webhook URL.
- Customer tracking shows Packed, then Shipped, then In Transit. An AWB alone does not mean shipped.

## Verified without creating a shipment

- Delhivery production token: PIN `160017` is prepaid, COD, and pickup-capable. An 800 g prepaid quote from `160017` to `110001` returned Surface zone B at 8780 paise and Express zone B at 9016 paise. The charge API does not return an ETA. Staging rejected this token. Warehouse list URLs returned 404, so the Chandigarh warehouse id is not confirmed.
- Shiprocket external `POST /auth/login` on `apiv2.shiprocket.in` returned 403 Access forbidden for the panel email. That login is not an API user. The panel (`apiv2.shiprocket.co`) requires email OTP. No API user, pickup id, or wallet figure was read.
- No label, AWB, or pickup was created.

## Gmail OTP helper

`scripts/local/shipping-gmail-otp/` is a local read-only Gmail client (`gmail.readonly` only). It is not imported by the site. No Google OAuth client exists in this environment, so the helper is not authorized yet. Portal login is paused until that client is saved as `client_secret.json` and `auth_setup.py` completes.

## Not built

Shipment create, label, pickup, customer returns portal, refund execution, and courier SMS. Manual AWB remains the fulfilment path.
