# Course & Portal Access (and Login Codes)

This guide pulls together everything about **giving, removing, and resending access** and **login codes**. These actions live across the **Students**, **Access at Risk**, and **SMS** pages.

**Who can do most of this:** staff with **Manage students, leads & enrollments**. The **Access at Risk** page needs **View revenue**.

## The two login codes (recap)

- **Access code** (`NS-…`) — shows as the `Access` chip; for the LMS/subscription dashboard.
- **Portal login code** (7 characters) — shows as the `Portal` chip; for the student portal at `/portal` (this is the one most course/webinar students use).

Both are visible on the student's profile header. **Click a code chip to copy it.**

## Granting access

There are several kinds of "access". Pick the one that matches the situation:

### 1. Enroll in a course (gives Class Hub access)
On the student profile → **`Enrolled courses`** → **`Enroll`** → choose course and plan:
- **`Pay in full`** or **`EMI`** — access follows the payment (record payments to unlock).
- **`Complimentary`** — free, immediate full access at ₹0 (no payment needed).

### 2. Register for a webinar
On the student profile → **`Webinars registered`** → **`Register`** → choose webinar, enter amount (`0` = free) → **`Register`**.

### 3. Subscription / LMS access (validity)
On the student profile, in **`Access control`**:
- **`+30 days`** — extend by a month.
- **`1M`**, **`3M`**, **`6M`**, **`12M`** — set a validity period.
- **`Lifetime ∞`** — never expires.
- `Custom valid-till date (IST)` + **`Set date`** — pick an exact end date.

### 4. Per-course lecture access (grant/extend/revoke)
This is on the **`Access at Risk`** page (`People` → `Access at Risk`, needs **View revenue**):
- **`+1 month`** — grant ~1 month of lecture access.
- **`Lifetime`** — grant permanent lecture access.

## Revoking (removing) access

⚠️ **These take effect immediately.**

- **Subscription/LMS:** on the profile `Access control`, click **`Revoke`**. To undo, click **`Restore`**. (Their data is kept; they just can't log in / open gated content.)
- **Per-course lecture access:** on **`Access at Risk`**, click **`Revoke`**.

> There is **no** "revoke a single course enrollment" button on the profile, and no webinar "unregister" button.

## Resending access / login details

There is no single "Resend" button, but you have three reliable ways:

1. **Copy the code** — click the `Portal` (or `Access`) chip on the profile to copy, then paste into WhatsApp/SMS yourself.
2. **SMS** — click **`SMS`** on the profile, choose the **`Login Code Resend`** template (or a payment/enrollment template that includes the code), then **`Send`**. The code is filled in automatically. (Needs the send-SMS permission, and a Super Admin must have Approved/Activated that template first.)
3. **Send on WhatsApp** — available on the **create-student success screen** only (sends the access code with a welcome message).

## Regenerating a login code

⚠️ You **cannot** regenerate a normal student's portal login code from the admin pages. Only **staff test accounts** can have their code regenerated (Staff & Roles → `Regenerate code`). If a real student's code is compromised, escalate to a Super Admin.

## Quick decision guide

| Situation | Do this |
|---|---|
| Student paid online, has access | Nothing — access is automatic on `PAID`. |
| Student paid offline (cash/UPI) | Enroll → `Record payment` (see Students guide). |
| Give free access to a course | Enroll → choose `Complimentary`. |
| Student's lectures got blocked for dues | `Access at Risk` → `+1 month` / `Lifetime`. |
| Student can't find login code | Open profile → copy `Portal` chip, or `SMS` the `Login Code Resend` template. |
| Need to stop someone's access | Profile `Revoke` (LMS) or `Access at Risk` `Revoke` (course lectures). |
