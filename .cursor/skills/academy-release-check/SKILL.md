---
name: academy-release-check
description: >-
  Pre-completion release checklist for Academy changes: typecheck, tests, browser,
  mobile, money isolation, and regression. Use before saying a feature is done.
---

# Academy release check

## Always

- [ ] `npx tsc --noEmit`
- [ ] Targeted tests / guards for touched domain
- [ ] No secrets in diff
- [ ] No accidental unrelated file edits

## UI

- [ ] Desktop + 375px
- [ ] Empty / loading / error / success
- [ ] Focus visible; labels on inputs
- [ ] Console clean of app errors

## Notes Store

- [ ] `node scripts/ci/guard-store-domain-isolation.mjs`
- [ ] `tests/notes-store-isolation/` + media tests as needed
- [ ] Kill switch / preview enable behaviour understood
- [ ] Cart/checkout/order/track send `no-store`
- [ ] Samples never expose `original_key`
- [ ] Admin can see ship-to address before packing

## Money / auth

- [ ] No academy ledger pollution from store
- [ ] Idempotent payment terminals
- [ ] Admin routes still permission-gated

Report what was **not** tested.
