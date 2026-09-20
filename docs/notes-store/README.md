# Notes Store — documentation index

Physical printed UPSC notes sold by **Naman Sharma IAS Academy**, implemented inside the same Next.js application as the Academy portal.

**Canonical product specification:** [`docs/notes-store-spec.md`](../notes-store-spec.md) (authoritative requirements). This folder is the **implementation handoff** for engineers and Cursor agents — architecture, current state, how to operate — not a second conflicting product spec.

## Prominent warnings

| Warning | Status |
|---------|--------|
| Production `notes_store` feature flag | **DISABLED** (`enabled=false`, `scope=off`) |
| Real ICICI Eazypay ₹1 (or any) transaction | **Deferred by owner** — not performed; do not claim payment validation passed |
| COD | **Never** |
| Second payment gateway / Razorpay for store | **Never** |
| Second Eazypay return URL | **Never** — shared with Academy |
| Fake reviews / scarcity / unsupported claims | **Forbidden** |

Implementation exists and automated isolation tests pass; a real Eazypay transaction remains deliberately deferred and unverified by owner decision.

## Current phase

**Phase 1:** guest checkout, store-owned Eazypay Verify, hash-only order access, manual fulfilment (courier/AWB), preview-only enable. Coupons, Shiprocket, reviews, DLT send, account order history: out of phase or deferred.

## Reading order by task

| Task | Read first |
|------|------------|
| Any Notes Store change | `CURRENT_STATE.md` → `DECISION_LOG.md` → `.cursor/skills/notes-store/SKILL.md` |
| Frontend / UI | `FRONTEND_IMPLEMENTATION.md` → `DESIGN_AND_MOTION.md` → `.cursor/skills/academy-design/` |
| Backend / APIs | `BACKEND_IMPLEMENTATION.md` → `ROUTES_AND_APIS.md` |
| Payments | `PAYMENTS_EAZYPAY.md` → `SECURITY_AND_PRIVACY.md` |
| Database | `DATABASE_AND_MIGRATIONS.md` |
| Admin / ops | `ADMIN_AND_FULFILMENT.md` |
| Deploy / flags | `DEPLOYMENT_RUNBOOK.md` → `FEATURE_FLAGS_AND_ENV.md` |
| New laptop | `NEW_MACHINE_BOOTSTRAP.md` → `HANDOFF_2026-09-19.md` |
| After a change | Update `CURRENT_STATE.md` / `handoff-state.json` / relevant doc; run tests in `TESTING_AND_VERIFICATION.md` |

## Document map

| Doc | Purpose |
|-----|---------|
| [CURRENT_STATE.md](./CURRENT_STATE.md) | As-of capability matrix |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Boundaries, money domain, flows |
| [FRONTEND_IMPLEMENTATION.md](./FRONTEND_IMPLEMENTATION.md) | Routes, components, UX states |
| [BACKEND_IMPLEMENTATION.md](./BACKEND_IMPLEMENTATION.md) | Domain libs, jobs, idempotency |
| [DATABASE_AND_MIGRATIONS.md](./DATABASE_AND_MIGRATIONS.md) | `store_*` schema + migrations |
| [PAYMENTS_EAZYPAY.md](./PAYMENTS_EAZYPAY.md) | Same merchant/return URL, Verify terminal |
| [SECURITY_AND_PRIVACY.md](./SECURITY_AND_PRIVACY.md) | Access tokens, rate limits, PII |
| [ADMIN_AND_FULFILMENT.md](./ADMIN_AND_FULFILMENT.md) | Queue, advance, ship |
| [DESIGN_AND_MOTION.md](./DESIGN_AND_MOTION.md) | Tokens + gold-standard reuse |
| [ROUTES_AND_APIS.md](./ROUTES_AND_APIS.md) | Page + API inventory |
| [FEATURE_FLAGS_AND_ENV.md](./FEATURE_FLAGS_AND_ENV.md) | Flag/env **names** only |
| [TESTING_AND_VERIFICATION.md](./TESTING_AND_VERIFICATION.md) | Commands, results, gaps |
| [DEPLOYMENT_RUNBOOK.md](./DEPLOYMENT_RUNBOOK.md) | Preview/prod safety |
| [DECISION_LOG.md](./DECISION_LOG.md) | Accepted decisions |
| [IMPLEMENTATION_MANIFEST.md](./IMPLEMENTATION_MANIFEST.md) | Exhaustive file list |
| [DATA_AND_TEST_FIXTURES.md](./DATA_AND_TEST_FIXTURES.md) | Test SKU (non-sensitive) |
| [EXTERNAL_DEPENDENCIES.md](./EXTERNAL_DEPENDENCIES.md) | What code cannot finish |
| [KNOWN_GAPS_AND_ROADMAP.md](./KNOWN_GAPS_AND_ROADMAP.md) | Prioritized queue |
| [ROLLBACK_AND_RECOVERY.md](./ROLLBACK_AND_RECOVERY.md) | Kill switch + rollback |
| [NEW_MACHINE_BOOTSTRAP.md](./NEW_MACHINE_BOOTSTRAP.md) | Fresh laptop steps |
| [HANDOFF_2026-09-19.md](./HANDOFF_2026-09-19.md) | Snapshot |
| [handoff-state.json](./handoff-state.json) | Machine-readable state |

## Cursor intelligence

| Resource | Path |
|----------|------|
| Notes Store rule | `.cursor/rules/notes-store.mdc` |
| Notes Store skill | `.cursor/skills/notes-store/SKILL.md` |
| Academy core / UI / safety / verification | `.cursor/rules/academy-*.mdc` |
| Academy design | `.cursor/skills/academy-design/` |
| Feature builder / critic / release check | `.cursor/skills/academy-*` |
| Agent entry | `AGENTS.md` |

## Isolation dirs (CI)

`lib/store`, `app/(site)/notes`, `app/api/notes`, `app/admin/notes`, `app/api/admin/notes`, `app/api/cron/notes-store-verify`, `components/notes` — guarded by `scripts/ci/guard-store-domain-isolation.mjs`.

## Protected Academy boundaries

Do **not** casually modify: `lib/eazypay.ts`, course Verify cron, course two-second status poll, `payments` / `students` / `buyers` / `leads` / fee-state / entitlements / lecture / quiz gates. Store payment code lives under `lib/store/payments/**` and may only reuse low-level `encrypt` / signature helpers via `lib/store/payments/eazypay.ts`.
