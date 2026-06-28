# Troubleshooting

Common situations and what to check. Most "missing" things are permissions, not bugs.

## "A menu item / button is missing for me"
Your **role** doesn't have that permission. This is intended. See **Roles & Permissions**. Ask a Super Admin to adjust your role if you need it.

## "I can't open SMS Mission Control"
You need the **Send SMS** permission. Super Admin, Admin, Content Admin, and Support/Operations have it by default.

## "The SMS Send button says no templates"
Message: `No Approved/Active templates…`. A **Super Admin** must open `SMS Mission Control` → `Templates`, paste the **DLT Template ID**, and set the status to **Approved** or **Active** first.

## "My SMS didn't go out / Overview says OFF"
Sending is **off by default**. It only works when the kill switch is on (`SMS_ENABLED=true` plus the soft `Master kill switch`). Also check: daily cap reached, per-mobile cap, the 30-minute same-template guard, or (for automations) the send window. Check the `Logs` tab — the row shows the reason/error.

## "A payment shows pending but the student paid online"
Click **`↻`** on that row (or `↻ Re-verify payments`) to re-check with ICICI. If it has no ICICI reference, it can't be auto-verified — ask the student for proof and accept it.

## "A student can't log into the portal"
- Make sure you're giving them the **`Portal`** code (7 characters), not the `Access` code.
- Confirm their access isn't `Revoked` (profile `Access control` → `Restore`).
- Confirm they actually have an enrollment / valid payment.
- Resend the code via `SMS` (`Login Code Resend`) or by copying the `Portal` chip.

## "A paid student isn't in the Students list"
On `Students & Enrollments`, click **`Sync paying students`** to pull them in.

## "The webinar Attended column is all blank"
That's expected — it isn't auto-filled. Use the SMS `Attended`/`No-show` audiences or the Analytics `Paid webinar · no Zoom click` segment to find real attendance.

## "I need to refund someone"
There is **no refund button** in the admin panel. Escalate to a Super Admin / finance; refunds are handled in the payment gateway/bank.

## "I accidentally moved a lead to the wrong stage"
Just open the lead and pick the correct `Pipeline stage` again. (Note: setting `Admitted` also flags admission.)

## "I deleted something — can I undo it?"
⚠️ Deletes are usually permanent. Deleting a webinar also deletes its registrations. There is no undo. If unsure, **disable** instead of delete where that option exists.

## Still stuck?
Open **`❓ Help & Learn`** and use **Ask a question** to message a Super Admin with your question.
