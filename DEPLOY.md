# Deployment Guide

This app is designed to deploy on **Vercel on the first try with zero configuration**, then go LIVE by adding environment variables — no code changes.

## 1. Deploy the demo (zero env)

1. Push this repo to GitHub.
2. In Vercel, **Add New → Project → Import** the repo.
3. Framework preset: **Next.js** (auto-detected). Leave everything default.
4. **Deploy.** With no env vars the site runs in **DEMO MODE** — full mock data, demo logins, simulated payments.

Demo logins:
- Student: phone `9999999999`, code `NS-0000-DEMO`
- Admin: `demoadmin` / `DemoAdmin2025`

## 2. Set up the database (to go LIVE)

1. Create a project at [supabase.com](https://supabase.com).
2. SQL Editor → run **`supabase/schema.sql`**, then **`supabase/seed.sql`**.
3. Project Settings → API → copy the **Project URL**, **anon key**, and **service_role key**.

## 3. Add environment variables in Vercel

Settings → Environment Variables (Production + Preview). All optional individually; add what you need.

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | **Flips app to LIVE mode** |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-side DB access |
| `JWT_SECRET` / `ADMIN_JWT_SECRET` | Strong random session secrets |
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` / `RAZORPAY_WEBHOOK_SECRET` | Payments (Razorpay) |
| `NEXT_PUBLIC_RAZORPAY_LINK_1M…LIFETIME` | Per-plan Razorpay payment links |
| `ICICI_EAZYPAY_AES_KEY` | **Backend-only** AES key for Eazypay (never `NEXT_PUBLIC_`, never commit). Absent ⇒ simulated demo payments |
| `ICICI_EAZYPAY_MERCHANT_ID` | Eazypay merchant id (default `343526`) |
| `ICICI_EAZYPAY_RETURN_URL` | Must point to `https://<your-domain>/api/v1/bank/payment` |
| `ICICI_EAZYPAY_SUBMERCHANT_MAP` | Optional JSON map of item → SubMerchantID (fallback `11`) |
| `RESEND_API_KEY` | Transactional email (optional) |
| `NEXT_PUBLIC_PORTAL_URL` | Used in WhatsApp messages |
| `CRON_SECRET` | Protects the keep-alive cron endpoint |
| `SUPPORT_PHONE` / `SUPPORT_EMAIL` | Public contact details |
| `DEMO_*` | Demo-only credentials (ignored in LIVE mode) |

Redeploy after saving. The presence of `NEXT_PUBLIC_SUPABASE_URL` switches the app from demo to live.

## 4. Razorpay webhook

Point a Razorpay webhook at `https://<your-domain>/api/webhook/razorpay` and set the secret to `RAZORPAY_WEBHOOK_SECRET`.

## 4b. ICICI Eazypay return URL

In the Eazypay merchant dashboard set the **return/response URL** to `https://<your-domain>/api/v1/bank/payment` (e.g. `https://namanias.vercel.app/api/v1/bank/payment`). Configure `ICICI_EAZYPAY_RETURN_URL` to the same value. The backend AES-encrypts each request parameter and verifies the SHA-512 `RS` signature on the response before marking a payment `PAID`.

Because Vercel functions are stateless (the callback can hit a different instance than the one that created the payment), the verified callback signs the final result with an HMAC and hands it to `/payment/status`, which re-verifies it — so the success/failure outcome is reliable **without a database**. Configure **Supabase** if you also want each payment persisted in the admin Payments ledger. Keep `ICICI_EAZYPAY_AES_KEY` server-side only.

## 5. Cron / keep-alive

`vercel.json` schedules `/api/cron/ping`. Set `CRON_SECRET` to protect it.

## Safety notes

- Never commit real secrets — use Vercel env vars.
- Rotate `JWT_SECRET`, `ADMIN_JWT_SECRET`, and the seeded admin password before going live.
- All API routes return JSON and never leak server-only secrets to the client.
