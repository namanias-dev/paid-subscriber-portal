# AIVA — Architecture Map (Codebase Intelligence, Phase 0)

**AIVA = Aman's Intelligent Virtual Assistant** — the private, Super-Admin-only AI Business Operating System / CEO Command Center for Naman Sharma IAS Academy.

This document is the human-readable index of the AIVA Codebase Intelligence Registry. The machine-readable registries live beside it as JSON (`ROUTE_REGISTRY.json`, `API_REGISTRY.json`, `DB_SCHEMA_MAP.json`, `PAYMENT_STATE_MACHINE.json`, etc.). It reflects the **actual** repository as inspected in Phase 0 — no guessed names.

> Generated: Phase 0 (`feat/aiva-codebase-intelligence`). Keep in sync via `scripts/aiva-sync-codebase-intelligence.ts` on every change to the domains it covers.

---

## 1. Deployment topology

```text
namanias.com                → Existing portal (Next.js 14 app at repo ROOT). UNCHANGED.
aiva.namanias.com           → AIVA app (Next.js 14 app at aiva/). Separate Vercel project `namanias-aiva`.
Supabase / Postgres         → Shared source of truth (same project, same tables).
Aman's Mac (optional)       → Ollama + OpenClaw private intelligence worker (disabled by default).
```

- The portal remains a **single Next.js app at the repository root**. It is NOT restructured. This repo is **not** a monorepo (no `turbo.json` / workspaces).
- AIVA is an **independent Next.js app** in `aiva/` with its own `package.json`, `next.config.js`, `tailwind.config.ts`, build, env, domain, and Vercel project. See `docs/aiva/DEPLOYMENT.md`.
- The portal does **not** import any AIVA / Three.js / R3F code. AIVA does **not** import the heavy portal runtime; it reuses only the **pure, dependency-light business primitives** (see §4).
- AIVA failure cannot affect the portal: separate build, separate deployment, separate runtime. AIVA only reads the shared DB (read-only in v1).

## 2. Portal stack (source of truth)

| Concern | Implementation |
|---|---|
| Framework | Next.js 14 (App Router), React 18, TypeScript 5.6 (`strict`) |
| Path alias | `@/*` → repo root (`tsconfig.json`) |
| DB client (server) | `getSupabaseAdmin()` in `lib/supabase.ts` (service role; returns `null` → demo mode) |
| Admin auth | JWT (jose HS256) cookie `naman_admin_token`, secret `ADMIN_JWT_SECRET`; `getAdminSession()` in `lib/session.ts` |
| RBAC | `lib/permissions.ts` — 8 system roles, 21 permission keys; Super Admin = `manage_roles` + `manage_staff` + `view_revenue` |
| Payments | ICICI Eazypay (`lib/eazypay.ts`) + legacy Razorpay; reconciliation in `lib/paymentsAgg.ts`, `lib/paymentGroups.ts`, `lib/installments.ts`, `lib/paymentProofs.ts`, `lib/dataProvider.ts` |
| Analytics/events | `analytics_events` table + `writeEvent()` / `track()` in `lib/analytics/server.ts`; read side `lib/analytics/queries.ts`, `lib/analytics/ceoOverview.ts` |
| SMS | JustGoSMS via `lib/sms/service.ts` (single send path); kill switch `SMS_ENABLED` + DB `settings.enabled` |
| Crons | `vercel.json` → `/api/cron/*` (ping, verify-payments, analytics-rollup, sms-dispatch, media-purge); secured by `CRON_SECRET` |
| Region | `bom1` (Mumbai) |
| Tests | **None configured** in the portal (no jest/vitest/playwright). AIVA introduces its own scoped vitest suite. |

## 3. Payment / enrollment source of truth (do NOT reimplement)

Reconciliation RULES are encoded in pure modules. AIVA reuses them verbatim as its single source of truth:

- **Paid detection**: `isPaidStatus(status)` → `PAID` | `captured` only (`lib/paymentsAgg.ts`).
- **Dedupe / revenue total**: `dedupePaidRows`, `dedupedPaidTotal`, `distinctRegistrations` (`lib/paymentsAgg.ts`).
- **Group (PAID-wins) status**: `buildPaymentGroups`, `deriveGroupStatus`, `groupNeedsAction` (`lib/paymentGroups.ts`).
- **Outstanding / overdue per enrollment**: `deriveEnrollment(enr).{remaining,hasOverdue,nextPayable}`, `isActiveEnrollment`, `isLineOutstanding`, `installmentStatus` (`lib/installments.ts`).

See `PAYMENT_STATE_MACHINE.json` and `ENROLLMENT_STATE_MACHINE.json` for full state tables. Key invariants:

- Attempts (`INITIATED`/`PENDING`/`ABANDONED`) are **not** revenue.
- Imported/manual verified payments are `status='PAID'`, `gateway='offline'` → counted.
- A PAID attempt supersedes (`is_superseded=true`) unpaid siblings in the same group; duplicate PAID rows flagged, never auto-superseded.
- Proof upload never grants access; only `PAID`/`captured` grants entitlements.
- Soft-deleted payments (`deleted_at` set) are excluded from money/access.

## 4. AIVA ↔ portal reuse boundary

AIVA imports these **pure** modules from the repo root via the `@portal/*` alias (they only depend on each other and on pure type/date files — zero heavy runtime deps):

| Module | Reused for |
|---|---|
| `@portal/lib/types` | Canonical `Payment`, `CourseEnrollment`, `Role`, etc. type shapes |
| `@portal/lib/dates` | IST date helpers (`addDaysISO`, `formatISTDate`, …) |
| `@portal/lib/paymentsAgg` | `isPaidStatus`, `dedupePaidRows`, `dedupedPaidTotal`, `distinctRegistrations`, `itemKey` |
| `@portal/lib/paymentGroups` | `buildPaymentGroups`, `deriveGroupStatus`, `groupNeedsAction`, `GROUP_STATUS_META` |
| `@portal/lib/installments` | `deriveEnrollment`, `isActiveEnrollment`, `isLineOutstanding`, `installmentStatus`, `enrollmentStatusFromSchedule` |
| `@portal/lib/permissions` | `isSuperAdmin`, `resolvePermissions`, `hasPermission`, `allPermissions` |

Everything else AIVA needs (Supabase client, queries, auth session, agents, 3D) lives inside `aiva/` and is AIVA-specific. AIVA never imports `lib/dataProvider.ts` (heavy), portal UI, SMS send paths, or payment-mutation code.

## 5. AIVA app structure (`aiva/`)

```text
aiva/
  package.json                 # own deps: next, react, three, @react-three/fiber, @react-three/drei, framer-motion, jose, bcryptjs, recharts, @supabase/supabase-js
  next.config.js               # outputFileTracingRoot = repo root (to trace reused @portal/* files)
  tsconfig.json                # paths: @/* → aiva/*, @portal/* → repo root
  tailwind.config.ts           # navy / royal blue / gold / soft white
  vercel.json                  # AIVA-only crons (none enabled in v1)
  app/
    (auth)/login               # Super-Admin login (own session cookie aiva_session)
    aiva/                       # /aiva PWA + command center (the CEO surface)
      page.tsx                  # Neural Core + daily brief
      revenue/                  # Revenue Control Tower
      admissions/ marketing/ student-success/ content/ batch-launch/ analytics/ security/
      approvals/ actions/ learning/ codebase-intelligence/ system-health/
    api/                        # AIVA-only read APIs + safe internal endpoints
    manifest.webmanifest, sw    # PWA
  lib/
    env.ts, supabase.ts, session.ts, flags.ts, guard.ts
    events/                     # canonical business event catalog + emitter
    revenue/                    # read-only revenue tower queries (reuse @portal primitives)
    agents/                     # domain agent read models
    tools/                      # allowlisted tool definitions (metadata; execution disabled in v1)
  components/                   # 3D NeuralCore, panels, cards, charts
  tests/                        # vitest unit tests for reconciliation + flags + risk policy
```

## 6. Feature-flag posture (first release = read-only)

All action-producing features ship **disabled**. Defaults (see `aiva/lib/flags.ts` and `docs/aiva/ENV.md`):

```text
AIVA_ENABLED=true              # AIVA app is reachable (private, super-admin only)
AIVA_READ_ONLY=true            # no mutations anywhere
AIVA_3D_BRAIN_ENABLED=true
AIVA_WEBSITE_RECOMMENDATIONS_ENABLED=false
AIVA_CAMPAIGNS_ENABLED=false
AIVA_INSTALLMENT_REMINDERS_ENABLED=false
AIVA_LOCAL_WORKER_ENABLED=false
AIVA_OPENCLAW_ENABLED=false
AIVA_LEARNING_ENABLED=false      # off in v1 (no writes)
AIVA_AUTO_GREEN_ACTIONS_ENABLED=false
AIVA_DATA_RETENTION_DAYS=180
```

## 7. Where each requested capability lives

| Capability | Location |
|---|---|
| Codebase Intelligence Registry | `docs/aiva/*` (this dir) + `/aiva/aiva/codebase-intelligence` page |
| Canonical business event layer | migration `supabase/migrations/2026-07-11-aiva-foundation.sql` + `aiva/lib/events/*` |
| Read-only Revenue Control Tower | `aiva/lib/revenue/*` + `/aiva/aiva/revenue` |
| Living 3D Neural Core | `aiva/components/neural/*` + `/aiva/aiva` |
| Agent panels (real data) | `aiva/lib/agents/*` + `/aiva/aiva/{revenue,admissions,...}` |
| CEO daily brief | `aiva/lib/revenue/dailyBrief.ts` + `/aiva/aiva` |
| Recommendations & action drafts | `aiva/lib/agents/*` (read-only; drafts only) |
| Approval inbox | `/aiva/aiva/approvals` (renders drafts; approval execution disabled by flags) |
| System health & audit logs | `/aiva/aiva/system-health` + `security_audit`/`aiva_audit_log` reads |
| Mobile private PWA | `aiva/app/manifest.webmanifest`, `aiva/app/sw.js`, install-friendly `/aiva` |

## 8. Change-impact & sync

`scripts/aiva-sync-codebase-intelligence.ts` re-scans changed domains from a Git diff and updates `aiva_codebase_snapshots`. See `CHANGE_IMPACT_RULES.json` for the domain→file mapping and the CI failure conditions.
