---
name: notes-store
description: >-
  Build and change the Naman IAS Notes Store safely: isolation, Eazypay, guest
  checkout, admin fulfilment, and handoff docs. Use for any store_* /notes work.
---

# Notes Store skill

## Required reading order

1. `docs/notes-store/README.md`
2. `docs/notes-store/CURRENT_STATE.md`
3. `docs/notes-store/DECISION_LOG.md`
4. `docs/notes-store-spec.md` (product requirements)
5. Then: `ARCHITECTURE.md`, `PAYMENTS_EAZYPAY.md`, `SECURITY_AND_PRIVACY.md` as needed
6. UI: `.cursor/skills/academy-design/` + `DESIGN_AND_MOTION.md`

## Boundaries

- Same app/deploy; separate money domain (`store_*`, `NIASN-N-`).
- Shared Eazypay return URL via additive shim in `app/api/v1/bank/payment/route.ts`.
- Isolation CI: `scripts/ci/guard-store-domain-isolation.mjs` on STORE_DIRS including `app/(site)/notes` (not dead `app/(notes)`).

## Safe feature workflow

UNDERSTAND → read CURRENT_STATE → TRACE data flow in `lib/store` → IMPLEMENT smallest change → RUN store tests → UPDATE docs/handoff-state if behavior changed.

## Payments

Read `PAYMENTS_EAZYPAY.md`. Never invent a second gateway. Real charge is **deferred_by_owner** unless owner explicitly runs it.

## Migrations

Additive only preferred. Document in `DATABASE_AND_MIGRATIONS.md`. Preserve paid rows.

## Tests

See `TESTING_AND_VERIFICATION.md`. Minimum: tsc + isolation guard + `tests/notes-store-*`.

## Hard-stop

Secret exposure; store money entering academy `payments`; guest creating Academy identity; destructive irreversible migration without plan; enabling production without owner.
