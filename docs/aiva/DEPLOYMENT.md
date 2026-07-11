# AIVA — Deployment Guide

AIVA ships as an **independent Next.js app** (`aiva/`) and an **independent Vercel project** (`namanias-aiva`), in the **same GitHub repository** as the portal, deployed to **`aiva.namanias.com`**. The portal stays exactly where it is (repo root, `namanias.com`) and is not restructured.

## Why separate

- **Reliability isolation:** AIVA failure (3D/AI bundles, heavier queries) cannot affect public pages, student/admin login, payments, callbacks, enrollments, quizzes, Class Hub, webinars, courses, or SMS.
- **Bundle isolation:** the public portal never imports Three.js / React Three Fiber / AIVA dashboards. AIVA never imports the heavy portal runtime — only the pure reconciliation/permission primitives (`DEPENDENCY_GRAPH.json`).
- **Deploy isolation:** separate env, domain, rollback, and health.

## One-time setup

1. **Apply the migration** (additive, safe): run `supabase/migrations/2026-07-11-aiva-foundation.sql` against the shared Supabase project (via Supabase SQL editor or your migration flow).
2. **Create the Vercel project** `namanias-aiva`:
   - Import the SAME GitHub repo.
   - Set **Root Directory = `aiva`**.
   - Framework preset **Next.js**, region **bom1**.
   - Add env vars from `docs/aiva/ENV.md`.
   - Set the **Ignored Build Step** (see ENV.md) so portal-only pushes don't rebuild AIVA.
3. **Add the domain** `aiva.namanias.com` to the `namanias-aiva` project and point DNS (CNAME → Vercel) — a subdomain, independent of the apex.
4. **Update the portal project** with its own Ignored Build Step (see ENV.md) so AIVA-only pushes don't rebuild the portal.

## First release posture

- Private, **Super-Admin-only**, **read-only**. All action-producing features are disabled behind flags.
- Low request volume (the CEO surface, refreshed on demand). No AIVA crons enabled.

## Local dev

```bash
cd aiva
npm install
cp .env.example .env.local   # fill Supabase + AIVA_JWT_SECRET
npm run dev                  # http://localhost:3100
```

The portal continues to run from the repo root (`npm run dev`) unaffected.

## Verify before deploy

From `aiva/`:

```bash
npm run typecheck   # tsc --noEmit
npm run test        # vitest (flags, events, mask, reconciliation contract)
npm run build       # next build
```

From the repo root, confirm the portal still builds:

```bash
npm run build
```

## Upgrading to Vercel Pro (enable heavier automation)

The first release is intentionally light. Before enabling frequent automation, bulk campaigns, or higher-frequency checks:

1. Activate **Vercel Pro** on the `namanias-aiva` project (higher function limits, more cron slots, longer execution).
2. Add AIVA crons in `aiva/vercel.json` (e.g. a daily brief snapshot, a codebase-intelligence sync, a durable-queue worker) and protect them with a `CRON_SECRET`.
3. Flip flags **one at a time**, in order, validating each with dry-runs/preview:
   `AIVA_WEBSITE_RECOMMENDATIONS_ENABLED` → `AIVA_LEARNING_ENABLED` → draft actions → `AIVA_AUTO_GREEN_ACTIONS_ENABLED` → `AIVA_CAMPAIGNS_ENABLED` (with kill switch) → `AIVA_INSTALLMENT_REMINDERS_ENABLED`.
4. Keep **Red actions** human-confirmed indefinitely.
5. Only then wire the durable queue + `agent-worker` (Ollama/OpenClaw) with HMAC-signed outbound results (`AIVA_LOCAL_WORKER_ENABLED`, `AIVA_OPENCLAW_ENABLED`).

See `docs/aiva/ROLLBACK.md` for rollback at every layer.
