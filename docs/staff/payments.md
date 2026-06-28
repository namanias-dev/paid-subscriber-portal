# Payments & Finance

**Menu:** `People` → `Payments & Finance`  ·  **Web address:** `/admin/payments`
**Related pages:** `Course EMI & Seats` (`/admin/course-payments`) and `Access at Risk` (`/admin/access-risk`).
**Who can open them:** staff whose role has **View revenue dashboards**. Re-verifying needs **View revenue** or **Manage payments**. **Uploading proof and approving a payment** need **Manage payments**. **Reversing an approval** and the **Staff accountability** report are **Super Admin only**.

## What this page is for

This is the money screen. It shows every payment transaction (ICICI and older Razorpay), revenue, and collections. Heading: `Payments & Finance`, subtitle `Razorpay & ICICI transactions, revenue & collections`.

> ⚠️ **Recording a cash/UPI/bank (offline) payment? Don't look here.** Offline payments are **always** recorded from the student's profile (`People` → `Students & Enrollments` → open the student → `Record payment`), never on this Payments page. See [Students & Enrollments](students) and [Course & Portal Access](course-access).

## Payment statuses (what each one means)

| Status shown | Meaning | Has access? |
|---|---|---|
| `PAID` | Payment succeeded (ICICI, or accepted manually, or recorded offline). | ✅ Yes |
| `PENDING` | Started but not confirmed yet, still within the waiting window. | ❌ No |
| `VERIFYING` | Waiting window passed; the system is re-checking with ICICI. | ❌ Not yet |
| `ABANDONED` | The person started paying but never finished. A hot lead to call. | ❌ No |
| `FAILED` | The payment was declined or cancelled. | ❌ No |
| `refunded` | Old Razorpay refund. Not counted as paid. | ❌ No |

> Only `PAID` (and the old `captured`) grant access. The system **never** downgrades a paid record.

**Filter chips** at the top let you show: `Paid`, `Pending`, `Verifying`, `Abandoned`, `Failed`, `Needs verification`, and `Proof uploaded`.

## Verifying an online payment

Payments are confirmed by **re-verifying** with the bank (ICICI). There is no separate "Verify" button — look for **re-verify**.

### Re-verify a single stuck payment
1. Find the row (it must have an ICICI reference). Non-paid rows show a small **`↻`** icon (tooltip: `Re-verify this payment with ICICI`).
2. Click **`↻`**. The system checks with ICICI and updates the status to `PAID`, `FAILED`, or `ABANDONED` as appropriate.
3. If you see `This row has no ICICI reference to verify.`, that payment can't be checked this way (e.g. it was an old Razorpay one).

### Re-verify many at once
- Click **`↻ Re-verify payments`** (header) to re-check all non-paid records, or
- Apply filters first, then click **`Re-verify filtered (N)`** to re-check just those.

> Re-verifying is **safe** — it can only upgrade or correctly fail a payment; it never removes access from someone already `PAID`.

## Payment proofs & approving a payment

Every payment row now has a **`Manage`** button (for staff with **Manage payments**). It opens the **`Manage payment`** window where you can upload proof, approve, ask for a better screenshot, and (Super Admins) reverse or see the full history. Students can also upload proof themselves from their portal — both land in the same place.

> 💡 **Login codes:** as soon as a student starts a payment (even before it's confirmed) they now get a portal **login code**, so they can sign in to upload their own proof and track status. You no longer have to wait for `PAID`.

### Find a payment to manage
1. Search by name / phone / item / reference, or use the **`Proof uploaded`** filter chip, or look for a **`📎`** badge.
2. Click **`Manage`** on the row (or click the **`📎`** badge to jump straight to an existing proof).

### Upload payment proof on a student's behalf
Use this when a student sends you a screenshot over WhatsApp/email instead of uploading it themselves.
1. In the `Manage payment` window, under **`Upload payment proof (on student's behalf)`**, click **Choose files** and pick the screenshot(s)/PDF (images or PDF, up to 3 files, 8 MB each).
2. The files upload to secure storage and attach to the payment. ⚠️ **Uploading proof never grants access by itself** — you still have to approve.

### View an uploaded proof
- In the `Uploaded files` list, click **`View (signed) →`** to open each screenshot/PDF in a secure, short-lived link.

### Approve a payment and grant access
1. In the `Manage payment` window, click **`✓ Approve payment & grant access`**.
2. Confirm the dialog: `Approve payment and grant access to {name}? This marks the payment PAID.`
3. The payment becomes `PAID` and the student gets access (this runs the exact same steps a normal bank confirmation does — login code + course access). ⚠️ **This is real and grants access — only do it once you've checked the screenshot is genuine.**
4. If you see a banner saying the student already has access, approving is usually unnecessary.

### Ask for a better screenshot / reject
- **`Request reupload`** — asks the student to upload again (type a `Reason` they'll see).
- **`Reject proof`** — rejects it (type a `Reason`). This does **not** grant access.
- **`Add note`** — an internal note for staff only.

> ⚠️ Approving (with or without proof) is the **only** way to move a `FAILED` payment to `PAID` by hand. Every upload and approval is recorded against your name in an audit log.

## Reversing an approval (Super Admin only)

If a payment was approved by mistake (e.g. a fake screenshot), a **Super Admin** can undo it.
1. Open the payment's **`Manage`** window. For a `PAID` row, scroll to the red **`Reverse approval (Super Admin)`** box.
2. Type a **reason** (required) and click **`↩ Reverse approval`**, then confirm.
3. The payment goes back to its previous status, the student's access is **re-locked**, and for course EMIs the settled installment + receipt are rolled back. **Nothing is deleted** — the payment record and the proof files are kept, and the reversal is logged.

> Reversal is permission-gated to Super Admins. Regular staff do not see this option.

## Staff accountability report (Super Admin only)

At the top of the Payments page, Super Admins see a **`Staff accountability (Super Admin)`** panel (click **`View`**).
- It shows **per staff member**: how many proofs they uploaded, how many payments they approved, plus reversals and rejections, and their last action time.
- Click **`Drill-down`** on any staff member to see their recent individual actions (which payment, the status change, reason, and time).
- ⚠️ Regular staff **cannot** see this panel — it's Super Admin only.

## Recording an OFFLINE payment (cash / bank transfer / UPI)

⚠️ **Important:** There is **no offline-payment button on this Payments page.** Offline payments are recorded from the **student's profile**. See the **Students & Enrollments** and **Course & Portal Access** guides for the full step-by-step. In short:

1. Go to `People` → `Students & Enrollments` and open (or create) the student.
2. Enroll them in the course if needed (`Enroll`).
3. On the course card, click **`Record payment`**, choose what to settle, pick `Method` (`Cash` / `Bank Transfer` / `Offline UPI`) and date, then click **`Record {amount}`**.

This creates a `PAID` record (marked as offline) and a receipt.

## Converting a student from Full Payment to EMI / Custom installments

If a student paid (or booked) a course as **Pay in Full** and later wants **EMI** or a **custom** schedule (or vice-versa), don't re-enrol them. Open their profile → on the course card use **`Change plan`** (paid amounts are always preserved) or **`Manage installments`**. Full guide, including how due dates drive the 15-day access timer: **[Changing a Student's Payment Plan](payment-plans)**.

## Editing or deleting a payment (Super Admin only)

Open any payment's **`Manage`** window. Super Admins see an amber **Edit / delete payment** box:

- **Edit fields** — correct the **Amount**, **Status**, **Reference no.**, or **Student name**. A **Reason** is required and every change is saved to the immutable audit log (old → new values). Changing a course payment's amount/status/reference automatically **recomputes the enrollment** (balance, installments, access).
- **🗑 Move to Trash (recoverable)** — a soft-delete. The payment is **never erased** — it goes to **Trash** and can be restored anytime. If the deleted payment was PAID, access is safely re-locked and the balance recomputed. A reason is required.

### Trash (recover a deleted payment)
Click **🗑 Trash** at the top-right of the Payments page (Super Admin only):
- **Restore** — brings the payment back and re-applies its effect on the student's balance/access.
- **Delete forever** — permanent, irreversible removal (only possible for items already in Trash). You must type a reason; it is logged **before** the row is removed.

⚠️ Staff (non-super) cannot edit, delete, restore, or permanently delete payments — those controls only appear for Super Admins.

## Refunds

⚠️ There is **no "mark refunded" button** anywhere in the admin panel. The `Refunded` figure on this page only **displays** old Razorpay refunds. Refunds must be handled outside this system (e.g. directly in the payment gateway / bank), and there is currently no way to record a new refund here. Flag refund requests to a Super Admin / finance.

## Following up on failed, pending and abandoned payments

- **Abandoned checkouts** appear as `🔥 Hot leads — abandoned checkouts`. For each you can `Call`, `WhatsApp`, `↻ Verify`, or `SMS`.
- Use **`SMS`** (needs the send-SMS permission) to nudge a pending/failed payer.
- Use **`⬇ Export`** / **`⬇ Export (filtered)`** to download `payments.csv` for follow-up calling. ⚠️ Contains personal data.

## Course EMI & Seats (`/admin/course-payments`)

A read-only overview of installment/seat plans. Enrollment statuses: `Pending`, `Seat Booked`, `Partially Paid`, `Fully Paid`, `Cancelled`. Overdue installments show `· OVERDUE` in red.

## Access at Risk (`/admin/access-risk`)

Lists learners whose lecture access is blocked or expiring, so you can recover revenue. Per learner you can:
- **`+1 month`** — grant 1 more month of access.
- **`Lifetime`** — grant permanent access.
- **`Revoke`** — block access. ⚠️ Immediately stops their lectures.
- **`Call`** — phone them.

## Where the data comes from
- All transactions → the `payments` table.
- Student & staff screenshots → `payment_proofs` (files stored privately).
- Every proof upload, approval, rejection and reversal → the immutable `payment_action_log` (this powers the per-payment history and the Super Admin accountability report). It is append-only — entries are never edited or deleted.
- Online payments are written by the **ICICI Eazypay** return/verify and the older **Razorpay** webhook. Offline ones are written when staff record them. (There is no Pabbly here.)
