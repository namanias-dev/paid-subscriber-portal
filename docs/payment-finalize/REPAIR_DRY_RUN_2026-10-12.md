# Production repair dry run — course payment over-allocation

**Status:** READ-ONLY review artifact. Not executed.  
**Revalidated against production:** 2026-10-12 (Supabase `xqwdfyzerzsllqiyzxem`).  
**Do not run** until owner approves code deploy + migration + this plan.

## Root cause (confirmed)

`finalizeCoursePaymentByReference` could run from callback, verify, and status-poll concurrently. There was no DB-enforced per-`payment_id` finalize lock. Duplicate `payment_receipts` rows for one reference made `maybeSingle()` error look like “no receipt,” so a second caller allocated the next installment from the same payment.

## Code fix (this PR — not yet deployed)

See `DEPLOYMENT_AND_ROLLBACK.md`.

- Migration `supabase/migrations/2026-10-12-course-payment-finalize-atomic.sql`
  - `finalize_course_payment(text, jsonb)` — locks + due fills inside the transaction
  - `schedule_line_allocatable` includes partial remainders
  - Evidence-based receipt reconcile; `review_required` when ambiguous
  - Receipt email outbox on the ledger (retries never reallocate)
- Executable repair: `scripts/repair-payment-overallocation.sql` (fixture-tested)
- Transfer-aware recompute preserves seat `payments.enrollment_id`

**Production today:** ledger + helpers + soft-supersede columns exist (`course_payment_finalize_ledger`); **RPC absent**; running app does not use them.

---

## Case 1 — Udaydeep (…0474)

| Field | Current | Proposed |
|---|---|---|
| Evening enrollment | `72c363d0-6bbc-4818-b3d3-7a6fcfbe43ec` | same |
| Morning (transferred_out) | `c4818f64-0e61-4322-83a6-33ff4b8b4c71` | unchanged |
| Transfer | `15da518e-6de7-4a00-8c7a-652360ed0b29` morning→evening, amount_paid 2000 | preserve |
| Seat payment | `29af2fd3-…` ₹2000 ref `NAMAN-COURSE-MSACLFJ4-LYFH`, **enrollment_id stays morning** | keep as-is |
| Inst payment | `85c361a2-…` ₹8250 ref `NAMAN-COURSE-MSMV2WHW-3IX7` | keep |
| Webinar | ₹50 separate — ignore | ignore |
| amount_paid | 18500 | **10250** |
| status | partially_paid | partially_paid |
| Inst 1 | paid (same ref) | paid (same ref) |
| Inst 2 | paid (same ref) — **false** | **unpaid**, clear paid_at/ref/gateway |
| Inst 3–4 | unpaid | unpaid |
| Next due | (none outstanding in UI) | Inst 2 **2026-10-10** |

### Receipts for `MSMV2WHW-3IX7`

| receipt_no | id | label | paid_to_date | Action |
|---|---|---|---|---|
| NSA-2627-001165 | `3c73f594-…` | Installment 1 of 4 | 10250 | **CANONICAL** (earliest Inst1; matches `installment_no=1`) |
| NSA-2627-001166 | `1f521f4e-…` | Installment 1 of 4 | 10250 | supersede → points to 001165 |
| NSA-2627-001167 | `d9adc455-…` | Installment 2 of 4 | 18500 | supersede (race double-allocate) |

Update `payments.receipt_no` from `NSA-2627-001167` → `NSA-2627-001165`.

Seat receipt `NSA-2627-001097` retained; do **not** move seat payment onto evening enrollment.

### Access / reminders

- After repair, Inst 2 due 2026-10-10 → grace ≈ 2026-10-25. As of 2026-10-12 still in grace (access allowed).
- **Access reminder automation is LIVE** (`enabled=true`, `dry_run=false`). Repair would surface an overdue installment and can trigger SMS. Pause kill_switch / per-student suppress before execute.

---

## Case 2 — Akash Dhawan (…9232)

Enrollment `dfc3dfde-c122-4bee-b3cc-e001ac7d965e` · total_fee 35000 · discount 5000  
Schedule lines: seat 10000 + **8333 + 8333 + 8334** (= 25000).

### ₹1 explanation

EMI remainder after seat: `35000 − 10000 = 25000`.  
`floor(25000/3) = 8333`, last line `25000 − 8333×2 = 8334`.  
Not a bug in fee math — the false fully-paid state hid the unpaid 8333+8334.

| Field | Current | Proposed |
|---|---|---|
| Valid payments | seat ₹10000 (`3c401d33-…` / `MTK1SFRS-7CRQ`) + inst ₹8333 (`74c37dad-…` / `MUF6V8MJ-K9Q9`) | same |
| amount_paid | 35000 | **18333** |
| status | fully_paid | **partially_paid** |
| Seat | paid | paid |
| Inst 1 | paid (MUF6…) | paid (MUF6…) |
| Inst 2 | paid (same ref) | **unpaid** |
| Inst 3 (8334) | paid (same ref) | **unpaid** |
| Next due | — | Inst 2 **2026-10-09** |

### Receipts

**Seat `MTK1SFRS-7CRQ`:** canonical `NSA-2627-001388` (Book Your Seat); supersede 001389, 001390. Fix `payments.receipt_no` → 001388.

**Inst `MUF6V8MJ-K9Q9`:** canonical `NSA-2627-001502` (Installment 1 of 3, paid_to_date 18333); supersede 001503, 001504. Fix `payments.receipt_no` from 001504 → 001502.

### Access / reminders

- Demote `fully_paid` → `partially_paid` exits lifetime path; Inst 2 due 2026-10-09 → grace ≈ 2026-10-24 (still grace on 2026-10-12).
- Reminder automation LIVE — suppress before execute. Consider temporary access grant if ops want zero grace UX change.

---

## Case 3 — Sarah Pandher (…3754)

Enrollment `b1ee55ac-a2f2-458e-a1ae-96e94ac9fa89` · total_fee 75000  
Lines: seat 2000 + **24333 + 24333 + 24334** (= 73000).

### ₹1 explanation

`75000 − 2000 = 73000`; `floor(73000/3) = 24333`; last = `73000 − 24333×2 = 24334`.  
One ₹24333 payment must clear only Inst 2; Inst 3 remains ₹24334 outstanding.

| Field | Current | Proposed |
|---|---|---|
| Valid payments | seat 2000 + Inst1 24333 + Inst2 24333 (`3733de51-…` / `MUMLT4E9-JF5O`) | same |
| amount_paid | 75000 | **50666** |
| status | fully_paid | **partially_paid** |
| Inst 2 | paid | paid |
| Inst 3 (24334) | paid (same ref) | **unpaid** |
| Next due | — | Inst 3 **2026-12-10** |

### Receipts `MUMLT4E9-JF5O`

Canonical `NSA-2627-001525` (Installment 2 of 3, paid_to_date 50666); supersede 001526, 001527. Fix `payments.receipt_no` from 001527 → 001525.

### Access / reminders

- Next due Dec 10 — not overdue after repair; access stays active.
- Still pause reminders for this phone during the batch repair to avoid any ladder recompute edge case.

---

## Case 4 — Payal (…6942)

Enrollment `9e515d9f-091c-4123-8ee5-c641b5c51424` · total_fee 70000

| Valid PAID ledger | Amount | Ref |
|---|---|---|
| Legacy import | 38000 | `LEGACY-IMPORT-…-1` |
| Inst 1 of 8 | 4000 | `MRG73WZB-XUZF` |
| Cash offline | 4000 | `OFF-MSMZL7X3-Y2JN` |
| Inst 3 of 8 | 4000 | `MU3J8I31-8IHZ` |
| Inst 4 of 8 (race) | 4000 | `MUYZZS1A-IFSX` |
| **Total valid** | **54000** | |

| Field | Current | Proposed |
|---|---|---|
| amount_paid | 62000 | **54000** |
| status | partially_paid | partially_paid |
| Inst 4–6 | all paid with `MUYZZS1A-IFSX` | **only Inst 4 paid**; Inst 5–6 unpaid |
| Inst 7–8 | unpaid | unpaid |
| Next due | Inst 7 2027-01-16 (wrong) | Inst 5 **2026-11-16** |

### Receipts `MUYZZS1A-IFSX`

Canonical `NSA-2627-001570` (Installment 4 of 8, paid_to_date 54000); supersede 001571, 001572. Fix `payments.receipt_no` from 001572 → 001570.

Offline `OFF-…` row and receipt retained unchanged (legitimate bulk/offline path).

### Access / reminders

- Next due Nov 16 — not overdue. Reminder suppress during batch still required.

---

## Before/after summary

| Student | Paid now → proposed | Status now → proposed | Next due proposed | Canonical receipt | Supersede |
|---|---|---|---|---|---|
| Udaydeep | 18500 → 10250 | partially_paid → partially_paid | Inst2 2026-10-10 | NSA-2627-001165 | 001166, 001167 |
| Akash | 35000 → 18333 | fully_paid → partially_paid | Inst2 2026-10-09 | seat 001388; inst 001502 | 001389–90; 001503–04 |
| Sarah | 75000 → 50666 | fully_paid → partially_paid | Inst3 2026-12-10 | NSA-2627-001525 | 001526, 001527 |
| Payal | 62000 → 54000 | partially_paid → partially_paid | Inst5 2026-11-16 | NSA-2627-001570 | 001571, 001572 |

---

## Proposed execution plan (owner-approved only)

1. **Deploy sequence**
   1. Apply remaining migration: create/replace `finalize_course_payment` + grants (ledger already present).
   2. Deploy app code that calls the RPC.
   3. Optional backfill: insert `payment_finalize_ledger` rows for existing PAID course payments that already have receipts (`outcome='reconciled_existing'`) — prevents any edge path from treating them as new.
2. **Before repair writes**
   - Set `access_reminder_settings.kill_switch = true` (or `dry_run = true`) for the maintenance window.
   - Snapshot JSON of the four enrollments, related payments, and receipts (IDs above).
3. **Per enrollment, one transaction**
   - `SELECT … FOR UPDATE` enrollment + payments by id.
   - Precondition abort if `amount_paid`, schedule paid flags, or payment amounts differ from snapshot.
   - Rewrite schedule paid flags to proposed state (do not change line amounts).
   - Set `amount_paid` / `status` from fee-state rules.
   - Soft-supersede duplicate receipts; set `canonical_receipt_id`; fix `payments.receipt_no`.
   - Upsert finalize ledger for touched payment_ids.
   - **Do not** call `runPaidTerminalSideEffects`, send SMS, or revoke entitlements.
4. **After repair**
   - Verify fee-state + receipt canonicalization with read queries.
   - For Udaydeep/Akash: decide whether to leave natural grace or add a short staff access grant before re-enabling reminders.
   - Restore reminder settings only after explicit approval.

### Rollback

- Restore enrollment `schedule` / `amount_paid` / `status` from snapshot.
- Clear `superseded_at` / `superseded_reason` / `canonical_receipt_id` on soft-superseded receipts.
- Restore prior `payments.receipt_no`.
- Do **not** delete receipts. Do **not** invent compensating payments.
- If a legitimate new payment landed after snapshot, abort that enrollment’s rollback overwrite (precondition on `updated_at` / new payment ids).

---

## Decisions needing approval

1. Deploy migration + app before any repair writes.
2. Pause live access-reminder automation for the repair window.
3. Accept demoting Akash/Sarah from `fully_paid` (correct ledger) knowing Class Hub switches from lifetime to installment-tied access (both currently still within grace / not yet due).
4. Whether to issue temporary staff access grants for Udaydeep/Akash so grace UX does not change.
5. Whether to soft-supersede seat duplicate receipts for Akash (schedule already correct for seat) in the same batch.
6. Confirm canonical receipt choices above (evidence-based, not last `payment.receipt_no`).
