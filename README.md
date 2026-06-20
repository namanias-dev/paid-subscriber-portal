# Naman Sharma IAS Academy — UPSC Edtech Platform

A complete, **deploy-on-Vercel** UPSC platform: a world-class public website, a student learning portal, and a full **LMS + CRM admin** — built mobile-first with an Apple-inspired light UI.

**Zero-config:** with **no environment variables**, it builds and runs in **DEMO MODE** (rich mock data, demo logins, simulated payments). Add keys in Vercel to go LIVE on Supabase + Razorpay + Resend — no code changes.

---

## ✨ What's inside

### Public website (light, animated)
`/` Home · `/courses` · `/courses/[slug]` · `/about` · `/results` · `/free-resources` · `/webinars` · `/webinars/[slug]` · `/demo` · `/contact` · `/login` · `/enroll/[slug]`

- Animated hero (word-by-word headline, floating cards, parallax Ashoka Chakra), counter stats
- Scroll-reveal sections, course explorer with category filters & 3D-tilt cards, results wall, testimonials carousel, FAQ accordion, map, lead capture
- Comprehensive course detail pages (overview, curriculum, schedule, faculty, what's included, fees & EMI, FAQ, comparison)
- Framer Motion animations, `prefers-reduced-motion` respected, smooth page transitions

### Student portal (`/dashboard`)
Sidebar + bottom-nav, light theme. My Courses · Daily Feed (CA/MCQ) · Live Classes · Test Series · Study Material · Mentorship · Bookmarks · My Fees · Profile. Streak 🔥 + days-to-Prelims 🗓️ widgets, locked/empty states, skeletons, toasts.

### Admin platform (`/admin`) — full LMS + CRM
Sidebar dashboard with 14 modules:
Dashboard (KPIs + charts) · Lead CRM (Kanban + table, filters, WhatsApp, notes, CSV export) · Lead Forms Builder · Landing Pages · Marketing/Broadcast · Referrals · Course Manager (full CRUD → auto-generates public pages) · Webinars & Events · Content/LMS · Subscription Plans · Students & Enrollments (fee ledger, access codes) · Payments & Finance · Staff & Roles · Settings.

---

## 🚀 Quick start

```bash
npm install
npm run dev      # http://localhost:3000  (DEMO MODE, no env needed)
```

### Demo credentials (DEMO MODE)
- **Student** — phone `9999999999`, access code `NS-0000-DEMO`
- **Admin** — username `demoadmin`, password `DemoAdmin2025`

> These come from `DEMO_STUDENT_PHONE`, `DEMO_STUDENT_ACCESS_CODE`, `DEMO_ADMIN_USERNAME`, `DEMO_ADMIN_PASSWORD` in `.env.example` (non-sensitive placeholders). Change them anytime. They have **no effect in LIVE mode**.

---

## 🌐 Deploy to Vercel (first try)

1. Push to GitHub and **Import** the repo in Vercel.
2. Deploy with **no env vars** → live demo immediately.
3. To go LIVE, add env vars (see `.env.example`) in Vercel → Settings → Environment Variables, then redeploy.

The app never crashes on missing env vars — every integration degrades gracefully.

---

## 🔌 Going LIVE

1. **Database** — create a Supabase project, run `supabase/schema.sql` then `supabase/seed.sql` in the SQL editor.
2. Set `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (presence of the URL flips the app to LIVE mode).
3. Set strong `JWT_SECRET` and `ADMIN_JWT_SECRET`.
4. **Payments (Razorpay)** — add `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, and per-plan `NEXT_PUBLIC_RAZORPAY_LINK_*`.
5. **Payments (ICICI Eazypay)** — courses, plans and paid webinars route through Eazypay. Set the **backend-only** `ICICI_EAZYPAY_AES_KEY` (never `NEXT_PUBLIC_`, never committed), plus `ICICI_EAZYPAY_MERCHANT_ID` and `ICICI_EAZYPAY_RETURN_URL` (must point to `/api/v1/bank/payment` on your domain, e.g. `https://namanias.vercel.app/api/v1/bank/payment`). Flow: student form → `POST /api/v1/bank/create-payment` (returns encrypted Eazypay URL) → pay → Eazypay posts back to the return URL → **SHA-512 signature verified server-side** → marked PAID/FAILED → redirect to `/payment/status`. The outcome is verified purely from ICICI's response + the AES key (the callback signs the result with an HMAC for the status page), so payments work **statelessly even with no database** — Supabase is only needed to persist the payment in the admin ledger. Without the AES key, payments are **simulated** (demo) so the app still builds/runs with zero env.
6. **Email** (optional) — add `RESEND_API_KEY`.
7. In LIVE mode the seeded admin login is `namanadmin` / `NamanAdmin2025` (bcrypt hash in `seed.sql` — change it).

---

## 🧱 Tech stack

Next.js 14 (App Router) · TypeScript · Tailwind CSS · Framer Motion · Recharts · Supabase (Postgres + RLS) · Razorpay · Resend · JWT (`jose`) · bcrypt.

## 📁 Structure

```
app/
  (site)/        Public website (nav + footer + page transitions)
  dashboard/     Student portal (sidebar + bottom nav)
  admin/         Admin LMS + CRM (sidebar shell, 14 modules)
  api/           Route handlers (auth, student, admin, public, webhook, cron)
components/      ui · public · dashboard · admin · layout
lib/             config · types · dataProvider · mockData · auth · dates ...
supabase/        schema.sql · seed.sql
```

`lib/dataProvider.ts` is the single switchboard: it reads/writes **mock data in demo mode** and **Supabase in live mode**, automatically.

## 🎨 Design system

Light theme — white canvas, royal-blue `#0057FF` accent, charcoal text, sparing saffron/green India motifs. Sora (headings) + Inter (body). Soft shadows, rounded-2xl cards, frosted navbars, 150–250ms micro-interactions, AAA contrast, mobile-first.
