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
| `docs/notes-store-spec.md` | Notes Store **product** requirements (canonical) |
| `docs/notes-store/README.md` | Notes Store **implementation** handoff index |
| `docs/notes-store/CURRENT_STATE.md` | What is built / deferred / unverified |
| `docs/notes-store/DECISION_LOG.md` | Accepted architecture decisions |
| `.cursor/skills/notes-store/SKILL.md` | How to change the store safely |
| `.cursor/rules/notes-store.mdc` | Path-scoped store hard rules |

## Non-negotiables

1. Do not break ISR by reading sessions in `app/(site)/layout.tsx`.
2. Do not merge Notes Store money into academy `payments` / entitlements.
3. Do not modify `lib/eazypay.ts` for store features — use `lib/store/payments/eazypay.ts`.
4. Do not invent COD, second gateways, or fake social proof.
5. Prefer fixing and composing existing code over speculative rewrites.
6. Before editing Notes Store code: read `docs/notes-store/README.md`, `CURRENT_STATE.md`, `DECISION_LOG.md`, the notes-store skill, and the relevant architecture/security/payment doc.
7. Production `notes_store` stays disabled unless the owner explicitly enables it. Real Eazypay validation is **deferred_by_owner** until they run it — do not claim it passed.

## Notes Store map

- Storefront: `app/(site)/notes/**`, `components/notes/**`
- Domain: `lib/store/**`
- APIs: `app/api/notes/**`, `app/api/admin/notes/**`, `app/api/cron/notes-store-verify`
- Callback shim: `app/api/v1/bank/payment/route.ts` (additive only)
- Schema: `supabase/migrations/2026-09-16-notes-store-*.sql`, `2026-09-17-notes-store-*.sql`, `2026-09-19-notes-store-tracking-token-hash.sql`
- Order confirmation: `/notes/order/[orderNumber]` authorised by httpOnly cookie (set at checkout) or optional `?t=` — only `tracking_token_hash` is stored; `order_no` alone must not load or Verify; phone+order via `/notes/track` mints a fresh token
- Isolation dirs (CI): `lib/store`, `app/(site)/notes`, `app/api/notes`, `app/admin/notes`, `app/api/admin/notes`, `app/api/cron/notes-store-verify`, `components/notes`
- Handoff tag: `notes-store-handoff-2026-09-19` on branch `notes-store-release-hardening`

## Commands

```bash
npx tsc --noEmit
node scripts/ci/guard-store-domain-isolation.mjs
node --import tsx --import ./scripts/_react-cache-shim.mjs --test tests/notes-store-isolation/*.test.ts tests/notes-store-media/*.test.ts
```
