# Students & Enrollments

**Menu:** `People` → `Students & Enrollments`  ·  **Web address:** `/admin/students`
**Who can open it:** staff whose role has **Manage students, leads & enrollments**.

## What this page is for

Every paying (or enrolled) student lives here — their courses, webinars, EMI/seat plans, access status, payments, and login codes. Heading: `Students & Enrollments`, subtitle `Every paying student — courses, webinars, EMI & access — in one place`.

## Finding a student

- **Search box:** `Search by name, phone or login code`.
- **Filters:** `All enrollments` (also `Course students`, `Webinar registrants`, a specific course, or a specific webinar), `Any payment` (`Fully paid`, `Partial (EMI/seat)`, `Outstanding balance`, `Free`), and `Any access` (`Active`, `Expiring`, `Expired`, `Lifetime`, `Revoked`).
- **Sort:** `Latest first`, `Oldest first`, `Balance (high→low)`, `Total paid (high→low)`, `Name (A→Z)`.
- Click **`View`** on a row to open the full profile.

### If a paying student is missing from the list
Click **`Sync paying students`** (tooltip: `Pull any paying students (online/offline) into this list`). This safely pulls in anyone who has paid but isn't shown yet. It never deletes anything.

## Two kinds of login code (important!)

A student can have two different codes — don't mix them up:

| Code | Shown as | Used to log into |
|---|---|---|
| **Access code** (`NS-…`) | `Access` chip | The LMS/subscription dashboard (only for subscription students) |
| **Portal login code** (7 characters) | `Portal` chip | The student portal at `/portal` (courses, webinars, purchases) |

For most course/webinar students, the one they need to log into the portal is the **`Portal`** code. Both appear in the profile header when they exist. Click a code chip to copy it.

## "How do I…" recipes

### Create a brand-new student
1. Click **`+ Add Student`** (opens `/admin/students/new`).
2. Under **`Profile`**, fill `Full name *` and `Phone (10-digit) *` (required); optionally `Email`, `Target year`, `Access validity` (e.g. `3 Months`), and `Internal notes`.
3. (Optional) Under **`Enroll into courses`**, tick a course and choose `Pay in full`, `EMI / Installments`, or `Complimentary`.
4. (Optional) Under **`Register for webinars`**, tick any webinars.
5. (Optional) Under **`Record initial payment`**, record their first offline payment.
6. Click **`Create student`**.
7. On the success screen (`Student created`) you can `Copy` the access code, `Send on WhatsApp`, or `Open profile →`.

> ⚠️ The success screen shows the **`Access`** code. If you enrolled them in a course, they also get a **`Portal`** code — find it on their profile header to share for portal login.

### Edit a student's details
1. Open the profile → click **`Edit`** (`Edit profile` window).
2. You can change `Name`, `Email`, `Target year`, `Internal notes`. **The phone number cannot be changed here.**
3. Click to save.

### Enroll an existing student in a course
1. Open the profile → in **`Enrolled courses`** click **`Enroll`**.
2. Choose the `Course`, pick `Pay in full` / `EMI` / `Complimentary` (and installments / `Book seat first` if relevant).
3. Click **`Enroll`**.

### Change an existing enrolment's payment plan (Full ↔ EMI ↔ Custom)
On the course card, click **`Change plan`** (switch Full/EMI/Custom — paid amounts are kept) or **`Manage installments`** (edit due dates, waive or cancel an installment, see history). Full step-by-step, including how due dates affect the 15-day access timer and what the student sees: **[Changing a Student's Payment Plan](payment-plans)**.

### Register an existing student for a webinar
1. Open the profile → in **`Webinars registered`** click **`Register`**.
2. Choose the `Webinar`. Enter `Amount paid (₹, leave 0 for free)`. If more than 0, pick `Method` and `Date (IST)`.
3. Click **`Register`**.

### Record an offline payment for a course
1. Open the profile → on the course card click **`Record payment`** (`Record payment · {course}`).
2. Choose what to `Settle` (a specific installment or `Pay full remaining balance`), pick `Method` (`Cash` / `Bank Transfer` / `Offline UPI`), set the `Date (IST)`, and optionally a `Reference / note` (e.g. `Receipt book #42`).
3. Click **`Record {amount}`**. You'll see `Payment recorded`, and a receipt is generated (download it from the `Payments ledger` section → `PDF`).
4. ⚠️ This creates a permanent paid record and receipt — it can't be undone in the app (a correction means issuing a new receipt).

### Full flow: a student who paid OFFLINE (cash/UPI), enroll them
1. `People` → `Students & Enrollments`. Search their phone. If not found, click **`+ Add Student`** and create the `Profile`.
2. (If creating fresh, you can do steps 3–4 right inside the create form using `Enroll into courses` + `Record initial payment`.)
3. Open the profile → **`Enroll`** into the course → choose `Pay in full` or `EMI` → **`Enroll`**.
4. On the course card → **`Record payment`** → choose what to settle → `Method` = `Cash`/`Bank Transfer`/`Offline UPI` → **`Record {amount}`**.
5. Share their **`Portal`** login code (copy the chip, or use the `SMS` button with the `Login Code Resend` template, or WhatsApp).

### See a student's journey
On the profile, in **`Customer journey`**, click **`View journey`** to see their timeline (pages, payments, logins, Zoom clicks).

## What the profile shows
A single scrolling page with: header (name, status, phone, email, `Access`/`Portal` codes, `SMS` button, `Edit`, `Revoke`/`Restore`, `+30 days`), KPI tiles (`Total paid`, `Outstanding`, `Next due`, `Tests attempted`), `Access control`, `Customer journey`, `Enrolled courses`, `Webinars registered`, `Payments ledger`, and `Activity & performance`.

## What you can't do here (by design)
- You can't **regenerate** a student's portal login code from these pages (only staff test accounts can be regenerated, on the Staff page).
- There's no single "Resend access" button — instead copy the code, use `SMS`, or `Send on WhatsApp` (on the create screen).
- You can't delete a student from the screen, and you can't change their phone number.
- Per-course access grant/revoke is done on the **Access at Risk** page, not the profile (see **Course & Portal Access**).

## Where the data lives
- `students` (main record), `buyers` (portal login), `course_enrollments` (modern course purchases), `webinar_registrations`, `payments` + `payment_receipts`, `course_access_overrides` (per-course access).
