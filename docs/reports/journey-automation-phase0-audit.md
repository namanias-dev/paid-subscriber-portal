# Journey Automation — Phase 0 Investigation Report

Scope: read-only architecture audit performed before building the Student Journey
Automation foundation. Goal: confirm the single trusted SMS chokepoint, map the
data reality and detectable business events, and assess durable-execution options.
**Conclusion: no material conflict with the Phase 1 plan — safe to build the
foundation (zero sending / zero execution).**

---

## 1. SMS Mission Control — the single send chokepoint

There is exactly ONE trusted, DLT-compliant send path. Journey Automation must
route every future send through it and must never create a second sender.

- **Chokepoint:** `sendSms(input: SendSmsInput): Promise<SendSmsResult>` and the
  batch orchestrator `sendBatch(...)` in `lib/sms/service.ts` (`sendSms` at
  `lib/sms/service.ts:165`, `sendBatch` at `:299`). These are the only functions
  that call the gateway (`sendViaGateway` / `sendBulkViaGateway` from
  `lib/sms/gateway.ts`). No other module talks to the gateway.
- **Signature** (`lib/sms/service.ts:44-59`):
  `SendSmsInput { mobile, templateId, variables?, relatedEntity?, sentBy:{userId?,type:"ADMIN"|"SYSTEM"}, triggerEvent?, audienceType?, dedupeKey?, enforceWindow?, allowRecentOverride?, scheduleTime? }`.
- **Compliance safeguards, all enforced inside the chokepoint before any send**
  (`lib/sms/service.ts:165-236`), in order:
  1. Kill switch — hard env `SMS_ENABLED==="true"` (`lib/sms/config.ts:53`) **and**
     soft `sms_settings.enabled` (`getSettings()`), else `{skipped:"disabled"}`.
  2. Template gate — must exist, be `active`/`approved`, have a
     `gateway_template_id` (DLT id); promotional templates may never go to the
     `all` audience (`:173-176`).
  3. Phone validation / normalization — `normalizeIndianMobile` (`lib/phone.ts`).
  4. **Opt-out / DND suppression** — `isOptedOut(normalized)` on every path
     (`:184`, and `optedOutSet(...)` for batches at `:348,354`).
  5. **Quiet hours** — IST send window `settings.windowStart..windowEnd` enforced
     for cron auto-sends via `enforceWindow` (`:194-197`).
  6. **Frequency caps** — daily cap, per-mobile daily cap, and a 30-minute
     same-template anti-spam guard (`:199-208`).
  7. **Double-send guard** — insert a `QUEUED` `sms_logs` row with a UNIQUE
     `dedupe_key` FIRST, then send (`:210-236`); the partial-unique index
     `sms_logs_dedupe_key_uq` (`supabase/migrations/2026-sms-comms.sql:71`) makes
     concurrent serverless triggers unable to double-send.
- **Message logs:** `public.sms_logs` (`2026-sms-comms.sql:39-77`) — every attempt,
  status `QUEUED|SENT|FAILED|DELIVERED|UNKNOWN`.
- **Delivery callbacks / retry:** pull-based DLR via `pollDeliveryStatuses()`
  (`lib/sms/service.ts:489`), plus `resendCampaignFailed()` / `retryLog()`.
- **Templates & variables:** `public.sms_templates` + `lib/sms/templates.ts`
  (`renderTemplate` + `validateBody` for GSM/length/segment validation) +
  `lib/sms/variables.ts` (variable store) + `lib/sms/store.ts` (data layer).
  Canonical variable catalogue in `lib/sms/types.ts:10-13`. Secrets/login codes are
  resolved at send time and **never** returned to the client (`lib/sms/config.ts`).

**Implication for Journey Automation:** the future execution engine (P3/P4) will
build a `SendSmsInput` and call `sendSms`/`sendBatch`. It adds NO sending code and
NO safeguards of its own — the chokepoint already owns compliance. This shipment
adds nothing that can send.

## 2. Data reality & detectable business events

- **Postgres via Supabase**, service-role only. Client from `getSupabaseAdmin()`
  (`lib/supabase.ts`) with `cache:"no-store"`. Access is exclusively through
  guarded admin API routes; tables use RLS-enabled-with-no-policies so only the
  service role can read/write (e.g. `2026-sms-comms.sql:105-109`,
  `2026-payment-action-log.sql:42`).
- **Domain tables (existing):** `sms_templates/sms_logs/sms_auto_rules/sms_settings`,
  `sms_opt_outs`, `roles`, `admin_users`, courses/batches + `course_enrollments`
  (schedule/installments), `payment_proofs`, `payment_action_log`, webinars +
  registrations, leads (+ `lead_accounts`, AI counselor), quizzes/questions,
  resources, analytics events. Migrations in `supabase/migrations/`.
- **Business truth is READ via existing derivations** — never recomputed:
  `deriveEnrollment(enr, now)` (`lib/installments.ts:412`) and
  `deriveCollections(enr, now)` (`:451`) yield paid/remaining/overdue/installment
  state. Journey Automation reads these; it never mutates payment/installment/
  enrollment/access/student records.
- **Detectable events today** — mostly imperative call-sites + cron/polling, NOT a
  unified event bus:
  - Payment success/pending/failed/abandoned, proof uploaded, admin approval,
    course enrolled, payment-plan changed, first login — already enumerated as
    SMS auto-rule triggers (`lib/sms/store.ts:15-32`, `TRIGGERS` in
    `lib/sms/templates.ts`). Fired inline from payment/enrollment flows.
  - Webinar registered / day-before / same-day / starting-soon / zoom-published /
    post-webinar — driven by the `sms-dispatch` cron (`app/api/cron/sms-dispatch`).
  - Payment reconciliation/verification crons (`app/api/cron/verify-payments`,
    `reconcile-payments`).
  - **Gap:** there is no generic `automation_events` stream. The execution
    shipment (P3) will need either to (a) tap these existing call-sites/crons or
    (b) introduce an events table. This is a P3 design note, not a Phase 1 blocker.

## 3. Infra & conventions

- **IDs/timestamps:** mixed. Stable app-keys use `text primary key`
  (`sms_templates`, `roles`, `payment_action_log`); machine rows use
  `uuid primary key default gen_random_uuid()` (`sms_logs`). Timestamps are
  `timestamptz not null default now()`. Actor columns are `*_by text`.
  → New automation tables use `uuid` PKs + `timestamptz` + `created_by/updated_by`.
- **Cron/queue:** Vercel Cron (`vercel.json` `crons[]`) drives `/api/cron/*`
  handlers; the SMS system already runs a Postgres-backed, poll+cron dispatcher
  (`app/api/cron/sms-dispatch`) using the insert-first-dedupe pattern. Region
  `bom1`, functions capped at 60s (`maxDuration=60`).
- **Env pattern:** backend-only `process.env` read through small helpers; flags are
  `X === "true"` (`smsEnvEnabled()` at `lib/sms/config.ts:53`). Supabase reads env
  via computed access so values activate at runtime without a rebuild.
- **RBAC:** `PermissionKey` union + `PERMISSIONS` metadata (`lib/permissions.ts`);
  roles seeded in DB `roles.permissions` jsonb (`2026-staff-roles.sql`); guards in
  `lib/adminGuard.ts` (`requirePermission`, `requireSuperAdmin`,
  `effectivePermissions`). Super Admin is granted every permission **dynamically**
  including keys added after the token was minted (`lib/adminGuard.ts:14-17`), so
  new permission keys are OFF for all non-super roles until explicitly granted.
- **Nav & UI:** `components/admin/adminNav.ts` (groups derived by first-appearance
  order in `AdminShell.tsx:87`), icons `lib/appIcons.ts` (lucide-react), gating in
  `AdminShell.tsx` + `lib/adminGuard.ts`. Design tokens: `--primary` (navy/royal),
  gold accents, `card`/`pill`/`KpiCard`/`PageHeader`/`TableShell`
  (`components/admin/ui.tsx`). SMS Mission Control lives at
  `/admin/communications/sms` (`adminNav.ts:37`) — the `/admin/communications`
  parent already exists.

## 4. Durable-execution assessment (recommendation only — not built here)

The current stack (Vercel serverless, 60s functions, Supabase Postgres, Vercel
Cron) **already runs a durable, at-least-once job pattern** for SMS: rows persisted
in Postgres, a cron worker polls and processes with an insert-first UNIQUE dedupe
guard against double-processing.

**Recommendation:** back the future Journey execution engine with the SAME pattern
— a Postgres-backed job/queue table (e.g. `automation_jobs` + `automation_node_runs`
in the P3 shipment) drained by a Vercel Cron worker, using an INSERT-with-UNIQUE
idempotency key before any effect and bounded per-invocation batches to respect the
60s limit. No external queue (SQS/Upstash/Inngest) is required for the expected
volume; revisit only if sub-minute latency or very high fan-out is needed. All
actual sending still goes through `sendSms`/`sendBatch`.

## 5. Deliverables summary

- **Exists / reuse:** the SMS chokepoint (`sendSms`/`sendBatch`), template+variable
  validation, opt-out/caps/quiet-hours, `sms_logs`, DLR polling, `deriveEnrollment`/
  `deriveCollections`, RBAC + guards, admin nav/shell/icons/UI kit, Supabase admin
  client, Vercel Cron.
- **Do NOT duplicate:** any sender, DLT mapping, template store, opt-out logic,
  payment/installment/enrollment/access math.
- **Production-critical routes & chokepoint:** `app/api/admin/sms/send`,
  `app/api/cron/sms-dispatch`, and `lib/sms/service.ts` (the chokepoint) — all left
  untouched.
- **State representation:** payments/installments/enrollment/access derived by
  `lib/installments.ts`; read-only for Journey Automation.
- **Major risks:** (a) accidentally introducing a second send path — mitigated by
  adding zero send code and routing all future sends through the chokepoint;
  (b) permission bleed (Mission Control's `send_sms` granting journey publish) —
  mitigated with NEW `journey_*` keys that default OFF; (c) bundle leakage into the
  student portal — mitigated by isolating code under `lib/journey-automation`,
  `components/journey-automation`, `app/admin/communications/...`.
- **Recommended integration strategy:** additive, isolated module; new
  `automation_*` tables (immutable published versions from day one); six env flags
  default OFF; new restrictive permission keys; read-only dashboard under a new
  COMMUNICATIONS nav group alongside (not replacing) Mission Control.
- **Files likely touched (Phase 1):** new migration
  `supabase/migrations/2026-07-14-journey-automation-foundation.sql`; new
  `lib/journey-automation/*`, `types/journey-automation.ts`,
  `components/journey-automation/*`, `app/admin/communications/journey-automation/*`,
  `app/api/admin/journey-automation/*`; edits to `lib/permissions.ts` (add keys),
  `components/admin/adminNav.ts` (COMMUNICATIONS group), `lib/appIcons.ts` (icons),
  `package.json` (test script).

## 6. Conflict check vs Phase 1 plan

- Single chokepoint: **CONFIRMED** — `sendSms`/`sendBatch`. No conflict.
- Route collision: none — dashboard at `/admin/communications/journey-automation`
  is a clean sibling of `/admin/communications/sms`.
- Permission collision: none — `journey_*` keys are new; `send_sms` untouched.
- Naming: existing "journey" usages (lead-journey analytics, `JourneyTimeline`) are
  unrelated; the `journey-automation` module namespace is distinct.
- Additive migration only; no existing table altered. **No material conflict —
  proceeding to Phase 1.**
