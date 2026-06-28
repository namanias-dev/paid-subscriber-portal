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
- **`Disable`** / **`Enable`** — hide/show on the public site (reversible).
- **`Delete`** — ⚠️ **permanently deletes the webinar AND all its registrations.** This cannot be undone.

## Creating / editing a webinar

Click **`+ New Webinar`** (or `Edit`). The form has tabs: `Basic Details`, `Pricing & Seats`, `Media`, `Rich Content`, `Reviews`, `After Registration`, `Cross-sell`, `SEO`, `Contact / WhatsApp`.

Most-used fields:
- **Basic Details:** `Title`, `Slug (URL)`, `Status` (`Upcoming` / `Completed (show recording)`), `Short description`, `Start date & time (IST)`, `End date & time (IST, optional)`, `Session type` (`Live webinar` / `Recorded session`), `Zoom / live class link`, `Recording link`. There's also an `Active` / `Disabled` toggle (visible on public site or not).
- **Pricing & Seats:** `Price (₹)` (`0 = free registration`), `Capacity (seats)`, optional `Show seats remaining` and a `Filling Fast` urgency badge.
- **Media:** cover image, video, downloadable resources, shared brochures.

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
