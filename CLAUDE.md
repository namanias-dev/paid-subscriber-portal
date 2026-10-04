# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

The imported `AGENTS.md` has the non-negotiables and the Notes Store map, and it lists the `.cursor/rules/*.mdc` and `.cursor/skills/*` files. Those rules and skills apply to Claude too: read the matching skill before UI, feature, or Notes Store work.

## Commands

```bash
npm run dev                      # localhost:3000. With no env vars this runs in DEMO MODE
npx tsc --noEmit                 # typecheck (main static gate)
npm test                         # CI guards + every registered node:test suite
npm run build                    # run when routing, ISR, or config changes

# Single suite / single file (always pass both preloads)
node --import tsx --import ./scripts/_react-cache-shim.mjs --test tests/notes-store-orders/*.test.ts
node --import tsx --import ./scripts/_react-cache-shim.mjs --test tests/notes-store-orders/stages.test.ts

# CI guards (also run by npm test)
node scripts/ci/guard-store-domain-isolation.mjs
node scripts/ci/guard-amount-paid-money-math.mjs
```

- Tests use Node's built-in `node:test` runner with `tsx`. There is no Jest or Vitest. `scripts/_react-cache-shim.mjs` stubs `react.cache` so that test files can import `lib/dataProvider.ts` outside the React Server Components runtime.
- `npm test` runs an **explicit list** of test directories in `package.json`. A new `tests/<dir>/` does not run until you add it to that list. Some existing directories, such as `tests/entitlements`, are not in the list.
- No ESLint config is checked in, so `npm run lint` is not a reliable gate. Use `tsc` and the tests instead.
- Path alias: `@/` points to the repo root.

## Architecture

**Stack:** Next.js 14 App Router, TypeScript, Tailwind, Supabase (service role, server-side only), ICICI Eazypay for money (Razorpay is legacy), Resend, JWT sessions via `jose`. Deployed on Vercel in region `bom1`.

**Demo vs live mode:** `lib/config.ts` sets `isDemoMode = !NEXT_PUBLIC_SUPABASE_URL`. In demo mode the app runs on mock data with demo logins and simulated payments, and `middleware.ts` lets every request through. Integrations degrade gracefully when their env vars are missing, so a missing key should never crash the app. `.env.example` lists the variables.

**Data access:** `lib/dataProvider.ts` (about 8k lines) is the main switchboard between mock data and Supabase for the academy domain. Server code gets a DB client from `getSupabaseAdmin()`. The Notes Store does **not** use `dataProvider`. It keeps its own domain in `lib/store/**`, which has its own db, payments, orders, invoice, shipping, and flags (`notes_store` kill switch).

**Route groups and auth:**
- `app/(site)/`: public, ISR-first marketing site plus the Notes storefront at `/notes`. The layout must stay session-free. `PublicNav` hydrates auth on the client from `/api/session/state`.
- `app/dashboard/`: student portal (student JWT cookie, enforced in `middleware.ts`).
- `app/(site)/portal/`: buyer portal (buyer JWT cookie).
- `app/admin/`: staff admin. Gate API routes with `requirePermission()` / `requireAnyPermission()` from `lib/adminGuard.ts`. Permission keys are in `lib/permissions.ts`. Super Admins implicitly get every permission, including newly added keys.
- `app/api/`: route handlers. Cron endpoints live in `app/api/cron/*` and are scheduled in `vercel.json`.

**Two isolated money domains:**

| Domain | Tables | Reference prefixes | Terminal authority |
|--------|--------|------|-----|
| Academy | `payments`, enrollments | `NAMAN-` / `OFF-` / `LEGACY-` / `SAARTHI-` | course Verify + `lib/paymentOutcome/` |
| Notes Store | `store_*` only | `NIASN-N-` | `applyStoreVerify` in `lib/store/payments/verify.ts` |

Both domains share one Eazypay merchant and the return URL `app/api/v1/bank/payment/route.ts`. That route dispatches by reference prefix, and store changes to it must be additive only. The Eazypay callback is advisory: only Verify (including the cron at `/api/cron/notes-store-verify`) marks an order captured. The isolation guard fails CI if store code imports academy money paths or writes academy tables.

**Schema:** `supabase/schema.sql` is the base schema. `supabase/migrations/*.sql` are idempotent, dated files that the owner applies by hand in the Supabase SQL editor. No migration runner is wired up. Add schema changes as new dated migration files and keep them additive.

**Deploys:** `scripts/vercel-ignored-build.sh` skips Vercel builds when a diff touches only docs (`*.md`, `docs/**`). Exit 0 means skip. Do not invert this logic.

## Sensitive areas (inspect first, change rarely)

Auth and sessions, `payments` / fee-state / entitlements, lecture access and `LecturePlayer`, quiz gates, `lib/eazypay.ts`, Telegram event types, DLT SMS templates (`docs/sms-dlt-templates.md`; message bodies must match the registered templates), and `PublicNav` session hydration.

After meaningful Notes Store changes, update `docs/notes-store/CURRENT_STATE.md` and `handoff-state.json`.

## UI

Read `.cursor/skills/academy-design/SKILL.md` before UI work. Use the existing tokens (`--ca-navy-*`, `--ca-gold*`, `--ca-slate-*`, `--ink`, `--primary` in `app/globals.css` and `tailwind.config.ts`) and the existing primitives (`ca-*` classes, `container-wide`, `font-heading`, `CaPageHeader`, admin `PageHeader`). Fonts are Sora for headings and Inter for body text. Check layouts at 375, 390, and 430 px wide as well as desktop. Respect `prefers-reduced-motion`. Avoid purple SaaS gradients, glow effects, cards nested inside cards, fake urgency or social proof, and generic Shopify-style chrome.

## Production releases

See `docs/PRODUCTION_RELEASE.md`. For production feature tasks:

- Start from the exact live SHA (`curl https://www.namanias.com/api/version`), not `master`. Keep live functionality, and do not merge unrelated master-only work.
- Run `npm run release:check`, push, then `npm run release:smoke -- <preview url>`.
- Ship with `npm run release:prod -- <preview url>`. It promotes the tested preview, verifies the live SHA, routes and logs, and rolls back automatically on a critical regression.
- Stop for the user only for interactive logins (Vercel, Supabase, Cloudflare, GitHub) or a destructive migration.
- Automated QA never pays, books couriers, advances real orders, or writes R2. Production checks are read-only.
