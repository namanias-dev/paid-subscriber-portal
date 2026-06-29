# Webinars & Events

**Menu:** `Academics` → `Webinars & Events`  ·  **Web address:** `/admin/webinars`
**Who can open it:** staff whose role has **Manage webinars & events**.

## What this page is for

Create and manage webinars. Each webinar **automatically creates a public registration page** at `/webinars/<slug>`. Heading: `Webinars & Events`, subtitle `Each webinar auto-creates a public registration page`.

## The list page

Columns: `Title`, `When`, `Price` (`Free` or amount), `Regs` (a `View registrants` link), `Status`, `Share`, and actions.
- **`+ New Webinar`** — create a webinar.
- **`Copy link`** / **`WhatsApp`** (under `Share`) — share the public registration page.
- **`Edit`** — edit it.
- **`Duplicate`** — make a copy for the next session (see *Duplicating a webinar* below).
- **`Disable`** / **`Enable`** — hide/show on the public site (reversible).
- **`Delete`** — ⚠️ **permanently deletes the webinar AND all its registrations.** This cannot be undone.

**Status badge** is now computed automatically and is always accurate:
- `Upcoming` — in the future, registration open.
- `Live` — happening now.
- `Ended` — the start time has passed; **registration is auto-closed** and new payments are rejected.
- `Registration Closed` — you manually closed registration (even before the start).
- `Recording` — a completed/recorded session that still sells the recording (stays open on purpose).
- `Disabled` — hidden from the public site.
- `Draft` — not yet published.

> A past-start webinar will **never** show "Upcoming" again — it shows `Ended` and stops taking money.

## Registration window (auto-close)

In **`Edit` → Basic Details → Registration window`** you control when people can register & pay:
- **`Registration`** — `Open` (normal), `Closed` (stop now), `Disabled` (hide), or `Draft` (not published yet).
- **`Auto-close at start`** (on by default) — once the start time (or your custom cutoff) passes, the public **Register / Pay** button disappears **and the server refuses new payments**. This is the safeguard that stops people paying for a session that already happened.
- **`Custom registration cutoff (IST)`** — optional; close registration earlier than the start time. Leave blank to close at the start.

The expired public page shows: **"This webinar has ended"** with a button to **upcoming webinars** — or, if you linked a next session (via Duplicate), **"Register for the next live session."**

> Recording / completed sessions stay open on purpose so you can keep selling the recording. Turn **Auto-close** off if you ever want a live session to keep accepting registrations after it starts.

## Duplicating a webinar

Use **`Duplicate`** on the list to spin up the next session in seconds. It opens **Duplicate webinar** and copies **all** content, media, price, seats, mentor, reviews, SEO, WhatsApp and registration settings **by reference** — ⚠️ no files are re-uploaded, so it never wastes storage.

You set:
- **New date & time (IST)** (required) and optional **End time**.
- **Slug** — leave blank to auto-generate (e.g. `upsc-strategy-01072026`).
- **Publish state** — `Draft` (hidden while you finish editing) or `Live` (public immediately).
- **Copy the Zoom / joining link** — usually off (you'll set a fresh link).
- **Mark the original as ended** (on by default) — closes the old session's registration and links the two so the old page points students to the new one.

Registrants and payment attempts are **not** copied. The original is kept (archived/ended), not deleted.

## Moving late registrations to the next session

If people registered/paid for a session that has now passed, move them forward instead of refunding. On **`View registrants`**, click **`Move late registrations`**:
1. Pick the **target webinar**, an optional **cutoff** (only people who registered after this time), and which **statuses** to include (`Paid`, `Pending/Verifying`; free registrants are always included; `Failed`/`Abandoned` are excluded).
2. Click **`Preview (dry run)`** — you'll see totals, a per-status breakdown, and a list (name / mobile / login code / status / amount) of exactly who will move. **Nothing changes yet.**
3. Click **`Confirm move`** to apply.

What a move does (and does **not**) do:
- ✅ Re-points each person's registration (and their paid payment) to the new webinar, so their **portal immediately shows the new date**.
- ✅ Keeps payment history, paid status, login code, proof uploads and access.
- ✅ Notifies each moved student **once** (via the `Webinar Moved` SMS template, if you've enabled it).
- ❌ Never deletes anyone, never duplicates revenue, never re-charges, never creates duplicate students.

Every duplicate / move / auto-close / blocked-payment is recorded in `webinar_audit_log` (with the admin and timestamp).

## Creating / editing a webinar

Click **`+ New Webinar`** (or `Edit`). The form has tabs: `Basic Details`, `Pricing & Seats`, `Media`, `Rich Content`, `Reviews`, `After Registration`, `Cross-sell`, `SEO`, `Contact / WhatsApp`.

Most-used fields:
- **Basic Details:** `Title`, `Slug (URL)`, `Status` (`Upcoming` / `Completed (show recording)`), `Short description`, `Start date & time (IST)`, `End date & time (IST, optional)`, `Session type` (`Live webinar` / `Recorded session`), `Zoom / live class link`, `Recording link`. There's also an `Active` / `Disabled` toggle (visible on public site or not).
- **Pricing & Seats:** `Price (₹)` (`0 = free registration`), `Capacity (seats)`, optional `Show seats remaining` and a `Filling Fast` urgency badge.
- **Media:** cover image, video, downloadable resources, shared brochures.
- **After Registration:** `Orientation & starter videos` (pick reusable videos from the Content library — see [Content / LMS → Orientation / starter videos](content-lms.md)) and `Materials & deliverables` (PDFs/links). Both show only to registered/paid (or staff-comp) attendees on their portal card.

Save with **`Create Webinar`** / **`Save Changes`**. You'll see `Title is required` if the title is empty, or `End time must be after the start time.` if the times are wrong.

## Seeing who registered (registrants)

1. On the list, click **`View registrants`** for the webinar (opens `/admin/webinars/[id]/registrations`).
2. Heading: `Registrants — {title}`.
3. **Summary cards:** `Confirmed`, and for paid webinars also `Pending`, `Failed`, `Unpaid (lead only)`, plus `Total rows`.
4. **Table columns:** `Name`, `Phone`, `Registered`, `Status`, `Attended`, `SMS`.

**Status** in the list:
- Free webinar → everyone shows `Free`.
- Paid webinar → `Paid`, `Pending`, `Failed`, or `Unpaid` (based on their payment).
- ⚠️ `Confirmed` counts only `Paid` + `Free`. People who are `Pending`/`Failed`/`Unpaid` are **not** counted as registered.

> There is **no search, filter, or CSV export** on the registrants page — it shows the full list, newest first.

## How "Attended" works (important)

- The **`Attended`** column shows `Yes` only if that registration is marked attended in the database, otherwise `—`.
- ⚠️ There is **no "Mark attended" button** anywhere, and the system does **not** currently flip this column on its own. In practice the `Attended` column usually stays `—`.
- What the system **does** track is a **Zoom click**: when a registered student clicks **`Attend Live Class →`** in their portal, that "showed up" signal is recorded. This Zoom-click signal is used by:
  - **SMS** audiences (the `Attended` / `No-show` segments),
  - **Business Analytics → Re-engagement segments** (`Paid webinar · no Zoom click`, with CSV export),
  - the student's **Customer journey** (event `Clicked Zoom link`).
- So to find genuine attendees/no-shows, use the **SMS audience** segments or the **Analytics segment**, not the `Attended` column.

## Registering someone manually

⚠️ There is **no "Add registrant" button on the registrants page.** To register someone by hand, do it from their **student profile**:
1. `People` → `Students & Enrollments` → open/create the student.
2. **`Webinars registered`** → **`Register`**.
3. Choose the `Webinar`, enter `Amount paid` (`0` for free), and if paid set `Method` + `Date (IST)`.
4. Click **`Register`** (you'll see `Webinar registered`). This needs the **Manage students, leads & enrollments** permission.

## Sending an SMS to a registrant
On the registrants table, the `SMS` column has a **`SMS`** button per person. Click it, pick an Approved/Active template, preview, and **`Send`**. The message content depends on the template you pick (it isn't a fixed webinar message). Needs the send-SMS permission.

## Where the data lives
- Webinars → `webinars`; registrations → `webinar_registrations` (deleted with the webinar). Paid status comes from `payments`. Zoom clicks → `analytics_events`.
- Lifecycle columns on `webinars`: `registration_status`, `auto_close_registration`, `registration_closes_at`, `ended_at`, `next_webinar_id`, `previous_webinar_id`.
- Move provenance lives on both `webinar_registrations` and `payments`: `moved_from_webinar_id`, `moved_to_webinar_id`, `moved_at`, `moved_by`, `move_reason`, `is_moved_registration`.
- Lifecycle actions are audited in `webinar_audit_log`.
- "Has it ended?" is computed on every page/API hit (no cron) by comparing the current instant to the stored UTC time — correct in IST on any server.
