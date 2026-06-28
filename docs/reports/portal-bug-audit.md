# Portal Bug Audit — Retry / Race / Partial-State Class

**Date:** 2026-06-28
**Scope:** Checkout / enrollment / payment creation, state transitions, identity/dedupe, access control, money safety, admin UI — user side and admin side.
**Trigger:** Duplicate active enrollments (Kavita ×4, Sunil ×3, Kashish ×2) inflating outstanding balances, all stemming from missing guards around retries after the slow/VERIFYING checkout redirect.

Severity legend: **Critical** (money/access loss or duplication in production) · **High** (likely data corruption / over-bill) · **Medium** (duplicate rows, misleading totals, no money loss) · **Low** (cosmetic / rare).

---

## FIXED NOW (safe, additive)

### 1. Duplicate enrollments on repeat "Book Your Seat" — **Critical** — FIXED
- **Root cause:** `POST /api/v1/enroll/create-payment` always called `addCourseEnrollment()` + `createPayment()` with no dedupe/reuse. Every retry after the slow-VERIFYING redirect created a new enrollment + PENDING/VERIFYING payment.
- **Effect:** 3 students with 2–4 active enrollments each. Admin/portal summed `total_fee − amount_paid` across all of them → Kavita showed ₹1,80,000 (4 × ₹45,000).
- **Fix:**
  - **Reuse guard:** the route now reuses an existing non-cancelled, not-fully-paid enrollment for the same phone+course. ₹0 enrollments are re-planned to the latest selection (stale attempts abandoned); paid enrollments resume the next outstanding line.
  - **Idempotency dedupe:** a second open course attempt for the same phone+course within 2 min re-hands-back the same payment URL (`findRecentOpenCoursePayment`).
  - **Front-end:** `CheckoutClient.proceed()` has a re-entry guard and keeps the Pay button disabled through redirect.
  - **Existing data:** merged Kavita/Sunil/Kashish via the new Merge tool (see below).

### 2. Inflated outstanding summed across duplicate enrollments — **Critical** — FIXED
- **Root cause:** balances/installment schedules aggregated per enrollment with no canonicalization.
- **Fix:** the Merge/Cancel tool keeps ONE canonical enrollment (status `cancelled` + `superseded_by` on the rest). Cancelled enrollments are already excluded from portal sums (`amount_paid > 0 && status !== "cancelled"`) and access. Balances corrected: Kavita ₹1,80,000→₹45,000, Kashish ₹80,000→₹40,000, Sunil ₹1,28,000→₹38,000 (₹2,000 paid preserved).

### 3. No overpayment / pay-after-fully-paid guard — **High** — FIXED
- **Root cause:** neither checkout route blocked a charge on an already-settled course.
- **Fix:** `create-payment` returns 409 `alreadyPaid` when the phone is fully paid for the course (`isCourseFullyPaidForPhone`). The in-portal pay route already guarded `derived.remaining <= 0`; it now also dedupes the same installment within 2 min (`findRecentOpenInstallmentPayment`) so a double-click can't over-apply to the next installment on finalize.

### 4. Duplicate webinar/plan checkout rows on double-submit — **Medium** — FIXED
- **Root cause:** `POST /api/v1/bank/create-payment` (webinar/plan/course) had no dedupe (e.g. Sunil's ₹50 webinar attempt ×2).
- **Effect:** duplicate PENDING/VERIFYING rows. No double-charge (unpaid) and admin views already collapse via `distinctRegistrations`/`dedupedPaidTotal`, but it bloats the VERIFYING list.
- **Fix:** generic `findRecentOpenPaymentForItem` dedupe (2-min window, same amount) on that route.

### 5. No recoverable trash for payment edits/deletes — **High** (operational safety) — FIXED
- **Root cause:** no admin way to correct/remove a payment without a hard DB edit (risk of data loss + no audit).
- **Fix:** super-admin edit (amount/status/reference/name), soft-delete to recoverable Trash, restore, and (Trash-only) permanent delete — all gated to super admin, all written to `payment_action_log`, all safely recomputing the enrollment via `recomputeCourseEnrollment` (comp-safe: never zeroes a ₹0 manual grant). Reads (`getPayments`, `getPaymentsByPhone`, `getPaymentByReference`, `getPaymentsByEnrollmentId`) exclude soft-deleted rows so a callback/verify can't resurrect trashed payments.

### 6. No early-warning for duplicates — **Medium** — FIXED
- **Fix:** super-admin dashboard badge (`DuplicateEnrollmentAlert`) detects duplicates on demand (query-based, no cron) and links to the Merge tool. Clears automatically once resolved.

---

## VERIFIED SAFE (already correct — no change needed)

- **Revenue / today's counts:** `dedupedPaidTotal` + `distinctRegistrations` already collapse exact retry-duplicates by (phone, item), so duplicate enrollments did **not** double-count captured revenue — only the *outstanding/pending* projection was inflated.
- **Course access (Class Hub):** gated by `amount_paid > 0` / `fully_paid` / grants per course, keyed by phone — duplicate enrollments did not grant extra access.
- **Login codes / buyers:** keyed by phone and idempotent (`ensureBuyer`); merge/edit/delete never strand a login code.
- **Payment finalize:** idempotent on receipt-by-reference; re-runs are no-ops.
- **New endpoints:** all `/api/admin/enrollments/*` and the payment edit/delete/restore/permanent/trash routes enforce `requireAdmin` + `requireSuperAdmin`. New tables (`enrollment_merge_log`) ship RLS-enabled, service-role-only.

---

## DEFERRED — needs your decision (not changed)

### D1. Webhook + browser-callback both firing → possible duplicate finalize path — **Low/Medium**
- ICICI return-URL callback and the verify/cron path can both confirm a payment. Today this is safe because finalize is idempotent on receipt-by-reference, but if a future change keys receipts differently it could double-apply. **Recommended:** keep a DB unique constraint on `payment_receipts.reference_no` (verify it exists). Deferred because it's a defensive DDL, not a live bug.

### D2. Existing orphaned VERIFYING attempts on now-cancelled duplicates — **Low**
- The merge abandoned the duplicates' open attempts, but historic stray VERIFYING rows (e.g. Sunil's 2 webinar ₹50 attempts) remain as unpaid attempts. They're harmless (unpaid) and surface as hot-leads. **Recommended:** a one-off "abandon stale >7-day VERIFYING" sweep via the existing Re-verify tool. Deferred — destructive-ish bulk status change, your call.

### D3. Re-plan on reuse overwrites the prior plan selection for ₹0 enrollments — **Low (by design)**
- When a student re-books a course they have a ₹0 in-progress enrollment for, the latest selection (plan/installments/seat) wins. This matches "resume the latest booking", but if you'd prefer to always keep the *first* selection, that's a one-line change. Flagged for confirmation.

### D4. Duplicate-enrollment nav item visibility — **Low**
- The "Duplicate Enrollments" nav item is gated by `view_revenue` (the page + API enforce super-admin). A non-super accountant role would see the link but get a "Super Admin only" page. **Recommended:** add a `superOnly` nav flag if you want it fully hidden. Deferred — purely cosmetic.
