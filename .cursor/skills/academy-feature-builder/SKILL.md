---
name: academy-feature-builder
description: >-
  Controlled feature workflow for the Academy portal: understand, inspect, implement,
  verify. Use when adding or substantially changing features across frontend and backend.
---

# Academy feature builder

```
UNDERSTAND → INSPECT → TRACE DATA FLOW → REVIEW PATTERNS →
IDENTIFY RISKS → IDENTIFY MISSING STATES → IMPLEMENT →
VERIFY → REVIEW DIFF → POLISH
```

Never jump request → code.

## Per stage

1. **Understand** — user + business outcome; read relevant spec (`docs/`).
2. **Inspect** — existing files, APIs, tables, flags.
3. **Trace** — reads/writes, auth, money, cache tags.
4. **Patterns** — gold standards + sibling features.
5. **Risks** — isolation, ISR, secrets, double-submit, idempotency.
6. **States** — empty, loading, error, success, disabled, OOS, offline.
7. **Implement** — smallest coherent change; no drive-by refactors.
8. **Verify** — release-check skill.
9. **Diff** — no debug leftovers, no unrelated files.
10. **Polish** — copy, spacing, mobile.

## Notes Store specifics

- Server recomputes quote; EazyPGVerify terminals only; `NIASN-N-` prefix
- Kill switch / preview enable: `lib/store/flags.ts`
- Guard: `scripts/ci/guard-store-domain-isolation.mjs`
