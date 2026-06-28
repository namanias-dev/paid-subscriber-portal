# Payments & Finance

**Menu:** `People` → `Payments & Finance`  ·  **Web address:** `/admin/payments`
**Related pages:** `Course EMI & Seats` (`/admin/course-payments`) and `Access at Risk` (`/admin/access-risk`).
**Who can open them:** staff whose role has **View revenue dashboards**. Accepting proofs and re-verifying also need **View revenue** or **Manage payments**.

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

## Payment proofs (student-submitted screenshots)

If a student paid but the system shows it as not paid, they can upload proof from their portal. You then review it.

### Find and review a proof
1. Use the **`Proof uploaded`** filter chip, or look for a **`📎`** badge on a payment row (e.g. `📎 Proof uploaded`). Click it.
2. The `Payment proof` window opens. Click **`View (signed) →`** to open each screenshot/PDF.

### Approve a proof and grant access
1. In the proof window, click **`✓ Accept payment & grant access`**.
2. Confirm the dialog: `Accept payment and grant access to {name}? This marks the payment PAID.`
3. The payment becomes `PAID` and the student gets access. ⚠️ **This is real and grants access — only do it once you've checked the screenshot is genuine.**
4. If you see a banner saying the student already has access, accepting is usually unnecessary.

### Ask for a better screenshot / reject
- **`Request reupload`** — asks the student to upload again (type a `Reason` they'll see).
- **`Reject proof`** — rejects it (type a `Reason`). This does **not** grant access.
- **`Add note`** — an internal note for staff only.

> ⚠️ Uploading or accepting proof is the **only** way to move a `FAILED` payment to `PAID` by hand.

## Recording an OFFLINE payment (cash / bank transfer / UPI)

⚠️ **Important:** There is **no offline-payment button on this Payments page.** Offline payments are recorded from the **student's profile**. See the **Students & Enrollments** and **Course & Portal Access** guides for the full step-by-step. In short:

1. Go to `People` → `Students & Enrollments` and open (or create) the student.
2. Enroll them in the course if needed (`Enroll`).
3. On the course card, click **`Record payment`**, choose what to settle, pick `Method` (`Cash` / `Bank Transfer` / `Offline UPI`) and date, then click **`Record {amount}`**.

This creates a `PAID` record (marked as offline) and a receipt.

## Converting a student from Full Payment to EMI / Custom installments

If a student paid (or booked) a course as **Pay in Full** and later wants **EMI** or a **custom** schedule (or vice-versa), don't re-enrol them. Open their profile → on the course card use **`Change plan`** (paid amounts are always preserved) or **`Manage installments`**. Full guide, including how due dates drive the 15-day access timer: **[Changing a Student's Payment Plan](payment-plans)**.

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
- Student screenshots → `payment_proofs`.
- Online payments are written by the **ICICI Eazypay** return/verify and the older **Razorpay** webhook. Offline ones are written when staff record them. (There is no Pabbly here.)
