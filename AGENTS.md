# Agent guide — Naman IAS Academy portal

This repository is the production Next.js application for **Naman Sharma IAS Academy** (public site, student/buyer portal, admin ops, Notes Store).

## Read first

| Resource | Why |
|----------|-----|
| `.cursor/rules/academy-core.mdc` | Business + architecture + sensitive areas |
| `.cursor/rules/academy-ui.mdc` | UI change discipline |
| `.cursor/rules/academy-production-safety.mdc` | Money/auth/DB safety |
| `.cursor/rules/academy-verification.mdc` | Done means verified |
| `.cursor/skills/academy-design/` | Design system + gold standards |
| `.cursor/skills/academy-feature-builder/` | How to build features |
| `.cursor/skills/academy-product-critic/` | Product critique before scope creep |
| `.cursor/skills/academy-release-check/` | Pre-ship checklist |
| `docs/notes-store-spec.md` | Notes Store source of truth |

## Non-negotiables

1. Do not break ISR by reading sessions in `app/(site)/layout.tsx`.
2. Do not merge Notes Store money into academy `payments` / entitlements.
3. Do not modify `lib/eazypay.ts` for store features — use `lib/store/payments/eazypay.ts`.
4. Do not invent COD, second gateways, or fake social proof.
5. Prefer fixing and composing existing code over speculative rewrites.

## Notes Store map

- Storefront: `app/(site)/notes/**`, `components/notes/**`
- Domain: `lib/store/**`
- APIs: `app/api/notes/**`, `app/api/admin/notes/**`, `app/api/cron/notes-store-verify`
- Callback shim: `app/api/v1/bank/payment/route.ts` (additive only)
- Schema: `supabase/migrations/2026-09-16-notes-store-*.sql`, `2026-09-17-notes-store-*.sql`

## Commands

```bash
npx tsc --noEmit
node scripts/ci/guard-store-domain-isolation.mjs
node --import tsx --import ./scripts/_react-cache-shim.mjs --test tests/notes-store-isolation/*.test.ts tests/notes-store-media/*.test.ts
```
