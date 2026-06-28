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

## How this relates to "Pending / attempted" registrations

The Merge tool and the dashboard badge now only ever look at **real enrollments** — a student who paid (even partially) or was granted comp access. Repeated *unpaid* attempts (someone clicking "Book your seat" several times without completing payment) are **no longer treated as duplicate enrollments**. They show up as a single **Pending / attempted registration** card on the student's profile and never inflate counts or balances, so the badge stays quiet for them.

That means you should rarely need this tool now — duplicates are prevented at the source. It remains for the rare case where two *paid* enrollments exist for the same course.

### One-off cleanup (Super Admin, technical)
There is a safe, reversible cleanup endpoint `POST /api/admin/enrollments/backfill` that supersedes leftover duplicate **attempt** rows (keeping one booking intent per course, never deleting payments, fully audit-logged). It runs as a **dry-run by default** — send `{ "apply": true }` only after reviewing the previewed `actions`. In practice the live data is already clean, so it reports zero changes.
