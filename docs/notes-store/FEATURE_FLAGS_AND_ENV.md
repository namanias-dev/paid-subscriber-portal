# Notes Store — feature flags and environment (names only)

**Never commit or paste secret values.** Document names, purpose, scope.

## Feature flags (`app_feature_flags`)

| Key | Purpose | Production default |
|-----|---------|-------------------|
| `notes_store` | Master kill switch | **off** |
| `notes_store_coupons` | Coupons | off |
| `notes_store_free_shipping` | Free shipping rules | off |
| `notes_store_reviews` | Reviews | off |
| `notes_store_shiprocket` | Aggregator | off |
| `notes_store_sms` | DLT SMS send | off |
| `notes_store_qr_bonuses` | QR bonuses | off |
| `notes_store_preorders` | Preorders | off |

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
| `STORE_ACCESS_TOKEN_PEPPER` | Preferred pepper for token hash |
| `JWT_SECRET` | Fallback pepper if store pepper unset |

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
| `CLOUDFLARE_R2_*` | Object storage for product/sample media |

## SMS / DLT

Academy SMS credentials apply when `notes_store_sms` eventually enabled — store must not send until DLT templates approved. See `docs/notes-store-dlt-templates.md`.

## Nav visibility

`PublicNav` fetches `/api/notes/status`. When store disabled, Notes link hidden/unavailable without touching session hydration in `(site)/layout`.

## Safe enable / disable

1. Keep production DB flag off until owner decision.  
2. Preview: set `NOTES_STORE_PREVIEW_ENABLE=1` on **preview** target only.  
3. Emergency: set `kill_switch=true` on `notes_store`.  
4. Never put preview enable on production target.
