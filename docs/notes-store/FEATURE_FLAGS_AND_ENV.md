# Notes Store — feature flags and environment (names only)

**Never commit or paste secret values.** Document names, purpose, scope.

## Feature flags (`app_feature_flags`)

| Key | Purpose | Production default |
|-----|---------|-------------------|
| `notes_store` | Master kill switch | **off** |
| `notes_store_coupons` | Coupons | off |
| `notes_store_free_shipping` | Free shipping rules | off |
| `notes_store_reviews` | Reviews | off |
| `notes_store_shiprocket` | Legacy aggregator flag. It does **not** switch fulfilment onto Shiprocket. | off |
| `notes_store_sms` | DLT SMS send | off |
| `notes_store_qr_bonuses` | QR bonuses | off |
| `notes_store_preorders` | Preorders | off |
| `notes_store_bundles` | Storefront bundle merchandising (hero CTA, #bundles, cart bundle suggestion) | **off** — schema and admin remain |

`kill_switch=true` wins over `enabled` everywhere, including preview.

## Preview-only enable

| Name | Scope | Purpose |
|------|-------|---------|
| `NOTES_STORE_PREVIEW_ENABLE` | Vercel **preview** (and local) | Open storefront without flipping shared DB flag. **Ignored when `VERCEL_ENV=production`.** |

## Eazypay / money (shared Academy + store)

| Name | Purpose |
|------|---------|
| `ICICI_EAZYPAY_MERCHANT_ID` | Merchant |
| `ICICI_EAZYPAY_AES_KEY` | Encryption |
| `ICICI_EAZYPAY_RETURN_URL` | Registered return URL (shared) |
| `NOTES_STORE_SUBMERCHANT_ID` | Optional override (default code `"21"`) |

## Access token pepper

| Name | Purpose |
|------|---------|
| `STORE_ACCESS_TOKEN_PEPPER` | Pepper for token hash. Unset keeps the historical default so existing order links stay valid. Session `JWT_SECRET` is not used. |

## Supabase

| Name | Purpose |
|------|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Anon (browser) |
| `SUPABASE_SERVICE_ROLE_KEY` | Server only |

## Cron / internal

| Name | Purpose |
|------|---------|
| `CRON_SECRET` | Protect cron routes |

## R2 / media

| Name | Purpose |
|------|---------|
| `CLOUDFLARE_R2_*` | Object storage for product/sample media and teaching-video derivatives (`media/store/videos/`) |

## Courier quotes (read-only)

| Name | Purpose |
|------|---------|
| `NOTES_STORE_PICKUP_POSTCODE` | Chandigarh pickup PIN used for live quotes. 6 digits, no leading zero. |
| `SHIPROCKET_API_EMAIL` | Shiprocket API-user email. Must not be the panel login. `SHIPROCKET_EMAIL` is the fallback name. |
| `SHIPROCKET_API_PASSWORD` | Shiprocket API-user password. `SHIPROCKET_PASSWORD` is the fallback name. |
| `SHIPROCKET_PICKUP_LOCATION` | Pickup nickname sent as `pickup_location`. Verified nickname is `work`. Do not send the numeric id `117035417`. |
| `SHIPROCKET_API_BASE_URL` | Optional. Default `https://apiv2.shiprocket.in/v1/external`. |
| `DELHIVERY_API_TOKEN` | Delhivery One token. Sent as `Authorization: Token`. |
| `DELHIVERY_PICKUP_LOCATION` | Case-sensitive Facility Name for `pickup_location.name`. Verified value is `NAMAN SHARMA IAS ACADEMY`. |
| `DELHIVERY_API_BASE_URL` | Optional. Default `https://track.delhivery.com`. Staging host is `https://staging-express.delhivery.com` and uses a different token. |
| `NOTES_STORE_COURIER_WEBHOOK_KEY` | Shared secret for `POST /api/notes/courier/events`, checked against `x-api-key`. The path deliberately avoids the words Shiprocket forbids in a webhook URL. |
| `NOTES_STORE_SHIPPING_WRITES` | Must be `1` before any future billable call. No route creates a shipment today. |
| `NOTES_STORE_SHIPPING_WRITE_CONFIRM` | Must be `I_AUTHORIZE_BILLABLE_SHIPMENT` together with the writes flag. Leave unset. |

Do not commit values. Mark shipped still records a courier and AWB typed by staff.

## SMS / DLT

Academy SMS credentials apply when `notes_store_sms` eventually enabled — store must not send until DLT templates approved. See `docs/notes-store-dlt-templates.md`.

## Nav visibility

`PublicNav` fetches `/api/notes/status`. When store disabled, Notes link hidden/unavailable without touching session hydration in `(site)/layout`.

## Safe enable / disable

1. Keep production DB flag off until owner decision.  
2. Preview: set `NOTES_STORE_PREVIEW_ENABLE=1` on **preview** target only.  
3. Emergency: set `kill_switch=true` on `notes_store`.  
4. Never put preview enable on production target.
