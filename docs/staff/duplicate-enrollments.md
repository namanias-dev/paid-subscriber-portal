# Duplicate Enrollments — Merge / Cancel tool

**Who can use this:** Super Admin only.
**Where:** Left menu → **People → Duplicate Enrollments**. A red alert also appears on the **Dashboard** whenever duplicates exist, with a **Review & merge →** button.

## What is a "duplicate enrollment"?

When a student clicks **Book Your Seat** more than once for the **same course** (often because the payment page was slow and they retried), the system used to create a brand-new enrollment each time. The result: one student showing 2, 3 or 4 copies of the same course — and their **outstanding balance gets multiplied** (e.g. 4 × ₹45,000 = ₹1,80,000 instead of ₹45,000).

> ✅ New bookings are now **blocked from duplicating** automatically. This tool is for cleaning up old duplicates and any rare edge cases.

## How to merge duplicates

1. Open **People → Duplicate Enrollments** (or click **Review & merge** on the dashboard alert).
2. Each student with duplicates shows as a card with **all their copies side by side** (fee, paid, outstanding, status, date).
3. The system pre-selects the best one to **Keep this** — the copy with the most money paid (or the earliest one if none are paid). You can change which one to keep with the radio button.
4. Type a short **Reason** (saved to the audit log).
5. Click **Merge → keep 1, cancel N**.

### What merging does
- Keeps **one** enrollment as the real one.
- Marks the other copies as **cancelled** (they disappear from the student's portal and from balance totals).
- **Never deletes payments.** Any real (paid) money is re-pointed to the kept enrollment. Unpaid/abandoned attempts on the cancelled copies are marked **Abandoned** (kept for history).
- Recomputes the **single correct balance** and shows you **before → after** (e.g. "Outstanding ₹1,80,000 → ₹45,000").
- Logs who merged, what was cancelled, and the old→new balance.

⚠️ **"Multiple paid" warning:** if more than one copy has real money on it, the card shows an amber warning. Double-check which copy to keep before merging — the kept copy receives all re-pointed payments.

The dashboard badge **clears automatically** once every student has only one active enrollment per course.
