# Naman Sharma IAS Academy — Subscriber Portal

A mobile-first, premium UPSC subscriber portal. **Deploys to Vercel with zero
configuration** and runs in a fully-featured **Demo Mode** until you add real keys.

- **Frontend:** Next.js 14 (App Router) + TypeScript + Tailwind CSS
- **Backend:** Next.js API Routes (all secrets server-side)
- **Database:** Supabase (Postgres + RLS) — with automatic mock fallback
- **Auth:** custom phone + access-code login (no SMS), bcrypt admin, JWT cookies
- **Payments:** Razorpay Payment Links + idempotent webhook — with demo fallback
- **Email:** Resend (optional) · **Delivery:** WhatsApp `wa.me` deep links
- **Storage:** Google Drive (PDFs) + YouTube unlisted (videos) as URLs — no uploads

---

## 🚀 Deploy in 60 seconds

1. Push this repo to GitHub.
2. Go to [vercel.com/new](https://vercel.com/new) → **Import** the repo.
3. Click **Deploy**. That's it — **no environment variables needed**.

The site goes live instantly in **Demo Mode**: a working landing page, a
demo-login-able dashboard, and a demo admin panel — all on mock data.

### Demo credentials

| Role    | Login                                   |
| ------- | --------------------------------------- |
| Student | Phone `9999999999` · Code `NS-0000-DEMO` |
| Admin   | `namanadmin` / `NamanAdmin2025` (at `/admin`) |

---

## 🌐 Going live (add keys, no code changes)

The moment `NEXT_PUBLIC_SUPABASE_URL` is set, the app **automatically** switches
from mock data to Supabase/Razorpay/Resend. Each service degrades gracefully on
its own (e.g. no Razorpay key → demo payment toast; no Resend key → email skipped).

1. **Supabase**
   - Create a project at [supabase.com](https://supabase.com).
   - In the SQL editor, run `supabase/schema.sql`, then `supabase/seed.sql`.
   - Copy `Project URL`, `anon` key, and `service_role` key into Vercel env vars:
     - `NEXT_PUBLIC_SUPABASE_URL`
     - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
     - `SUPABASE_SERVICE_ROLE_KEY`

2. **Razorpay**
   - Create **5 Payment Links** (one per plan) and paste them into:
     - `NEXT_PUBLIC_RAZORPAY_LINK_1M` … `NEXT_PUBLIC_RAZORPAY_LINK_LIFETIME`
   - When creating links, add `notes`: `plan` (`1m`/`3m`/`6m`/`12m`/`lifetime`),
     `name`, `phone`, `email` so the webhook can provision access automatically.
   - Add `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`.
   - Set the webhook URL to `https://YOURDOMAIN/api/webhook/razorpay`
     (event: `payment.captured`).

3. **Resend (optional)** — add `RESEND_API_KEY` for automatic welcome emails.

4. **Secrets** — set strong random values for:
   - `JWT_SECRET`, `ADMIN_JWT_SECRET`, `CRON_SECRET`

5. **Redeploy.** The app is now live. 🎉

### Content delivery (frugal, zero storage cost)

- **PDFs** → upload to **Google Drive**, set _Anyone with the link = Viewer_, paste
  the link in **Admin → Content** (`drive_link`).
- **Videos** → upload to **YouTube as Unlisted**, paste the link (`youtube_link`).

### Free keep-alive (stop Supabase free tier from pausing)

A Vercel cron is preconfigured in `vercel.json` to hit `/api/cron/ping` daily.
If the Vercel Hobby plan limits crons, use the free
[cron-job.org](https://cron-job.org) instead:

```
GET https://YOURDOMAIN/api/cron/ping?secret=YOUR_CRON_SECRET   (daily)
```

---

## 🧑‍💻 Local development

```bash
npm install
npm run dev        # runs in Demo Mode with an empty .env.local
```

Copy `.env.example` to `.env.local` and fill in keys only when you want live mode.

```bash
npm run build      # production build (succeeds with zero env vars)
npm start
```

---

## 📁 Project structure

```
app/                     Routes (landing, dashboard, admin) + API routes
components/ui            Buttons, cards, modal, toast, pills, skeletons
components/layout        Navbars, footer, bottom nav, demo banner
components/dashboard     Welcome bar, content cards, renew modal, context
components/admin         Stats, add-student, students table, content manager
lib/                     config, mockData, dataProvider (mock↔live switch),
                         supabase, auth, razorpay, codeGenerator, whatsapp,
                         email, dates, session, types
supabase/                schema.sql + seed.sql
middleware.ts            Route protection (allows everything in demo mode)
```

`lib/dataProvider.ts` is the single switchboard every API route uses — it routes
to mock data in demo mode and to Supabase in live mode, which is what makes the
demo → live transition automatic.

---

## 💳 Plans

| Plan     | Price   | Duration | Note         |
| -------- | ------- | -------- | ------------ |
| 1 Month  | ₹299    | 30 days  |              |
| 3 Months | ₹799    | 90 days  | Most Popular |
| 6 Months | ₹1,499  | 180 days | Best Value   |
| 12 Months| ₹2,499  | 365 days |              |
| Lifetime | ₹3,999  | ∞        | Gold         |

---

## 🔒 Security notes

- Service role key, Razorpay secret, and JWT secrets are used **only** inside
  `/api` routes — never imported into client components.
- In demo mode, `JWT_SECRET` / `ADMIN_JWT_SECRET` fall back to dev strings.
  **Always set strong, unique secrets in production.**
-   Supabase RLS keeps the public anon key restricted to published content only.
