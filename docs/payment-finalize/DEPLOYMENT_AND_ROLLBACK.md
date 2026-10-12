# Deployment history, rollout, and rollback — course payment finalize

## What already exists in production (applied earlier, before this PR land)

Supabase migration version `20261012153957` / name `course_payment_finalize_ledger` is recorded in `supabase_migrations.schema_migrations`.

**Present today on production:**

| Object | State |
|---|---|
| `payment_finalize_ledger` table | Exists (columns through `updated_at`; **no** receipt-email columns yet) |
| `payment_receipts.superseded_at` / `superseded_reason` / `canonical_receipt_id` | Exist (additive, unused by running app) |
| `schedule_net_allocated` / `schedule_line_remaining` / `schedule_line_outstanding` | Exist as helper functions |
| `finalize_course_payment` RPC | **Does not exist** |

**Effect on running production code today:** none of the live app paths call these helpers or the ledger. Soft-supersede columns are unused. The earlier session applied schema only; no app deploy consumed it. Student payments continue on the old non-atomic finalize path until this PR’s app + RPC are deployed together.

## What this PR adds (not yet applied to production)

- Replace/create `finalize_course_payment(text, jsonb)` with due-fills under lock, allocatable partial lines, evidence-based receipt reconcile, `review_required` outcomes
- `schedule_line_allocatable`
- Ledger columns: `receipt_email_*`, status allows `needs_review`
- App: no pre-RPC schedule write; RPC due fills; receipt email outbox drain on cron
- Repair function in `scripts/repair-payment-overallocation.sql` (not a Supabase migration — load explicitly when executing an approved repair)

## Safe rollout (old + new app instances)

1. **Apply migration** (DDL only): functions + ledger column adds. Old app instances ignore the new RPC and unused columns — safe.
2. **Deploy app** that calls `finalize_course_payment(..., p_due_fills)`. During mixed fleet:
   - New instances use the RPC (idempotent).
   - Old instances still use the racy path until drained — keep the deploy window short; do not run repair until the fleet is fully new.
3. Optional: backfill `payment_finalize_ledger` for already-receipted PAID course payments (`outcome=reconciled_existing`) so retries hit the short-circuit.
4. Repair (separate approval) with reminders paused.

## Rollback / containment (must preserve payment safety)

**Do not** roll back to the old non-idempotent finalizer while leaving traffic live — that reintroduces double-allocation.

Preferred containment if the new path misbehaves:

1. **Feature contain:** keep the RPC deployed; temporarily route finalize through a “reconcile-only” mode (or block new allocations via kill switch) while investigating — still never re-enable the old check-then-act writer.
2. **App rollback only if** the previous release already included an equally safe finalize (it does not today). Otherwise roll **forward** with a fix.
3. **Schema:** leaving ledger/helpers/RPC in place is safe (no student impact if unused). Dropping the RPC while old racy code is live is the dangerous combination — avoid.
4. **Repair rollback:** restore from `payment_repair_snapshots` only when preconditions still match; never overwrite newer legitimate payments.
