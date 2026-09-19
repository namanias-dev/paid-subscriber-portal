# Notes Store — implementation manifest

Exhaustive paths from Git (handoff era). Prefer `git ls-files` to refresh.

## Specs / docs

- `docs/notes-store-spec.md`
- `docs/notes-store-dlt-templates.md`
- `docs/notes-store/**` (this handoff set)
- `AGENTS.md`

## Cursor

- `.cursor/rules/academy-*.mdc`
- `.cursor/rules/notes-store.mdc`
- `.cursor/skills/academy-design/**`
- `.cursor/skills/academy-feature-builder/SKILL.md`
- `.cursor/skills/academy-product-critic/SKILL.md`
- `.cursor/skills/academy-release-check/SKILL.md`
- `.cursor/skills/notes-store/SKILL.md`

## Public pages / layouts

- `app/(site)/notes/layout.tsx`
- `app/(site)/notes/page.tsx`
- `app/(site)/notes/[subject]/page.tsx`
- `app/(site)/notes/products/[slug]/page.tsx`
- `app/(site)/notes/cart/page.tsx`
- `app/(site)/notes/checkout/page.tsx`
- `app/(site)/notes/order/[orderNumber]/page.tsx`
- `app/(site)/notes/track/page.tsx`

## Admin pages

- `app/admin/notes/page.tsx`
- `app/admin/notes/products/page.tsx`
- `app/admin/notes/pick-list/page.tsx`

## APIs

- `app/api/notes/status/route.ts`
- `app/api/notes/cart/route.ts`
- `app/api/notes/checkout/route.ts`
- `app/api/notes/pin/route.ts`
- `app/api/notes/sample/[id]/route.ts`
- `app/api/notes/track/route.ts`
- `app/api/notes/order/[orderNumber]/verify/route.ts`
- `app/api/admin/notes/orders/route.ts`
- `app/api/admin/notes/orders/[id]/advance/route.ts`
- `app/api/admin/notes/orders/[id]/ship/route.ts`
- `app/api/admin/notes/products/route.ts`
- `app/api/cron/notes-store-verify/route.ts`

## Components

- `components/notes/*.tsx`
- `components/notes/admin/*.tsx`

## Store libraries

- `lib/store/**` (db, flags, http, catalogue, cart, checkout, quote, orders, accessToken, inventory, serviceability, projection, money, productPrice, references, rateLimit, alerts, media/watermark, payments/*)

## Database migrations

- `supabase/migrations/2026-09-16-notes-store-1a-item-type-constraint.sql`
- `supabase/migrations/2026-09-16-notes-store-1a-schema.sql`
- `supabase/migrations/2026-09-17-notes-store-1b-grants-and-categories.sql`
- `supabase/migrations/2026-09-17-notes-store-1b-inventory.sql`
- `supabase/migrations/2026-09-17-notes-store-1c-verify-fixtures.sql`
- `supabase/migrations/2026-09-19-notes-store-tracking-token-hash.sql`

## Tests

- `tests/notes-store-isolation/*.test.ts`
- `tests/notes-store-media/*.test.ts`

## Scripts

- `scripts/ci/guard-store-domain-isolation.mjs`
- `scripts/notes-store-isolation-check.ts`
- `scripts/notes-preview-smoke.mjs`
- `scripts/store/build-watermark-tile.mjs`

## Shared Academy files modified for integration

| File | Why touched | Store behavior | Regression risk | Verification |
|------|-------------|----------------|-----------------|--------------|
| `app/api/v1/bank/payment/route.ts` | Shared return URL | Additive `maybeDispatchNotesStoreCallback` | Course payments mis-routed | callback-shim tests |
| `components/public/PublicNav.tsx` | Notes discoverability | Fetch `/api/notes/status`; no layout session read | ISR/nav break | manual + status API |
| `next.config.js` | Cache/referrer/robots for store paths | no-store + no-referrer on order/track | Headers only | inspect headers |
| `vercel.json` | Cron | `notes-store-verify` `*/15` | Cron budget | dashboard |
| `components/admin/adminNav.ts` | Admin IA | Notes admin links | Nav clutter | admin load |
| `lib/permissions.ts` | RBAC keys | store permissions | Over/under privilege | code review |
| `package.json` | test script includes store suites | CI surface | test time | npm test subset |
| `app/globals.css` | Token aliases if present | navy/gold continuity | visual | design skill |

## Do not touch casually

`lib/eazypay.ts`, course Verify cron, course status poll, fee-state, entitlements, lecture player, quiz gates, Academy `payments` writers.
