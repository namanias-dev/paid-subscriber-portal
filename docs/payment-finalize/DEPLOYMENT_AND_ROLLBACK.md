# Deployment history, rollout, and rollback — course payment finalize

## What already exists in production (applied earlier, before this PR land)

Supabase migration version `20261012153957` / name `course_payment_finalize_ledger` is recorded in `supabase_migrations.schema_migrations`.

**Present today on production:**

| Object | State |
|---|---|
| `payment_finalize_ledger` table | Exists (columns through `updated_at`; **no** receipt-email claim columns until ops migration) |
| `payment_receipts.superseded_at` / `superseded_reason` / `canonical_receipt_id` | Exist (additive, unused by running app) |
| `schedule_net_allocated` / `schedule_line_remaining` / `schedule_line_outstanding` | Exist as helper functions |
| `finalize_course_payment` RPC | **Does not exist** until atomic migration |

**Effect on running production code today:** none of the live app paths call these helpers or the ledger. Soft-supersede columns are unused. Student payments continue on the old non-atomic finalize path until this PR’s app + RPC are deployed together.

## What this PR adds

- `finalize_course_payment(text, jsonb)` with due-fills under lock, allocatable partial lines, evidence-based receipt reconcile, `review_required`
- `finalize_course_payment_guarded` — sets `app.course_finalize_rpc`, records deferred attempts, drains on success
- Ops: `payment_finalize_settings` containment, `payment_finalize_deferred`, claim/ack receipt-email RPCs with leases
- App: no pre-RPC schedule write; guarded RPC; receipt email outbox drain on cron; containment helpers
- Repair: `scripts/repair-payment-overallocation.sql` (load explicitly; not auto-applied)

## Concrete cutover (protects payments during mixed old/new)

Production is not `master`. Start from the live `/api/version` SHA.

1. **Apply additive migrations** (DDL only) via Supabase MCP / SQL editor:
   - `2026-10-12-course-payment-finalize-atomic.sql`
   - `2026-10-12-course-payment-finalize-ops.sql`
   Old app instances ignore new RPCs/columns — safe.
2. **Enable containment** before promoting the new app:
   ```sql
   update payment_finalize_settings
   set containment_enabled = true,
       containment_reason = 'cutover:block_legacy_finalize_writers',
       updated_at = now(),
       updated_by = 'release'
   where id = 1;
   ```
   While containment is on, non-RPC writers cannot mutate enrollment money fields or receipts. Incoming PAID payments remain durable in `payments`; `finalize_course_payment_guarded` records them in `payment_finalize_deferred` and allocates when called.
3. **Promote** the preview that contains the live SHA + this fix (`npm run release:prod -- <preview>`).
4. **Verify** live `/api/version`, `finalize_course_payment_guarded` grants for `service_role`, containment still on.
5. **Drain** deferred/unledgered PAID course payments exactly once (app `drainDeferredFinalizations` or guarded RPC per reference).
6. **Repair** approved cases with `repair_course_overallocation_case` + reviewed baselines (reminders/outbox suppressed for those students).
7. **Disable containment** after drain + repairs are verified:
   ```sql
   update payment_finalize_settings
   set containment_enabled = false, containment_reason = null, updated_at = now()
   where id = 1;
   ```
8. Restore automation holds; leave narrowly scoped access holds only when needed.

## Rollback / containment (must preserve payment safety)

**Do not** roll back to the old non-idempotent finalizer while leaving traffic live — that reintroduces double-allocation.

Preferred containment if the new path misbehaves:

1. Keep the RPC deployed; re-enable `payment_finalize_settings.containment_enabled` so legacy writers cannot allocate. PAID intake continues; drain later with a safe build.
2. **App rollback only if** the previous release already included an equally safe finalize (it does not for the pre-fix live SHA). Otherwise roll **forward** with a fix.
3. **Schema:** leaving ledger/helpers/RPC in place is safe. Dropping the RPC while old racy code is live is the dangerous combination — avoid.
4. **Repair rollback:** restore from `payment_repair_snapshots` only when preconditions still match; never overwrite newer legitimate payments.
