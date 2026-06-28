# Changing a Student's Payment Plan: Full Payment → EMI / Custom Installments

Use this when a student first chose **Pay in Full** (or booked a seat to pay in full) but later asks to pay in **EMI** or a **custom installment** schedule — or the other way round. Everything the student has already paid is **always kept**. You only restructure the money that is *still outstanding*.

> ⚠️ This changes how the student pays the **remaining** balance. It never deletes any past payment or receipt, never creates a duplicate enrolment, and never touches their login code.

---

## Where to go

1. Open **Admin → Students & Enrollments**.
2. Click the student to open their profile.
3. Scroll to the **Enrolled courses** card.
4. On the course you want to change, you'll see two buttons:
   - **Change plan** — switch between Full / EMI / Custom.
   - **Manage installments** — edit due dates, waive or cancel a single installment, and see the plan-change history.

Each course shows a small **plan badge** (Full payment / EMI / Custom installments) and, if it was changed before, a "was …" note.

---

## Change a plan (Full → EMI)

Example: *Safalta Online Foundation*, fee ₹40,000. Student paid ₹2,000 (seat). Outstanding ₹38,000. They now want EMI.

1. On the course card, click **Change plan**.
2. The window shows **Paid so far**, **Outstanding**, and the **current plan**.
3. Under **New plan**, choose **EMI**.
4. Pick the **number of installments** (e.g. 6). It shows roughly how much each installment will be (the last one absorbs any rounding).
5. Type a short **Reason** — e.g. *"Student requested EMI after booking seat"*. (Strongly recommended; it's saved in the history.)
6. Click **Apply plan change**.

What happens:
- The ₹2,000 already paid stays exactly as it is.
- The ₹38,000 outstanding is split into the installments you chose, with due dates based on the course schedule.
- The student's portal immediately shows the new **installment schedule** instead of one big balance.
- Any unfinished "pay in full" attempt the student started earlier is cleared so it can't reappear.

---

## Change a plan (EMI → Full)

1. Click **Change plan** → choose **Full payment** → add a reason → **Apply plan change**.
2. All **paid** installments are kept. The remaining unpaid installments are **superseded** and replaced by a single **Remaining balance** line.
3. The student can now pay the whole remaining amount in one go.

---

## Custom installments (staff only)

Custom installments are never shown to students during public checkout — only you can build them here.

1. Click **Change plan** → choose **Custom (staff)**.
2. Add one row per installment: **title**, **amount**, **due date**, and an optional **grace date**.
3. Use **+ Add installment** for more rows. The running total is shown.
4. The installments should total the **outstanding** amount. If they don't, the system asks you to **re-confirm** because you're effectively changing the course fee (a discount or extra charge).
5. Add a reason → **Apply plan change**.

---

## How due dates affect access (the 15-day rule)

Course access follows one rule across the whole system:

- A student keeps access as long as no installment is **more than 15 days past its due date**.
- Once an installment is **15+ days overdue**, access is **automatically revoked** until it's paid.

Because of this:

- ✅ A student who is paid-up for now keeps access even if a *future* installment is scheduled.
- ⚠️ If you set or edit a due date that is **already more than 15 days in the past**, saving it will **immediately revoke** the student's access. The system warns you and makes you tick a box to confirm before it saves. Don't backdate due dates unless you really mean to.

The optional **grace date** simply lets you set an explicit cut-off instead of the default "due + 15 days" — it uses the same single access rule, not a separate one.

---

## What the student sees

- On their next login (or any portal page), the affected student gets a one-time premium notice: **"Your payment plan has been updated"**, with their paid amount, outstanding, and next installment.
- Tapping **View installments** (or **Got it / Go to Dashboard**) marks it as seen so it won't show again — unless you change the plan again.
- On **My Courses & Payments → the course**, they now see the full schedule, what's paid, what's outstanding, the next due installment, and **Pay now** buttons (using the normal payment gateway).

---

## Recording future installment payments

When the student pays an installment later:

- **Online:** they pay it themselves from their portal (the usual Pay now flow).
- **Offline / cash:** on the course card, click **Record payment**, choose the specific installment (or **Pay full remaining balance**), pick the method and date, and save. A branded receipt is generated automatically.

Use **Manage installments** to edit a due date, **waive** an installment (forgives that amount and lowers the fee), or **cancel** one — all without losing any paid history.

---

## ⚠️ Things to check before you save

- **Verify the outstanding amount** shown matches what you expect before applying.
- **Never** create a second enrolment to "redo" a plan — always use **Change plan** on the existing one.
- **Never** delete old payments; they are the official record. Changing a plan never deletes them.
- **Beware backdated due dates** — anything 15+ days in the past revokes access on save.
- Always add a **reason** so the next staff member understands why the plan changed.

---

**Related guides:** [Students & Enrollments](students.md) · [Payments & Finance](payments.md)
